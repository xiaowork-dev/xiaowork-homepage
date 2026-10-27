//go:build linux

package publishworker

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

type fakeBuilder struct {
	output string
	err    error
	calls  int
}

func (b *fakeBuilder) Build(context.Context, publishmodel.Assignment) (string, func(), error) {
	b.calls++
	_ = os.Remove(filepath.Join(b.output, publishmodel.MarkerPath))
	return b.output, func() {}, b.err
}

type fakeControl struct {
	job      *publishmodel.Assignment
	restore  bool
	down     bool
	results  []string
	prepared bool
	badToken bool
}

func (c *fakeControl) Claim(context.Context) (*publishmodel.Assignment, error) { return c.job, nil }
func (c *fakeControl) Heartbeat(context.Context, string, publishmodel.HeartbeatRequest) error {
	return nil
}
func (c *fakeControl) Prepared(_ context.Context, _ string, r publishmodel.PreparedRequest) (publishmodel.PreparedResponse, error) {
	c.prepared = true
	token := strings.Repeat("d", 64)
	if c.badToken {
		token = "bad"
	}
	return publishmodel.PreparedResponse{ActivationToken: token, ExpectedPreviousReleaseID: c.job.ExpectedPreviousReleaseID}, nil
}
func (c *fakeControl) Result(_ context.Context, _ string, r publishmodel.ResultRequest) (ResultResponse, error) {
	c.results = append(c.results, r.Outcome)
	if c.down {
		return ResultResponse{}, errors.New("injected database failure")
	}
	if r.Outcome == "activated" && c.restore {
		return ResultResponse{Status: "reconciling", Action: "restore", ExpectedPreviousReleaseID: c.job.ExpectedPreviousReleaseID}, nil
	}
	status := "succeeded"
	if r.Outcome == "failed" || r.Outcome == "restored" {
		status = "failed"
	}
	return ResultResponse{Status: status, Action: "none", ExpectedPreviousReleaseID: c.job.ExpectedPreviousReleaseID}, nil
}
func runStore(t *testing.T) (*publishfs.Store, string) {
	t.Helper()
	root := t.TempDir()
	s, err := publishfs.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	unlock, err := s.Lock()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { unlock(); s.Close() })
	return s, root
}
func runFixture(t *testing.T) (*Runner, *fakeControl, *fakeBuilder, publishmodel.Assignment) {
	t.Helper()
	job, snapshot := fixture()
	store, _ := runStore(t)
	builder := &fakeBuilder{output: outputFixture(t, job, snapshot)}
	control := &fakeControl{job: &job}
	return &Runner{Control: control, Store: store, Builder: builder, SourceRevision: job.SourceRevision, BuilderID: job.BuilderID}, control, builder, job
}

func TestRunnerPublishRequiresActualPreparedAndReconciledResult(t *testing.T) {
	r, c, b, j := runFixture(t)
	if _, err := r.RunNext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if b.calls != 1 || !c.prepared || len(c.results) != 1 || c.results[0] != "activated" {
		t.Fatal(c.results)
	}
	if current, _ := r.Store.Current(); current != j.ReleaseID {
		t.Fatal(current)
	}
	if _, _, err := r.Store.VerifyRelease(j.ReleaseID); err != nil {
		t.Fatal(err)
	}
}
func TestRunnerBuildAndValidationFailuresNeverActivate(t *testing.T) {
	for _, point := range []string{"build", "bad-html", "bad-approval"} {
		t.Run(point, func(t *testing.T) {
			r, c, b, _ := runFixture(t)
			switch point {
			case "build":
				b.err = errors.New("build timeout")
			case "bad-html":
				os.Remove(filepath.Join(b.output, "about", "index.html"))
			case "bad-approval":
				c.badToken = true
			}
			_, err := r.RunNext(context.Background())
			if point == "bad-approval" && !errors.Is(err, publishfs.ErrRecoveryRequired) {
				t.Fatal(err)
			}
			if point != "bad-approval" && err != nil {
				t.Fatal(err)
			}
			if current, _ := r.Store.Current(); current != "" {
				t.Fatal("failed task activated", current)
			}
		})
	}
}
func TestRunnerGatewayFailureRestoresFirstPublicationAbsence(t *testing.T) {
	r, c, _, j := runFixture(t)
	c.restore = true
	if _, err := r.RunNext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if current, _ := r.Store.Current(); current != "" {
		t.Fatal(current)
	}
	if strings.Join(c.results, ",") != "activated,restored" {
		t.Fatal(c.results)
	}
	if recovery, _, err := r.Store.ReadRecoveryReceipt(j.ID); err != nil || recovery.Outcome != "restored" {
		t.Fatal(err)
	}
}
func TestRunnerDatabaseFailureLeavesGateClosedThenReconcilesWithoutRebuild(t *testing.T) {
	r, c, b, j := runFixture(t)
	c.down = true
	if _, err := r.RunNext(context.Background()); !errors.Is(err, publishfs.ErrRecoveryRequired) {
		t.Fatal(err)
	}
	if current, _ := r.Store.Current(); current != j.ReleaseID {
		t.Fatal(current)
	}
	c.down = false
	c.job.RecoveryRequired = true
	if _, err := r.RunNext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if b.calls != 1 {
		t.Fatal("recovery rebuilt content")
	}
}
func TestRunnerCrashBetweenCurrentAndReceiptRecoversWithoutRebuild(t *testing.T) {
	r, c, b, j := runFixture(t)
	r.Store.SetFaultForTest(func(point string) error {
		if point == "after-current-rename" || point == "before-file-rename" {
			return errors.New("crash")
		}
		return nil
	})
	// Only inject after initial durable preparation/intent, not every file.
	fired := false
	r.Store.SetFaultForTest(func(point string) error {
		if point == "after-current-rename" {
			fired = true
			return errors.New("crash after pointer")
		}
		if fired && point == "before-file-rename" {
			return errors.New("receipt disk failure")
		}
		return nil
	})
	if _, err := r.RunNext(context.Background()); !errors.Is(err, publishfs.ErrRecoveryRequired) {
		t.Fatal(err)
	}
	if current, _ := r.Store.Current(); current != j.ReleaseID {
		t.Fatal(current)
	}
	r.Store.SetFaultForTest(nil)
	c.job.RecoveryRequired = true
	if _, err := r.RunNext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if b.calls != 1 {
		t.Fatal("recovery rebuilt")
	}
	if _, _, err := r.Store.ReadReceipt(j.ID); err != nil {
		t.Fatal(err)
	}
}
func TestRunnerPreviewNeverChangesCurrentAndHasIndependentProof(t *testing.T) {
	r, c, b, j := runFixture(t)
	j.Kind = "preview"
	j.ReleaseID = ident("pre", '1')
	c.job = &j
	_, s := fixture()
	b.output = outputFixture(t, j, s)
	if _, err := r.RunNext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if current, _ := r.Store.Current(); current != "" {
		t.Fatal(current)
	}
	if receipt, _, err := r.Store.ReadReceipt(j.ID); err != nil || receipt.Outcome != "preview-ready" || receipt.ActivationToken != "" {
		t.Fatal(receipt, err)
	}
}

func TestUnixClientActualSocketStrictFiniteProtocol(t *testing.T) {
	socket := filepath.Join(t.TempDir(), "control.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	var mode atomic.Value
	mode.Store("valid")
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != publishmodel.InternalPrefix+"/claim" || r.Method != "POST" {
			t.Error("unexpected control path")
		}
		var request publishmodel.ClaimRequest
		if json.NewDecoder(r.Body).Decode(&request) != nil || request.WorkerID != publishmodel.WorkerID {
			t.Error("bad request")
		}
		switch mode.Load().(string) {
		case "valid":
			w.Write([]byte(`{"data":{"job":null},"requestId":"bounded-id"}`))
		case "unknown":
			w.Write([]byte(`{"data":{"job":null},"surprise":true}`))
		case "huge":
			w.Write([]byte(strings.Repeat("x", MaxMessage+1)))
		case "redirect":
			http.Redirect(w, r, "http://127.0.0.1:1/", 302)
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	client, err := NewUnixClient(socket)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"valid", "unknown", "huge", "redirect"} {
		mode.Store(value)
		_, err := client.Claim(context.Background())
		if value == "valid" && err != nil {
			t.Fatal(err)
		}
		if value != "valid" && err == nil {
			t.Fatal("accepted", value)
		}
	}
}

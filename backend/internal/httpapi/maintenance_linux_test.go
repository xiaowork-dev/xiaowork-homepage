//go:build linux

package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/maintenancegate"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishworker"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

const maintenanceOwner = "22222222-2222-2222-2222-222222222222"

// Only this _test.go helper has checkpoint inputs. No formal runtime binary
// includes them. The worker uses the REAL FixedBuilder and REAL Unix API.
type observedBuilder struct{ event, resume string }

func (b observedBuilder) Build(ctx context.Context, j publishmodel.Assignment) (string, func(), error) {
	if e := os.WriteFile(b.event, []byte("before-real-nuxt-build"), 0600); e != nil {
		return "", nil, e
	}
	for {
		if _, e := os.Stat(b.resume); e == nil {
			break
		}
		select {
		case <-ctx.Done():
			return "", nil, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
	return (publishworker.FixedBuilder{}).Build(ctx, j)
}

type observedControl struct {
	publishworker.Control
	event, resume string
}

func (c observedControl) Prepared(ctx context.Context, id string, p publishmodel.PreparedRequest) (publishmodel.PreparedResponse, error) {
	r, e := c.Control.Prepared(ctx, id, p)
	if e != nil {
		return r, e
	}
	if e = os.WriteFile(c.event, []byte("prepared-before-current-activation"), 0600); e != nil {
		return r, e
	}
	for {
		if _, e = os.Stat(c.resume); e == nil {
			return r, nil
		}
		select {
		case <-ctx.Done():
			return r, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}
func TestMaintenanceProcessHelper(t *testing.T) {
	mode := os.Getenv("P6E_HTTP_HELPER")
	if mode == "" {
		return
	}
	root := os.Getenv("P6E_CONTROL")
	event := os.Getenv("P6E_EVENT")
	resume := os.Getenv("P6E_RESUME")
	if mode == "api" {
		db, e := store.Open(os.Getenv("P6E_DB"), false)
		if e != nil {
			t.Fatal(e)
		}
		defer db.Close()
		s := httptest.NewUnstartedServer(nil)
		app, e := New(db, Config{ControlDir: root, Origin: "https://" + s.Listener.Addr().String(), Secret: bytes.Repeat([]byte{0x42}, 32), UploadDir: os.Getenv("P6E_UPLOADS"), LocalPublish: true, PublicationsDir: os.Getenv("P6E_PUBLICATIONS"), WorkerSocket: os.Getenv("P6E_SOCKET"), SourceRevision: os.Getenv("P6E_SOURCE"), BuilderID: os.Getenv("P6E_BUILDER"), PublicationVerifyURL: os.Getenv("P6E_VERIFY")})
		if e != nil {
			t.Fatal(e)
		}
		s.Config.Handler = app.Handler()
		s.StartTLS()
		defer s.Close()
		if e = os.WriteFile(event, []byte(s.URL), 0600); e != nil {
			t.Fatal(e)
		}
		select {}
	}
	if mode == "operator" {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		if e := maintenancegate.Begin(ctx, root, maintenanceOwner); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(event, []byte("drained"), 0600); e != nil {
			t.Fatal(e)
		}
		return
	}
	client, e := publishworker.NewUnixClient(os.Getenv("P6E_SOCKET"))
	if e != nil {
		t.Fatal(e)
	}
	s, e := publishfs.Open(os.Getenv("P6E_PUBLICATIONS"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	unlock, e := s.Lock()
	if e != nil {
		t.Fatal(e)
	}
	defer unlock()
	var builder publishworker.Builder = publishworker.FixedBuilder{}
	var control publishworker.Control = client
	if mode == "building" {
		builder = observedBuilder{event, resume}
	} else {
		control = observedControl{client, event, resume}
	}
	r := publishworker.Runner{ControlDir: root, Control: control, Store: s, Builder: builder, SourceRevision: os.Getenv("P6E_SOURCE"), BuilderID: os.Getenv("P6E_BUILDER")}
	processed, e := r.RunNext(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if mode == "idle-worker" {
		if processed {
			t.Fatal("blocked worker claimed a task")
		}
		return
	}
	if !processed {
		t.Fatal("worker did not claim an admitted task")
	}
}
func maintenanceProcess(t *testing.T, f *authFixture, mode string) (*exec.Cmd, string, string) {
	t.Helper()
	signals := t.TempDir()
	event := filepath.Join(signals, "event")
	resume := filepath.Join(signals, "resume")
	c := exec.Command(os.Args[0], "-test.run=^TestMaintenanceProcessHelper$", "-test.v", "-test.timeout=4m")
	c.Env = append(os.Environ(), "P6E_HTTP_HELPER="+mode, "P6E_CONTROL="+f.app.config.ControlDir, "P6E_EVENT="+event, "P6E_RESUME="+resume, "P6E_SOCKET="+f.app.config.WorkerSocket, "P6E_PUBLICATIONS="+f.app.config.PublicationsDir, "P6E_SOURCE="+f.app.config.SourceRevision, "P6E_BUILDER="+f.app.config.BuilderID)
	if mode == "api" {
		var seq int
		var name, dbPath string
		if e := f.db.QueryRow(`PRAGMA database_list`).Scan(&seq, &name, &dbPath); e != nil {
			t.Fatal(e)
		}
		c.Env = append(c.Env, "P6E_DB="+dbPath, "P6E_UPLOADS="+f.app.config.UploadDir, "P6E_VERIFY="+f.app.config.PublicationVerifyURL)
	}
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	if e := c.Start(); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = c.Process.Kill(); _ = c.Wait() })
	return c, event, resume
}
func awaitMaintenance(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(100 * time.Second)
	for !check() {
		if time.Now().After(deadline) {
			t.Fatal("maintenance checkpoint deadline")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
func barrierState(t *testing.T, f *authFixture) {
	t.Helper()
	s, e := maintenancegate.Inspect(f.app.config.ControlDir)
	if e != nil {
		t.Fatal(e)
	}
	current, e := f.app.currentRelease()
	if e != nil {
		t.Fatal(e)
	}
	rows, e := f.db.Query(`SELECT id,status,phase FROM publish_jobs ORDER BY created_at,id`)
	if e != nil {
		t.Fatal(e)
	}
	defer rows.Close()
	var tasks []map[string]any
	for rows.Next() {
		var id, status string
		var phase *string
		if e = rows.Scan(&id, &status, &phase); e != nil {
			t.Fatal(e)
		}
		tasks = append(tasks, map[string]any{"id": id, "status": status, "phase": phase})
	}
	files := map[string]string{}
	if e = filepath.Walk(f.app.config.PublicationsDir, func(p string, i os.FileInfo, e error) error {
		if e != nil {
			return e
		}
		if i.Mode().IsRegular() {
			raw, e := os.ReadFile(p)
			if e != nil {
				return e
			}
			h := sha256.Sum256(raw)
			name, _ := filepath.Rel(f.app.config.PublicationsDir, p)
			files[name] = hex.EncodeToString(h[:])
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(map[string]any{"barrier": s, "current": current, "sqliteTasks": tasks, "fileSHA256": files, "apiPid": os.Getpid()})
	t.Log("MACHINE_STATE " + string(raw))
	if locks, e := os.ReadFile("/proc/locks"); e == nil {
		t.Log("KERNEL_LOCKS " + string(locks))
	}
}
func TestMaintenanceHTTPOnlineDenialRestartAndRecovery(t *testing.T) {
	f, c, csrf := publicationFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if e := maintenancegate.Begin(ctx, f.app.config.ControlDir, maintenanceOwner); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"/publish-jobs", "/preview-jobs", "/rollback-jobs"} {
		body, _ := contentHTTP(t, f, c, "POST", path, map[string]any{}, csrf, `"ws-1"`, "maint-deny-key-0001", 503)
		if contentObject(t, body["error"])["code"] != "MAINTENANCE_REQUIRED" {
			t.Fatal(body)
		}
	}
	response, e := c.Get(f.server.URL + "/healthz")
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("API stopped instead of enforced barrier")
	}
	workerCall(t, f, "/claim", publishmodel.ClaimRequest{ProtocolVersion: 1, WorkerID: publishmodel.WorkerID}, 503)
	// Recreate the API application and its HTTP handler with the retained DB
	// and control state; separate kill/exec tests below cover process locks.
	app, e := New(f.db, f.app.config)
	if e != nil {
		t.Fatal(e)
	}
	f.app = app
	f.server.Config.Handler = app.Handler()
	f.request(t, c, "GET", "/auth/session", nil, "", 503)
	barrierState(t, f)
	if e = maintenancegate.Complete(app.config.ControlDir, maintenanceOwner); e != nil {
		t.Fatal(e)
	}
	f.app.workerSeen.Store(f.clock.Load())
	queuePublication(t, f, c, csrf, "preview", "after-maintenance-recovery-1")
	barrierState(t, f)
}
func TestMaintenancePublishArrivalRace(t *testing.T) {
	for attempt := 0; attempt < 8; attempt++ {
		t.Run(fmt.Sprint(attempt), func(t *testing.T) {
			f, c, csrf := publicationFixture(t)
			f.request(t, c, "POST", "/auth/reauth", map[string]string{"password": authTestPassword}, csrf, 200)
			body := []byte(`{"confirmAllChanges":true,"reviewedActiveReleaseId":null}`)
			req, _ := http.NewRequest("POST", f.server.URL+apiPrefix+"/publish-jobs", bytes.NewReader(body))
			req.Header.Set("Origin", f.server.URL)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-CSRF-Token", csrf)
			req.Header.Set("If-Match", publicationRevision(t, f))
			req.Header.Set("Idempotency-Key", "maintenance-race-key-0001")
			start := make(chan struct{})
			var wg sync.WaitGroup
			wg.Add(1)
			var status int
			var requestErr error
			go func() {
				defer wg.Done()
				<-start
				res, e := c.Do(req)
				requestErr = e
				if e == nil {
					status = res.StatusCode
					raw, _ := io.ReadAll(res.Body)
					res.Body.Close()
					t.Logf("real HTTPS publish race status=%d body=%s", status, raw)
				}
			}()
			close(start)
			operator, _, _ := maintenanceProcess(t, f, "operator")
			wg.Wait()
			if requestErr != nil {
				t.Fatal(requestErr)
			}
			if e := operator.Wait(); e != nil {
				t.Fatal(e)
			}
			if status != 202 && status != 503 {
				t.Fatal(status)
			}
			var count int
			if e := f.db.QueryRow(`SELECT count(*) FROM publish_jobs`).Scan(&count); e != nil {
				t.Fatal(e)
			}
			if status == 202 && count != 1 || status == 503 && count != 0 {
				t.Fatal("HTTP/SQLite mismatch", status, count)
			}
			contentHTTP(t, f, c, "POST", "/publish-jobs", map[string]any{}, csrf, `"ws-1"`, "maintenance-race-key-0002", 503)
			workerCall(t, f, "/claim", publishmodel.ClaimRequest{ProtocolVersion: 1, WorkerID: publishmodel.WorkerID}, 503)
			barrierState(t, f)
		})
	}
}

func TestMaintenanceAPIAndWorkerExecRestart(t *testing.T) {
	f, c, _ := publicationFixture(t)
	f.server.Close()
	if e := maintenancegate.Begin(context.Background(), f.app.config.ControlDir, maintenanceOwner); e != nil {
		t.Fatal(e)
	}
	for attempt := 0; attempt < 2; attempt++ {
		api, event, _ := maintenanceProcess(t, f, "api")
		awaitMaintenance(t, func() bool { _, e := os.Stat(event); return e == nil })
		endpoint, e := os.ReadFile(event)
		if e != nil {
			t.Fatal(e)
		}
		res, e := c.Get(string(endpoint) + apiPrefix + "/auth/session")
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 503 || !bytes.Contains(raw, []byte("MAINTENANCE_REQUIRED")) {
			t.Fatal(res.StatusCode, string(raw))
		}
		res, e = c.Get(string(endpoint) + "/healthz")
		if e != nil {
			t.Fatal(e)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatal(res.StatusCode)
		}
		worker, _, _ := maintenanceProcess(t, f, "idle-worker")
		if e = worker.Wait(); e != nil {
			t.Fatal(e)
		}
		t.Logf("restart=%d apiPID=%d workerPID=%d HTTPS=503/MAINTENANCE_REQUIRED health=200; worker did not Claim", attempt, api.Process.Pid, worker.Process.Pid)
		if attempt == 1 {
			if e = maintenancegate.Complete(f.app.config.ControlDir, maintenanceOwner); e != nil {
				t.Fatal(e)
			}
			res, e = c.Get(string(endpoint) + apiPrefix + "/auth/session")
			if e != nil {
				t.Fatal(e)
			}
			raw, _ = io.ReadAll(res.Body)
			res.Body.Close()
			if res.StatusCode != 200 {
				t.Fatal(res.StatusCode, string(raw))
			}
		}
		if e = api.Process.Kill(); e != nil {
			t.Fatal(e)
		}
		_ = api.Wait()
	}
	barrierState(t, f)
}
func TestMaintenanceActualWorkerDrainsBuildAndActivation(t *testing.T) {
	if _, e := os.Stat(publishworker.NuxtCLI); e != nil {
		t.Skip("real offline builder only in isolated gate test image")
	}
	for _, mode := range []string{"building", "activating"} {
		t.Run(mode, func(t *testing.T) {
			f, c, csrf := publicationFixture(t)
			socketDir, e := os.MkdirTemp("", "gate-uds-")
			if e != nil {
				t.Fatal(e)
			}
			defer os.RemoveAll(socketDir)
			if e = os.Chmod(socketDir, 0700); e != nil {
				t.Fatal(e)
			}
			f.app.config.WorkerSocket = filepath.Join(socketDir, "publisher.sock")
			listener, e := f.app.WorkerListener()
			if e != nil {
				t.Fatal(e)
			}
			defer listener.Close()
			server := Server("", f.app.WorkerHandler())
			defer server.Close()
			go server.Serve(listener)
			id := queuePublication(t, f, c, csrf, "publish", "real-worker-maintenance-"+mode)
			worker, event, resume := maintenanceProcess(t, f, mode)
			awaitMaintenance(t, func() bool { _, e := os.Stat(event); return e == nil })
			operator, drained, _ := maintenanceProcess(t, f, "operator")
			awaitMaintenance(t, func() bool {
				s, e := maintenancegate.Inspect(f.app.config.ControlDir)
				return e == nil && s.Phase == "draining"
			})
			if _, e = os.Stat(drained); !os.IsNotExist(e) {
				t.Fatal("maintenance entered before worker drained")
			}
			contentHTTP(t, f, c, "POST", "/publish-jobs", map[string]any{}, csrf, `"ws-1"`, "during-real-worker-build-1", 503)
			barrierState(t, f)
			if e = os.WriteFile(resume, []byte("continue admitted task"), 0600); e != nil {
				t.Fatal(e)
			}
			if e = worker.Wait(); e != nil {
				t.Fatal("real Nuxt/Runner task failed", e)
			}
			if e = operator.Wait(); e != nil {
				t.Fatal("maintenance did not drain", e)
			}
			var status string
			if e = f.db.QueryRow(`SELECT status FROM publish_jobs WHERE id=?`, id).Scan(&status); e != nil || status != "succeeded" {
				t.Fatal(status, e)
			}
			if e = f.app.verifyActive(context.Background(), mustCurrent(t, f)); e != nil {
				t.Fatal(e)
			}
			barrierState(t, f)
			if e = maintenancegate.Complete(f.app.config.ControlDir, maintenanceOwner); e != nil {
				t.Fatal(e)
			}
			f.request(t, c, "GET", "/publishing-status", nil, "", 200)
		})
	}
}
func mustCurrent(t *testing.T, f *authFixture) string {
	t.Helper()
	id, e := f.app.currentRelease()
	if e != nil || id == "" {
		t.Fatal(id, e)
	}
	return id
}

func TestMaintenanceWaitsForAdmittedHTTPTransaction(t *testing.T) {
	f, c, csrf := publicationFixture(t)
	f.request(t, c, "POST", "/auth/reauth", map[string]string{"password": authTestPassword}, csrf, 200)
	revision := publicationRevision(t, f)
	// The real pool has one connection. Hold it to suspend the real HTTPS
	// authorization/SQLite path AFTER the public shared lease was acquired.
	conn, e := f.db.Conn(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	baseline := f.db.Stats().WaitCount
	request, _ := http.NewRequest("POST", f.server.URL+apiPrefix+"/publish-jobs", bytes.NewBufferString(`{"confirmAllChanges":true,"reviewedActiveReleaseId":null}`))
	request.Header.Set("Origin", f.server.URL)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", csrf)
	request.Header.Set("If-Match", revision)
	request.Header.Set("Idempotency-Key", "real-admitted-http-transaction")
	type result struct {
		status int
		raw    string
		err    error
	}
	done := make(chan result, 1)
	go func() {
		res, e := c.Do(request)
		if e != nil {
			done <- result{err: e}
			return
		}
		raw, e := io.ReadAll(res.Body)
		res.Body.Close()
		done <- result{res.StatusCode, string(raw), e}
	}()
	awaitMaintenance(t, func() bool { return f.db.Stats().WaitCount > baseline })
	operator, event, _ := maintenanceProcess(t, f, "operator")
	awaitMaintenance(t, func() bool {
		s, e := maintenancegate.Inspect(f.app.config.ControlDir)
		return e == nil && s.Phase == "draining"
	})
	if _, e = os.Stat(event); !os.IsNotExist(e) {
		t.Fatal("operator crossed admitted HTTP request")
	}
	contentHTTP(t, f, c, "POST", "/publish-jobs", map[string]any{}, csrf, revision, "new-request-during-sqlite-wait", 503)
	if e = conn.Close(); e != nil {
		t.Fatal(e)
	}
	outcome := <-done
	if outcome.err != nil || outcome.status != 202 {
		t.Fatal(outcome)
	}
	if e = operator.Wait(); e != nil {
		t.Fatal(e)
	}
	t.Logf("admitted HTTPS held real SQLite pool; maintenance waited through task Commit; status=%d body=%s; subsequent HTTPS=503", outcome.status, outcome.raw)
	barrierState(t, f)
}

func TestMaintenanceControlAccessFailure(t *testing.T) {
	for _, mode := range []string{"unreadable", "missing", "corrupt"} {
		t.Run(mode, func(t *testing.T) {
			f, c, csrf := publicationFixture(t)
			queuePublication(t, f, c, csrf, "preview", "control-access-failure-"+mode)
			root := f.app.config.ControlDir
			original, e := os.ReadFile(filepath.Join(root, "state.json"))
			if e != nil {
				t.Fatal(e)
			}
			switch mode {
			case "unreadable":
				if e = os.Chmod(root, 0000); e != nil {
					t.Fatal(e)
				}
				defer os.Chmod(root, 0700)
			case "missing":
				if e = os.Rename(root, root+".test-unavailable"); e != nil {
					t.Fatal(e)
				}
				defer os.Rename(root+".test-unavailable", root)
			case "corrupt":
				if e = os.WriteFile(filepath.Join(root, "state.json"), []byte("{invalid-test-only-state"), 0600); e != nil {
					t.Fatal(e)
				}
			}
			body, _ := contentHTTP(t, f, c, "POST", "/publish-jobs", map[string]any{}, csrf, `"ws-1"`, "bad-control-request-0001", 503)
			if contentObject(t, body["error"])["code"] != "MAINTENANCE_REQUIRED" {
				t.Fatal(body)
			}
			workerCall(t, f, "/claim", publishmodel.ClaimRequest{ProtocolVersion: 1, WorkerID: publishmodel.WorkerID}, 503)
			var count int
			var status string
			if e = f.db.QueryRow(`SELECT count(*),status FROM publish_jobs GROUP BY status`).Scan(&count, &status); e != nil || count != 1 || status != "queued" {
				t.Fatal(count, status, e)
			}
			current, e := f.app.currentRelease()
			if e != nil || current != "" {
				t.Fatal(current, e)
			}
			hash := sha256.Sum256(original)
			t.Logf("control=%s pid=%d originalStateSHA256=%x; real HTTPS=503; UDS Claim=503; SQLite queued=1; current=empty; no new artifact", mode, os.Getpid(), hash)
		})
	}
}

//go:build linux

package httpapi

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishworker"
)

func diagnosticsUnixControl(t *testing.T, f *authFixture) *publishworker.UnixClient {
	t.Helper()
	dir, err := os.MkdirTemp("", "xw-diagnostics-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	f.app.config.WorkerSocket = filepath.Join(dir, "publisher.sock")
	listener, err := f.app.WorkerListener()
	if err != nil {
		t.Fatal(err)
	}
	server := Server("", f.app.WorkerHandler())
	t.Cleanup(func() { _ = server.Close(); _ = listener.Close() })
	go server.Serve(listener)
	control, err := publishworker.NewUnixClient(f.app.config.WorkerSocket)
	if err != nil {
		t.Fatal(err)
	}
	return control
}

func TestPublicationRecoverySuccessAtomicallyClearsOnlyCurrentDiagnostics(t *testing.T) {
	// A focused real SQLite/filesystem/HTTPS/private-UDS integration test. The
	// artifact fixture does not pretend to be another real Nuxt fault build.
	f, client, csrf := publicationFixture(t)
	queuePublication(t, f, client, csrf, "publish", "recovery-current-diagnostics")
	control := diagnosticsUnixControl(t, f)
	job, err := control.Claim(context.Background())
	if err != nil || job == nil {
		t.Fatalf("actual UDS claim failed: %v", err)
	}
	store, _, manifestHash := prepareArtifact(t, f, *job)
	if err = control.Heartbeat(context.Background(), job.ID, publishmodel.HeartbeatRequest{LeaseToken: job.LeaseToken, Phase: "validating"}); err != nil {
		t.Fatal(err)
	}
	prepared, err := control.Prepared(context.Background(), job.ID, publishmodel.PreparedRequest{LeaseToken: job.LeaseToken, ManifestSHA256: manifestHash})
	if err != nil {
		t.Fatal(err)
	}
	activateArtifact(t, f, store, *job, manifestHash, prepared.ActivationToken)
	_, originalReceipt, err := store.ReadReceipt(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	var unavailable atomic.Bool
	unavailable.Store(true)
	var failedHTTP, successfulHTTP atomic.Int64
	target := f.app.config.PublicationVerifyURL
	transport := &http.Transport{Proxy: nil}
	t.Cleanup(transport.CloseIdleConnections)
	proofClient := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	proof := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if unavailable.Load() {
			failedHTTP.Add(1)
			http.Error(w, "isolated proof service unavailable", http.StatusServiceUnavailable)
			return
		}
		response, err := proofClient.Get(target + r.URL.RequestURI())
		if err != nil {
			http.Error(w, "isolated proof forwarding failed", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		if response.StatusCode == http.StatusOK {
			successfulHTTP.Add(1)
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
	}))
	t.Cleanup(proof.Close)
	f.app.config.PublicationVerifyURL = proof.URL
	for attempt := 0; attempt < 2; attempt++ {
		result, err := control.Result(context.Background(), job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "activated"})
		if err != nil || result.Status != "reconciling" || result.Action != "restore" {
			t.Fatalf("actual failed HTTP proof incorrectly completed: %#v %v", result, err)
		}
		var status, code, summary string
		if err = f.db.QueryRow(`SELECT status,error_code,error_summary FROM publish_jobs WHERE id=?`, job.ID).Scan(&status, &code, &summary); err != nil {
			t.Fatal(err)
		}
		if status != "reconciling" || code != "RECONCILIATION_FAILED" || summary == "" {
			t.Fatal("recovery failure lost its current diagnostics")
		}
		view, _ := f.request(t, client, "GET", "/jobs/"+job.ID, nil, "", http.StatusOK)
		if current := contentObject(t, authData(t, view)["job"]); current["status"] != "reconciling" || current["error"] == nil || current["activeVerified"] != false {
			t.Fatal("HTTPS job view hid the still-unresolved failure")
		}
	}
	if failedHTTP.Load() < 2 {
		t.Fatal("the two failures did not reach a real HTTP verifier")
	}
	var retainedFailureIDs string
	if err = f.db.QueryRow(`SELECT group_concat(id,',') FROM (SELECT id FROM audit_events WHERE resource_id=? AND action='publication.worker.reconciling' AND outcome='failure' ORDER BY id)`, job.ID).Scan(&retainedFailureIDs); err != nil || retainedFailureIDs == "" {
		t.Fatal("failure audit history missing")
	}
	// A trigger verifies that diagnostic clearing occurs in the same SQL UPDATE
	// as success, rather than as an unrelated cleanup write after success.
	if _, err = f.db.Exec(`CREATE TRIGGER test_atomic_success_diagnostics BEFORE UPDATE OF status ON publish_jobs WHEN NEW.status='succeeded' AND (NEW.error_code IS NOT NULL OR NEW.error_summary IS NOT NULL) BEGIN SELECT RAISE(ABORT,'success must clear current diagnostics atomically'); END`); err != nil {
		t.Fatal(err)
	}
	f.clock.Add(workerLeaseSeconds + 1)
	reclaimed, err := control.Claim(context.Background())
	if err != nil || reclaimed == nil || reclaimed.ID != job.ID || !reclaimed.RecoveryRequired {
		t.Fatal("recovery did not reclaim the same frozen task")
	}
	unavailable.Store(false)
	result, err := control.Result(context.Background(), job.ID, publishmodel.ResultRequest{LeaseToken: reclaimed.LeaseToken, Outcome: "activated"})
	if err != nil || result.Status != "succeeded" || result.Action != "none" || successfulHTTP.Load() == 0 {
		t.Fatalf("repaired actual HTTP proof did not complete cleanly: %#v %v", result, err)
	}
	var status, retainedAfter string
	var code, summary sql.NullString
	if err = f.db.QueryRow(`SELECT status,error_code,error_summary FROM publish_jobs WHERE id=?`, job.ID).Scan(&status, &code, &summary); err != nil || status != "succeeded" || code.Valid || summary.Valid {
		t.Fatalf("successful DB row retained stale diagnostics: status=%s codeValid=%t summaryValid=%t err=%v", status, code.Valid, summary.Valid, err)
	}
	if err = f.db.QueryRow(`SELECT group_concat(id,',') FROM (SELECT id FROM audit_events WHERE resource_id=? AND action='publication.worker.reconciling' AND outcome='failure' ORDER BY id)`, job.ID).Scan(&retainedAfter); err != nil || retainedAfter != retainedFailureIDs {
		t.Fatal("successful reconciliation deleted or rewrote the failure audit history")
	}
	var failures, successes int
	if err = f.db.QueryRow(`SELECT count(*) FROM audit_events WHERE resource_id=? AND action='publication.worker.reconciling' AND outcome='failure'`, job.ID).Scan(&failures); err != nil || failures != 2 {
		t.Fatal("the two failed reconciliation audits were not preserved")
	}
	if err = f.db.QueryRow(`SELECT count(*) FROM audit_events WHERE resource_id=? AND action='publication.worker.succeeded' AND outcome='success'`, job.ID).Scan(&successes); err != nil || successes != 1 {
		t.Fatal("success did not append exactly one audit event")
	}
	view, _ := f.request(t, client, "GET", "/jobs/"+job.ID, nil, "", http.StatusOK)
	if current := contentObject(t, authData(t, view)["job"]); current["status"] != "succeeded" || current["error"] != nil || current["activeVerified"] != true {
		t.Fatal("HTTPS job view did not expose succeeded/error:null/activeVerified:true")
	}
	if _, err = control.Result(context.Background(), job.ID, publishmodel.ResultRequest{LeaseToken: reclaimed.LeaseToken, Outcome: "activated"}); err == nil {
		t.Fatal("completed task accepted a duplicate result")
	}
	if _, hash, err := store.ReadReceipt(job.ID); err != nil || hash != originalReceipt {
		t.Fatal("diagnostic cleanup rewrote the immutable activation receipt")
	}
	t.Log("two real HTTP503 proof failures -> same-task UDS reclaim -> real HTTP proof success; SQLite success/errorNULL atomic trigger passed; HTTPS succeeded/error:null/activeVerified:true; two failure audits retained plus one success; duplicate result rejected")
}

func TestPublicationTerminalFailureRetainsDiagnosticsAndAudit(t *testing.T) {
	f, client, csrf := publicationFixture(t)
	queuePublication(t, f, client, csrf, "preview", "terminal-diagnostics-preserved")
	control := diagnosticsUnixControl(t, f)
	job, err := control.Claim(context.Background())
	if err != nil || job == nil {
		t.Fatal("private UDS did not return a job")
	}
	result, err := control.Result(context.Background(), job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "failed", ErrorCode: "INVALID_ASSIGNMENT"})
	if err != nil || result.Status != "failed" || result.Action != "none" {
		t.Fatalf("terminal failure was changed by diagnostic cleanup: %#v %v", result, err)
	}
	if _, err = control.Result(context.Background(), job.ID, publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "activated"}); err == nil {
		t.Fatal("terminal failed job accepted a success retry")
	}
	var status, code, summary string
	if err = f.db.QueryRow(`SELECT status,error_code,error_summary FROM publish_jobs WHERE id=?`, job.ID).Scan(&status, &code, &summary); err != nil || status != "failed" || code != "INVALID_ASSIGNMENT" || summary != "发布任务契约校验失败，公开版本未改变。" {
		t.Fatal("terminal failure diagnostics were cleared or changed")
	}
	var failures int
	if err = f.db.QueryRow(`SELECT count(*) FROM audit_events WHERE resource_id=? AND action='publication.worker.failed' AND outcome='failure'`, job.ID).Scan(&failures); err != nil || failures != 1 {
		t.Fatal("terminal failure audit was not preserved")
	}
	view, _ := f.request(t, client, "GET", "/jobs/"+job.ID, nil, "", http.StatusOK)
	current := contentObject(t, authData(t, view)["job"])
	if current["status"] != "failed" || contentObject(t, current["error"])["code"] != "INVALID_ASSIGNMENT" || current["activeVerified"] != false {
		t.Fatal("HTTPS no longer reported the final failure accurately")
	}
	t.Log("actual UDS final failure -> DB/API failed+sanitized error retained; duplicate success rejected; original failure audit preserved")
}

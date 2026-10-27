package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

func TestPublicationConcurrentHTTPSRequestsCreateSingleJob(t *testing.T) {
	for _, duplicate := range []bool{false, true} {
		t.Run(fmt.Sprintf("duplicate-key-%t", duplicate), func(t *testing.T) {
			f, client, csrf := publicationFixture(t)
			revision := publicationRevision(t, f)
			body := []byte(`{"confirmAllChanges":true,"reviewedActiveReleaseId":null}`)
			// Hold both actual HTTPS requests at the server boundary, then let
			// the real middleware/SQLite handlers run concurrently. A sequential
			// second request alone would not test competing submissions.
			arrived := make(chan struct{}, 2)
			release := make(chan struct{})
			var releaseOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(release) }) }
			defer unblock()
			handler := f.server.Config.Handler
			f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost && r.URL.Path == apiPrefix+"/publish-jobs" {
					arrived <- struct{}{}
					select {
					case <-release:
					case <-r.Context().Done():
						return
					}
				}
				handler.ServeHTTP(w, r)
			})
			type outcome struct {
				status int
				body   map[string]any
				err    error
			}
			results := make(chan outcome, 2)
			for i := 0; i < 2; i++ {
				key := fmt.Sprintf("concurrent-publication-key-%d", i)
				if duplicate {
					key = "concurrent-publication-same-key"
				}
				req, err := http.NewRequest(http.MethodPost, f.server.URL+apiPrefix+"/publish-jobs", bytes.NewReader(body))
				if err != nil {
					t.Fatal(err)
				}
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Origin", f.server.URL)
				req.Header.Set("X-CSRF-Token", csrf)
				req.Header.Set("If-Match", revision)
				req.Header.Set("Idempotency-Key", key)
				go func() {
					res, err := client.Do(req)
					if err != nil {
						results <- outcome{err: err}
						return
					}
					defer res.Body.Close()
					var envelope map[string]any
					err = json.NewDecoder(res.Body).Decode(&envelope)
					if res.Header.Get("Cache-Control") != "no-store" {
						err = fmt.Errorf("concurrent response lacks no-store")
					}
					results <- outcome{status: res.StatusCode, body: envelope, err: err}
				}()
			}
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
			for i := 0; i < 2; i++ {
				select {
				case <-arrived:
				case <-deadline.C:
					t.Fatal("both HTTPS submissions did not reach the concurrency barrier")
				}
			}
			unblock()
			accepted, conflicts := 0, 0
			jobID := ""
			for i := 0; i < 2; i++ {
				result := <-results
				if result.err != nil {
					t.Fatal(result.err)
				}
				switch result.status {
				case http.StatusAccepted:
					accepted++
					id, ok := authData(t, result.body)["jobId"].(string)
					if !ok || !publishmodel.ValidID(id, "job") || jobID != "" && jobID != id {
						t.Fatal("concurrent requests returned different or invalid task IDs")
					}
					jobID = id
				case http.StatusConflict:
					conflicts++
					if contentObject(t, result.body["error"])["code"] != "JOB_CONFLICT" {
						t.Fatal("competing task did not fail with JOB_CONFLICT")
					}
				default:
					t.Fatalf("unexpected concurrent submission status %d", result.status)
				}
			}
			if duplicate && (accepted != 2 || conflicts != 0) || !duplicate && (accepted != 1 || conflicts != 1) {
				t.Fatalf("duplicate=%t accepted=%d conflicts=%d", duplicate, accepted, conflicts)
			}
			for _, table := range []string{"snapshots", "publish_jobs", "publication_job_details", "idempotency_records"} {
				var count int
				if err := f.db.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 1 {
					t.Fatalf("%s count=%d err=%v; concurrent loser left partial state", table, count, err)
				}
			}
			if publicationRevision(t, f) != revision {
				t.Fatal("competing publication submissions changed the draft")
			}
			t.Logf("two overlapping verified HTTPS submissions; duplicate=%t accepted=%d conflict=%d; exactly one sealed snapshot/job/assignment/idempotency record", duplicate, accepted, conflicts)
		})
	}
}

func TestPublicationRealSQLiteResultFailureReconcilesExistingActivation(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("real atomic symlink activation and retained filesystem proof run on Linux")
	}
	// This is a real SQLite + filesystem + HTTP reconciliation test using a
	// fixed artifact fixture. It deliberately does not claim a real Nuxt build.
	f, client, csrf := publicationFixture(t)
	revision := publicationRevision(t, f)
	queuePublication(t, f, client, csrf, "publish", "sqlite-result-failure-publish")
	job := claimJob(t, f)
	store, _, manifestHash := prepareArtifact(t, f, job)
	token := prepareWorker(t, f, job, manifestHash)
	activateArtifact(t, f, store, job, manifestHash, token)
	_, originalReceiptHash, err := store.ReadReceipt(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	manifest, _, err := store.ReadManifest(job.ReleaseID)
	if err != nil {
		t.Fatal(err)
	}
	// Count real HTTP proof requests without replacing the artifact verifier
	// with a fake success response. The forwarding target is the fixture's
	// actual current-pointer filesystem server.
	var verificationCalls atomic.Int64
	target := f.app.config.PublicationVerifyURL
	transport := &http.Transport{Proxy: nil}
	t.Cleanup(transport.CloseIdleConnections)
	proofClient := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	proofServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response, err := proofClient.Get(target + r.URL.RequestURI())
		if err != nil {
			http.Error(w, "fixture verification unavailable", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		if response.StatusCode == http.StatusOK {
			verificationCalls.Add(1)
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
	}))
	t.Cleanup(proofServer.Close)
	f.app.config.PublicationVerifyURL = proofServer.URL
	if _, err = f.db.Exec(`CREATE TRIGGER test_result_commit_failure BEFORE UPDATE OF status ON publish_jobs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'test actual SQLite result write failure'); END`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = f.db.Exec(`DROP TRIGGER IF EXISTS test_result_commit_failure`) })
	failure := workerCall(t, f, "/jobs/"+job.ID+"/result", publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "activated"}, 409)
	if contentObject(t, failure["error"])["code"] != "RECORD_CONFLICT" {
		t.Fatal("completion did not fail at the actual SQLite constraint trigger")
	}
	proofRequestsBeforeFailure := verificationCalls.Load()
	if proofRequestsBeforeFailure != int64(len(manifest.Files)) {
		t.Fatal("SQLite result failure was not reached after real HTTP verification of every manifest file")
	}
	var status string
	var completed, reconciledAt sql.NullInt64
	var release, proof sql.NullString
	if err = f.db.QueryRow(`SELECT status,completed_at,reconciled_release_id,reconciled_at,reconciliation_receipt_sha256 FROM publish_jobs WHERE id=?`, job.ID).Scan(&status, &completed, &release, &reconciledAt, &proof); err != nil {
		t.Fatal(err)
	}
	if status != "reconciling" || completed.Valid || release.Valid || reconciledAt.Valid || proof.Valid {
		t.Fatal("failed SQLite completion transaction exposed a successful or partial DB proof")
	}
	if current, err := store.Current(); err != nil || current != job.ReleaseID {
		t.Fatal("SQLite result failure changed the already atomically activated artifact")
	}
	contentHTTP(t, f, client, "POST", "/preview-jobs", map[string]any{}, csrf, revision, "sqlite-result-failure-blocked-new", 409)
	capability, _ := f.request(t, client, "GET", "/publishing-status", nil, "", 200)
	data := authData(t, capability)
	if data["activeVerified"] != false || contentObject(t, data["blockingJob"])["id"] != job.ID {
		t.Fatal("uncertain SQLite result did not keep the publication gate closed")
	}
	if _, err = f.db.Exec(`DROP TRIGGER test_result_commit_failure`); err != nil {
		t.Fatal(err)
	}
	// Recover the same frozen task after its lease expires. No new snapshot,
	// build, release or activation is created to paper over the DB failure.
	f.clock.Add(workerLeaseSeconds + 1)
	reclaimed := claimJob(t, f)
	if reclaimed.ID != job.ID || !reclaimed.RecoveryRequired || reclaimed.LeaseToken == job.LeaseToken {
		t.Fatal("uncertain result was not reclaimed as the same recovery task")
	}
	workerCall(t, f, "/jobs/"+job.ID+"/result", publishmodel.ResultRequest{LeaseToken: job.LeaseToken, Outcome: "activated"}, 409)
	verifiedBefore := verificationCalls.Load()
	result := workerCall(t, f, "/jobs/"+job.ID+"/result", publishmodel.ResultRequest{LeaseToken: reclaimed.LeaseToken, Outcome: "activated"}, 200)
	if result["status"] != "succeeded" || result["action"] != "none" || verificationCalls.Load() <= verifiedBefore {
		t.Fatal("same-task recovery did not independently repeat real HTTP verification")
	}
	if err = f.app.verifyActive(context.Background(), job.ReleaseID); err != nil {
		t.Fatal(err)
	}
	if _, actualHash, err := store.VerifyRelease(job.ReleaseID); err != nil || actualHash != manifestHash {
		t.Fatal("DB recovery changed the retained artifact")
	}
	if _, actualHash, err := store.ReadReceipt(job.ID); err != nil || actualHash != originalReceiptHash {
		t.Fatal("DB recovery rewrote the original activation receipt")
	}
	for _, table := range []string{"snapshots", "publish_jobs", "publication_job_details", "releases"} {
		var count int
		if err := f.db.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s count=%d err=%v; recovery duplicated state", table, count, err)
		}
	}
	var attempts int
	if err = f.db.QueryRow(`SELECT attempts FROM publish_jobs WHERE id=?`, job.ID).Scan(&attempts); err != nil || attempts != 2 {
		t.Fatal("same task did not retain its two lease attempts")
	}
	if publicationRevision(t, f) != revision {
		t.Fatal("result recovery changed the draft")
	}
	t.Logf("actual SQLite trigger aborted completion after %d real HTTP proof requests; reconciling blocked new jobs; expired lease reclaimed same job and completed from unchanged artifact/receipt without rebuild", proofRequestsBeforeFailure)
}

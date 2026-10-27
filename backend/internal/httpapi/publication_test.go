package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

func publicationFixture(t *testing.T) (*authFixture, *http.Client, string) {
	t.Helper()
	f, c, csrf := seededContentFixture(t)
	directory := t.TempDir()
	s, e := publishfs.Open(directory)
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	verify := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, e := f.app.currentRelease()
		if e != nil || id == "" {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if !publishfs.SafePath(name) {
			http.NotFound(w, r)
			return
		}
		raw, err := os.ReadFile(filepath.Join(directory, "releases", id, "public", filepath.FromSlash(name)))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(200)
		w.Write(raw)
	}))
	t.Cleanup(verify.Close)
	f.app.config.LocalPublish = true
	f.app.config.PublicationsDir = directory
	f.app.config.WorkerSocket = filepath.Join(t.TempDir(), "worker.sock")
	f.app.config.PublicationVerifyURL = verify.URL
	f.app.config.SourceRevision = strings.Repeat("a", 40)
	f.app.config.BuilderID = "sha256:" + strings.Repeat("b", 64)
	if e = validatePublicationConfig(f.app.config); e != nil {
		t.Fatal(e)
	}
	f.app.workerSeen.Store(f.clock.Load())
	return f, c, csrf
}
func workerCall(t *testing.T, f *authFixture, endpoint string, body any, expected int) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest("POST", publishmodel.InternalPrefix+endpoint, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	f.app.WorkerHandler().ServeHTTP(w, r)
	if w.Code != expected {
		t.Fatalf("worker %s expected=%d actual=%d body=%s", endpoint, expected, w.Code, w.Body.String())
	}
	var envelope map[string]any
	if e := json.Unmarshal(w.Body.Bytes(), &envelope); e != nil {
		t.Fatal(e)
	}
	t.Logf("private protocol POST %s expected=%d actual=%d", endpoint, expected, w.Code)
	if expected != 200 {
		return envelope
	}
	return authData(t, envelope)
}
func claimJob(t *testing.T, f *authFixture) publishmodel.Assignment {
	t.Helper()
	data := workerCall(t, f, "/claim", publishmodel.ClaimRequest{ProtocolVersion: 1, WorkerID: publishmodel.WorkerID}, 200)
	raw, _ := json.Marshal(data["job"])
	var job publishmodel.Assignment
	if e := json.Unmarshal(raw, &job); e != nil || job.ID == "" {
		t.Fatalf("claim missing: %s %v", raw, e)
	}
	return job
}
func publicationRevision(t *testing.T, f *authFixture) string {
	t.Helper()
	r, e := contentdata.CurrentRevision(context.Background(), f.db)
	if e != nil {
		t.Fatal(e)
	}
	return `"` + revisionLabel(r) + `"`
}
func queuePublication(t *testing.T, f *authFixture, c *http.Client, csrf, kind, key string) string {
	t.Helper()
	body := map[string]any{}
	if kind != "preview" {
		f.request(t, c, "POST", "/auth/reauth", map[string]string{"password": authTestPassword}, csrf, 200)
		body["confirmAllChanges"] = true
		current, err := f.app.currentRelease()
		if err != nil {
			t.Fatal(err)
		}
		body["reviewedActiveReleaseId"] = nil
		if current != "" {
			body["reviewedActiveReleaseId"] = current
		}
	}
	result, _ := contentHTTP(t, f, c, "POST", "/"+kind+"-jobs", body, csrf, publicationRevision(t, f), key, 202)
	return authData(t, result)["jobId"].(string)
}

func TestPublicationHTTPSGatesRevisionReauthIdempotencyAndAtomicFailure(t *testing.T) {
	f, c, csrf := publicationFixture(t)
	anon := f.client(t)
	contentHTTP(t, f, anon, "POST", "/publish-jobs", map[string]any{}, "", `"ws-1"`, "test-publish-anon-1", 401)
	body := map[string]any{"confirmAllChanges": true, "reviewedActiveReleaseId": nil}
	rev := publicationRevision(t, f)
	if _, e := f.db.Exec(`UPDATE sessions SET reauth_until=NULL`); e != nil {
		t.Fatal(e)
	}
	contentHTTP(t, f, c, "POST", "/publish-jobs", body, "", rev, "test-publish-csrf-1", 403)
	contentHTTP(t, f, c, "POST", "/publish-jobs", body, csrf, rev, "test-publish-reauth-1", 403)
	f.request(t, c, "POST", "/auth/reauth", map[string]string{"password": authTestPassword}, csrf, 200)
	contentHTTP(t, f, c, "POST", "/publish-jobs", body, csrf, `"ws-999"`, "test-publish-stale-1", 409)
	contentHTTP(t, f, c, "POST", "/publish-jobs", map[string]any{"confirmAllChanges": true, "path": "/etc/passwd"}, csrf, rev, "test-publish-path-1", 400)
	if _, e := f.db.Exec(`CREATE TRIGGER test_job_failure BEFORE INSERT ON publish_jobs BEGIN SELECT RAISE(ABORT,'test transaction failure'); END`); e != nil {
		t.Fatal(e)
	}
	contentHTTP(t, f, c, "POST", "/publish-jobs", body, csrf, rev, "test-publish-txfail-1", 409)
	var n int
	f.db.QueryRow(`SELECT count(*) FROM snapshots`).Scan(&n)
	if n != 0 {
		t.Fatal("failed queue transaction leaked snapshot")
	}
	f.db.Exec(`DROP TRIGGER test_job_failure`)
	first, _ := contentHTTP(t, f, c, "POST", "/publish-jobs", body, csrf, rev, "test-publish-idempotent-1", 202)
	second, _ := contentHTTP(t, f, c, "POST", "/publish-jobs", body, csrf, rev, "test-publish-idempotent-1", 202)
	if authData(t, first)["jobId"] != authData(t, second)["jobId"] {
		t.Fatal("retry duplicated job")
	}
	contentHTTP(t, f, c, "POST", "/publish-jobs", map[string]any{"confirmAllChanges": true, "reviewedActiveReleaseId": nil, "snapshotId": "snap_" + strings.Repeat("0", 32)}, csrf, rev, "test-publish-idempotent-1", 409)
	contentHTTP(t, f, c, "POST", "/preview-jobs", map[string]any{}, csrf, rev, "test-preview-jobconflict-1", 409)
	f.app.workerSeen.Store(0)
	contentHTTP(t, f, c, "POST", "/preview-jobs", map[string]any{}, csrf, rev, "test-preview-unavailable-1", 503)
	r, e := c.Get(f.server.URL + publishmodel.InternalPrefix + "/claim")
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 404 {
		t.Fatal("worker control leaked on public listener")
	}
}

func prepareArtifact(t *testing.T, f *authFixture, j publishmodel.Assignment) (*publishfs.Store, func() error, string) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("atomic Linux symlink/flock publication runs in Docker")
	}
	s, e := publishfs.Open(f.app.config.PublicationsDir)
	if e != nil {
		t.Fatal(e)
	}
	unlock, e := s.Lock()
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { unlock(); s.Close() })
	out := t.TempDir()
	marker, _ := json.Marshal(publishmodel.Marker{SchemaVersion: 1, ReleaseID: j.ReleaseID, SnapshotID: j.SnapshotID, SnapshotSHA256: j.SnapshotSHA256, WorkspaceRevision: j.WorkspaceRevision})
	files := map[string][]byte{"index.html": []byte("<html>real homepage</html>"), "projects/index.html": []byte("<html>real projects</html>"), "about/index.html": []byte("<html>real about</html>"), "robots.txt": []byte("User-agent: *\nDisallow:\n"), "sitemap.xml": []byte("<urlset></urlset>"), publishmodel.MarkerPath: marker, "_releases/" + j.ReleaseID + "/assets/image.png": []byte("opaque fixed fixture image bytes")}
	for name, raw := range files {
		target := filepath.Join(out, filepath.FromSlash(name))
		if e = os.MkdirAll(filepath.Dir(target), 0700); e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(target, raw, 0600); e != nil {
			t.Fatal(e)
		}
	}
	m := publishmodel.Manifest{SchemaVersion: 1, JobID: j.ID, ReleaseID: j.ReleaseID, SnapshotID: j.SnapshotID, SnapshotSHA256: j.SnapshotSHA256, WorkspaceRevision: j.WorkspaceRevision, SourceRevision: j.SourceRevision, BuilderID: j.BuilderID, Kind: j.Kind, Origin: contentdata.PublicOrigin, CreatedAt: publicationTime(f.clock.Load())}
	if j.Kind == "preview" {
		m.PreviewID = j.ReleaseID
	}
	hash, e := s.Prepare(j.ID, m, out)
	if e != nil {
		t.Fatal(e)
	}
	return s, unlock, hash
}
func prepareWorker(t *testing.T, f *authFixture, j publishmodel.Assignment, hash string) string {
	t.Helper()
	workerCall(t, f, "/jobs/"+j.ID+"/heartbeat", publishmodel.HeartbeatRequest{LeaseToken: j.LeaseToken, Phase: "validating"}, 200)
	data := workerCall(t, f, "/jobs/"+j.ID+"/prepared", publishmodel.PreparedRequest{LeaseToken: j.LeaseToken, ManifestSHA256: hash}, 200)
	return data["activationToken"].(string)
}
func activateArtifact(t *testing.T, f *authFixture, s *publishfs.Store, j publishmodel.Assignment, hash, token string) {
	t.Helper()
	receipt := publishmodel.Receipt{SchemaVersion: 1, JobID: j.ID, ReleaseID: j.ReleaseID, PreviousReleaseID: j.ExpectedPreviousReleaseID, ActivationToken: token, SnapshotID: j.SnapshotID, SnapshotSHA256: j.SnapshotSHA256, ManifestSHA256: hash, ActivatedAt: publicationTime(f.clock.Load()), Outcome: "activated"}
	if e := s.Activate(publishmodel.Intent{Receipt: receipt, Phase: "prepared"}, receipt); e != nil {
		t.Fatal(e)
	}
}

func TestPublicationRealFilesystemHTTPProofAndRecovery(t *testing.T) {
	f, c, csrf := publicationFixture(t)
	queuePublication(t, f, c, csrf, "publish", "real-publish-one-1")
	j := claimJob(t, f)
	s, unlock, hash := prepareArtifact(t, f, j)
	token := prepareWorker(t, f, j, hash)
	// A worker claim and even a prepared artifact cannot imply public success.
	data := workerCall(t, f, "/jobs/"+j.ID+"/result", publishmodel.ResultRequest{LeaseToken: j.LeaseToken, Outcome: "activated"}, 200)
	if data["status"] != "reconciling" || data["action"] != "restore" {
		t.Fatal("forged worker success accepted")
	}
	activateArtifact(t, f, s, j, hash, token)
	data = workerCall(t, f, "/jobs/"+j.ID+"/result", publishmodel.ResultRequest{LeaseToken: j.LeaseToken, Outcome: "activated"}, 200)
	if data["status"] != "succeeded" {
		t.Fatalf("real publication failed: %#v", data)
	}
	unlock()
	if e := f.app.verifyActive(context.Background(), j.ReleaseID); e != nil {
		t.Fatal(e)
	}
	// Completed retries return the original task even after its active pointer
	// changed. A different tab's new request must bind its own reviewed pointer.
	replay, _ := contentHTTP(t, f, c, "POST", "/publish-jobs", map[string]any{"confirmAllChanges": true, "reviewedActiveReleaseId": nil}, csrf, publicationRevision(t, f), "real-publish-one-1", 202)
	if authData(t, replay)["jobId"] != j.ID {
		t.Fatal("completed retry created another job")
	}
	other := f.client(t)
	otherCSRF, _ := f.loginAs(t, other, "xiaowork", authTestPassword, 200)
	stale, _ := contentHTTP(t, f, other, "POST", "/publish-jobs", map[string]any{"confirmAllChanges": true, "reviewedActiveReleaseId": nil}, otherCSRF, publicationRevision(t, f), "stale-tab-active-review-1", 409)
	if contentObject(t, stale["error"])["code"] != "ACTIVE_RELEASE_CONFLICT" {
		t.Fatal("stale active review was not identified")
	}
	contentHTTP(t, f, other, "POST", "/rollback-jobs", map[string]any{"confirmAllChanges": true, "reviewedActiveReleaseId": nil, "targetReleaseId": j.ReleaseID}, otherCSRF, publicationRevision(t, f), "stale-tab-active-rollback-1", 409)
	contentHTTP(t, f, c, "POST", "/publish-jobs", map[string]any{"confirmAllChanges": true}, csrf, publicationRevision(t, f), "missing-active-review-1", 422)
	status, _ := f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	review := contentObject(t, authData(t, status)["review"])
	if review["available"] != true || len(review["added"].([]any)) != 0 {
		t.Fatalf("precise unchanged review missing: %#v", review)
	}
	contentHTTP(t, f, c, "POST", "/projects/xiaowork-nav/archive", map[string]any{}, csrf, publicationRevision(t, f), "", 200)
	status, _ = f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	review = contentObject(t, authData(t, status)["review"])
	if review["available"] != true || len(review["archived"].([]any)) != 1 {
		t.Fatal("full-site archived-project review missing")
	}
	before := publicationRevision(t, f)
	queuePublication(t, f, c, csrf, "publish", "real-publish-two-1")
	j2 := claimJob(t, f)
	s2, _, h2 := prepareArtifact(t, f, j2)
	t2 := prepareWorker(t, f, j2, h2)
	activateArtifact(t, f, s2, j2, h2, t2)
	// Break live HTTP routing while keeping the immutable artifact intact.
	oldURL := f.app.config.PublicationVerifyURL
	bad := httptest.NewServer(http.NotFoundHandler())
	defer bad.Close()
	f.app.config.PublicationVerifyURL = bad.URL
	data = workerCall(t, f, "/jobs/"+j2.ID+"/result", publishmodel.ResultRequest{LeaseToken: j2.LeaseToken, Outcome: "activated"}, 200)
	if data["status"] != "reconciling" {
		t.Fatal("bad live HTTP falsely succeeded")
	}
	f.app.config.PublicationVerifyURL = oldURL
	recovery := publishmodel.Receipt{SchemaVersion: 1, JobID: j2.ID, ReleaseID: j.ReleaseID, PreviousReleaseID: j2.ReleaseID, ActivationToken: t2, SnapshotID: j.SnapshotID, SnapshotSHA256: j.SnapshotSHA256, ManifestSHA256: hash, ActivatedAt: publicationTime(f.clock.Load()), Outcome: "restored"}
	if e := s2.Restore(j2.ID, t2, recovery); e != nil {
		t.Fatal(e)
	}
	data = workerCall(t, f, "/jobs/"+j2.ID+"/result", publishmodel.ResultRequest{LeaseToken: j2.LeaseToken, Outcome: "restored"}, 200)
	if data["status"] != "failed" {
		t.Fatalf("recovery not reconciled: %#v", data)
	}
	if publicationRevision(t, f) != before {
		t.Fatal("publication/recovery changed draft")
	}
}

func TestPreviewEveryResourceAuthenticationTTLAndSnapshotPrivacy(t *testing.T) {
	f, c, csrf := publicationFixture(t)
	if _, e := f.db.Exec(`UPDATE project_drafts SET visible=0,description='PRIVATE_HIDDEN_VALUE' WHERE id='xiaowork-nav'`); e != nil {
		t.Fatal(e)
	}
	queuePublication(t, f, c, csrf, "preview", "real-preview-one-1")
	j := claimJob(t, f)
	if bytes.Contains(j.Snapshot, []byte("PRIVATE_HIDDEN_VALUE")) || bytes.Contains(j.Snapshot, []byte("archivedAt")) || bytes.Contains(j.Snapshot, []byte("created_at")) {
		t.Fatal("snapshot leaked private fields")
	}
	s, _, hash := prepareArtifact(t, f, j)
	prepareWorker(t, f, j, hash)
	receipt := publishmodel.Receipt{SchemaVersion: 1, JobID: j.ID, ReleaseID: j.ReleaseID, SnapshotID: j.SnapshotID, SnapshotSHA256: j.SnapshotSHA256, ManifestSHA256: hash, ActivatedAt: publicationTime(f.clock.Load()), Outcome: "preview-ready"}
	if e := s.WritePreviewReceipt(receipt); e != nil {
		t.Fatal(e)
	}
	data := workerCall(t, f, "/jobs/"+j.ID+"/result", publishmodel.ResultRequest{LeaseToken: j.LeaseToken, Outcome: "preview-ready"}, 200)
	if data["status"] != "succeeded" {
		t.Fatal(data)
	}
	for _, name := range []string{"", "projects/", "_releases/" + j.ReleaseID + "/assets/image.png"} {
		endpoint := "/previews/" + j.ReleaseID + "/" + name
		req, e := http.NewRequest("GET", f.server.URL+apiPrefix+endpoint, nil)
		if e != nil {
			t.Fatal(e)
		}
		res, e := c.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || res.Header.Get("Cache-Control") != "no-store" || len(raw) == 0 {
			t.Fatalf("auth preview resource failed %s %d", name, res.StatusCode)
		}
		f.request(t, f.client(t), "GET", endpoint, nil, "", 401)
	}
	f.clock.Add(86401)
	csrf, _ = f.loginAs(t, c, "xiaowork", authTestPassword, 200)
	_ = csrf
	f.request(t, c, "GET", "/previews/"+j.ReleaseID+"/", nil, "", 404)
}

func TestWorkerLeaseRecoveryAndSnapshotImmutability(t *testing.T) {
	f, c, csrf := publicationFixture(t)
	queuePublication(t, f, c, csrf, "preview", "lease-recovery-one-1")
	j := claimJob(t, f)
	if _, e := f.db.Exec(`UPDATE snapshots SET public_json='{}' WHERE id=?`, j.SnapshotID); e == nil {
		t.Fatal("sealed snapshot editable")
	}
	workerCall(t, f, "/jobs/"+j.ID+"/heartbeat", publishmodel.HeartbeatRequest{LeaseToken: "bad", Phase: "validating"}, 409)
	f.clock.Add(workerLeaseSeconds + 1)
	again := claimJob(t, f)
	if again.ID != j.ID || !again.RecoveryRequired || again.LeaseToken == j.LeaseToken {
		t.Fatal("expired worker lease did not require recovery")
	}
	workerCall(t, f, "/jobs/"+j.ID+"/result", publishmodel.ResultRequest{LeaseToken: j.LeaseToken, Outcome: "failed"}, 409)
	data := workerCall(t, f, "/jobs/"+j.ID+"/result", publishmodel.ResultRequest{LeaseToken: again.LeaseToken, Outcome: "failed"}, 200)
	if data["status"] != "failed" {
		t.Fatal(data)
	}
	_, _, _, e := publishdata.Load(context.Background(), f.db, j.SnapshotID)
	if e != nil {
		t.Fatal(e)
	}
}

func TestPublicationRejectsUnconfirmedPublicMediaWithoutPartialSnapshot(t *testing.T) {
	f, c, csrf := publicationFixture(t)
	now := f.clock.Load()
	hash := strings.Repeat("d", 64)
	if _, e := f.db.Exec(`INSERT INTO assets(id,storage_kind,storage_key,sha256,media_type,byte_size,width,height,created_at) VALUES('asset-unconfirmed','upload',?,?,'image/png',4,1,1,?)`, "derived/"+hash+".png", hash, now); e != nil {
		t.Fatal(e)
	}
	if _, e := f.db.Exec(`INSERT INTO asset_metadata(asset_id,created_at,updated_at) VALUES('asset-unconfirmed',?,?)`, now, now); e != nil {
		t.Fatal(e)
	}
	if _, e := f.db.Exec(`UPDATE project_draft_assets SET asset_id='asset-unconfirmed' WHERE project_id='xiaowork-blog' AND role='cover'`); e != nil {
		t.Fatal(e)
	}
	contentHTTP(t, f, c, "POST", "/preview-jobs", map[string]any{}, csrf, publicationRevision(t, f), "unconfirmed-media-preview-1", 422)
	var snapshots, jobs int
	if e := f.db.QueryRow(`SELECT count(*) FROM snapshots`).Scan(&snapshots); e != nil {
		t.Fatal(e)
	}
	if e := f.db.QueryRow(`SELECT count(*) FROM publish_jobs`).Scan(&jobs); e != nil {
		t.Fatal(e)
	}
	if snapshots != 0 || jobs != 0 {
		t.Fatal("invalid media left a partially sealed snapshot or job")
	}
}

func TestPublishingStatusPassivePollingDoesNotExtendSessionIdleExpiry(t *testing.T) {
	f, c, _ := publicationFixture(t)
	initial := f.clock.Load()
	for _, advance := range []int64{600, 600, 599} {
		f.clock.Add(advance)
		f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	}
	var last int64
	if e := f.db.QueryRow(`SELECT last_interactive_at FROM sessions ORDER BY created_at DESC LIMIT 1`).Scan(&last); e != nil {
		t.Fatal(e)
	}
	if last != initial {
		t.Fatal("passive publication polling refreshed idle timeout")
	}
	f.clock.Add(2)
	f.request(t, c, "GET", "/publishing-status", nil, "", 401)
}

func TestProductionPublicationConfigurationFailsClosed(t *testing.T) {
	c := Config{LocalPublish: true, Origin: "https://xiaoworks.com", PublicationVerifyURL: "http://publication-static:8080", PublicationsDir: "/publications", WorkerSocket: "/run/publishing/api.sock", SourceRevision: strings.Repeat("a", 40), BuilderID: "sha256:" + strings.Repeat("b", 64)}
	if validatePublicationConfig(c) == nil {
		t.Fatal("production publishing gate bypassed")
	}
	c.Origin = "https://localhost:3445"
	if e := validatePublicationConfig(c); e != nil {
		t.Fatal(e)
	}
	c.PublicationVerifyURL = "http://example.com"
	if validatePublicationConfig(c) == nil {
		t.Fatal("arbitrary verifier URL accepted")
	}
}

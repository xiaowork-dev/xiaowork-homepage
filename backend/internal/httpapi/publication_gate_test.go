package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishgate"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

const gateTestProject = "xiaowork-homepage-v11-unit"

func TestProductionPublicationConfigurationRequiresFixedIdentity(t *testing.T) {
	base := Config{ProductionPublish: true, Origin: "https://xiaoworks.com", Project: gateTestProject, PublicationVerifyURL: "http://publication-static:8080", PublicationsDir: "/publications", WorkerSocket: "/run/publishing/api.sock", SourceRevision: strings.Repeat("a", 40), BuilderID: "sha256:" + strings.Repeat("b", 64)}
	if e := validatePublicationConfig(base); e != nil {
		t.Fatalf("valid production mode refused: %v", e)
	}
	for name, mutate := range map[string]func(*Config){
		"both modes":      func(c *Config) { c.LocalPublish = true },
		"loopback origin": func(c *Config) { c.Origin = "https://localhost:3445" },
		"missing project": func(c *Config) { c.Project = "" },
		"floating worker": func(c *Config) { c.BuilderID = "xiaowork-nuxt-p6d-v1" },
		"public verifier": func(c *Config) { c.PublicationVerifyURL = "http://example.com" },
	} {
		c := base
		mutate(&c)
		if validatePublicationConfig(c) == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	local := base
	local.ProductionPublish, local.LocalPublish = false, true
	if validatePublicationConfig(local) == nil {
		t.Fatal("local mode accepted the production origin")
	}
}

func productionFixture(t *testing.T) (*authFixture, string) {
	t.Helper()
	f, _, _ := publicationFixture(t) // skips on non-Linux
	f.app.config.LocalPublish = false
	f.app.config.ProductionPublish = true
	f.app.config.Project = gateTestProject
	return f, f.app.config.ControlDir
}

func authorizeGate(t *testing.T, f *authFixture, mutate func(*publishgate.Authorization)) publishgate.Authorization {
	t.Helper()
	id, err := publishgate.NewID()
	if err != nil {
		t.Fatal(err)
	}
	issued := time.Unix(f.clock.Load(), 0).UTC()
	a := publishgate.Authorization{Format: 1, ID: id, Project: gateTestProject, Origin: publishgate.ProductionOrigin, Source: f.app.config.SourceRevision, Schema: store.SchemaVersion, WorkerImage: f.app.config.BuilderID, APIImage: "sha256:" + strings.Repeat("c", 64), IssuedAt: issued, ExpiresAt: issued.Add(7 * 24 * time.Hour), Backup: publishgate.Backup{Path: "/srv/backups/unit", ContentManifestSHA256: strings.Repeat("d", 64), VerifiedAt: issued.Add(-time.Hour)}, ApprovalNote: "单元测试授权，非生产"}
	if mutate != nil {
		mutate(&a)
	}
	if err = publishgate.Authorize(f.app.config.ControlDir, a); err != nil {
		t.Fatal(err)
	}
	return a
}

func errorCode(t *testing.T, envelope map[string]any) string {
	t.Helper()
	return contentObject(t, envelope["error"])["code"].(string)
}

func completePreview(t *testing.T, f *authFixture) publishmodel.Assignment {
	t.Helper()
	j := claimJob(t, f)
	s, _, hash := prepareArtifact(t, f, j)
	prepareWorker(t, f, j, hash)
	receipt := publishmodel.Receipt{SchemaVersion: 1, JobID: j.ID, ReleaseID: j.ReleaseID, SnapshotID: j.SnapshotID, SnapshotSHA256: j.SnapshotSHA256, ManifestSHA256: hash, ActivatedAt: publicationTime(f.clock.Load()), Outcome: "preview-ready"}
	if e := s.WritePreviewReceipt(receipt); e != nil {
		t.Fatal(e)
	}
	if data := workerCall(t, f, "/jobs/"+j.ID+"/result", publishmodel.ResultRequest{LeaseToken: j.LeaseToken, Outcome: "preview-ready"}, 200); data["status"] != "succeeded" {
		t.Fatalf("preview did not succeed: %#v", data)
	}
	return j
}

func TestProductionGateClosedWithoutMatchingAuthorization(t *testing.T) {
	f, _ := productionFixture(t)
	c := f.client(t)
	csrf, _ := f.loginAs(t, c, "xiaowork", authTestPassword, 200)
	status, _ := f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	data := authData(t, status)
	gate := contentObject(t, data["gate"])
	if data["mode"] != "production" || data["enabled"] != false || gate["open"] != false || gate["code"] != "GATE_ABSENT" {
		t.Fatalf("absent authorization must keep production publishing closed: %#v", data)
	}
	res, _ := contentHTTP(t, f, c, "POST", "/preview-jobs", map[string]any{}, csrf, publicationRevision(t, f), "gate-absent-preview-1", 503)
	if errorCode(t, res) != "PUBLISH_GATE_CLOSED" {
		t.Fatal("wrong refusal code")
	}
	authorizeGate(t, f, func(a *publishgate.Authorization) { a.Source = strings.Repeat("f", 40) })
	status, _ = f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	if contentObject(t, authData(t, status)["gate"])["code"] != "GATE_MISMATCH" {
		t.Fatal("authorization for another release identity must not open the gate")
	}
	contentHTTP(t, f, c, "POST", "/preview-jobs", map[string]any{}, csrf, publicationRevision(t, f), "gate-mismatch-preview-1", 503)
}

func TestProductionGateRequiresPreviewLimitsRateAndAudits(t *testing.T) {
	f, _ := productionFixture(t)
	c := f.client(t)
	csrf, _ := f.loginAs(t, c, "xiaowork", authTestPassword, 200)
	auth := authorizeGate(t, f, nil)
	status, _ := f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	gate := contentObject(t, authData(t, status)["gate"])
	if gate["open"] != true || gate["authorizationId"] != auth.ID {
		t.Fatalf("valid authorization must open the gate: %#v", gate)
	}
	f.request(t, c, "POST", "/auth/reauth", map[string]string{"password": authTestPassword}, csrf, 200)
	body := map[string]any{"confirmAllChanges": true, "reviewedActiveReleaseId": nil}
	res, _ := contentHTTP(t, f, c, "POST", "/publish-jobs", body, csrf, publicationRevision(t, f), "gate-no-preview-1", 422)
	if errorCode(t, res) != "PREVIEW_REQUIRED" {
		t.Fatal("publish without preview must be refused")
	}
	queuePublication(t, f, c, csrf, "preview", "gate-preview-one-1")
	completePreview(t, f)
	jobID := queuePublication(t, f, c, csrf, "publish", "gate-publish-after-preview-1")
	var meta string
	if e := f.db.QueryRow(`SELECT metadata_json FROM audit_events WHERE action='publication.gate.authorized' AND resource_id=?`, jobID).Scan(&meta); e != nil {
		t.Fatalf("gate audit missing: %v", e)
	}
	var recorded map[string]string
	if json.Unmarshal([]byte(meta), &recorded) != nil || recorded["authorization"] != auth.ID {
		t.Fatalf("audit does not name the authorization: %s", meta)
	}
	// A draft change invalidates the earlier preview for the next publication.
	if _, e := f.db.Exec(`UPDATE publish_jobs SET status='failed',phase=NULL,completed_at=created_at,error_code='BUILD_FAILED',error_summary='test' WHERE id=?`, jobID); e != nil {
		t.Fatal(e)
	}
	contentHTTP(t, f, c, "POST", "/projects/xiaowork-nav/archive", map[string]any{}, csrf, publicationRevision(t, f), "", 200)
	f.request(t, c, "POST", "/auth/reauth", map[string]string{"password": authTestPassword}, csrf, 200)
	res, _ = contentHTTP(t, f, c, "POST", "/publish-jobs", body, csrf, publicationRevision(t, f), "gate-stale-preview-1", 422)
	if errorCode(t, res) != "PREVIEW_REQUIRED" {
		t.Fatal("preview of an older revision must not authorize publication")
	}
	prior := productionJobsPerHour
	productionJobsPerHour = 1
	t.Cleanup(func() { productionJobsPerHour = prior })
	queuePublication(t, f, c, csrf, "preview", "gate-preview-two-1")
	completePreview(t, f)
	res, _ = contentHTTP(t, f, c, "POST", "/publish-jobs", body, csrf, publicationRevision(t, f), "gate-rate-limited-1", 429)
	if errorCode(t, res) != "PUBLISH_RATE_LIMITED" {
		t.Fatal("hourly publication limit not enforced")
	}
}

func TestProductionRevocationFailsQueuedJobAndClosesGate(t *testing.T) {
	f, root := productionFixture(t)
	c := f.client(t)
	csrf, _ := f.loginAs(t, c, "xiaowork", authTestPassword, 200)
	authorizeGate(t, f, nil)
	jobID := queuePublication(t, f, c, csrf, "preview", "gate-revoke-preview-1")
	if _, err := publishgate.Revoke(root, "单元测试撤销", time.Unix(f.clock.Load(), 0)); err != nil {
		t.Fatal(err)
	}
	data := workerCall(t, f, "/claim", publishmodel.ClaimRequest{ProtocolVersion: 1, WorkerID: publishmodel.WorkerID}, 200)
	if data["job"] != nil {
		t.Fatalf("a queued job ran after revocation: %#v", data)
	}
	var status, code string
	if e := f.db.QueryRow(`SELECT status,coalesce(error_code,'') FROM publish_jobs WHERE id=?`, jobID).Scan(&status, &code); e != nil || status != "failed" || code != "PUBLISH_GATE_CLOSED" {
		t.Fatalf("queued job not closed safely: %s %s %v", status, code, e)
	}
	st, _ := f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	if contentObject(t, authData(t, st)["gate"])["code"] != "GATE_REVOKED" {
		t.Fatal("revocation not reported")
	}
	contentHTTP(t, f, c, "POST", "/preview-jobs", map[string]any{}, csrf, publicationRevision(t, f), "gate-revoked-preview-2", 503)
}

func TestProductionAuthorizationExpiryClosesGate(t *testing.T) {
	f, _ := productionFixture(t)
	authorizeGate(t, f, nil)
	f.clock.Add(7 * 24 * 60 * 60)
	c := f.client(t)
	csrf, _ := f.loginAs(t, c, "xiaowork", authTestPassword, 200)
	st, _ := f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	if contentObject(t, authData(t, st)["gate"])["code"] != "GATE_EXPIRED" {
		t.Fatal("expired authorization must close the gate")
	}
	contentHTTP(t, f, c, "POST", "/preview-jobs", map[string]any{}, csrf, publicationRevision(t, f), "gate-expired-preview-1", 503)
}

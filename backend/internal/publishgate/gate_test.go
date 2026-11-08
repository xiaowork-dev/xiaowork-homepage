package publishgate

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

var issued = time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)

func sample(t *testing.T) Authorization {
	t.Helper()
	id, err := NewID()
	if err != nil {
		t.Fatal(err)
	}
	return Authorization{
		Format: 1, ID: id, Project: "xiaowork-homepage-v11-prod", Origin: ProductionOrigin,
		Source: strings.Repeat("a", 40), Schema: 3,
		WorkerImage: "sha256:" + strings.Repeat("b", 64), APIImage: "sha256:" + strings.Repeat("c", 64),
		IssuedAt: issued, ExpiresAt: issued.Add(7 * 24 * time.Hour),
		Backup:       Backup{Path: "/srv/backups/prod-1", ContentManifestSHA256: strings.Repeat("d", 64), VerifiedAt: issued.Add(-time.Hour)},
		ApprovalNote: "隔离验收报告已通过，批准生产发布",
	}
}

func expect(a Authorization) Expect {
	return Expect{Project: a.Project, Origin: a.Origin, Source: a.Source, WorkerImage: a.WorkerImage, Schema: a.Schema}
}

func code(t *testing.T, err error) string {
	t.Helper()
	var c *Closed
	if !errors.As(err, &c) {
		t.Fatalf("expected a closed gate error, got %v", err)
	}
	return c.Code
}

func controlDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestOpenOnlyWithValidMatchingUnexpiredAuthorization(t *testing.T) {
	root := controlDir(t)
	a := sample(t)
	if _, err := Check(root, expect(a), issued); code(t, err) != "GATE_ABSENT" {
		t.Fatal("absent authorization must close the gate")
	}
	if err := Authorize(root, a); err != nil {
		t.Fatal(err)
	}
	got, err := Check(root, expect(a), issued.Add(time.Hour))
	if err != nil || got.ID != a.ID {
		t.Fatalf("valid authorization refused: %v", err)
	}
	if _, err = Check(root, expect(a), a.ExpiresAt); code(t, err) != "GATE_EXPIRED" {
		t.Fatal("expiry boundary must close the gate")
	}
	if _, err = Check(root, expect(a), issued.Add(-time.Hour)); code(t, err) != "GATE_NOT_YET_VALID" {
		t.Fatal("future authorization must not open the gate")
	}
}

func TestIdentityMismatchClosesTheGate(t *testing.T) {
	root := controlDir(t)
	a := sample(t)
	if err := Authorize(root, a); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*Expect){
		"project": func(e *Expect) { e.Project = "xiaowork-homepage-v11-other" },
		"origin":  func(e *Expect) { e.Origin = "https://localhost:3445" },
		"source":  func(e *Expect) { e.Source = strings.Repeat("f", 40) },
		"worker":  func(e *Expect) { e.WorkerImage = "sha256:" + strings.Repeat("e", 64) },
		"schema":  func(e *Expect) { e.Schema = 4 },
	} {
		e := expect(a)
		mutate(&e)
		if _, err := Check(root, e, issued.Add(time.Minute)); code(t, err) != "GATE_MISMATCH" {
			t.Fatalf("%s mismatch accepted", name)
		}
	}
}

func TestRevocationClosesImmediatelyAndReauthorizationArchivesHistory(t *testing.T) {
	root := controlDir(t)
	a := sample(t)
	if err := Authorize(root, a); err != nil {
		t.Fatal(err)
	}
	r, err := Revoke(root, "紧急停止发布", issued.Add(time.Minute))
	if err != nil || r.AuthorizationID != a.ID {
		t.Fatalf("revoke: %v %+v", err, r)
	}
	if _, err = Check(root, expect(a), issued.Add(2*time.Minute)); code(t, err) != "GATE_REVOKED" {
		t.Fatal("revocation must close the gate even with a valid authorization present")
	}
	again, err := Revoke(root, "重复撤销请求", issued.Add(3*time.Minute))
	if err != nil || !again.RevokedAt.Equal(r.RevokedAt) {
		t.Fatal("an existing revocation must be kept unchanged")
	}
	b := sample(t)
	if err = Authorize(root, b); err != nil {
		t.Fatal(err)
	}
	got, err := Check(root, expect(b), issued.Add(time.Hour))
	if err != nil || got.ID != b.ID {
		t.Fatalf("re-authorization did not take effect: %v", err)
	}
	entries, _ := os.ReadDir(root)
	var archivedAuth, archivedRevocation int
	for _, e := range entries {
		switch {
		case strings.HasPrefix(e.Name(), "publish-authorization.2"):
			archivedAuth++
		case strings.HasPrefix(e.Name(), "publish-revoked.2"):
			archivedRevocation++
		}
	}
	if archivedAuth != 1 || archivedRevocation != 1 {
		t.Fatalf("history not preserved: %d authorizations, %d revocations", archivedAuth, archivedRevocation)
	}
}

func TestDamagedOrUnsafeRecordsCloseTheGate(t *testing.T) {
	a := sample(t)
	raw, _ := json.Marshal(a)
	cases := map[string]func(root string) error{
		"unknown field": func(root string) error {
			return os.WriteFile(filepath.Join(root, AuthorizationFile), []byte(strings.TrimSuffix(string(raw), "}")+`,"extra":1}`), 0o600)
		},
		"trailing content": func(root string) error {
			return os.WriteFile(filepath.Join(root, AuthorizationFile), append(raw, []byte(" {}")...), 0o600)
		},
		"oversized": func(root string) error {
			return os.WriteFile(filepath.Join(root, AuthorizationFile), []byte(strings.Repeat(" ", maxRecordBytes+1)), 0o600)
		},
		"directory": func(root string) error { return os.Mkdir(filepath.Join(root, AuthorizationFile), 0o700) },
	}
	if runtime.GOOS != "windows" {
		cases["group readable"] = func(root string) error {
			p := filepath.Join(root, AuthorizationFile)
			if err := os.WriteFile(p, raw, 0o600); err != nil {
				return err
			}
			return os.Chmod(p, 0o640)
		}
		cases["symlink"] = func(root string) error {
			target := filepath.Join(root, "elsewhere.json")
			if err := os.WriteFile(target, raw, 0o600); err != nil {
				return err
			}
			return os.Symlink("elsewhere.json", filepath.Join(root, AuthorizationFile))
		}
		cases["hard link"] = func(root string) error {
			p := filepath.Join(root, AuthorizationFile)
			if err := os.WriteFile(p, raw, 0o600); err != nil {
				return err
			}
			return os.Link(p, filepath.Join(root, "second-link.json"))
		}
		cases["unreadable revocation"] = func(root string) error {
			if err := Authorize(root, a); err != nil {
				return err
			}
			return os.Mkdir(filepath.Join(root, RevocationFile), 0o700)
		}
	}
	for name, prepare := range cases {
		t.Run(name, func(t *testing.T) {
			root := controlDir(t)
			if err := prepare(root); err != nil {
				t.Fatal(err)
			}
			if _, err := Check(root, expect(a), issued.Add(time.Minute)); code(t, err) != "GATE_INVALID" {
				t.Fatalf("%s opened or mis-reported the gate: %v", name, err)
			}
		})
	}
}

func TestValidateRejectsUnsafeAuthorizations(t *testing.T) {
	for name, mutate := range map[string]func(*Authorization){
		"local origin":      func(a *Authorization) { a.Origin = "https://localhost:3445" },
		"short id":          func(a *Authorization) { a.ID = "abc" },
		"floating image":    func(a *Authorization) { a.WorkerImage = "xiaowork-homepage-worker:latest" },
		"too long":          func(a *Authorization) { a.ExpiresAt = a.IssuedAt.Add(MaxValidity + time.Hour) },
		"inverted window":   func(a *Authorization) { a.ExpiresAt = a.IssuedAt },
		"stale backup":      func(a *Authorization) { a.Backup.VerifiedAt = a.IssuedAt.Add(-MaxBackupAge - time.Minute) },
		"future backup":     func(a *Authorization) { a.Backup.VerifiedAt = a.IssuedAt.Add(time.Hour) },
		"relative backup":   func(a *Authorization) { a.Backup.Path = "backups/x" },
		"empty note":        func(a *Authorization) { a.ApprovalNote = "  " },
		"multiline note":    func(a *Authorization) { a.ApprovalNote = "approved\nby someone" },
		"bad project":       func(a *Authorization) { a.Project = "other" },
		"bad manifest hash": func(a *Authorization) { a.Backup.ContentManifestSHA256 = "x" },
	} {
		a := sample(t)
		mutate(&a)
		if Validate(a) == nil {
			t.Fatalf("%s accepted", name)
		}
		if Authorize(controlDir(t), a) == nil {
			t.Fatalf("%s written", name)
		}
	}
}

func TestLeftoverTemporaryRecordRequiresManualReview(t *testing.T) {
	root := controlDir(t)
	if err := os.WriteFile(filepath.Join(root, AuthorizationFile+".next"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if Authorize(root, sample(t)) == nil {
		t.Fatal("leftover temporary file must not be overwritten")
	}
	if _, err := Check(root, expect(sample(t)), issued); code(t, err) != "GATE_ABSENT" {
		t.Fatal("gate must stay closed")
	}
}

func TestInspectReportsWithoutRepairing(t *testing.T) {
	root := controlDir(t)
	a := sample(t)
	if s := Inspect(root); s.Authorization != nil || s.Revocation != nil || s.Problem != "" {
		t.Fatalf("empty state: %+v", s)
	}
	if err := Authorize(root, a); err != nil {
		t.Fatal(err)
	}
	if _, err := Revoke(root, "例行撤销测试", issued); err != nil {
		t.Fatal(err)
	}
	s := Inspect(root)
	if s.Authorization == nil || s.Authorization.ID != a.ID || s.Revocation == nil || s.Revocation.AuthorizationID != a.ID {
		t.Fatalf("inspect: %+v", s)
	}
}

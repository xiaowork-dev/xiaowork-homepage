package publishfs

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

func testID(prefix string, n byte) string { return prefix + "_" + strings.Repeat(string(n), 32) }
func testStore(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	s, err := Open(root)
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
func tree(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"index.html": "complete home", "about.html": "complete about", "assets/app.js": "snapshot A"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}
func manifest(id, job string) publishmodel.Manifest {
	return publishmodel.Manifest{SchemaVersion: 1, JobID: job, ReleaseID: id, SnapshotID: testID("snap", 'a'), SnapshotSHA256: strings.Repeat("a", 64), WorkspaceRevision: "ws-7", SourceRevision: strings.Repeat("b", 40), BuilderID: "reviewed-builder", Kind: "publish", Origin: "https://xiaoworks.com", CreatedAt: "2026-10-27T00:00:00Z"}
}
func sealed(t *testing.T, s *Store, id, job string) (publishmodel.Manifest, string) {
	t.Helper()
	digest, err := s.Prepare(job, manifest(id, job), tree(t))
	if err != nil {
		t.Fatal(err)
	}
	m, _, err := s.VerifyRelease(id)
	if err != nil {
		t.Fatal(err)
	}
	return m, digest
}
func proof(m publishmodel.Manifest, job, previous, digest string) (publishmodel.Intent, publishmodel.Receipt) {
	r := publishmodel.Receipt{SchemaVersion: 1, JobID: job, ReleaseID: m.ReleaseID, PreviousReleaseID: previous, ActivationToken: strings.Repeat("c", 64), SnapshotID: m.SnapshotID, SnapshotSHA256: m.SnapshotSHA256, ManifestSHA256: digest, ActivatedAt: "2026-10-27T00:00:00Z", Outcome: "activated"}
	return publishmodel.Intent{Receipt: r, Phase: "prepared"}, r
}
func requireLinks(t *testing.T, root string) {
	t.Helper()
	a := filepath.Join(root, "link-check")
	if err := os.Symlink("releases", a); err != nil {
		t.Skipf("host symlink unavailable: %v", err)
	}
	os.Remove(a)
}

func TestManifestVerifiesCompleteTreeAndRejectsCorruption(t *testing.T) {
	for _, change := range []string{"alter", "remove", "extra", "manifest", "symlink"} {
		t.Run(change, func(t *testing.T) {
			s, root := testStore(t)
			id := testID("rel", '1')
			_, digest := sealed(t, s, id, testID("job", '1'))
			if !ValidHash(digest) {
				t.Fatal(digest)
			}
			base := filepath.Join(root, "releases", id)
			switch change {
			case "alter":
				os.WriteFile(filepath.Join(base, "public", "index.html"), []byte("changed"), 0600)
			case "remove":
				os.Remove(filepath.Join(base, "public", "index.html"))
			case "extra":
				os.WriteFile(filepath.Join(base, "public", "secret.txt"), []byte("not in manifest"), 0600)
			case "manifest":
				os.WriteFile(filepath.Join(base, "manifest.json"), []byte(`{"unknown":true}`), 0600)
			case "symlink":
				requireLinks(t, root)
				os.Symlink("index.html", filepath.Join(base, "public", "surprise.html"))
			}
			if _, _, err := s.VerifyRelease(id); err == nil {
				t.Fatal("accepted corrupt tree")
			}
		})
	}
}

func TestGeneratedNamesAndPathContainment(t *testing.T) {
	s, _ := testStore(t)
	for _, name := range []string{"../release", "a/../b", "/absolute", "a\\b", "a/%2e%2e/b", "a//b", "a?b", ".hidden", "a/.hidden", "C:/escape", "a/./b"} {
		if SafePath(name) {
			t.Errorf("accepted %q", name)
		}
		if _, err := s.ReadPublic(testID("rel", '1'), name, 100); err == nil {
			t.Errorf("read accepted %q", name)
		}
	}
	if _, err := s.Current(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prepare("../evil", manifest(testID("rel", '1'), "../evil"), tree(t)); err == nil {
		t.Fatal("accepted traversal job")
	}
}

func TestKernelLockExcludesSeparateStores(t *testing.T) {
	s, root := testStore(t)
	second, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if unlock, err := second.Lock(); err == nil {
		unlock()
		t.Fatal("second lock succeeded")
	}
	if _, err = s.Prepare(testID("job", '1'), manifest(testID("rel", '1'), testID("job", '1')), tree(t)); err != nil {
		t.Fatal(err)
	}
}

func TestMutationRequiresLockAndImmutableIDs(t *testing.T) {
	s, root := testStore(t)
	job, id := testID("job", '1'), testID("rel", '1')
	sealed(t, s, id, job)
	if _, err := s.Prepare(testID("job", '2'), manifest(id, testID("job", '2')), tree(t)); !errors.Is(err, ErrConflict) {
		t.Fatalf("overwrite: %v", err)
	}
	ro, err := OpenReadOnly(root)
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	if _, err = ro.Lock(); err == nil {
		t.Fatal("read-only lock")
	}
	if _, err = ro.Prepare(testID("job", '3'), manifest(testID("rel", '3'), testID("job", '3')), tree(t)); err == nil {
		t.Fatal("read-only mutation")
	}
}

func TestSymlinkSourceAndContainmentRejected(t *testing.T) {
	s, root := testStore(t)
	requireLinks(t, root)
	source := tree(t)
	if err := os.Symlink("index.html", filepath.Join(source, "alias")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prepare(testID("job", '1'), manifest(testID("rel", '1'), testID("job", '1')), source); !errors.Is(err, ErrUnsafe) {
		t.Fatalf("source link: %v", err)
	}
	if err := os.Symlink("../outside", filepath.Join(root, "current")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Current(); err == nil {
		t.Fatal("unsafe current")
	}
}

func TestEveryActivationFailureBoundaryKeepsCompleteVersion(t *testing.T) {
	for _, point := range []string{"after-intent", "before-current-rename", "after-current-rename", "after-receipt"} {
		t.Run(point, func(t *testing.T) {
			s, root := testStore(t)
			requireLinks(t, root)
			a, ad := sealed(t, s, testID("rel", '1'), testID("job", '1'))
			ai, ar := proof(a, testID("job", '1'), "", ad)
			if err := s.Activate(ai, ar); err != nil {
				t.Fatal(err)
			}
			b, bd := sealed(t, s, testID("rel", '2'), testID("job", '2'))
			bi, br := proof(b, testID("job", '2'), a.ReleaseID, bd)
			s.SetFaultForTest(func(p string) error {
				if p == point {
					return errors.New("injected crash")
				}
				return nil
			})
			err := s.Activate(bi, br)
			if err == nil {
				t.Fatal("fault did not execute")
			}
			current, currentErr := s.Current()
			if currentErr != nil {
				t.Fatal(currentErr)
			}
			want := a.ReleaseID
			if point == "after-current-rename" || point == "after-receipt" {
				want = b.ReleaseID
				if !errors.Is(err, ErrRecoveryRequired) {
					t.Fatal("ambiguous activation was not recovery required")
				}
			}
			if current != want {
				t.Fatalf("current=%s want=%s", current, want)
			}
			if _, _, err = s.VerifyRelease(current); err != nil {
				t.Fatal(err)
			}
			if _, err = s.ReadIntent(bi.JobID); err != nil {
				t.Fatal("missing durable intent", err)
			}
		})
	}
}

func TestAtomicActivationRollbackAndIndependentRecoveryProof(t *testing.T) {
	s, root := testStore(t)
	requireLinks(t, root)
	a, ad := sealed(t, s, testID("rel", '1'), testID("job", '1'))
	ai, ar := proof(a, testID("job", '1'), "", ad)
	if err := s.Activate(ai, ar); err != nil {
		t.Fatal(err)
	}
	b, bd := sealed(t, s, testID("rel", '2'), testID("job", '2'))
	bi, br := proof(b, testID("job", '2'), a.ReleaseID, bd)
	if err := s.Activate(bi, br); err != nil {
		t.Fatal(err)
	}
	rollbackJob := testID("job", '3')
	ri, rr := proof(a, rollbackJob, b.ReleaseID, ad)
	if err := s.Activate(ri, rr); err != nil {
		t.Fatal(err)
	}
	if r, _, err := s.ReadReceipt(rollbackJob); err != nil || r.JobID == ar.JobID {
		t.Fatal("reused original proof", r, err)
	}
	if _, _, err := s.VerifyRelease(b.ReleaseID); err != nil {
		t.Fatal("old release lost", err)
	}
	recovery := rr
	recovery.Outcome = "restored"
	recovery.ReleaseID = b.ReleaseID
	recovery.PreviousReleaseID = a.ReleaseID
	recovery.ManifestSHA256 = bd
	recovery.SnapshotID = b.SnapshotID
	recovery.SnapshotSHA256 = b.SnapshotSHA256
	if err := s.Restore(rollbackJob, rr.ActivationToken, recovery); err != nil {
		t.Fatal(err)
	}
	if current, _ := s.Current(); current != b.ReleaseID {
		t.Fatal(current)
	}
	if original, _, err := s.ReadReceipt(rollbackJob); err != nil || original.Outcome != "activated" {
		t.Fatal("mutated activation proof")
	}
	if r, _, err := s.ReadRecoveryReceipt(rollbackJob); err != nil || r.Outcome != "restored" {
		t.Fatal(r, err)
	}
}

func TestStalePreviousDoesNotCreateIntentOrSwitch(t *testing.T) {
	s, root := testStore(t)
	requireLinks(t, root)
	a, ad := sealed(t, s, testID("rel", '1'), testID("job", '1'))
	i, r := proof(a, testID("job", '1'), testID("rel", '9'), ad)
	if err := s.Activate(i, r); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if current, _ := s.Current(); current != "" {
		t.Fatal(current)
	}
	if _, err := s.ReadIntent(i.JobID); !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
}

func TestPreparationFaultsDoNotPublishOrOverwrite(t *testing.T) {
	for _, point := range []string{"after-copy", "before-file-rename", "before-release-rename", "after-release-rename"} {
		t.Run(point, func(t *testing.T) {
			s, _ := testStore(t)
			s.SetFaultForTest(func(p string) error {
				if p == point {
					return errors.New("disk full")
				}
				return nil
			})
			job, id := testID("job", '1'), testID("rel", '1')
			if _, err := s.Prepare(job, manifest(id, job), tree(t)); err == nil {
				t.Fatal("fault not reached")
			}
			if current, err := s.Current(); err != nil || current != "" {
				t.Fatal(current, err)
			}
			if point == "after-release-rename" {
				if _, _, err := s.VerifyRelease(id); err != nil {
					t.Fatal("sealed directory incomplete", err)
				}
			}
		})
	}
}

func TestRecoveryNeverClobbersUnrelatedCurrent(t *testing.T) {
	s, root := testStore(t)
	requireLinks(t, root)
	a, ad := sealed(t, s, testID("rel", '1'), testID("job", '1'))
	i, r := proof(a, testID("job", '1'), "", ad)
	if err := s.Activate(i, r); err != nil {
		t.Fatal(err)
	}
	b, bd := sealed(t, s, testID("rel", '2'), testID("job", '2'))
	bi, br := proof(b, testID("job", '2'), a.ReleaseID, bd)
	if err := s.Activate(bi, br); err != nil {
		t.Fatal(err)
	}
	r.ReleaseID = ""
	r.PreviousReleaseID = a.ReleaseID
	r.ManifestSHA256 = ""
	r.SnapshotID = ""
	r.SnapshotSHA256 = ""
	r.Outcome = "restored"
	if err := s.Restore(i.JobID, i.ActivationToken, r); !errors.Is(err, ErrRecoveryRequired) {
		t.Fatal(err)
	}
	if current, _ := s.Current(); current != b.ReleaseID {
		t.Fatal(current)
	}
}

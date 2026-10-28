//go:build linux

package maintenance

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/authn"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func currentFixture(t *testing.T) (string, string) {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	emptyRoots(t, root)
	db, err := store.Open(filepath.Join(root, "db/content.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = authn.InitAdministrator(ctx, db, "repair-test-admin", []byte("isolated-repair-password")); err != nil {
		t.Fatal(err)
	}
	pub, err := publishfs.Open(filepath.Join(root, "publications"))
	if err != nil {
		t.Fatal(err)
	}
	defer pub.Close()
	unlock, err := pub.Lock()
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	var previous string
	for i, c := range []string{"a", "b"} {
		job := "job_" + strings.Repeat(c, 32)
		rel := "rel_" + strings.Repeat(c, 32)
		snap := "snap_" + strings.Repeat(c, 32)
		token := strings.Repeat(c, 64)
		body := `{"fixture":"` + c + `"}`
		sh := publishfs.Hash([]byte(body))
		exec("INSERT INTO snapshots(id,source_revision,projection_version,public_json,content_sha256,created_at) VALUES(?,0,1,?,?,1)", snap, body, sh)
		exec("UPDATE snapshots SET sealed_at=2 WHERE id=?", snap)
		exec("INSERT INTO publish_jobs(id,idempotency_key,kind,snapshot_id,activation_token_hash,requested_by,created_at) VALUES(?,?,'publish',?,?,1,2)", job, job, snap, publishfs.Hash([]byte(token)))
		exec("UPDATE publish_jobs SET status='running',phase='prepared',worker_id='publisher-v1',lease_token_hash=?,lease_expires_at=100,started_at=3 WHERE id=?", strings.Repeat("c", 64), job)
		output := t.TempDir()
		if err = os.WriteFile(filepath.Join(output, "index.html"), []byte("complete "+c), 0600); err != nil {
			t.Fatal(err)
		}
		m := publishmodel.Manifest{SchemaVersion: 1, JobID: job, ReleaseID: rel, SnapshotID: snap, SnapshotSHA256: sh, WorkspaceRevision: "ws-0", SourceRevision: strings.Repeat("d", 40), BuilderID: "isolated-builder", Kind: "publish", Origin: "https://xiaoworks.com", CreatedAt: "2026-10-28T00:00:00Z"}
		digest, e := pub.Prepare(job, m, output)
		if e != nil {
			t.Fatal(e)
		}
		exec("INSERT INTO releases(id,publish_job_id,snapshot_id,kind,directory_key,template_revision,manifest_sha256,created_at) VALUES(?,?,?,'publication',?,?,?,4)", rel, job, snap, rel, m.SourceRevision, digest)
		var previousValue any
		if previous != "" {
			previousValue = previous
		}
		exec("INSERT INTO publication_job_details(job_id,release_id,previous_release_id,source_revision,builder_id,manifest_sha256) VALUES(?,?,?,?,?,?)", job, rel, previousValue, m.SourceRevision, m.BuilderID, digest)
		receipt := publishmodel.Receipt{SchemaVersion: 1, JobID: job, ReleaseID: rel, PreviousReleaseID: previous, ActivationToken: token, SnapshotID: snap, SnapshotSHA256: sh, ManifestSHA256: digest, ActivatedAt: "2026-10-28T00:00:00Z", Outcome: "activated"}
		intent := publishmodel.Intent{Receipt: receipt, Phase: "prepared"}
		if i == 0 {
			if e = pub.Activate(intent, receipt); e != nil {
				t.Fatal(e)
			}
			exec("UPDATE publish_jobs SET status='reconciling',phase='activating' WHERE id=?", job)
			exec("UPDATE publish_jobs SET status='succeeded',phase=NULL,completed_at=5,reconciled_release_id=?,reconciled_at=5,reconciliation_receipt_sha256=? WHERE id=?", rel, strings.Repeat("e", 64), job)
			previous = rel
		} else {
			activation := filepath.Join(root, "publications/activations", job)
			if e = os.Mkdir(activation, 0700); e != nil {
				t.Fatal(e)
			}
			data, _ := json.Marshal(intent)
			if e = os.WriteFile(filepath.Join(activation, "intent.json"), data, 0600); e != nil {
				t.Fatal(e)
			}
			if e = os.Symlink("releases/"+rel, filepath.Join(root, "publications/current.next."+token)); e != nil {
				t.Fatal(e)
			}
			exec("UPDATE publish_jobs SET status='failed',phase=NULL,completed_at=5,error_code='BUILD_INTERRUPTED' WHERE id=?", job)
		}
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	return root, "current.next." + strings.Repeat("b", 64)
}

func TestCurrentRepairFullHashAuditThenBackupRestore(t *testing.T) {
	ctx := context.Background()
	root, member := currentFixture(t)
	if _, err := Backup(ctx, root, filepath.Join(t.TempDir(), "blocked")); err == nil {
		t.Fatal("backup accepted unresolved symlink")
	}
	p, err := InspectCurrentRepair(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Candidates) != 1 || p.Candidates[0].Status != "failed" || !p.Candidates[0].ReferencedByHistory {
		t.Fatal("unexpected plan", p)
	}
	if _, err = RepairCurrent(ctx, root, member, strings.Repeat("0", 64), "isolated interrupted activation review"); err == nil {
		t.Fatal("accepted stale plan")
	}
	r, err := RepairCurrent(ctx, root, member, p.SHA256, "isolated interrupted activation review")
	if err != nil {
		t.Fatal(err)
	}
	if r.Outcome != "verified-redundant-link-removed" || len(r.AfterFiles) != len(p.Files)-1 {
		t.Fatal("missing audit")
	}
	if _, err = os.Lstat(filepath.Join(root, "publications", member)); !os.IsNotExist(err) {
		t.Fatal("link retained", err)
	}
	if _, err = Inspect(ctx, root); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, err = Backup(ctx, root, backup); err != nil {
		t.Fatal(err)
	}
	if _, err = Verify(ctx, backup); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	for _, p := range []string{"db", "uploads", "publications", "secrets", "authority", "tls"} {
		if err = os.Mkdir(filepath.Join(target, p), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = Restore(ctx, backup, target); err != nil {
		t.Fatal(err)
	}
}

func TestCurrentRepairRejectsAmbiguityCorruptionAndLiveTasks(t *testing.T) {
	for _, change := range []string{"unknown-token", "escape", "regular", "artifact", "unfinished", "receipt", "pending-audit", "locked"} {
		t.Run(change, func(t *testing.T) {
			ctx := context.Background()
			root, member := currentFixture(t)
			pubdir := filepath.Join(root, "publications")
			switch change {
			case "unknown-token":
				os.Rename(filepath.Join(pubdir, member), filepath.Join(pubdir, "current.next."+strings.Repeat("f", 64)))
			case "escape":
				os.Remove(filepath.Join(pubdir, member))
				os.Symlink("../../outside", filepath.Join(pubdir, member))
			case "regular":
				os.Remove(filepath.Join(pubdir, member))
				os.WriteFile(filepath.Join(pubdir, member), []byte("x"), 0600)
			case "artifact":
				os.WriteFile(filepath.Join(pubdir, "releases/rel_"+strings.Repeat("b", 32)+"/public/index.html"), []byte("changed"), 0600)
			case "unfinished":
				db, e := store.Open(filepath.Join(root, "db/content.sqlite"), false)
				if e != nil {
					t.Fatal(e)
				}
				_, e = db.Exec("INSERT INTO publish_jobs(id,idempotency_key,kind,snapshot_id,requested_by,created_at) VALUES(?,'live','publish',?,1,7)", "job_"+strings.Repeat("f", 32), "snap_"+strings.Repeat("a", 32))
				db.Close()
				if e != nil {
					t.Fatal(e)
				}
			case "receipt":
				os.WriteFile(filepath.Join(pubdir, "activations/job_"+strings.Repeat("b", 32)+"/receipt.json"), []byte(`{}`), 0600)
			case "pending-audit":
				os.Mkdir(filepath.Join(pubdir, "maintenance-repairs"), 0700)
				record := CurrentRepairRecord{Format: 1, ID: "repair-incomplete", Outcome: "prepared"}
				b, _ := json.Marshal(record)
				os.WriteFile(filepath.Join(pubdir, "maintenance-repairs/repair-incomplete.intent.json"), b, 0600)
			case "locked":
				p, e := InspectCurrentRepair(ctx, root)
				if e != nil {
					t.Fatal(e)
				}
				s, e := publishfs.Open(pubdir)
				if e != nil {
					t.Fatal(e)
				}
				defer s.Close()
				unlock, e := s.Lock()
				if e != nil {
					t.Fatal(e)
				}
				defer unlock()
				if _, e = RepairCurrent(ctx, root, member, p.SHA256, "isolated locked writer review"); e == nil {
					t.Fatal("accepted active kernel lock")
				}
				return
			}
			if _, e := InspectCurrentRepair(ctx, root); e == nil {
				t.Fatal("accepted unsafe repair plan")
			}
		})
	}
}

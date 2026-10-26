package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/migrations"
)

func initialized(t *testing.T) (*sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "content.sqlite")
	db, err := Open(path, true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	return db, path
}

func TestMigrationAndPersistence(t *testing.T) {
	db, path := initialized(t)
	ctx := context.Background()
	if err := Migrate(ctx, db); err != nil {
		t.Fatalf("same migration must be repeatable: %v", err)
	}
	var accounts, projects int
	db.QueryRow("SELECT count(*) FROM administrators").Scan(&accounts)
	db.QueryRow("SELECT count(*) FROM project_drafts").Scan(&projects)
	if accounts != 0 || projects != 0 {
		t.Fatal("schema initialization must not create a default account or sample content")
	}
	if _, err := db.Exec("UPDATE workspace SET revision=7,updated_at=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	reopened, err := Open(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err := Check(ctx, reopened); err != nil {
		t.Fatal(err)
	}
	var revision int
	if err := reopened.QueryRow("SELECT revision FROM workspace WHERE id=1").Scan(&revision); err != nil || revision != 7 {
		t.Fatalf("revision did not survive reopen: %d %v", revision, err)
	}
	var version, integrity string
	reopened.QueryRow("SELECT sqlite_version()").Scan(&version)
	reopened.QueryRow("PRAGMA integrity_check").Scan(&integrity)
	if integrity != "ok" {
		t.Fatal(integrity)
	}
	t.Logf("actual SQLite core=%s integrity=%s", version, integrity)
}

func TestMissingAndUnknownDatabaseRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "absent.sqlite")
	if db, err := Open(path, false); err == nil {
		db.Close()
		t.Fatal("serve must not create a missing database")
	}
	db, err := Open(path, true)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.Exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)")
	if err := Migrate(context.Background(), db); err == nil {
		t.Fatal("must not adopt an unknown database")
	}
	known, _ := initialized(t)
	known.Exec("UPDATE schema_migrations SET version=99 WHERE version=2")
	if err := Check(context.Background(), known); err == nil {
		t.Fatal("must reject a newer schema")
	}
	known.Exec("UPDATE schema_migrations SET version=2 WHERE version=99")
	known.Exec("UPDATE schema_migrations SET checksum='changed' WHERE version=1")
	if err := Check(context.Background(), known); err == nil {
		t.Fatal("must reject changed migration bytes at the same schema version")
	}
}

func TestAppendOnlyUpgradePreservesVersionOneDataAndChecksEveryChecksum(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.sqlite")
	db, err := Open(path, true)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	if _, err := db.Exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL,checksum TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(migrations.Initial); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO schema_migrations VALUES(1,'legacy',?)", migrationChecksum(1)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO workspace(id,revision,updated_at) VALUES(1,11,1)"); err != nil {
		t.Fatal(err)
	}
	if err := Check(ctx, db); err == nil {
		t.Fatal("serve must refuse old schema before explicit upgrade")
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := Check(ctx, db); err != nil {
		t.Fatal(err)
	}
	var revision, count int
	if err := db.QueryRow("SELECT revision FROM workspace WHERE id=1").Scan(&revision); err != nil || revision != 11 {
		t.Fatalf("lost old workspace: %d %v", revision, err)
	}
	if err := db.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&count); err != nil || count != 2 {
		t.Fatalf("history: %d %v", count, err)
	}
	if _, err := db.Exec("UPDATE schema_migrations SET checksum='tampered' WHERE version=1"); err != nil {
		t.Fatal(err)
	}
	if err := Check(ctx, db); err == nil {
		t.Fatal("latest version cannot hide modified old checksum")
	}
	if err := Migrate(ctx, db); err == nil {
		t.Fatal("explicit migration must also reject changed old checksum")
	}
}

func TestMigrationGapRejected(t *testing.T) {
	db, _ := initialized(t)
	if _, err := db.Exec("DELETE FROM schema_migrations WHERE version=1"); err != nil {
		t.Fatal(err)
	}
	if err := Check(context.Background(), db); err == nil {
		t.Fatal("missing earlier migration must fail")
	}
	if err := Migrate(context.Background(), db); err == nil {
		t.Fatal("missing earlier migration cannot be reconstructed implicitly")
	}
}

func TestJobRequiresOwnReconciliation(t *testing.T) {
	db, _ := initialized(t)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	reject := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err == nil {
			t.Fatalf("expected constraint rejection: %s", query)
		}
	}
	hash := strings.Repeat("a", 64)
	exec("INSERT INTO administrators(id,username,password_hash,created_at,updated_at) VALUES(1,'test-only',?,1,1)", strings.Repeat("x", 32))
	exec("INSERT INTO snapshots(id,source_revision,projection_version,public_json,content_sha256,created_at) VALUES('s',1,1,'{}',?,1)", hash)
	exec("UPDATE snapshots SET sealed_at=2 WHERE id='s'")
	exec("INSERT INTO publish_jobs(id,idempotency_key,kind,snapshot_id,activation_token_hash,requested_by,created_at) VALUES('j','test-j','publish','s',?,1,2)", strings.Repeat("b", 64))
	reject("INSERT INTO publish_jobs(id,idempotency_key,kind,snapshot_id,requested_by,created_at) VALUES('second','test-second','preview','s',1,2)")
	exec("UPDATE publish_jobs SET status='running',phase='building',worker_id='w',lease_token_hash=?,lease_expires_at=100,started_at=3 WHERE id='j'", hash)
	exec("INSERT INTO releases(id,publish_job_id,snapshot_id,kind,directory_key,template_revision,manifest_sha256,created_at) VALUES('r','j','s','publication','r',?,?,4)", strings.Repeat("c", 40), hash)
	exec("UPDATE publish_jobs SET status='reconciling',phase='activating' WHERE id='j'")
	reject("UPDATE publish_jobs SET status='succeeded',phase=NULL,completed_at=5 WHERE id='j'")
	exec("UPDATE publish_jobs SET status='succeeded',phase=NULL,completed_at=5,reconciled_release_id='r',reconciled_at=5,reconciliation_receipt_sha256=? WHERE id='j'", strings.Repeat("d", 64))
	reject("UPDATE publish_jobs SET status='failed' WHERE id='j'")
	exec("INSERT INTO publish_jobs(id,idempotency_key,kind,snapshot_id,target_release_id,activation_token_hash,requested_by,created_at) VALUES('rb','test-rb','rollback','s','r',?,1,6)", strings.Repeat("e", 64))
	exec("UPDATE publish_jobs SET status='reconciling',phase='activating',worker_id='w',lease_token_hash=?,lease_expires_at=100,started_at=7 WHERE id='rb'", hash)
	reject("UPDATE publish_jobs SET status='succeeded',phase=NULL,completed_at=8,reconciled_release_id='r',reconciled_at=8,reconciliation_receipt_sha256=? WHERE id='rb'", strings.Repeat("d", 64))
	exec("UPDATE publish_jobs SET status='succeeded',phase=NULL,completed_at=8,reconciled_release_id='r',reconciled_at=8,reconciliation_receipt_sha256=? WHERE id='rb'", strings.Repeat("f", 64))
	var count int
	if err := db.QueryRow("SELECT count(*) FROM releases").Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback must use retained artifact: %d %v", count, err)
	}
}

func TestSnapshotAndAssetConstraints(t *testing.T) {
	db, _ := initialized(t)
	hash := strings.Repeat("a", 64)
	statements := []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO assets(id,storage_kind,storage_key,sha256,media_type,byte_size,width,height,created_at) VALUES('a','upload','covers/a.webp',?,'image/webp',10,1,1,1)", []any{hash}},
		{"INSERT INTO snapshots(id,source_revision,projection_version,public_json,content_sha256,created_at) VALUES('s',1,1,'{}',?,1)", []any{hash}},
		{"INSERT INTO snapshot_assets(snapshot_id,asset_id,public_path) VALUES('s','a','images/a.webp')", nil},
		{"UPDATE snapshots SET sealed_at=2 WHERE id='s'", nil},
	}
	for _, s := range statements {
		if _, err := db.Exec(s.sql, s.args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, statement := range []string{
		"UPDATE snapshots SET public_json='{\"changed\":true}' WHERE id='s'",
		"DELETE FROM snapshots WHERE id='s'",
		"DELETE FROM snapshot_assets WHERE snapshot_id='s'",
		"INSERT INTO snapshot_assets(snapshot_id,asset_id,public_path) VALUES('s','a','images/extra.webp')",
		"UPDATE assets SET storage_key='changed.webp' WHERE id='a'",
		"DELETE FROM assets WHERE id='a'",
		"INSERT INTO snapshot_assets(snapshot_id,asset_id,public_path) VALUES('missing','missing','a.webp')",
	} {
		if _, err := db.Exec(statement); err == nil {
			t.Fatalf("constraint did not reject: %s", statement)
		}
	}
	if _, err := db.Exec("INSERT INTO assets(id,storage_kind,storage_key,sha256,media_type,byte_size,width,height,created_at) VALUES('bad','upload','../bad',?,'image/svg+xml',10,1,1,1)", hash); err == nil {
		t.Fatal("unsafe path/active upload must not pass schema constraints")
	}
}

func TestReviewedSQLiteBaseline(t *testing.T) {
	for _, version := range []string{"3.51.3", "3.53.0", "4.0.0"} {
		if !SafeSQLiteVersion(version) {
			t.Fatal(version)
		}
	}
	for _, version := range []string{"3.51.2", "3.50.7", "3.9.0", "3.99.bad", "unknown"} {
		if SafeSQLiteVersion(version) {
			t.Fatal(version)
		}
	}
}

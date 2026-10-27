package store

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/migrations"
)

func TestVersionTwoPublicationUpgradePreservesExistingWorkspaceAndChecksums(t *testing.T) {
	db, e := Open(filepath.Join(t.TempDir(), "version-two.sqlite"), true)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if _, e = db.Exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL,checksum TEXT NOT NULL)`); e != nil {
		t.Fatal(e)
	}
	for index, source := range []string{migrations.Initial, migrations.ContentHistory} {
		if _, e = db.Exec(source); e != nil {
			t.Fatal(e)
		}
		if _, e = db.Exec(`INSERT INTO schema_migrations VALUES(?,'version-two-history',?)`, index+1, migrationChecksum(index+1)); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = db.Exec(`UPDATE workspace SET revision=29,updated_at=100 WHERE id=1`); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(`INSERT INTO workspace_documents(kind,content_json,updated_at) VALUES('site','{"retained":"existing-private-workspace"}',100)`); e != nil {
		t.Fatal(e)
	}
	if e = Migrate(context.Background(), db); e != nil {
		t.Fatal(e)
	}
	var revision int
	var raw string
	if e = db.QueryRow(`SELECT revision FROM workspace WHERE id=1`).Scan(&revision); e != nil || revision != 29 {
		t.Fatal("migration changed revision")
	}
	if e = db.QueryRow(`SELECT content_json FROM workspace_documents WHERE kind='site'`).Scan(&raw); e != nil || raw != `{"retained":"existing-private-workspace"}` {
		t.Fatal("migration changed existing content")
	}
	if e = Check(context.Background(), db); e != nil {
		t.Fatal(e)
	}
	if e = Migrate(context.Background(), db); e != nil {
		t.Fatal("reapplying reviewed migration failed", e)
	}
	var oldChecksum string
	if e = db.QueryRow(`SELECT checksum FROM schema_migrations WHERE version=2`).Scan(&oldChecksum); e != nil || oldChecksum != migrationChecksum(2) {
		t.Fatal("old applied migration checksum changed")
	}
}

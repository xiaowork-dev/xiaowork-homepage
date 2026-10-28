package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/authn"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func emptyRoots(t *testing.T, root string) {
	t.Helper()
	for _, p := range []string{"db", "uploads", "publications/releases", "publications/staging", "publications/preview", "publications/activations", "secrets", "authority", "tls"} {
		if err := os.MkdirAll(filepath.Join(root, p), 0700); err != nil {
			t.Fatal(err)
		}
	}
}
func TestStoppedBackupRestore(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	source := filepath.Join(root, "source")
	emptyRoots(t, source)
	db, err := store.Open(filepath.Join(source, "db", "content.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = authn.InitAdministrator(ctx, db, "test-backup-admin", []byte("temporary-isolated-password")); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE workspace SET revision=7,updated_at=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO sessions(token_hash,administrator_id,credential_version,csrf_token_hash,created_at,expires_at,last_seen_at,last_interactive_at) VALUES(?,1,1,?,1,9999999999,1,1)", string(makeHex('a')), string(makeHex('b'))); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, "secrets", "session.key"), []byte("private-backup-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	// Keep SQLite open with its WAL present: VACUUM INTO must create a complete
	// consistent database, rather than relying on copying a lone main DB file.
	destination := filepath.Join(root, "backup")
	manifest, err := Backup(ctx, source, destination)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.State.WorkspaceRevision != 7 || manifest.State.Administrators != 1 {
		t.Fatal("backup state")
	}
	if _, err = Verify(ctx, destination); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "restored")
	emptyRoots(t, target)
	// Restore demands new empty mounted directories; remove publication skeleton.
	for _, p := range []string{"releases", "staging", "preview", "activations"} {
		if err = os.Remove(filepath.Join(target, "publications", p)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = Restore(ctx, destination, target); err != nil {
		t.Fatal(err)
	}
	restored, err := store.Open(filepath.Join(target, "db", "content.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var revoked int
	if err = restored.QueryRow("SELECT count(*) FROM sessions WHERE revoked_at IS NOT NULL").Scan(&revoked); err != nil || revoked != 1 {
		t.Fatal("restored sessions not revoked", err)
	}
	if _, err = Restore(ctx, destination, target); err == nil {
		t.Fatal("overwrote nonempty target")
	}
	if err = Compatible(store.SchemaVersion + 1); err == nil {
		t.Fatal("accepted incompatible schema")
	}
	if err = os.WriteFile(filepath.Join(destination, "secrets", "session.key"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = Verify(ctx, destination); err == nil {
		t.Fatal("accepted corrupted backup")
	}
	db.Close()
}
func makeHex(ch byte) []byte {
	b := make([]byte, 64)
	for i := range b {
		b[i] = ch
	}
	return b
}

func TestBackupRejectsUnfinishedAndSymlink(t *testing.T) {
	if Compatible(0) == nil {
		t.Fatal("unknown schema accepted")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "secret"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("secret", filepath.Join(root, "outside")); err != nil {
		t.Skip("OS symlink privilege unavailable")
	}
	if _, err := inventory(root); err == nil {
		t.Fatal("accepted arbitrary symlink")
	}
}

package authn

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func TestPasswordEncodingAndValidation(t *testing.T) {
	password := []byte("可以保留空格的安全密码 2026")
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=1$") || !VerifyPassword(hash, password) {
		t.Fatal("approved PHC encoding did not verify")
	}
	if VerifyPassword(hash, []byte("wrong password")) || VerifyPassword(strings.Replace(hash, "m=65536", "m=999999999", 1), password) {
		t.Fatal("wrong password or unreviewed cost accepted")
	}
	for _, value := range [][]byte{[]byte("short"), []byte(strings.Repeat("a", 129)), {0xff}} {
		if ValidatePassword(value) == nil {
			t.Fatal("invalid password accepted")
		}
	}
	second, err := HashPassword(password)
	if err != nil || second == hash {
		t.Fatal("password salts must be random")
	}
}

func TestOfflineInitializationDoesNotOverwriteAndResetRevokes(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(filepath.Join(t.TempDir(), "admin.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = store.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	password := []byte("Offline first secure password")
	if err = InitAdministrator(ctx, db, "xiaowork", password); err != nil {
		t.Fatal(err)
	}
	if err = InitAdministrator(ctx, db, "other", []byte("Do not overwrite this account")); err == nil {
		t.Fatal("existing administrator overwritten")
	}
	var hash, username string
	if err = db.QueryRow("SELECT username,password_hash FROM administrators WHERE id=1").Scan(&username, &hash); err != nil || username != "xiaowork" || !VerifyPassword(hash, password) {
		t.Fatal("initial administrator changed", err)
	}
	now := time.Now().UTC().Unix()
	if _, err = db.Exec("INSERT INTO sessions(token_hash,administrator_id,credential_version,csrf_token_hash,created_at,expires_at,last_seen_at,last_interactive_at) VALUES(?,1,1,?,?,?,?,?)", strings.Repeat("a", 64), strings.Repeat("b", 64), now, now+43200, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO login_challenges(nonce_hash,cookie_hash,source_bucket_hash,created_at,expires_at) VALUES(?,?,?,?,?)", strings.Repeat("c", 64), strings.Repeat("d", 64), strings.Repeat("e", 64), now, now+300); err != nil {
		t.Fatal(err)
	}
	newPassword := []byte("Offline rotated secure password")
	if err = ResetAdministrator(ctx, db, newPassword); err != nil {
		t.Fatal(err)
	}
	var revoked, version, challenges int64
	if err = db.QueryRow("SELECT revoked_at FROM sessions").Scan(&revoked); err != nil || revoked < now {
		t.Fatal("reset did not revoke session", err)
	}
	if err = db.QueryRow("SELECT password_hash,credential_version FROM administrators WHERE id=1").Scan(&hash, &version); err != nil || version != 2 || !VerifyPassword(hash, newPassword) {
		t.Fatal("reset did not rotate credentials", err)
	}
	if err = db.QueryRow("SELECT count(*) FROM login_challenges").Scan(&challenges); err != nil || challenges != 0 {
		t.Fatal("reset retained login challenges", err)
	}
}

func TestSecretExclusiveCreationAndPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "csrf-secret")
	if _, err := ReadSecret(path); err == nil {
		t.Fatal("missing secret accepted")
	}
	if err := CreateSecret(path); err != nil {
		t.Fatal(err)
	}
	secret, err := ReadSecret(path)
	if err != nil || len(secret) != 32 {
		t.Fatal("secret read failed", err)
	}
	if err = CreateSecret(path); err == nil {
		t.Fatal("secret was overwritten")
	}
	if runtime.GOOS != "windows" {
		if err = os.Chmod(path, 0644); err != nil {
			t.Fatal(err)
		}
		if _, err = ReadSecret(path); err == nil {
			t.Fatal("publicly readable secret accepted")
		}
	}
	if err = os.WriteFile(path, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = ReadSecret(path); err == nil {
		t.Fatal("invalid length secret accepted")
	}
}

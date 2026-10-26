// Package authn contains password and offline account operations. It never reads
// passwords from process arguments, the environment, or logs.
package authn

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"regexp"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const (
	memory      = 64 * 1024
	iterations  = 3
	parallelism = 1
	keyLength   = 32
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$`)

func ValidUsername(username string) bool { return usernamePattern.MatchString(username) }

func ValidatePassword(password []byte) error {
	if !utf8.Valid(password) || len(password) > 1024 || utf8.RuneCount(password) < 12 || utf8.RuneCount(password) > 128 {
		return errors.New("password must contain 12–128 Unicode characters and at most 1024 UTF-8 bytes")
	}
	return nil
}

func HashPassword(password []byte) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey(password, salt, iterations, memory, parallelism, keyLength)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword only accepts the reviewed cost profile; malicious or corrupted
// database parameters cannot allocate an attacker-selected amount of memory.
func VerifyPassword(encoded string, password []byte) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=1" {
		return false
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) != 16 {
		return false
	}
	expected, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil || len(expected) != keyLength {
		return false
	}
	actual := argon2.IDKey(password, salt, iterations, memory, parallelism, keyLength)
	return subtle.ConstantTimeCompare(expected, actual) == 1
}

// DummyVerify burns the same password KDF cost for unknown usernames. Its
// result is never used as authentication and it cannot create an account.
func DummyVerify(password []byte) {
	_ = argon2.IDKey(password, []byte("xw-dummy-salt-v1!"), iterations, memory, parallelism, keyLength)
}

func InitAdministrator(ctx context.Context, db *sql.DB, username string, password []byte) error {
	if !ValidUsername(username) {
		return errors.New("username must be 1–80 ASCII letters, digits, dot, underscore or hyphen and start with a letter or digit")
	}
	encoded, err := HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var existing int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM administrators").Scan(&existing); err != nil {
		return err
	}
	if existing != 0 {
		return errors.New("administrator already exists; initialization refuses to overwrite it")
	}
	now := time.Now().UTC().Unix()
	if _, err := tx.ExecContext(ctx, "INSERT INTO administrators(id,username,password_hash,credential_version,created_at,updated_at) VALUES(1,?,?,1,?,?)", username, encoded, now, now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO audit_events(actor_administrator_id,action,resource_type,resource_id,outcome,created_at) VALUES(1,'administrator.initialize','administrator','1','success',?)", now); err != nil {
		return err
	}
	return tx.Commit()
}

func ResetAdministrator(ctx context.Context, db *sql.DB, password []byte) error {
	encoded, err := HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Unix()
	result, err := tx.ExecContext(ctx, "UPDATE administrators SET password_hash=?,credential_version=credential_version+1,updated_at=? WHERE id=1", encoded, now)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("administrator does not exist; initialize explicitly first")
	}
	if _, err := tx.ExecContext(ctx, "UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL", now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM login_challenges"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO audit_events(actor_administrator_id,action,resource_type,resource_id,outcome,created_at) VALUES(1,'administrator.offline-reset','administrator','1','success',?)", now); err != nil {
		return err
	}
	return tx.Commit()
}

// CreateSecret is an explicit offline operation; serve never silently creates
// a new key and thereby invalidates established sessions.
func CreateSecret(path string) error {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("cannot exclusively create secret file")
	}
	ok := false
	defer func() {
		file.Close()
		if !ok {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(secret); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	ok = true
	return nil
}

func ReadSecret(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("secret must be an existing regular file")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("secret file must not grant group or other permissions")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.New("cannot open secret file")
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) || opened.Size() != 32 {
		return nil, errors.New("secret file changed or does not contain exactly 32 bytes")
	}
	secret := make([]byte, 32)
	if _, err := file.ReadAt(secret, 0); err != nil {
		return nil, errors.New("cannot read complete secret file")
	}
	return secret, nil
}

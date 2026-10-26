package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/migrations"
	_ "modernc.org/sqlite"
)

const SchemaVersion = 1

// Open uses one connection for the scaffold. Every new connection receives all pragmas.
// Production concurrency and migration locking are P6-B/E acceptance items.
func Open(path string, create bool) (*sql.DB, error) {
	if !create {
		if _, err := os.Stat(path); err != nil {
			return nil, errors.New("database is absent; run the explicit migrate command first")
		}
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	uriPath := filepath.ToSlash(absolute)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	u := url.URL{Scheme: "file", Path: uriPath}
	q := url.Values{}
	if create {
		q.Set("mode", "rwc")
	} else {
		q.Set("mode", "rw")
	}
	for _, pragma := range []string{"foreign_keys(1)", "busy_timeout(5000)", "journal_mode(WAL)", "synchronous(FULL)"} {
		q.Add("_pragma", pragma)
	}
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var version string
	if err := db.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if !SafeSQLiteVersion(version) {
		db.Close()
		return nil, fmt.Errorf("SQLite %s does not meet the reviewed WAL baseline >=3.51.3", version)
	}
	return db, nil
}

func SafeSQLiteVersion(version string) bool {
	parts := strings.Split(version, ".")
	if len(parts) != 3 {
		return false
	}
	minimum := []int{3, 51, 3}
	values := make([]int, 3)
	for i, part := range parts {
		value, err := strconv.Atoi(part)
		if err != nil || value < 0 {
			return false
		}
		values[i] = value
	}
	for i, value := range values {
		if value != minimum[i] {
			return value > minimum[i]
		}
	}
	return true
}

func Check(ctx context.Context, db *sql.DB) error {
	var count, version int
	if err := db.QueryRowContext(ctx, "SELECT count(*), coalesce(max(version), 0) FROM schema_migrations").Scan(&count, &version); err != nil {
		return errors.New("database schema is not initialized")
	}
	if count != 1 || version != SchemaVersion {
		return errors.New("unsupported database schema; refusing to serve")
	}
	var checksum string
	if err := db.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE version=?", SchemaVersion).Scan(&checksum); err != nil || checksum != migrationChecksum() {
		return errors.New("migration checksum mismatch; refusing schema drift")
	}
	return db.PingContext(ctx)
}

func migrationChecksum() string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(migrations.Initial)))
}

// Migrate only installs the P6-A schema into an empty database or checks the same version.
// It will not adopt an unknown existing database, seed an account, or downgrade a schema.
func Migrate(ctx context.Context, db *sql.DB) error {
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return Check(ctx, db)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL)"); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, migrations.Initial); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at, checksum) VALUES (?, ?, ?)", SchemaVersion, time.Now().UTC().Format(time.RFC3339Nano), migrationChecksum()); err != nil {
		return err
	}
	return tx.Commit()
}

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

const SchemaVersion = 3

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
	version, err := checkHistory(ctx, db)
	if err != nil {
		return err
	}
	if version != SchemaVersion {
		return errors.New("unsupported database schema; run explicit migrations before serving")
	}
	return db.PingContext(ctx)
}

func migrationChecksum(version int) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(migrations.All[version-1])))
}

type historyQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// Every previously applied checksum is checked, not only the latest migration.
func checkHistory(ctx context.Context, db historyQuerier) (int, error) {
	rows, err := db.QueryContext(ctx, "SELECT version, checksum FROM schema_migrations ORDER BY version")
	if err != nil {
		return 0, errors.New("database schema is not initialized")
	}
	defer rows.Close()
	version := 0
	for rows.Next() {
		var current int
		var checksum string
		if err := rows.Scan(&current, &checksum); err != nil {
			return 0, err
		}
		if current != version+1 || current > SchemaVersion {
			return 0, errors.New("unsupported or incomplete migration history")
		}
		if checksum != migrationChecksum(current) {
			return 0, errors.New("migration checksum mismatch; refusing schema drift")
		}
		version = current
	}
	return version, rows.Err()
}

// Migrate explicitly upgrades reviewed, contiguous migrations. It never adopts
// unknown tables, seeds accounts/business content, or downgrades a schema.
func Migrate(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		if _, err := tx.ExecContext(ctx, "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL)"); err != nil {
			return err
		}
	}
	// Acquire the write lock before observing the applied version. Concurrent
	// explicit upgrades cannot both select and apply the same pending migration.
	if _, err := tx.ExecContext(ctx, "UPDATE schema_migrations SET version=version WHERE 0"); err != nil {
		return errors.New("refusing to adopt an unknown database")
	}
	version, err := checkHistory(ctx, tx)
	if err != nil {
		return err
	}
	if count != 0 && version == 0 {
		return errors.New("refusing a database without reviewed migration history")
	}
	for next := version + 1; next <= SchemaVersion; next++ {
		if _, err := tx.ExecContext(ctx, migrations.All[next-1]); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at, checksum) VALUES (?, ?, ?)", next, time.Now().UTC().Format(time.RFC3339Nano), migrationChecksum(next)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

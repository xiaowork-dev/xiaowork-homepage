// Package maintenance is an offline operator tool. It is never linked into the
// HTTP API or Worker and cannot be invoked through a web request.
package maintenance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/authn"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
	_ "modernc.org/sqlite"
)

type File struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256,omitempty"`
	Link   string `json:"link,omitempty"`
}
type State struct {
	Schema            int      `json:"schema"`
	WorkspaceRevision int64    `json:"workspaceRevision"`
	Administrators    int64    `json:"administrators"`
	Projects          int64    `json:"projects"`
	Uploads           int64    `json:"uploads"`
	Snapshots         int64    `json:"snapshots"`
	Jobs              int64    `json:"jobs"`
	Releases          int64    `json:"releases"`
	Unfinished        int64    `json:"unfinished"`
	ActiveRelease     string   `json:"activeRelease"`
	Sources           []string `json:"sources"`
	Builders          []string `json:"builders"`
}
type Manifest struct {
	Format        int    `json:"format"`
	CreatedAt     string `json:"createdAt"`
	Method        string `json:"method"`
	SessionPolicy string `json:"sessionPolicy"`
	State         State  `json:"state"`
	Files         []File `json:"files"`
}

func openReadOnly(path string) (*sql.DB, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("database is not a regular file")
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	q := url.Values{"mode": {"ro"}, "_pragma": {"foreign_keys(1)", "busy_timeout(5000)"}}
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// Inspect performs SQLite integrity/FK and application schema/history checks,
// then checks every upload and immutable release, including historical previews.
// The caller must have stopped all database/upload/publication writers.
func Inspect(ctx context.Context, root string) (State, error) {
	var result State
	db, err := openReadOnly(filepath.Join(root, "db", "content.sqlite"))
	if err != nil {
		return result, err
	}
	defer db.Close()
	if err = store.Check(ctx, db); err != nil {
		return result, err
	}
	result.Schema = store.SchemaVersion
	var integrity string
	if err = db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		return result, errors.New("SQLite integrity check failed")
	}
	fk, err := db.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return result, err
	}
	invalidFK := fk.Next()
	err = fk.Close()
	if err != nil || invalidFK {
		return result, errors.New("SQLite foreign key check failed")
	}
	queries := []struct {
		sql    string
		target *int64
	}{
		{"SELECT COALESCE((SELECT revision FROM workspace WHERE id=1),0)", &result.WorkspaceRevision},
		{"SELECT count(*) FROM administrators", &result.Administrators},
		{"SELECT count(*) FROM project_drafts", &result.Projects},
		{"SELECT count(*) FROM assets WHERE storage_kind='upload'", &result.Uploads},
		{"SELECT count(*) FROM snapshots", &result.Snapshots},
		{"SELECT count(*) FROM publish_jobs", &result.Jobs},
		{"SELECT count(*) FROM releases", &result.Releases},
		{"SELECT count(*) FROM publish_jobs WHERE status IN ('queued','running','reconciling')", &result.Unfinished},
	}
	for _, q := range queries {
		if err = db.QueryRowContext(ctx, q.sql).Scan(q.target); err != nil {
			return result, err
		}
	}
	if result.Unfinished != 0 {
		return result, errors.New("unfinished publication requires reconciliation before offline backup or upgrade")
	}
	rows, err := db.QueryContext(ctx, "SELECT storage_key,sha256,byte_size FROM assets WHERE storage_kind='upload'")
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var name, digest string
		var size int64
		if err = rows.Scan(&name, &digest, &size); err != nil {
			rows.Close()
			return result, err
		}
		if !publishfs.SafePath(name) {
			rows.Close()
			return result, errors.New("unsafe upload key")
		}
		f, e := hashFile(filepath.Join(root, "uploads", filepath.FromSlash(name)))
		if e != nil || f.SHA256 != digest || f.Bytes != size {
			rows.Close()
			return result, errors.New("upload reference hash mismatch")
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	publications, err := publishfs.OpenReadOnly(filepath.Join(root, "publications"))
	if err != nil {
		return result, err
	}
	defer publications.Close()
	result.ActiveRelease, err = publications.Current()
	if err != nil {
		return result, err
	}
	rows, err = db.QueryContext(ctx, "SELECT id,manifest_sha256,snapshot_id FROM releases ORDER BY id")
	if err != nil {
		return result, err
	}
	activeFound := result.ActiveRelease == ""
	sources, builders := map[string]bool{}, map[string]bool{}
	for rows.Next() {
		var id, digest, snapshot string
		if err = rows.Scan(&id, &digest, &snapshot); err != nil {
			rows.Close()
			return result, err
		}
		manifest, actual, e := publications.VerifyRelease(id)
		if e != nil || actual != digest || manifest.SnapshotID != snapshot {
			rows.Close()
			return result, errors.New("historical publication integrity mismatch")
		}
		if id == result.ActiveRelease {
			activeFound = true
		}
		sources[manifest.SourceRevision] = true
		builders[manifest.BuilderID] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	if !activeFound {
		return result, errors.New("current release missing from database")
	}
	if result.ActiveRelease != "" {
		var proven int
		err = db.QueryRowContext(ctx, "SELECT count(*) FROM publish_jobs WHERE status='succeeded' AND reconciled_release_id=?", result.ActiveRelease).Scan(&proven)
		if err != nil || proven == 0 {
			return result, errors.New("active release lacks successful database reconciliation")
		}
	}
	rows, err = db.QueryContext(ctx, "SELECT public_json,content_sha256 FROM snapshots WHERE sealed_at IS NOT NULL")
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var value, digest string
		if err = rows.Scan(&value, &digest); err != nil {
			rows.Close()
			return result, err
		}
		sum := sha256.Sum256([]byte(value))
		if hex.EncodeToString(sum[:]) != digest {
			rows.Close()
			return result, errors.New("sealed snapshot hash mismatch")
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	for source := range sources {
		result.Sources = append(result.Sources, source)
	}
	sort.Strings(result.Sources)
	for builder := range builders {
		result.Builders = append(result.Builders, builder)
	}
	sort.Strings(result.Builders)
	return result, nil
}

func hashFile(path string) (File, error) {
	var result File
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return result, errors.New("backup member is not a regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return result, err
	}
	defer f.Close()
	h := sha256.New()
	result.Bytes, err = io.Copy(h, f)
	if err != nil {
		return result, err
	}
	result.SHA256 = hex.EncodeToString(h.Sum(nil))
	return result, nil
}

func inventory(root string) ([]File, error) {
	var files []File
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		name, e := filepath.Rel(root, path)
		if e != nil {
			return e
		}
		name = filepath.ToSlash(name)
		if name == "manifest.json" {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			link, e := os.Readlink(path)
			if e != nil {
				return e
			}
			if name != "publications/current" || !strings.HasPrefix(link, "releases/") || !publishfs.ValidID(strings.TrimPrefix(link, "releases/"), "rel") {
				return errors.New("unsafe backup symbolic link")
			}
			files = append(files, File{Path: name, Link: link})
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if !publishfs.SafePath(name) {
			return errors.New("unsafe backup member name")
		}
		f, e := hashFile(path)
		if e != nil {
			return e
		}
		f.Path = name
		files = append(files, f)
		return nil
	})
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, err
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name, e := filepath.Rel(source, path)
		if e != nil {
			return e
		}
		target := filepath.Join(destination, name)
		if entry.IsDir() {
			if err := os.MkdirAll(target, 0700); err != nil {
				return err
			}
			return os.Chmod(target, 0700)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			link, e := os.Readlink(path)
			if e != nil {
				return e
			}
			if filepath.ToSlash(name) != "current" || !strings.HasPrefix(link, "releases/") || !publishfs.ValidID(strings.TrimPrefix(link, "releases/"), "rel") {
				return errors.New("unexpected source symlink")
			}
			return os.Symlink(link, target)
		}
		if !entry.Type().IsRegular() {
			return errors.New("non-regular backup source")
		}
		in, e := os.Open(path)
		if e != nil {
			return e
		}
		defer in.Close()
		out, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return e
		}
		_, e = io.Copy(out, in)
		if e == nil {
			e = out.Sync()
		}
		closeErr := out.Close()
		if e != nil {
			return e
		}
		return closeErr
	})
}

// Backup is deliberately fail-closed. It uses SQLite VACUUM INTO, never copies
// a live main DB file, and requires an operator-enforced stopped writer set.
func Backup(ctx context.Context, source, destination string) (Manifest, error) {
	var result Manifest
	state, err := Inspect(ctx, source)
	if err != nil {
		return result, err
	}
	if err = os.Mkdir(destination, 0700); err != nil {
		return result, errors.New("backup destination must not exist")
	}
	for _, name := range []string{"db", "uploads", "publications", "secrets"} {
		if err = os.Mkdir(filepath.Join(destination, name), 0700); err != nil {
			return result, err
		}
	}
	db, err := openReadOnly(filepath.Join(source, "db", "content.sqlite"))
	if err != nil {
		return result, err
	}
	_, err = db.ExecContext(ctx, "VACUUM INTO ?", filepath.Join(destination, "db", "content.sqlite"))
	closeErr := db.Close()
	if err != nil {
		return result, err
	}
	if closeErr != nil {
		return result, closeErr
	}
	for _, name := range []string{"uploads", "publications", "secrets", "authority", "tls"} {
		if _, err = os.Stat(filepath.Join(source, name)); os.IsNotExist(err) {
			if name == "authority" || name == "tls" {
				continue
			}
			return result, errors.New("required backup directory absent")
		}
		if err = copyTree(filepath.Join(source, name), filepath.Join(destination, name)); err != nil {
			return result, err
		}
	}
	verified, err := Inspect(ctx, destination)
	if err != nil {
		return result, err
	}
	before, _ := json.Marshal(state)
	after, _ := json.Marshal(verified)
	if string(before) != string(after) {
		return result, errors.New("database/publication state changed during backup")
	}
	result = Manifest{Format: 1, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Method: "stopped-writers + SQLite VACUUM INTO", SessionPolicy: "all sessions and login challenges revoked on restore", State: state}
	result.Files, err = inventory(destination)
	if err != nil {
		return result, err
	}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return result, err
	}
	err = os.WriteFile(filepath.Join(destination, "manifest.json"), append(data, '\n'), 0600)
	return result, err
}

func Verify(ctx context.Context, source string) (Manifest, error) {
	var result Manifest
	data, err := os.ReadFile(filepath.Join(source, "manifest.json"))
	if err != nil {
		return result, err
	}
	if len(data) > 32<<20 {
		return result, errors.New("backup manifest too large")
	}
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.DisallowUnknownFields()
	if err = d.Decode(&result); err != nil {
		return result, err
	}
	if result.Format != 1 || result.State.Schema != store.SchemaVersion {
		return result, errors.New("unsupported backup format or database schema")
	}
	actual, err := inventory(source)
	if err != nil {
		return result, err
	}
	expectedBytes, _ := json.Marshal(result.Files)
	actualBytes, _ := json.Marshal(actual)
	if string(actualBytes) != string(expectedBytes) {
		return result, errors.New("backup file inventory/hash mismatch")
	}
	state, err := Inspect(ctx, source)
	if err != nil {
		return result, err
	}
	a, _ := json.Marshal(state)
	b, _ := json.Marshal(result.State)
	if string(a) != string(b) {
		return result, errors.New("backup state mismatch")
	}
	return result, nil
}

// Restore only accepts entirely empty mounted directories. Session revocation is
// a documented security change after byte-identical copy verification.
func Restore(ctx context.Context, source, destination string) (State, error) {
	var result State
	manifest, err := Verify(ctx, source)
	if err != nil {
		return result, err
	}
	for _, name := range []string{"db", "uploads", "publications", "secrets", "authority", "tls"} {
		dir := filepath.Join(destination, name)
		info, e := os.Lstat(dir)
		if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return result, errors.New("restore requires pre-created empty target directories")
		}
		entries, e := os.ReadDir(dir)
		if e != nil || len(entries) != 0 {
			return result, errors.New("refusing to overwrite a nonempty restore target")
		}
	}
	for _, name := range []string{"db", "uploads", "publications", "secrets", "authority", "tls"} {
		if _, e := os.Stat(filepath.Join(source, name)); os.IsNotExist(e) {
			continue
		}
		if err = copyTree(filepath.Join(source, name), filepath.Join(destination, name)); err != nil {
			return result, err
		}
	}
	state, err := Inspect(ctx, destination)
	if err != nil {
		return result, err
	}
	a, _ := json.Marshal(state)
	b, _ := json.Marshal(manifest.State)
	if string(a) != string(b) {
		return result, errors.New("restored state does not match backup")
	}
	db, err := store.Open(filepath.Join(destination, "db", "content.sqlite"), false)
	if err != nil {
		return result, err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	if _, err = tx.ExecContext(ctx, "UPDATE sessions SET revoked_at=max(created_at,?),reauth_until=NULL WHERE revoked_at IS NULL", now); err != nil {
		return result, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE login_challenges SET consumed_at=max(created_at,min(expires_at,?)) WHERE consumed_at IS NULL", now); err != nil {
		return result, err
	}
	if err = tx.Commit(); err != nil {
		return result, err
	}
	return state, nil
}

func Compatible(schema int) error {
	if schema != store.SchemaVersion {
		return fmt.Errorf("schema %d is incompatible; supported schema is %d; destructive downgrade is forbidden", schema, store.SchemaVersion)
	}
	return nil
}

// SecretStatus returns only presence/validity, never secret bytes. It permits
// resuming an interrupted first deployment without replacing a valid key.
func SecretStatus(root string) (bool, error) {
	path := filepath.Join(root, "secrets", "session.key")
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	key, err := authn.ReadSecret(path)
	if err != nil {
		return false, err
	}
	clear(key)
	return true, nil
}

package maintenance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"modernc.org/sqlite"
)

// OfflineDatabaseLimit is the aggregate source main/WAL/SHM/journal budget.
// The maintenance container's private tmpfs must accommodate this plus a rebuilt
// WAL index. No scratch file is ever placed alongside the original database.
const OfflineDatabaseLimit int64 = 128 << 20

type DatabaseReadError struct {
	Kind string
	Err  error
}

func (e *DatabaseReadError) Error() string {
	return "offline database " + e.Kind + ": " + e.Err.Error()
}
func (e *DatabaseReadError) Unwrap() error { return e.Err }

func databaseError(kind, message string) error {
	return &DatabaseReadError{Kind: kind, Err: errors.New(message)}
}

func sourceError(err error) error {
	if errors.Is(err, os.ErrNotExist) {
		return databaseError("absent", "required database member does not exist")
	}
	if errors.Is(err, os.ErrPermission) {
		return databaseError("permission", "database member cannot be read without changing access metadata")
	}
	return &DatabaseReadError{Kind: "io", Err: err}
}

func databaseQueryError(err error) error {
	var sqliteErr *sqlite.Error
	if errors.As(err, &sqliteErr) {
		kind := "sqlite-read"
		switch sqliteErr.Code() & 0xff {
		case 11, 26:
			kind = "corrupt"
		case 8:
			kind = "permission"
		case 5, 6:
			kind = "state-unproven"
		case 10, 14:
			kind = "sqlite-io"
		}
		return &DatabaseReadError{Kind: kind, Err: err}
	}
	if strings.Contains(err.Error(), "schema is not initialized") {
		return &DatabaseReadError{Kind: "schema-missing", Err: err}
	}
	if strings.Contains(err.Error(), "migration") || strings.Contains(err.Error(), "unsupported database schema") {
		return &DatabaseReadError{Kind: "schema-incompatible", Err: err}
	}
	return err
}

type databaseMember struct {
	name   string
	info   os.FileInfo
	meta   any
	digest string
}

// readOnlyDatabase only lets SQLite see a controlled private COPY. SQLite may
// create a WAL index there even when mode=ro is used. The original is read with
// ordinary read-only file descriptors, never passed to SQLite and never opened
// read-write, checkpointed or VACUUMed. Callers must stop all writers and hold
// the host lifecycle lock; stable hashes cannot prove a writer is absent.
type readOnlyDatabase struct {
	*sql.DB
	path     string
	temp     string
	members  []databaseMember
	dirInfo  os.FileInfo
	dirMeta  any
	closed   bool
	closeErr error
}

var databaseSuffixes = []string{"", "-wal", "-shm", "-journal"}

func sourceMembers(path, destination string) ([]databaseMember, error) {
	var members []databaseMember
	var total int64
	mainInfo, err := os.Lstat(path)
	if err != nil {
		return nil, sourceError(err)
	}
	if !mainInfo.Mode().IsRegular() {
		return nil, databaseError("unsafe-file", "database main member must be a regular file")
	}
	// SQLite's file collection is deliberately closed. In particular, an unknown
	// recovery/super-journal or substituted member must not be silently omitted.
	directory, err := openSourceNoAtime(filepath.Dir(path))
	if err != nil {
		return nil, sourceError(err)
	}
	entries, readErr := directory.ReadDir(-1)
	closeErr := directory.Close()
	if readErr != nil {
		return nil, sourceError(readErr)
	}
	if closeErr != nil {
		return nil, sourceError(closeErr)
	}
	allowed := map[string]bool{}
	for _, suffix := range databaseSuffixes {
		allowed[filepath.Base(path)+suffix] = true
	}
	for _, entry := range entries {
		if !allowed[entry.Name()] || !entry.Type().IsRegular() {
			return nil, databaseError("unsafe-file", "database directory contains an unknown or non-regular member")
		}
	}
	for _, suffix := range databaseSuffixes {
		name := path + suffix
		info, err := os.Lstat(name)
		if errors.Is(err, os.ErrNotExist) && suffix != "" {
			members = append(members, databaseMember{name: suffix})
			continue
		}
		if err != nil {
			return nil, sourceError(err)
		}
		if !info.Mode().IsRegular() {
			return nil, databaseError("unsafe-file", "database members must be regular files, never links or devices")
		}
		if info.Size() < 0 || info.Size() > OfflineDatabaseLimit-total {
			return nil, databaseError("capacity", "database file set exceeds the 128 MiB offline inspection limit")
		}
		total += info.Size()
		in, err := openSourceNoAtime(name)
		if err != nil {
			return nil, sourceError(err)
		}
		opened, err := in.Stat()
		if err != nil || !os.SameFile(info, opened) || !reflect.DeepEqual(sourceMetadata(info), sourceMetadata(opened)) {
			in.Close()
			return nil, databaseError("source-changed", "database member changed while opening")
		}
		hash := sha256.New()
		var out *os.File
		var target io.Writer = hash
		if destination != "" && (suffix == "" || suffix == "-wal") {
			out, err = os.OpenFile(filepath.Join(destination, "content.sqlite"+suffix), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				in.Close()
				return nil, &DatabaseReadError{Kind: "scratch-io", Err: err}
			}
			target = io.MultiWriter(hash, out)
		}
		bytes, readErr := io.Copy(target, io.LimitReader(in, info.Size()+1))
		final, statErr := in.Stat()
		closeErr := in.Close()
		if out != nil {
			if err = out.Close(); err != nil && readErr == nil {
				readErr = err
			}
		}
		if readErr != nil {
			return nil, sourceError(readErr)
		}
		if statErr != nil || closeErr != nil || bytes != info.Size() || !os.SameFile(info, final) || !reflect.DeepEqual(sourceMetadata(info), sourceMetadata(final)) {
			return nil, databaseError("source-changed", "database member changed while reading")
		}
		members = append(members, databaseMember{name: suffix, info: info, meta: sourceMetadata(info), digest: hex.EncodeToString(hash.Sum(nil))})
	}
	return members, nil
}

// Inventory SQLite through the same no-atime descriptors as the consistency
// snapshot. filepath.WalkDir would otherwise update the source directory atime
// on a writable unit-test fixture (and is unnecessary for this closed file set).
func databaseInventory(root string) ([]File, error) {
	members, err := sourceMembers(filepath.Join(root, "db", "content.sqlite"), "")
	if err != nil {
		return nil, err
	}
	var files []File
	for _, member := range members {
		if member.info != nil {
			files = append(files, File{Path: "db/content.sqlite" + member.name, Bytes: member.info.Size(), SHA256: member.digest})
		}
	}
	return files, nil
}

func equalDatabaseMembers(a, b []databaseMember) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].name != b[i].name || a[i].digest != b[i].digest || (a[i].info == nil) != (b[i].info == nil) {
			return false
		}
		if a[i].info != nil && (!os.SameFile(a[i].info, b[i].info) || !reflect.DeepEqual(a[i].meta, b[i].meta)) {
			return false
		}
	}
	return true
}

func (db *readOnlyDatabase) unchanged() error {
	info, err := os.Lstat(filepath.Dir(db.path))
	if err != nil || !os.SameFile(db.dirInfo, info) || !reflect.DeepEqual(db.dirMeta, sourceMetadata(info)) {
		return databaseError("source-changed", "database directory changed during offline inspection")
	}
	actual, err := sourceMembers(db.path, "")
	if err != nil {
		return err
	}
	if !equalDatabaseMembers(db.members, actual) {
		return databaseError("source-changed", "database file set or SHA256 changed during offline inspection")
	}
	return nil
}

func (db *readOnlyDatabase) Close() error {
	if db.closed {
		return db.closeErr
	}
	db.closed = true
	if db.DB != nil {
		db.closeErr = db.DB.Close()
	}
	if err := db.unchanged(); err != nil {
		db.closeErr = err
	}
	// temp is created by this function, never derived from a user file path.
	if err := os.RemoveAll(db.temp); err != nil && db.closeErr == nil {
		db.closeErr = err
	}
	return db.closeErr
}

func openReadOnly(path string) (_ *readOnlyDatabase, resultErr error) {
	info, err := os.Lstat(filepath.Dir(path))
	if err != nil {
		return nil, sourceError(err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, databaseError("unsafe-file", "database directory must not be a symbolic link")
	}
	temp, err := os.MkdirTemp("", "xiaowork-offline-sqlite-")
	if err != nil {
		return nil, &DatabaseReadError{Kind: "scratch-io", Err: err}
	}
	view := &readOnlyDatabase{path: path, temp: temp, dirInfo: info, dirMeta: sourceMetadata(info)}
	defer func() {
		if resultErr != nil {
			os.RemoveAll(temp)
		}
	}()
	view.members, err = sourceMembers(path, temp)
	if err != nil {
		return nil, err
	}
	if err = view.unchanged(); err != nil {
		return nil, err
	}
	if err = validateDatabaseCopy(temp, view.members); err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(filepath.Join(temp, "content.sqlite"))}
	if u.Path[0] != '/' {
		u.Path = "/" + u.Path
	}
	u.RawQuery = url.Values{"mode": {"ro"}, "_pragma": {"foreign_keys(1)", "busy_timeout(5000)"}}.Encode()
	view.DB, err = sql.Open("sqlite", u.String())
	if err != nil {
		return nil, &DatabaseReadError{Kind: "sqlite-open", Err: err}
	}
	view.DB.SetMaxOpenConns(1)
	view.DB.SetMaxIdleConns(1)
	// Force the lazy SQLite open while errors can still be classified accurately.
	if err = view.DB.PingContext(context.Background()); err != nil {
		view.DB.Close()
		return nil, &DatabaseReadError{Kind: "sqlite-open", Err: err}
	}
	return view, nil
}

func validateDatabaseCopy(temp string, members []databaseMember) error {
	main, err := os.Open(filepath.Join(temp, "content.sqlite"))
	if err != nil {
		return &DatabaseReadError{Kind: "scratch-io", Err: err}
	}
	defer main.Close()
	header := make([]byte, 100)
	if _, err = io.ReadFull(main, header); err != nil || string(header[:16]) != "SQLite format 3\x00" {
		return databaseError("corrupt", "invalid SQLite main file header")
	}
	pageSize := int(binary.BigEndian.Uint16(header[16:18]))
	if pageSize == 1 {
		pageSize = 65536
	}
	if pageSize < 512 || pageSize > 65536 || pageSize&(pageSize-1) != 0 || members[0].info.Size()%int64(pageSize) != 0 {
		return databaseError("corrupt", "invalid SQLite main file page size or length")
	}
	if (header[18] != 1 && header[18] != 2) || header[18] != header[19] {
		return databaseError("state-unproven", "unsupported SQLite journal format")
	}
	if members[3].info != nil && members[3].info.Size() != 0 {
		return databaseError("journal-state-unproven", "rollback journal requires separate recovery; source is preserved")
	}
	if members[1].info == nil || members[1].info.Size() == 0 {
		if members[2].info != nil && members[2].info.Size() != 0 {
			return databaseError("wal-state-unproven", "WAL index exists without nonempty WAL; do not assume checkpoint completion")
		}
		return nil
	}
	if header[18] != 2 {
		return databaseError("wal-state-unproven", "nonempty WAL disagrees with main file journal format")
	}
	return validateWAL(filepath.Join(temp, "content.sqlite-wal"), pageSize)
}

// SQLite normally ignores uncommitted or old-cycle tail frames during recovery.
// Offline repair deliberately rejects those ambiguous states. This validator
// accepts only an entirely valid, current-generation WAL ending at a commit.
func validateWAL(path string, pageSize int) error {
	f, err := os.Open(path)
	if err != nil {
		return &DatabaseReadError{Kind: "scratch-io", Err: err}
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	bad := func(message string) error { return databaseError("wal-state-unproven", message) }
	if info.Size() < 32 || (info.Size()-32)%int64(24+pageSize) != 0 {
		return bad("truncated or unsupported WAL length")
	}
	header := make([]byte, 32)
	if _, err = io.ReadFull(f, header); err != nil {
		return bad("WAL header cannot be read")
	}
	magic := binary.BigEndian.Uint32(header[:4])
	if (magic != 0x377f0682 && magic != 0x377f0683) || binary.BigEndian.Uint32(header[4:8]) != 3007000 || binary.BigEndian.Uint32(header[8:12]) != uint32(pageSize) {
		return bad("unsupported WAL header or page size")
	}
	var order binary.ByteOrder = binary.LittleEndian
	if magic == 0x377f0683 {
		order = binary.BigEndian
	}
	checksum := func(data []byte, a, b uint32) (uint32, uint32) {
		for i := 0; i < len(data); i += 8 {
			a += order.Uint32(data[i:i+4]) + b
			b += order.Uint32(data[i+4:i+8]) + a
		}
		return a, b
	}
	a, b := checksum(header[:24], 0, 0)
	if a != binary.BigEndian.Uint32(header[24:28]) || b != binary.BigEndian.Uint32(header[28:32]) {
		return bad("WAL header checksum mismatch")
	}
	frame := make([]byte, 24+pageSize)
	committed := false
	frames := (info.Size() - 32) / int64(len(frame))
	for i := int64(0); i < frames; i++ {
		if _, err = io.ReadFull(f, frame); err != nil {
			return bad("WAL frame cannot be read")
		}
		if binary.BigEndian.Uint32(frame[:4]) == 0 || string(frame[8:16]) != string(header[16:24]) {
			return bad("WAL contains an invalid page or unproven previous-cycle tail")
		}
		a, b = checksum(frame[:8], a, b)
		a, b = checksum(frame[24:], a, b)
		if a != binary.BigEndian.Uint32(frame[16:20]) || b != binary.BigEndian.Uint32(frame[20:24]) {
			return bad("WAL frame checksum mismatch or unproven tail")
		}
		committed = binary.BigEndian.Uint32(frame[4:8]) != 0
	}
	if !committed {
		return bad("WAL does not end at a complete commit; manual recovery is required")
	}
	return nil
}

func closeReadOnly(db *readOnlyDatabase, resultErr *error) {
	if err := db.Close(); err != nil {
		*resultErr = fmt.Errorf("offline database final verification failed: %w", err)
	}
}

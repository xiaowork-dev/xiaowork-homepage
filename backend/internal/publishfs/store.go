// Package publishfs owns the publication filesystem protocol. All names are
// generated IDs, all ordinary files are verified, and activation never removes
// current before replacing it. Callers must hold Lock for every mutation.
package publishfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

const MaxManifestBytes = 4 << 20
const MaxArtifactBytes int64 = 512 << 20

var ErrUnsafe = errors.New("unsafe publication filesystem")
var ErrMismatch = errors.New("publication integrity mismatch")
var ErrConflict = errors.New("publication state conflict")
var ErrRecoveryRequired = errors.New("publication recovery required")

var idPattern = regexp.MustCompile(`^(job|rel|pre|snap)_[0-9a-f]{32}$`)
var shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var revisionPattern = regexp.MustCompile(`^ws-[0-9]+$`)

func ValidID(id, prefix string) bool {
	return strings.HasPrefix(id, prefix+"_") && idPattern.MatchString(id)
}

func ValidHash(value string) bool { return shaPattern.MatchString(value) }

func SafePath(value string) bool {
	if value == "" || len(value) > 1024 || !fs.ValidPath(value) || strings.ContainsAny(value, "\\:\x00%?#") || strings.HasPrefix(value, ".") {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if strings.HasPrefix(part, ".") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return false
		}
	}
	return true
}

func Hash(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }

// Fault is only injectable by in-process tests. It is never configured by a job,
// an environment variable, or an HTTP request.
type Fault func(point string) error

type Store struct {
	root     *os.Root
	readOnly bool
	fault    Fault
	mu       sync.Mutex
	locked   bool
}

func Open(directory string) (*Store, error)         { return open(directory, false) }
func OpenReadOnly(directory string) (*Store, error) { return open(directory, true) }

func open(directory string, readOnly bool) (*Store, error) {
	if !readOnly {
		if err := os.MkdirAll(directory, 0700); err != nil {
			return nil, err
		}
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, ErrUnsafe
	}
	r, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	s := &Store{root: r, readOnly: readOnly}
	if !readOnly {
		for _, name := range []string{"releases", "preview", "staging", "activations"} {
			if err = s.mkdir(name); err != nil {
				r.Close()
				return nil, err
			}
		}
	}
	return s, nil
}

func (s *Store) Close() error            { return s.root.Close() }
func (s *Store) SetFaultForTest(f Fault) { s.fault = f }
func (s *Store) hit(point string) error {
	if s.fault != nil {
		return s.fault(point)
	}
	return nil
}
func (s *Store) writable() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly || !s.locked {
		return ErrUnsafe
	}
	return nil
}

// Lock uses a kernel lock, not a PID file or an expiring database lease.
func (s *Store) Lock() (func() error, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly || s.locked {
		return nil, ErrConflict
	}
	if err := s.rejectLinks("publisher.lock", true); err != nil {
		return nil, err
	}
	f, err := s.root.OpenFile("publisher.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = lockFile(f); err != nil {
		f.Close()
		return nil, err
	}
	s.locked = true
	return func() error {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.locked = false
		err := unlockFile(f)
		closeErr := f.Close()
		if err != nil {
			return err
		}
		return closeErr
	}, nil
}

func (s *Store) rejectLinks(name string, allowMissing bool) error {
	if !SafePath(name) {
		return ErrUnsafe
	}
	parts := strings.Split(name, "/")
	for i := range parts {
		info, err := s.root.Lstat(strings.Join(parts[:i+1], "/"))
		if errors.Is(err, os.ErrNotExist) && allowMissing {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || (i < len(parts)-1 && !info.IsDir()) {
			return ErrUnsafe
		}
	}
	return nil
}

func (s *Store) mkdir(name string) error {
	if err := s.rejectLinks(name, true); err != nil {
		return err
	}
	return s.root.MkdirAll(name, 0700)
}

func (s *Store) syncDir(name string) error {
	f, err := s.root.Open(name)
	if err != nil {
		return err
	}
	defer f.Close()
	return syncDirectory(f)
}

// atomicNew creates an immutable file. Existing data is never replaced.
func (s *Store) atomicNew(name string, data []byte) error {
	if err := s.rejectLinks(name, true); err != nil {
		return err
	}
	if _, err := s.root.Lstat(name); err == nil {
		return ErrConflict
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	tmp := name + ".tmp"
	f, err := s.root.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		f.Close()
		if !ok {
			_ = s.root.Remove(tmp)
		}
	}()
	if _, err = f.Write(data); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = s.hit("before-file-rename"); err != nil {
		return err
	}
	if err = s.root.Rename(tmp, name); err != nil {
		return err
	}
	ok = true
	return s.syncDir(path.Dir(name))
}

func artifactDir(id string) (string, error) {
	if ValidID(id, "rel") {
		return "releases/" + id, nil
	}
	if ValidID(id, "pre") {
		return "preview/" + id, nil
	}
	return "", ErrUnsafe
}

func (s *Store) readRegular(name string, limit int64) ([]byte, error) {
	if err := s.rejectLinks(name, false); err != nil {
		return nil, err
	}
	f, err := s.root.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit || info.Size() < 0 {
		return nil, ErrUnsafe
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, ErrUnsafe
	}
	return data, nil
}

func decode(data []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return ErrMismatch
	}
	if d.Decode(new(any)) != io.EOF {
		return ErrMismatch
	}
	return nil
}

func (s *Store) ReadManifest(id string) (publishmodel.Manifest, string, error) {
	var manifest publishmodel.Manifest
	dir, err := artifactDir(id)
	if err != nil {
		return manifest, "", err
	}
	data, err := s.readRegular(dir+"/manifest.json", MaxManifestBytes)
	if err != nil {
		return manifest, "", err
	}
	if err = decode(data, &manifest); err != nil {
		return manifest, "", err
	}
	if err = validateManifest(manifest, id); err != nil {
		return manifest, "", err
	}
	return manifest, Hash(data), nil
}

func validateManifest(m publishmodel.Manifest, id string) error {
	if m.SchemaVersion != 1 || m.ReleaseID != id || !ValidID(m.JobID, "job") || !ValidID(m.SnapshotID, "snap") || !ValidHash(m.SnapshotSHA256) || !revisionPattern.MatchString(m.WorkspaceRevision) || m.Origin != "https://xiaoworks.com" || m.BuilderID == "" || !publishmodel.SourceHash.MatchString(m.SourceRevision) || len(m.Files) == 0 || len(m.Files) > 50000 {
		return ErrMismatch
	}
	if _, err := time.Parse(time.RFC3339, m.CreatedAt); err != nil {
		return ErrMismatch
	}
	if ValidID(id, "pre") {
		if m.Kind != "preview" || m.PreviewID != id {
			return ErrMismatch
		}
	} else if m.Kind != "publish" || m.PreviewID != "" {
		return ErrMismatch
	}
	previous := ""
	var total int64
	for _, f := range m.Files {
		if !SafePath(f.Path) || f.Path <= previous || !ValidHash(f.SHA256) || f.Bytes < 0 || f.Bytes > MaxArtifactBytes {
			return ErrMismatch
		}
		previous = f.Path
		total += f.Bytes
		if total > MaxArtifactBytes {
			return ErrMismatch
		}
	}
	return nil
}

// VerifyRelease enumerates actual files as well as checking every manifest
// hash. Extra files, symlinks, missing files and altered bytes all fail closed.
func (s *Store) VerifyRelease(id string) (publishmodel.Manifest, string, error) {
	m, digest, err := s.ReadManifest(id)
	if err != nil {
		return m, digest, err
	}
	dir, _ := artifactDir(id)
	files, err := s.enumerate(dir+"/public", false)
	if err != nil {
		return m, digest, err
	}
	if len(files) != len(m.Files) {
		return m, digest, ErrMismatch
	}
	for i := range files {
		if files[i] != m.Files[i] {
			return m, digest, ErrMismatch
		}
	}
	return m, digest, nil
}

func (s *Store) enumerate(directory string, syncFiles bool) ([]publishmodel.File, error) {
	if err := s.rejectLinks(directory, false); err != nil {
		return nil, err
	}
	r, err := s.root.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	files := []publishmodel.File{}
	var total int64
	err = fs.WalkDir(r.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == "." {
			return nil
		}
		if !SafePath(name) || entry.Type()&os.ModeSymlink != 0 {
			return ErrUnsafe
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return ErrUnsafe
		}
		total += info.Size()
		if total > MaxArtifactBytes || len(files) >= 50000 {
			return ErrUnsafe
		}
		var f *os.File
		if syncFiles {
			f, err = r.OpenFile(name, os.O_RDWR, 0)
		} else {
			f, err = r.Open(name)
		}
		if err != nil {
			return err
		}
		h := sha256.New()
		n, err := io.Copy(h, io.LimitReader(f, MaxArtifactBytes+1))
		if err == nil && syncFiles {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if n != info.Size() {
			return ErrMismatch
		}
		files = append(files, publishmodel.File{Path: name, SHA256: hex.EncodeToString(h.Sum(nil)), Bytes: n})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	if syncFiles {
		err = fs.WalkDir(r.FS(), ".", func(name string, e fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !e.IsDir() {
				return nil
			}
			f, err := r.Open(name)
			if err != nil {
				return err
			}
			defer f.Close()
			return syncDirectory(f)
		})
	}
	return files, err
}

// Prepare copies a verified generated tree into private staging. The build
// directory may be on tmpfs; final staging and releases share one filesystem.
func (s *Store) Prepare(jobID string, m publishmodel.Manifest, sourcePublic string) (string, error) {
	if err := s.writable(); err != nil {
		return "", err
	}
	if !ValidID(jobID, "job") || m.JobID != jobID {
		return "", ErrUnsafe
	}
	destination, err := artifactDir(m.ReleaseID)
	if err != nil {
		return "", err
	}
	if _, err = s.root.Lstat(destination); err == nil {
		return "", ErrConflict
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	staging := "staging/" + jobID
	if err = s.root.Mkdir(staging, 0700); err != nil {
		return "", err
	}
	if err = s.root.Mkdir(staging+"/public", 0700); err != nil {
		return "", err
	}
	if err = s.copyTree(sourcePublic, staging+"/public"); err != nil {
		return "", err
	}
	if err = s.hit("after-copy"); err != nil {
		return "", err
	}
	m.Files, err = s.enumerate(staging+"/public", true)
	if err != nil {
		return "", err
	}
	if err = validateManifest(m, m.ReleaseID); err != nil {
		return "", err
	}
	data, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	if len(data) > MaxManifestBytes {
		return "", ErrUnsafe
	}
	if err = s.atomicNew(staging+"/manifest.json", data); err != nil {
		return "", err
	}
	if err = s.syncDir(staging); err != nil {
		return "", err
	}
	if err = s.hit("before-release-rename"); err != nil {
		return "", err
	}
	if err = s.root.Rename(staging, destination); err != nil {
		return "", err
	}
	if err = s.syncDir(path.Dir(destination)); err != nil {
		return "", err
	}
	if err = s.syncDir("staging"); err != nil {
		return "", err
	}
	if err = s.hit("after-release-rename"); err != nil {
		return "", err
	}
	_, digest, err := s.VerifyRelease(m.ReleaseID)
	return digest, err
}

func (s *Store) copyTree(source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return ErrUnsafe
	}
	r, err := os.OpenRoot(source)
	if err != nil {
		return err
	}
	defer r.Close()
	var total int64
	count := 0
	return fs.WalkDir(r.FS(), ".", func(name string, e fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == "." {
			return nil
		}
		if !SafePath(name) || e.Type()&os.ModeSymlink != 0 {
			return ErrUnsafe
		}
		if e.IsDir() {
			return s.mkdir(destination + "/" + name)
		}
		info, err := e.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return ErrUnsafe
		}
		total += info.Size()
		count++
		if total > MaxArtifactBytes || count > 50000 {
			return ErrUnsafe
		}
		input, err := r.Open(name)
		if err != nil {
			return err
		}
		output, err := s.root.OpenFile(destination+"/"+name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			input.Close()
			return err
		}
		n, err := io.Copy(output, io.LimitReader(input, MaxArtifactBytes+1))
		if err == nil && n != info.Size() {
			err = ErrMismatch
		}
		if err == nil {
			err = output.Sync()
		}
		closeErr := output.Close()
		inputErr := input.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		return inputErr
	})
}

// Current validates the sole allowed symlink rather than following an arbitrary
// target. Absence is only allowed for a first publication.
func (s *Store) Current() (string, error) {
	info, err := s.root.Lstat("current")
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return "", ErrUnsafe
	}
	target, err := s.root.Readlink("current")
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(target, "releases/") || !ValidID(strings.TrimPrefix(target, "releases/"), "rel") {
		return "", ErrUnsafe
	}
	id := strings.TrimPrefix(target, "releases/")
	if err = s.rejectLinks(target, false); err != nil {
		return "", err
	}
	return id, nil
}

func (s *Store) ReadReceipt(jobID string) (publishmodel.Receipt, string, error) {
	return s.readReceipt(jobID, "receipt.json")
}

func (s *Store) ReadRecoveryReceipt(jobID string) (publishmodel.Receipt, string, error) {
	return s.readReceipt(jobID, "recovery.json")
}

func (s *Store) readReceipt(jobID, name string) (publishmodel.Receipt, string, error) {
	var receipt publishmodel.Receipt
	if !ValidID(jobID, "job") {
		return receipt, "", ErrUnsafe
	}
	data, err := s.readRegular("activations/"+jobID+"/"+name, 65536)
	if err != nil {
		return receipt, "", err
	}
	if err = decode(data, &receipt); err != nil {
		return receipt, "", err
	}
	if receipt.SchemaVersion != 1 || receipt.JobID != jobID {
		return receipt, "", ErrMismatch
	}
	return receipt, Hash(data), nil
}

func (s *Store) ReadIntent(jobID string) (publishmodel.Intent, error) {
	var intent publishmodel.Intent
	if !ValidID(jobID, "job") {
		return intent, ErrUnsafe
	}
	data, err := s.readRegular("activations/"+jobID+"/intent.json", 65536)
	if err != nil {
		return intent, err
	}
	if err = decode(data, &intent); err != nil {
		return intent, err
	}
	if intent.SchemaVersion != 1 || intent.JobID != jobID {
		return intent, ErrMismatch
	}
	return intent, nil
}

func (s *Store) WritePreviewReceipt(receipt publishmodel.Receipt) error {
	if err := s.writable(); err != nil {
		return err
	}
	if receipt.SchemaVersion != 1 || !ValidID(receipt.JobID, "job") || !ValidID(receipt.ReleaseID, "pre") || receipt.Outcome != "preview-ready" || receipt.ActivationToken != "" || receipt.PreviousReleaseID != "" {
		return ErrUnsafe
	}
	if m, digest, err := s.VerifyRelease(receipt.ReleaseID); err != nil || digest != receipt.ManifestSHA256 || m.SnapshotID != receipt.SnapshotID || m.SnapshotSHA256 != receipt.SnapshotSHA256 || m.JobID != receipt.JobID {
		if err != nil {
			return err
		}
		return ErrMismatch
	}
	if err := s.root.Mkdir("activations/"+receipt.JobID, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	return s.atomicNew("activations/"+receipt.JobID+"/receipt.json", data)
}

// Activate persists this task's intent, checks previous again, then atomically
// replaces current. Any error after pointer replacement is indeterminate until
// reconciliation, including receipt/fsync errors.
func (s *Store) Activate(intent publishmodel.Intent, receipt publishmodel.Receipt) error {
	if err := s.writable(); err != nil {
		return err
	}
	if intent.SchemaVersion != 1 || !ValidID(intent.JobID, "job") || !ValidID(intent.ReleaseID, "rel") || !ValidHash(intent.ActivationToken) || intent.Phase != "prepared" || intent.Receipt != receipt || receipt.Outcome != "activated" || (intent.PreviousReleaseID != "" && !ValidID(intent.PreviousReleaseID, "rel")) {
		return ErrUnsafe
	}
	if m, digest, err := s.VerifyRelease(intent.ReleaseID); err != nil || digest != intent.ManifestSHA256 || m.SnapshotID != receipt.SnapshotID || m.SnapshotSHA256 != receipt.SnapshotSHA256 {
		if err != nil {
			return err
		}
		return ErrMismatch
	}
	current, err := s.Current()
	if err != nil {
		return err
	}
	if current != intent.PreviousReleaseID {
		return ErrConflict
	}
	if current != "" {
		if _, _, err = s.VerifyRelease(current); err != nil {
			return err
		}
	}
	if err = s.root.Mkdir("activations/"+intent.JobID, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(intent)
	if err != nil {
		return err
	}
	if err = s.atomicNew("activations/"+intent.JobID+"/intent.json", data); err != nil {
		return err
	}
	if err = s.hit("after-intent"); err != nil {
		return err
	}
	if err = s.swapCurrent(intent.PreviousReleaseID, intent.ReleaseID, intent.ActivationToken); err != nil {
		return err
	}
	if err = s.hit("after-current-rename"); err != nil {
		return errors.Join(ErrRecoveryRequired, err)
	}
	data, err = json.Marshal(receipt)
	if err != nil {
		return errors.Join(ErrRecoveryRequired, err)
	}
	if err = s.atomicNew("activations/"+intent.JobID+"/receipt.json", data); err != nil {
		return errors.Join(ErrRecoveryRequired, err)
	}
	if err = s.hit("after-receipt"); err != nil {
		return errors.Join(ErrRecoveryRequired, err)
	}
	return nil
}

func (s *Store) swapCurrent(expected, target, token string) error {
	current, err := s.Current()
	if err != nil {
		return err
	}
	if current != expected {
		return ErrConflict
	}
	if !ValidID(target, "rel") || !ValidHash(token) {
		return ErrUnsafe
	}
	tmp := "current.next." + token
	if err = s.root.Symlink("releases/"+target, tmp); err != nil {
		return err
	}
	if err = s.syncDir("."); err != nil {
		_ = s.root.Remove(tmp)
		return err
	}
	if err = s.hit("before-current-rename"); err != nil {
		_ = s.root.Remove(tmp)
		return err
	}
	if err = s.root.Rename(tmp, "current"); err != nil {
		_ = s.root.Remove(tmp)
		return err
	}
	if err = s.syncDir("."); err != nil {
		return errors.Join(ErrRecoveryRequired, err)
	}
	return nil
}

// Restore is allowed only for the exact persisted activation intent and an
// independently verified retained previous release. It writes a new recovery
// proof and never modifies an old release or its original receipt.
func (s *Store) Restore(jobID, token string, receipt publishmodel.Receipt) error {
	if err := s.writable(); err != nil {
		return err
	}
	intent, err := s.ReadIntent(jobID)
	if err != nil {
		return err
	}
	if intent.ActivationToken != token || receipt.SchemaVersion != 1 || receipt.JobID != jobID || receipt.Outcome != "restored" || receipt.ReleaseID != intent.PreviousReleaseID || receipt.PreviousReleaseID != intent.ReleaseID || receipt.ActivationToken != token {
		return ErrRecoveryRequired
	}
	if receipt.ReleaseID != "" {
		m, digest, err := s.VerifyRelease(receipt.ReleaseID)
		if err != nil || digest != receipt.ManifestSHA256 || m.SnapshotID != receipt.SnapshotID || m.SnapshotSHA256 != receipt.SnapshotSHA256 {
			return ErrRecoveryRequired
		}
	} else if receipt.ManifestSHA256 != "" || receipt.SnapshotID != "" || receipt.SnapshotSHA256 != "" {
		return ErrRecoveryRequired
	}
	current, currentErr := s.Current()
	if currentErr != nil {
		return errors.Join(ErrRecoveryRequired, currentErr)
	}
	if current == intent.PreviousReleaseID {
		// A crash can occur after the recovery pointer but before its proof.
		if current != "" {
			if _, _, err = s.VerifyRelease(current); err != nil {
				return errors.Join(ErrRecoveryRequired, err)
			}
		}
	} else if intent.PreviousReleaseID == "" {
		current, currentErr := s.Current()
		if currentErr != nil || current != intent.ReleaseID {
			return ErrRecoveryRequired
		}
		if err = s.root.Remove("current"); err != nil {
			return errors.Join(ErrRecoveryRequired, err)
		}
		if err = s.syncDir("."); err != nil {
			return errors.Join(ErrRecoveryRequired, err)
		}
	} else {
		if _, _, err = s.VerifyRelease(intent.PreviousReleaseID); err != nil {
			return errors.Join(ErrRecoveryRequired, err)
		}
		if err = s.swapCurrent(intent.ReleaseID, intent.PreviousReleaseID, Hash([]byte(token+"/restore"))); err != nil {
			return errors.Join(ErrRecoveryRequired, err)
		}
	}
	data, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	if err = s.atomicNew("activations/"+jobID+"/recovery.json", data); err != nil {
		return errors.Join(ErrRecoveryRequired, err)
	}
	return nil
}

// CompleteActivationReceipt only repairs the crash gap after current was
// switched. It proves filesystem state, never HTTP success or DB completion.
func (s *Store) CompleteActivationReceipt(jobID string) (publishmodel.Receipt, error) {
	if err := s.writable(); err != nil {
		return publishmodel.Receipt{}, err
	}
	intent, err := s.ReadIntent(jobID)
	if err != nil {
		return publishmodel.Receipt{}, err
	}
	current, err := s.Current()
	if err != nil || current != intent.ReleaseID {
		return publishmodel.Receipt{}, ErrRecoveryRequired
	}
	if _, digest, err := s.VerifyRelease(current); err != nil || digest != intent.ManifestSHA256 {
		return publishmodel.Receipt{}, ErrRecoveryRequired
	}
	if existing, _, err := s.ReadReceipt(jobID); err == nil {
		return existing, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return publishmodel.Receipt{}, err
	}
	data, err := json.Marshal(intent.Receipt)
	if err != nil {
		return publishmodel.Receipt{}, err
	}
	if err = s.atomicNew("activations/"+jobID+"/receipt.json", data); err != nil {
		return publishmodel.Receipt{}, err
	}
	return intent.Receipt, nil
}

// PendingIntents returns tasks whose filesystem operation is not a completed
// proof. It is used at startup to block claiming new work until API reconciles.
func (s *Store) PendingIntents() ([]string, error) {
	r, err := s.root.OpenRoot("activations")
	if err != nil {
		return nil, err
	}
	defer r.Close()
	entries, err := fs.ReadDir(r.FS(), ".")
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, entry := range entries {
		if !ValidID(entry.Name(), "job") || !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil, ErrUnsafe
		}
		if _, err = s.ReadIntent(entry.Name()); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return nil, err
		}
		if _, _, err = s.ReadReceipt(entry.Name()); errors.Is(err, os.ErrNotExist) {
			ids = append(ids, entry.Name())
		} else if err != nil {
			return nil, err
		}
	}
	sort.Strings(ids)
	return ids, nil
}

// ReadPublic is for the authenticated preview gateway. It never follows links
// and cannot expose the private manifest, activation, or staging trees.
func (s *Store) ReadPublic(id, name string, max int64) ([]byte, error) {
	dir, err := artifactDir(id)
	if err != nil {
		return nil, err
	}
	if !SafePath(name) {
		return nil, ErrUnsafe
	}
	return s.readRegular(dir+"/public/"+name, max)
}

func (s *Store) String() string { return fmt.Sprintf("publishfs(%s)", filepath.Base(s.root.Name())) }

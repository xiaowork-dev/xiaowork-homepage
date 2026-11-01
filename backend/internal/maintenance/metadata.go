package maintenance

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
)

// SourceEntry contains no database values or credentials, only file evidence.
type SourceEntry struct {
	Path   string `json:"path"`
	Native any    `json:"stat"`
	SHA256 string `json:"sha256,omitempty"`
	Link   string `json:"link,omitempty"`
}

// ReadOnlyMetadata requires all six mounts to be kernel read-only. Directory
// reads and hashes additionally use O_NOATIME; unsupported permissions fail closed.
func ReadOnlyMetadata(root string) ([]SourceEntry, error) {
	var result []SourceEntry
	var walk func(string) error
	walk = func(p string) error {
		before, err := os.Lstat(p)
		if err != nil {
			return sourceError(err)
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		entry := SourceEntry{Path: filepath.ToSlash(rel), Native: sourceMetadata(before)}
		var children []os.DirEntry
		if before.Mode()&os.ModeSymlink != 0 {
			entry.Link, err = os.Readlink(p)
		} else if before.IsDir() || before.Mode().IsRegular() {
			var f *os.File
			f, err = openSourceNoAtime(p)
			if err == nil {
				opened, e := f.Stat()
				if e != nil || !os.SameFile(before, opened) || !reflect.DeepEqual(sourceMetadata(before), sourceMetadata(opened)) {
					f.Close()
					return nilSourceChanged()
				}
				if before.IsDir() {
					children, err = f.ReadDir(-1)
				} else {
					h := sha256.New()
					var n int64
					n, err = io.Copy(h, io.LimitReader(f, before.Size()+1))
					if err == nil && n != before.Size() {
						err = nilSourceChanged()
					}
					entry.SHA256 = hex.EncodeToString(h.Sum(nil))
				}
				if closeErr := f.Close(); err == nil {
					err = closeErr
				}
			}
		} else {
			return errors.New("source inventory refuses special files")
		}
		if err != nil {
			return sourceError(err)
		}
		after, err := os.Lstat(p)
		if err != nil || !os.SameFile(before, after) || !reflect.DeepEqual(sourceMetadata(before), sourceMetadata(after)) {
			return nilSourceChanged()
		}
		result = append(result, entry)
		sort.Slice(children, func(i, j int) bool { return children[i].Name() < children[j].Name() })
		for _, child := range children {
			if err := walk(filepath.Join(p, child.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	for _, role := range []string{"authority", "db", "publications", "secrets", "tls", "uploads"} {
		p := filepath.Join(root, role)
		i, err := os.Lstat(p)
		if err != nil || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("source mount root must be a real directory")
		}
		if err := requireReadOnlyMount(p); err != nil {
			return nil, err
		}
		if err := walk(p); err != nil {
			return nil, err
		}
	}
	return result, nil
}
func nilSourceChanged() error {
	return databaseError("source-changed", "source identity or complete metadata changed during inventory")
}

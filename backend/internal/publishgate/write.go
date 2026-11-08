package publishgate

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// Authorize installs a new authorization. Each intermediate state is closed:
// the previous authorization is archived first (gate absent), then any
// revocation is archived (still absent), and only then is the new record
// atomically created. Archived records are never deleted or overwritten.
func Authorize(root string, a Authorization) error {
	if err := Validate(a); err != nil {
		return err
	}
	if err := archive(root, AuthorizationFile, "publish-authorization."); err != nil {
		return err
	}
	if err := archive(root, RevocationFile, "publish-revoked."); err != nil {
		return err
	}
	raw, err := json.Marshal(a)
	if err != nil {
		return err
	}
	return createAtomically(root, AuthorizationFile, raw)
}

// Revoke closes the gate immediately. An existing revocation is kept as-is.
func Revoke(root, reason string, now time.Time) (Revocation, error) {
	var r Revocation
	if !validNote(reason, 4) {
		return r, errors.New("a non-secret revocation reason of 4-500 characters is required")
	}
	if raw, err := readRecord(root, RevocationFile); err == nil {
		if err = decodeStrict(raw, &r); err != nil {
			return Revocation{}, errors.New("existing revocation is damaged; gate remains closed")
		}
		return r, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return r, err
	}
	r = Revocation{Format: 1, RevokedAt: now.UTC(), Reason: reason}
	if raw, err := readRecord(root, AuthorizationFile); err == nil {
		var a Authorization
		if decodeStrict(raw, &a) == nil {
			r.AuthorizationID = a.ID
		}
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return Revocation{}, err
	}
	return r, createAtomically(root, RevocationFile, raw)
}

// State is the read-only operator view; damaged records are reported, never repaired.
type State struct {
	Authorization *Authorization `json:"authorization"`
	Revocation    *Revocation    `json:"revocation"`
	Problem       string         `json:"problem,omitempty"`
}

func Inspect(root string) State {
	var s State
	if raw, err := readRecord(root, AuthorizationFile); err == nil {
		var a Authorization
		if decodeStrict(raw, &a) == nil && Validate(a) == nil {
			s.Authorization = &a
		} else {
			s.Problem = "authorization record invalid"
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		s.Problem = "authorization record unreadable"
	}
	if raw, err := readRecord(root, RevocationFile); err == nil {
		var r Revocation
		if decodeStrict(raw, &r) == nil {
			s.Revocation = &r
		} else {
			s.Problem = "revocation record invalid"
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		s.Problem = "revocation record unreadable"
	}
	return s
}

func archive(root, name, prefix string) error {
	path := filepath.Join(root, name)
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("unsafe existing gate record")
	}
	id, err := NewID()
	if err != nil {
		return err
	}
	target := filepath.Join(root, prefix+time.Now().UTC().Format("20060102T150405Z")+"."+id+".json")
	if _, err = os.Lstat(target); !errors.Is(err, fs.ErrNotExist) {
		return errors.New("archive name collision")
	}
	if err = os.Rename(path, target); err != nil {
		return err
	}
	return syncDir(root)
}

func createAtomically(root, name string, raw []byte) error {
	temporary := filepath.Join(root, name+".next")
	f, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return errors.New("gate record temporary file exists or cannot be created; manual review required")
	}
	_, err = f.Write(append(raw, '\n'))
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if _, err = os.Lstat(filepath.Join(root, name)); !errors.Is(err, fs.ErrNotExist) {
		return errors.New("gate record appeared concurrently; manual review required")
	}
	if err = os.Rename(temporary, filepath.Join(root, name)); err != nil {
		return err
	}
	return syncDir(root)
}

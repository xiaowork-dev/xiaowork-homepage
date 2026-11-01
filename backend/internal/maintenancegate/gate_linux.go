//go:build linux

package maintenancegate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

var ownerPattern = regexp.MustCompile(`^[a-f0-9-]{36}$`)

func blocked(err error) error { return fmt.Errorf("%w: %w", ErrBlocked, err) }

// Resolve every component using directory descriptors. No symlinks, lock-file
// replacement, hardlinks, or group/other write access are accepted.
func directory(root string) (int, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" {
		return -1, ErrBlocked
	}
	fd, e := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if e != nil {
		return -1, blocked(e)
	}
	for _, part := range strings.Split(strings.TrimPrefix(root, "/"), "/") {
		next, err := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(fd)
		if err != nil {
			return -1, blocked(err)
		}
		fd = next
	}
	var st unix.Stat_t
	if e = unix.Fstat(fd, &st); e != nil || st.Uid != uint32(os.Geteuid()) || st.Mode&0077 != 0 {
		unix.Close(fd)
		return -1, ErrBlocked
	}
	return fd, nil
}
func member(dir int, name string, flags int) (int, error) {
	fd, e := unix.Openat(dir, name, flags|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if e != nil {
		return -1, blocked(e)
	}
	var s unix.Stat_t
	if e = unix.Fstat(fd, &s); e != nil || s.Mode&unix.S_IFMT != unix.S_IFREG || s.Nlink != 1 || s.Uid != uint32(os.Geteuid()) || s.Mode&0077 != 0 || s.Size > 16384 {
		unix.Close(fd)
		return -1, ErrBlocked
	}
	return fd, nil
}
func locked(dir int, name string, mode int) (int, error) {
	fd, e := member(dir, name, unix.O_RDONLY)
	if e == nil {
		e = unix.Flock(fd, mode|unix.LOCK_NB)
	}
	if e != nil {
		if fd >= 0 {
			unix.Close(fd)
		}
		return -1, blocked(e)
	}
	return fd, nil
}
func state(dir int) (State, error) {
	var pending unix.Stat_t
	if e := unix.Fstatat(dir, "state.next", &pending, unix.AT_SYMLINK_NOFOLLOW); !errors.Is(e, unix.ENOENT) {
		return State{}, ErrBlocked
	}
	fd, e := member(dir, "state.json", unix.O_RDONLY)
	if e != nil {
		return State{}, e
	}
	f := os.NewFile(uintptr(fd), "state.json")
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, 16385))
	if e != nil || len(raw) > 16384 {
		return State{}, ErrBlocked
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	var s State
	if e = d.Decode(&s); e != nil {
		return State{}, blocked(e)
	}
	if d.Decode(new(any)) != io.EOF || s.Format != 1 {
		return State{}, ErrBlocked
	}
	if s.Mode == "ready" && s.Phase == "idle" && s.Owner == "" {
		return s, nil
	}
	if s.Mode == "recovery-required" && (s.Phase == "draining" || s.Phase == "drained") && ownerPattern.MatchString(s.Owner) {
		return s, nil
	}
	return State{}, ErrBlocked
}
func writeState(dir int, s State) error {
	raw, e := json.Marshal(s)
	if e != nil {
		return e
	}
	// A leftover exclusive temporary file is deliberately not removed or reused.
	fd, e := unix.Openat(dir, "state.next", unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if e != nil {
		return blocked(e)
	}
	f := os.NewFile(uintptr(fd), "state.next")
	_, e = f.Write(append(raw, '\n'))
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e == nil {
		e = unix.Renameat(dir, "state.next", dir, "state.json")
	}
	if e == nil {
		e = unix.Fsync(dir)
	}
	return e
}
func enter(root string, continuation bool) (func(), error) {
	dir, e := directory(root)
	if e != nil {
		return nil, e
	}
	defer unix.Close(dir)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	admit, e := waitLock(ctx, dir, "admission.lock")
	if e != nil {
		return nil, e
	}
	defer unix.Close(admit)
	s, e := state(dir)
	if e != nil || (s.Mode != "ready" && !(continuation && s.Phase == "draining")) {
		return nil, ErrBlocked
	}
	// Never wait for the activity lock while holding admission: an admitted
	// worker may be waiting for API heartbeat/result admission itself.
	fd, e := locked(dir, "activity.lock", unix.LOCK_SH)
	if e != nil {
		return nil, e
	}
	return func() { unix.Close(fd) }, nil
}
func inspect(root string) (State, error) {
	dir, e := directory(root)
	if e != nil {
		return State{}, e
	}
	defer unix.Close(dir)
	fd, e := locked(dir, "admission.lock", unix.LOCK_EX)
	if e != nil {
		return State{}, e
	}
	defer unix.Close(fd)
	return state(dir)
}
func initialize(root string) error {
	dir, e := directory(root)
	if e != nil {
		return e
	}
	defer unix.Close(dir)
	// Explicit provisioning of an EMPTY control volume only. Never adopt an
	// existing state or create ready state as a service startup side effect.
	entries, e := os.ReadDir(root)
	if e != nil || len(entries) != 0 {
		return ErrBlocked
	}
	for _, name := range []string{"admission.lock", "activity.lock"} {
		fd, err := unix.Openat(dir, name, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0400)
		if err != nil {
			return blocked(err)
		}
		err = unix.Fsync(fd)
		unix.Close(fd)
		if err != nil {
			return blocked(err)
		}
	}
	return writeState(dir, State{Format: 1, Mode: "ready", Phase: "idle"})
}
func begin(ctx context.Context, root, owner string) error {
	if !ownerPattern.MatchString(owner) {
		return ErrBlocked
	}
	dir, e := directory(root)
	if e != nil {
		return e
	}
	defer unix.Close(dir)
	admit, e := waitLock(ctx, dir, "admission.lock")
	if e != nil {
		return e
	}
	s, e := state(dir)
	if e != nil || s.Mode != "ready" {
		unix.Close(admit)
		return ErrBlocked
	}
	e = writeState(dir, State{1, "recovery-required", "draining", owner})
	unix.Close(admit)
	if e != nil {
		return blocked(e)
	}
	// Marker is already durable before waiting for existing work. Death or a
	// timeout leaves admissions closed, independent of the parent process.
	active, e := waitLock(ctx, dir, "activity.lock")
	if e != nil {
		return e
	}
	defer unix.Close(active)
	admit, e = waitLock(ctx, dir, "admission.lock")
	if e != nil {
		return e
	}
	defer unix.Close(admit)
	s, e = state(dir)
	if e != nil || s.Owner != owner || s.Phase != "draining" {
		return ErrBlocked
	}
	return writeState(dir, State{1, "recovery-required", "drained", owner})
}
func waitLock(ctx context.Context, dir int, name string) (int, error) {
	for {
		fd, e := locked(dir, name, unix.LOCK_EX)
		if e == nil {
			return fd, nil
		}
		if !errors.Is(e, unix.EWOULDBLOCK) && !errors.Is(e, unix.EAGAIN) {
			return -1, e
		}
		select {
		case <-ctx.Done():
			return -1, blocked(ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
}
func complete(root, owner string) error {
	if !ownerPattern.MatchString(owner) {
		return ErrBlocked
	}
	dir, e := directory(root)
	if e != nil {
		return e
	}
	defer unix.Close(dir)
	admit, e := locked(dir, "admission.lock", unix.LOCK_EX)
	if e != nil {
		return e
	}
	defer unix.Close(admit)
	s, e := state(dir)
	if e != nil || s.Mode != "recovery-required" || s.Phase != "drained" || s.Owner != owner {
		return ErrBlocked
	}
	active, e := locked(dir, "activity.lock", unix.LOCK_EX)
	if e != nil {
		return e
	}
	defer unix.Close(active)
	// This is a trusted operator acknowledgement after ALL outer assertions,
	// never a public endpoint or a PID/timeout based automatic recovery.
	fd, e := unix.Openat(dir, owner+".completed.json", unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if e != nil {
		return blocked(e)
	}
	f := os.NewFile(uintptr(fd), "completion")
	_, e = f.WriteString(`{"outcome":"operator-verified-complete"}` + "\n")
	if e == nil {
		e = f.Sync()
	}
	f.Close()
	if e != nil {
		return blocked(e)
	}
	if e = unix.Fsync(dir); e != nil {
		return blocked(e)
	}
	return writeState(dir, State{Format: 1, Mode: "ready", Phase: "idle"})
}

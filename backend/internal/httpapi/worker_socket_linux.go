//go:build linux

package httpapi

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

type privateWorkerListener struct {
	net.Listener
	slots chan struct{}
}
type privateWorkerConn struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *privateWorkerConn) Close() error { e := c.Conn.Close(); c.once.Do(c.release); return e }
func (l *privateWorkerListener) Accept() (net.Conn, error) {
	for {
		c, e := l.Listener.Accept()
		if e != nil {
			return nil, e
		}
		u, ok := c.(*net.UnixConn)
		if !ok {
			c.Close()
			continue
		}
		raw, e := u.SyscallConn()
		if e != nil {
			c.Close()
			continue
		}
		accepted := false
		e = raw.Control(func(fd uintptr) {
			cred, err := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
			accepted = err == nil && cred.Uid == uint32(os.Geteuid())
		})
		if e != nil || !accepted {
			c.Close()
			continue
		}
		select {
		case l.slots <- struct{}{}:
			return &privateWorkerConn{Conn: c, release: func() { <-l.slots }}, nil
		default:
			c.Close()
		}
	}
}
func listenPrivateWorker(name string) (net.Listener, error) {
	if !filepath.IsAbs(name) || filepath.Clean(name) != name {
		return nil, errors.New("worker socket must be an absolute deployment path")
	}
	parent := filepath.Dir(name)
	info, e := os.Lstat(parent)
	if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0700 {
		return nil, errors.New("worker socket directory must be private 0700")
	}
	// The volume is pre-created for the API UID. Do not chmod an arbitrary path.
	var stat unix.Stat_t
	if e = unix.Stat(parent, &stat); e != nil || stat.Uid != uint32(os.Geteuid()) {
		return nil, errors.New("worker socket directory owner mismatch")
	}
	if info, e = os.Lstat(name); e == nil {
		if info.Mode()&os.ModeSocket == 0 || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("refusing to replace non-socket worker path")
		}
		if e = unix.Lstat(name, &stat); e != nil || stat.Uid != uint32(os.Geteuid()) {
			return nil, errors.New("worker socket owner mismatch")
		}
		if c, e := net.DialTimeout("unix", name, 2*time.Second); e == nil {
			c.Close()
			return nil, errors.New("worker socket already in use")
		} else if !errors.Is(e, unix.ECONNREFUSED) && !errors.Is(e, os.ErrNotExist) {
			return nil, errors.New("cannot safely classify existing worker socket")
		}
		if e = os.Remove(name); e != nil {
			return nil, e
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	listener, e := net.Listen("unix", name)
	if e != nil {
		return nil, e
	}
	if e = os.Chmod(name, 0600); e != nil {
		listener.Close()
		return nil, e
	}
	return &privateWorkerListener{Listener: listener, slots: make(chan struct{}, 8)}, nil
}

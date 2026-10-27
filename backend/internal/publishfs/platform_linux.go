//go:build linux

package publishfs

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockFile(f *os.File) error      { return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) }
func unlockFile(f *os.File) error    { return unix.Flock(int(f.Fd()), unix.LOCK_UN) }
func syncDirectory(f *os.File) error { return f.Sync() }

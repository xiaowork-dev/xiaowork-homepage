//go:build !linux && !windows

package publishfs

import "os"

func lockFile(f *os.File) error      { return ErrUnsafe }
func unlockFile(f *os.File) error    { return ErrUnsafe }
func syncDirectory(f *os.File) error { return ErrUnsafe }

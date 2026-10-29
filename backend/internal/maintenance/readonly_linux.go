//go:build linux

package maintenance

import (
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func openSourceNoAtime(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NOATIME|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), path), nil
}

func sourceMetadata(info os.FileInfo) any {
	if info == nil {
		return nil
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return *stat
	}
	return struct {
		Size int64
		Mode os.FileMode
		Time int64
	}{info.Size(), info.Mode(), info.ModTime().UnixNano()}
}

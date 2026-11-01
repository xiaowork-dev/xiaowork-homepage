//go:build linux

package maintenance

import (
	"errors"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func requireReadOnlyMount(path string) error {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return err
	}
	if stat.Flags&unix.ST_RDONLY == 0 {
		return errors.New("metadata inventory requires kernel read-only source mounts")
	}
	return nil
}

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

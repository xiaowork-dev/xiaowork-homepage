//go:build !windows

package publishgate

import (
	"errors"
	"io/fs"
	"os"
	"syscall"
)

func ownedSingleLink(info fs.FileInfo) error {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return errors.New("record metadata unavailable")
	}
	if st.Nlink != 1 || st.Uid != uint32(os.Geteuid()) {
		return errors.New("record must be a single-link file owned by this UID")
	}
	return nil
}

func syncDir(path string) error {
	d, err := os.Open(path)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

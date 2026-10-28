//go:build linux

package storagehealth

import "golang.org/x/sys/unix"

func diskSpace(directory string) (uint64, uint64, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(directory, &stat); err != nil {
		return 0, 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), stat.Blocks * uint64(stat.Bsize), nil
}

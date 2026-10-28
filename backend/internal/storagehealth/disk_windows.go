//go:build windows

package storagehealth

import "golang.org/x/sys/windows"

func diskSpace(directory string) (uint64, uint64, error) {
	p, err := windows.UTF16PtrFromString(directory)
	if err != nil {
		return 0, 0, err
	}
	var free, total, totalFree uint64
	err = windows.GetDiskFreeSpaceEx(p, &free, &total, &totalFree)
	return free, total, err
}

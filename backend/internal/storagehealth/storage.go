// Package storagehealth observes only configured project directories. It never
// deletes files or follows symlinks, and reports no filesystem paths to users.
package storagehealth

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

const MinimumFreeBytes uint64 = 512 << 20
const WarningFreeBytes uint64 = 1 << 30
const BuildMinimumFreeBytes uint64 = 256 << 20
const MaxUsageEntries = 100_000

type Area struct {
	Name          string `json:"name"`
	State         string `json:"state"`
	FreeBytes     uint64 `json:"freeBytes"`
	TotalBytes    uint64 `json:"totalBytes"`
	UsedBytes     uint64 `json:"usedBytes"`
	Files         int    `json:"files"`
	UsageComplete bool   `json:"usageComplete"`
}

func classify(free, total, minimum uint64) string {
	if total == 0 || free > total {
		return "unknown"
	}
	if free < minimum || float64(free)/float64(total) < .02 {
		return "critical"
	}
	if free < WarningFreeBytes || float64(free)/float64(total) < .10 {
		return "warning"
	}
	return "ok"
}

func Inspect(name, directory string, minimum uint64) Area {
	a := Area{Name: name, State: "unknown"}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return a
	}
	free, total, err := diskSpace(directory)
	if err != nil {
		return a
	}
	a.FreeBytes, a.TotalBytes = free, total
	a.State = classify(free, total, minimum)
	return a
}

// Measure bounds metadata work and does not read file content. Incomplete
// usage remains explicit; free-space enforcement uses current OS statistics.
func Measure(ctx context.Context, directory string) (bytes uint64, files int, complete bool) {
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return 0, 0, false
	}
	entries := 0
	err = filepath.WalkDir(directory, func(_ string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		entries++
		if entries > MaxUsageEntries {
			return errors.New("usage budget exceeded")
		}
		if e.Type()&os.ModeSymlink != 0 || e.IsDir() {
			return nil
		}
		info, err := e.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("unexpected storage entry")
		}
		bytes += uint64(info.Size())
		files++
		return nil
	})
	return bytes, files, err == nil
}

func CanWrite(area Area) bool { return area.State == "ok" || area.State == "warning" }

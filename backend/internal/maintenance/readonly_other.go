//go:build !linux

package maintenance

import "os"

// Metadata protection is deliberately unavailable outside the Linux runtime.
func requireReadOnlyMount(path string) error { return os.ErrPermission }

// Non-Linux builds are used by development tests only. Mutating repair already
// refuses non-Linux; actual offline acceptance uses Linux read-only volumes.
func openSourceNoAtime(path string) (*os.File, error) { return os.Open(path) }
func sourceMetadata(info os.FileInfo) any {
	if info == nil {
		return nil
	}
	return struct {
		Size int64
		Mode os.FileMode
		Time int64
	}{info.Size(), info.Mode(), info.ModTime().UnixNano()}
}

//go:build !linux && !windows

package storagehealth

import "errors"

func diskSpace(string) (uint64, uint64, error) {
	return 0, 0, errors.New("unsupported storage platform")
}

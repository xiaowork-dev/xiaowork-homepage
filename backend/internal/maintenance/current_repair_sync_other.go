//go:build !linux

package maintenance

import (
	"errors"
	"os"
)

func syncRepairRoot(_ *os.Root) error {
	return errors.New("repair mutation requires Linux durable directory fsync")
}

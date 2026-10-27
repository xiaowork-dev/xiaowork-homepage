//go:build !linux

package httpapi

import (
	"errors"
	"net"
)

func listenPrivateWorker(string) (net.Listener, error) {
	return nil, errors.New("same-UID offline publisher requires Linux Unix sockets; use isolated Docker environment")
}

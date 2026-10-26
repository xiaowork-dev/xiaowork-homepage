// Package devtls creates an isolated local development authority. It never
// modifies the operating system trust store or requests a public certificate.
package devtls

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

func serial() *big.Int {
	n, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if e != nil {
		panic("randomness unavailable")
	}
	return n
}

// Ensure refuses partial/corrupt credentials instead of silently replacing a
// previously trusted CA. Only an explicit local preparation command calls it.
func Ensure(authorityDir, serverDir string) error {
	paths := []string{filepath.Join(authorityDir, "ca.crt"), filepath.Join(authorityDir, "ca.key"), filepath.Join(serverDir, "tls.crt"), filepath.Join(serverDir, "tls.key")}
	count := 0
	for _, p := range paths {
		i, e := os.Lstat(p)
		if e == nil {
			if !i.Mode().IsRegular() || (runtime.GOOS != "windows" && i.Mode().Perm()&0077 != 0) {
				return errors.New("local TLS credentials must be regular files")
			}
			count++
		} else if !os.IsNotExist(e) {
			return e
		}
	}
	if count != 0 {
		if count != 4 {
			return errors.New("partial local TLS credentials; restore them explicitly")
		}
		for _, dir := range []string{authorityDir, serverDir} {
			info, e := os.Lstat(dir)
			if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
				return errors.New("local TLS directories must be private real directories")
			}
		}
		return validate(paths)
	}
	for _, d := range []string{authorityDir, serverDir} {
		if e := os.MkdirAll(d, 0700); e != nil {
			return e
		}
		info, e := os.Lstat(d)
		if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
			return errors.New("local TLS directories must be private real directories")
		}
	}
	now := time.Now()
	caKey, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return e
	}
	ca := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "XiaoWork isolated development CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.AddDate(1, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign, MaxPathLen: 0, MaxPathLenZero: true}
	caDER, e := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if e != nil {
		return e
	}
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return e
	}
	leaf := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "localhost"}, DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}, NotBefore: now.Add(-time.Minute), NotAfter: now.AddDate(0, 3, 0), BasicConstraintsValid: true, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, e := x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, caKey)
	if e != nil {
		return e
	}
	caBytes, e := x509.MarshalPKCS8PrivateKey(caKey)
	if e != nil {
		return e
	}
	keyBytes, e := x509.MarshalPKCS8PrivateKey(key)
	if e != nil {
		return e
	}
	values := [][]byte{pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: caBytes}), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes})}
	for i, p := range paths {
		f, e := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return e
		}
		_, e = f.Write(values[i])
		if e == nil {
			e = f.Sync()
		}
		ce := f.Close()
		if e != nil {
			return e
		}
		if ce != nil {
			return ce
		}
	}
	return validate(paths)
}

func validate(paths []string) error {
	caBytes, e := os.ReadFile(paths[0])
	if e != nil {
		return e
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caBytes) {
		return errors.New("invalid local CA")
	}
	caPair, e := tls.LoadX509KeyPair(paths[0], paths[1])
	if e != nil || len(caPair.Certificate) != 1 {
		return errors.New("invalid local CA key pair")
	}
	pair, e := tls.LoadX509KeyPair(paths[2], paths[3])
	if e != nil || len(pair.Certificate) != 1 {
		return errors.New("invalid local TLS key pair")
	}
	leaf, e := x509.ParseCertificate(pair.Certificate[0])
	if e != nil {
		return e
	}
	for _, host := range []string{"localhost", "127.0.0.1", "::1"} {
		if _, e = leaf.Verify(x509.VerifyOptions{DNSName: host, Roots: roots}); e != nil {
			return errors.New("local TLS certificate invalid/expired; renew explicitly")
		}
	}
	return nil
}

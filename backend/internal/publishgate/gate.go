// Package publishgate holds the operator-only production publishing
// authorization. The record lives in the shared maintenance control directory,
// which the API and Worker mount read-only; only the offline maintenance image
// (homepage-control) writes it. Every unknown, damaged, mismatched, revoked or
// expired state closes the gate.
package publishgate

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	AuthorizationFile = "publish-authorization.json"
	RevocationFile    = "publish-revoked.json"
	ProductionOrigin  = "https://xiaoworks.com"
	maxRecordBytes    = 16384
	// MaxValidity bounds any single authorization; the recommended default is 7 days.
	MaxValidity = 30 * 24 * time.Hour
	// MaxBackupAge is the freshness of the verified backup required at issue time.
	MaxBackupAge = 24 * time.Hour
	clockSkew    = 5 * time.Minute
)

var (
	idPattern      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	projectPattern = regexp.MustCompile(`^xiaowork-homepage-v11-[a-z0-9-]{1,40}$`)
	sourcePattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	imagePattern   = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	hashPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type Backup struct {
	Path                  string    `json:"path"`
	ContentManifestSHA256 string    `json:"contentManifestSHA256"`
	VerifiedAt            time.Time `json:"verifiedAt"`
}

type Authorization struct {
	Format       int       `json:"format"`
	ID           string    `json:"id"`
	Project      string    `json:"project"`
	Origin       string    `json:"origin"`
	Source       string    `json:"source"`
	Schema       int       `json:"schema"`
	WorkerImage  string    `json:"workerImage"`
	APIImage     string    `json:"apiImage"`
	IssuedAt     time.Time `json:"issuedAt"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Backup       Backup    `json:"backup"`
	ApprovalNote string    `json:"approvalNote"`
}

type Revocation struct {
	Format          int       `json:"format"`
	AuthorizationID string    `json:"authorizationId"`
	RevokedAt       time.Time `json:"revokedAt"`
	Reason          string    `json:"reason"`
}

// Expect is the identity of the running API that an authorization must match.
type Expect struct {
	Project     string
	Origin      string
	Source      string
	WorkerImage string
	Schema      int
}

// Closed explains why publishing is unavailable. Messages never contain secrets.
type Closed struct {
	Code    string
	Message string
}

func (c *Closed) Error() string { return c.Code + ": " + c.Message }

func closed(code, message string) error { return &Closed{Code: code, Message: message} }

func validNote(s string, min int) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(strings.TrimSpace(s)) >= min && len(s) <= 500 && !strings.ContainsAny(s, "\r\n\x00")
}

// Validate checks a record's own consistency, independent of the running API.
func Validate(a Authorization) error {
	switch {
	case a.Format != 1:
		return errors.New("unsupported authorization format")
	case !idPattern.MatchString(a.ID):
		return errors.New("invalid authorization id")
	case !projectPattern.MatchString(a.Project):
		return errors.New("invalid project")
	case a.Origin != ProductionOrigin:
		return errors.New("authorization origin must be the fixed production origin")
	case !sourcePattern.MatchString(a.Source):
		return errors.New("invalid source revision")
	case a.Schema <= 0:
		return errors.New("invalid schema")
	case !imagePattern.MatchString(a.WorkerImage) || !imagePattern.MatchString(a.APIImage):
		return errors.New("invalid image identity")
	case a.IssuedAt.IsZero() || !a.ExpiresAt.After(a.IssuedAt) || a.ExpiresAt.Sub(a.IssuedAt) > MaxValidity:
		return errors.New("invalid validity window")
	case !path.IsAbs(a.Backup.Path) || path.Clean(a.Backup.Path) != a.Backup.Path || len(a.Backup.Path) > 512 || strings.ContainsAny(a.Backup.Path, "\r\n\x00"):
		return errors.New("invalid backup path")
	case !hashPattern.MatchString(a.Backup.ContentManifestSHA256):
		return errors.New("invalid backup manifest hash")
	case a.Backup.VerifiedAt.IsZero() || a.Backup.VerifiedAt.After(a.IssuedAt.Add(clockSkew)) || a.IssuedAt.Sub(a.Backup.VerifiedAt) > MaxBackupAge:
		return errors.New("authorization requires a backup verified within 24 hours before issue")
	case !validNote(a.ApprovalNote, 8):
		return errors.New("a non-secret approval note of 8-500 characters is required")
	}
	return nil
}

// Check returns the authorization only when it is present, intact, unrevoked,
// within its validity window and bound to exactly this API's release identity.
func Check(root string, want Expect, now time.Time) (Authorization, error) {
	var a Authorization
	if !filepath.IsAbs(root) {
		return a, closed("GATE_INVALID", "控制目录无效，生产发布保持关闭。")
	}
	// Any revocation file closes the gate; one that cannot be read safely too.
	if _, err := readRecord(root, RevocationFile); !errors.Is(err, fs.ErrNotExist) {
		if err != nil {
			return a, closed("GATE_INVALID", "撤销记录无法核验，生产发布保持关闭。")
		}
		return a, closed("GATE_REVOKED", "运维人员已撤销生产发布授权，需要在服务器上重新授权。")
	}
	raw, err := readRecord(root, AuthorizationFile)
	if errors.Is(err, fs.ErrNotExist) {
		return a, closed("GATE_ABSENT", "尚未取得服务器运维授权，生产发布保持关闭。")
	}
	if err != nil {
		return a, closed("GATE_INVALID", "授权记录无法安全读取，生产发布保持关闭。")
	}
	if err = decodeStrict(raw, &a); err != nil || Validate(a) != nil {
		return Authorization{}, closed("GATE_INVALID", "授权记录格式或内容无效，生产发布保持关闭。")
	}
	switch {
	case a.Project != want.Project:
		return Authorization{}, closed("GATE_MISMATCH", "授权不属于本部署项目，需要重新授权。")
	case a.Origin != want.Origin:
		return Authorization{}, closed("GATE_MISMATCH", "授权 origin 与当前服务不一致，需要重新授权。")
	case a.Source != want.Source || a.WorkerImage != want.WorkerImage:
		return Authorization{}, closed("GATE_MISMATCH", "当前运行版本与授权时验收的源码或构建镜像不一致，需要重新验收并授权。")
	case a.Schema != want.Schema:
		return Authorization{}, closed("GATE_MISMATCH", "当前数据库结构版本与授权不一致，需要重新授权。")
	case now.Before(a.IssuedAt.Add(-clockSkew)):
		return Authorization{}, closed("GATE_NOT_YET_VALID", "授权尚未生效，请检查服务器时间。")
	case !now.Before(a.ExpiresAt):
		return Authorization{}, closed("GATE_EXPIRED", "生产发布授权已到期，需要在服务器上重新授权。")
	}
	return a, nil
}

func decodeStrict(raw []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing content")
	}
	return nil
}

// readRecord accepts only a small, regular, single-link file owned by this UID
// without group/other permissions, directly inside root (no symlinks).
func readRecord(root, name string) ([]byte, error) {
	dir, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	info, err := dir.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxRecordBytes {
		return nil, errors.New("unsafe record")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("record grants group or other permissions")
	}
	if err = ownedSingleLink(info); err != nil {
		return nil, err
	}
	f, err := dir.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("record changed while opening")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maxRecordBytes+1))
	if err != nil || len(raw) > maxRecordBytes {
		return nil, errors.New("record too large")
	}
	return raw, nil
}

// NewID returns a random RFC 4122 version 4 identifier.
func NewID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", h[0:8], h[8:12], h[12:16], h[16:20], h[20:32]), nil
}

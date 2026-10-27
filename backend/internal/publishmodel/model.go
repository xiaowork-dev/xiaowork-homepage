// Package publishmodel defines data-only publication contracts shared by the
// API and offline worker. It never executes content or resolves user URLs.
package publishmodel

import (
	"encoding/json"
	"regexp"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
)

const ProtocolVersion = 1
const WorkerID = "publisher-v1"
const InternalPrefix = "/internal/publisher/v1"
const MarkerPath = "__xiaowork-release.json"

var HexHash = regexp.MustCompile(`^[0-9a-f]{64}$`)
var SourceHash = regexp.MustCompile(`^[0-9a-f]{40}$`)
var identity = regexp.MustCompile(`^(job|rel|pre|snap)_[0-9a-f]{32}$`)

func ValidID(id, prefix string) bool {
	return identity.MatchString(id) && len(id) > len(prefix) && id[:len(prefix)+1] == prefix+"_"
}

var BuiltinPaths = map[string]string{
	"builtin-cover-blog":   "images/projects/blog/placeholder.svg",
	"builtin-cover-nav":    "images/projects/nav/placeholder.svg",
	"builtin-cover-erp":    "images/projects/erp/placeholder.svg",
	"builtin-social-share": "images/social/xiaowork-share.png",
	"builtin-brand-icon":   "favicon.svg",
}

type PublicProject struct {
	ID    string `json:"id"`
	Order int64  `json:"order"`
	contentdata.ProjectInput
}
type PublicCategory struct {
	Slug  string `json:"slug"`
	Name  string `json:"name"`
	Order int64  `json:"order"`
}
type Media struct {
	ID        string `json:"id"`
	SHA256    string `json:"sha256"`
	MediaType string `json:"mediaType"`
	ByteSize  int64  `json:"byteSize"`
	Width     int64  `json:"width"`
	Height    int64  `json:"height"`
	Alt       string `json:"alt"`
	Path      string `json:"path"`
}
type Snapshot struct {
	SchemaVersion        int                      `json:"schemaVersion"`
	SnapshotID           string                   `json:"snapshotId"`
	WorkspaceRevision    string                   `json:"workspaceRevision"`
	CreatedAt            string                   `json:"createdAt"`
	SiteProfile          contentdata.SiteProfile  `json:"siteProfile"`
	AboutProfile         contentdata.AboutProfile `json:"aboutProfile"`
	SiteSettings         contentdata.Settings     `json:"siteSettings"`
	VisibleProjects      []PublicProject          `json:"visibleProjects"`
	Categories           []PublicCategory         `json:"categories"`
	MediaManifest        []Media                  `json:"mediaManifest"`
	LegacyAssetAllowlist []string                 `json:"legacyAssetAllowlist"`
}
type MediaAsset struct {
	ID          string `json:"id"`
	StorageKind string `json:"storageKind"`
	SHA256      string `json:"sha256"`
	Bytes       int64  `json:"bytes"`
	MediaType   string `json:"mediaType"`
	PublicPath  string `json:"publicPath"`
}
type Assignment struct {
	ID                        string          `json:"id"`
	Kind                      string          `json:"kind"`
	SnapshotID                string          `json:"snapshotId"`
	SnapshotSHA256            string          `json:"snapshotSha256"`
	Snapshot                  json.RawMessage `json:"snapshot"`
	WorkspaceRevision         string          `json:"workspaceRevision"`
	ReleaseID                 string          `json:"releaseId"`
	TargetReleaseID           string          `json:"targetReleaseId"`
	ExpectedPreviousReleaseID string          `json:"expectedPreviousReleaseId"`
	LeaseToken                string          `json:"leaseToken"`
	LeaseExpiresAt            string          `json:"leaseExpiresAt"`
	SourceRevision            string          `json:"sourceRevision"`
	BuilderID                 string          `json:"builderId"`
	Assets                    []MediaAsset    `json:"assets"`
	RecoveryRequired          bool            `json:"recoveryRequired"`
}
type File struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}
type Manifest struct {
	SchemaVersion     int    `json:"schemaVersion"`
	JobID             string `json:"jobId"`
	ReleaseID         string `json:"releaseId"`
	SnapshotID        string `json:"snapshotId"`
	SnapshotSHA256    string `json:"snapshotSha256"`
	WorkspaceRevision string `json:"workspaceRevision"`
	SourceRevision    string `json:"sourceRevision"`
	BuilderID         string `json:"builderId"`
	Kind              string `json:"kind"`
	PreviewID         string `json:"previewId,omitempty"`
	Origin            string `json:"origin"`
	CreatedAt         string `json:"createdAt"`
	Files             []File `json:"files"`
}
type Marker struct {
	SchemaVersion     int    `json:"schemaVersion"`
	ReleaseID         string `json:"releaseId"`
	SnapshotID        string `json:"snapshotId"`
	SnapshotSHA256    string `json:"snapshotSha256"`
	WorkspaceRevision string `json:"workspaceRevision"`
}
type Receipt struct {
	SchemaVersion     int    `json:"schemaVersion"`
	JobID             string `json:"jobId"`
	ReleaseID         string `json:"releaseId"`
	PreviousReleaseID string `json:"previousReleaseId"`
	ActivationToken   string `json:"activationToken"`
	SnapshotID        string `json:"snapshotId"`
	SnapshotSHA256    string `json:"snapshotSha256"`
	ManifestSHA256    string `json:"manifestSha256"`
	ActivatedAt       string `json:"activatedAt"`
	Outcome           string `json:"outcome"`
}
type Intent struct {
	Receipt
	Phase string `json:"phase"`
}
type ClaimRequest struct {
	ProtocolVersion int    `json:"protocolVersion"`
	WorkerID        string `json:"workerId"`
}
type ClaimResponse struct {
	Job *Assignment `json:"job"`
}
type HeartbeatRequest struct {
	LeaseToken string `json:"leaseToken"`
	Phase      string `json:"phase"`
}
type PreparedRequest struct {
	LeaseToken     string `json:"leaseToken"`
	ManifestSHA256 string `json:"manifestSha256"`
}
type PreparedResponse struct {
	ActivationToken           string `json:"activationToken"`
	ExpectedPreviousReleaseID string `json:"expectedPreviousReleaseId"`
}
type ResultRequest struct {
	LeaseToken   string `json:"leaseToken"`
	Outcome      string `json:"outcome"`
	ErrorCode    string `json:"errorCode,omitempty"`
	ErrorSummary string `json:"errorSummary,omitempty"`
}
type ResultResponse struct {
	Status                    string `json:"status"`
	Action                    string `json:"action"`
	ExpectedPreviousReleaseID string `json:"expectedPreviousReleaseId"`
}

// Package contentlimits is the single resource contract for uploaded and
// published content. No runtime request can raise these budgets.
package contentlimits

const (
	MaxOriginalImageBytes = 10 << 20
	MaxMultipartBytes     = 11 << 20
	MaxPublishedFileBytes = 16 << 20
	MaxSnapshotMediaBytes = 256 << 20
	MaxImageDimension     = 8192
	MaxImagePixels        = 25_000_000
)

package publishworker

import (
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

// Project only the checked-in public seed. This test does not open an admin
// database, credentials, uploads or private workspace content.
func publicSeedAssignment(t *testing.T) (publishmodel.Assignment, publishmodel.Snapshot) {
	t.Helper()
	raw, err := os.ReadFile("../../seed/v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var envelope contentdata.Seed
	if err = json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	payloadBytes, err := contentdata.CanonicalJSON(envelope.Payload)
	if err != nil || publishfs.Hash(payloadBytes) != envelope.PayloadSHA256 {
		t.Fatal("public seed payload checksum differs")
	}
	var seed contentdata.SeedPayload
	if err = json.Unmarshal(envelope.Payload, &seed); err != nil {
		t.Fatal(err)
	}
	job, snapshot := fixture()
	snapshot.SiteProfile = seed.Profile.Site
	snapshot.AboutProfile = seed.Profile.About
	snapshot.SiteSettings = seed.Settings
	snapshot.VisibleProjects = []publishmodel.PublicProject{}
	snapshot.Categories = []publishmodel.PublicCategory{}
	snapshot.LegacyAssetAllowlist = []string{}
	for _, project := range seed.Projects {
		if project.Visible != nil && *project.Visible {
			snapshot.VisibleProjects = append(snapshot.VisibleProjects, publishmodel.PublicProject{
				ID: project.ID, Order: project.Order, ProjectInput: project.ProjectInput,
			})
		}
	}
	for _, category := range seed.Categories {
		snapshot.Categories = append(snapshot.Categories, publishmodel.PublicCategory{
			Slug: category.Slug, Name: category.Name, Order: category.Order,
		})
	}
	for _, asset := range seed.Assets {
		if expected, ok := publishmodel.BuiltinPaths[asset.ID]; !ok || asset.Path != expected {
			t.Fatal("public seed contains an unknown builtin resource")
		}
		snapshot.LegacyAssetAllowlist = append(snapshot.LegacyAssetAllowlist, asset.ID)
		job.Assets = append(job.Assets, publishmodel.MediaAsset{
			ID: asset.ID, StorageKind: "builtin", SHA256: asset.SHA256,
			Bytes: asset.ByteSize, MediaType: asset.MediaType, PublicPath: asset.Path,
		})
	}
	sort.Strings(snapshot.LegacyAssetAllowlist)
	sealProbeSnapshot(t, &job, snapshot)
	return job, snapshot
}

func sealProbeSnapshot(t *testing.T, job *publishmodel.Assignment, snapshot publishmodel.Snapshot) {
	t.Helper()
	raw, err := contentdata.CanonicalJSON(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	job.Snapshot = raw
	job.SnapshotSHA256 = publishfs.Hash(raw)
}

func TestPublicSeedSnapshotDocumentBuiltinsAccepted(t *testing.T) {
	job, snapshot := publicSeedAssignment(t)
	if snapshot.SiteProfile.BrandAssetID == nil || *snapshot.SiteProfile.BrandAssetID != "builtin-brand-icon" || snapshot.SiteSettings.DefaultShareAssetID == nil || *snapshot.SiteSettings.DefaultShareAssetID != "builtin-social-share" {
		t.Fatal("checked-in public seed no longer exercises builtin brand and share references")
	}
	if _, err := ValidateAssignment(job, job.SourceRevision, job.BuilderID); err != nil {
		t.Fatalf("real public seed projection rejected before FixedBuilder: %v", err)
	}
	t.Log("checked-in public seed brand icon and default share image accepted through their sealed builtin allowlist")
}

func TestPublicSeedDocumentReferencesRequireSealedAsset(t *testing.T) {
	fields := []struct {
		name string
		ref  func(*publishmodel.Snapshot) **string
	}{
		{"avatar", func(s *publishmodel.Snapshot) **string { return &s.SiteProfile.AvatarAssetID }},
		{"brand", func(s *publishmodel.Snapshot) **string { return &s.SiteProfile.BrandAssetID }},
		{"default-share", func(s *publishmodel.Snapshot) **string { return &s.SiteSettings.DefaultShareAssetID }},
		{"home-share", func(s *publishmodel.Snapshot) **string { return &s.SiteSettings.Pages.Home.ShareAssetID }},
		{"projects-share", func(s *publishmodel.Snapshot) **string { return &s.SiteSettings.Pages.Projects.ShareAssetID }},
		{"about-share", func(s *publishmodel.Snapshot) **string { return &s.SiteSettings.Pages.About.ShareAssetID }},
	}
	for _, field := range fields {
		for _, kind := range []string{"builtin", "media", "unknown", "builtin-not-allowlisted"} {
			t.Run(field.name+"/"+kind, func(t *testing.T) {
				job, snapshot := publicSeedAssignment(t)
				for _, item := range fields {
					*item.ref(&snapshot) = nil
				}
				id := "builtin-brand-icon"
				if kind == "unknown" {
					id = "asset-not-in-snapshot"
				}
				if kind == "media" {
					id = "asset-confirmed"
					hash := strings.Repeat("a", 64)
					path := "media/" + hash + ".png"
					snapshot.MediaManifest = append(snapshot.MediaManifest, publishmodel.Media{
						ID: id, SHA256: hash, MediaType: "image/png", ByteSize: 4,
						Width: 1, Height: 1, Alt: "Public fixture image", Path: path,
					})
					job.Assets = append(job.Assets, publishmodel.MediaAsset{
						ID: id, StorageKind: "upload", SHA256: hash, Bytes: 4,
						MediaType: "image/png", PublicPath: path,
					})
				}
				if kind == "builtin-not-allowlisted" {
					allowlist := []string{}
					for _, allowed := range snapshot.LegacyAssetAllowlist {
						if allowed != id {
							allowlist = append(allowlist, allowed)
						}
					}
					snapshot.LegacyAssetAllowlist = allowlist
					assets := []publishmodel.MediaAsset{}
					for _, asset := range job.Assets {
						if asset.ID != id {
							assets = append(assets, asset)
						}
					}
					job.Assets = assets
				}
				*field.ref(&snapshot) = &id
				sealProbeSnapshot(t, &job, snapshot)
				_, err := ValidateAssignment(job, job.SourceRevision, job.BuilderID)
				allowed := kind == "builtin" || kind == "media"
				if allowed && err != nil {
					t.Fatalf("sealed document resource rejected: %v", err)
				}
				if !allowed && err == nil {
					t.Fatal("document referenced a resource absent from the sealed allowlist/manifest")
				}
			})
		}
	}
}

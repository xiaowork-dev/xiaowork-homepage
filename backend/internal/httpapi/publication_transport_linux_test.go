//go:build linux

package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishworker"
)

func TestWorkerClaimUnixTransportPreservesSealedSnapshotBytes(t *testing.T) {
	for _, uploaded := range []bool{false, true} {
		name := "public-seed"
		if uploaded {
			name = "uploaded-media-and-unicode"
		}
		t.Run(name, func(t *testing.T) {
			f, client, csrf := publicationFixture(t)
			assetID := ""
			if uploaded {
				// All mutations use the real authenticated HTTPS API. The image
				// is a locally generated PNG with no private workspace data.
				body, mediaType := mediaMultipart(t, "transport.png", "image/png", mediaTestPNG(t), false)
				response, _ := mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), mediaType, csrf, publicationRevision(t, f), http.StatusCreated)
				media, revision := mediaResponse(t, response)
				assetID = media.ID
				mediaRequest(t, f, client, "PATCH", "/media/"+assetID, strings.NewReader(`{"alt":"A & B — 中文 🚀","publicUseConfirmed":true,"publicConfirmationNote":"Generated public regression fixture"}`), "application/json", csrf, revision, http.StatusOK)
				project := projectBody(t, f, "xiaowork-blog")
				project["cover"] = contentdata.Reference{Kind: "media", ID: assetID}
				contentHTTP(t, f, client, "PUT", "/projects/xiaowork-blog", project, csrf, publicationRevision(t, f), "", http.StatusOK)
				profile, _, err := contentdata.ProfileView(context.Background(), f.db)
				if err != nil {
					t.Fatal(err)
				}
				profile.Site.Role = "Developer & Creator — 中文 🚀"
				profile.Site.Introduction = []string{"Public text & Unicode 中文 🚀 \u2028\u2029"}
				contentHTTP(t, f, client, "PUT", "/profile", profile, csrf, publicationRevision(t, f), "", http.StatusOK)
			}
			queuePublication(t, f, client, csrf, "preview", "sealed-transport-"+name)

			// Exercise the actual private listener and production UnixClient,
			// rather than passing a Go struct directly to the validator.
			dir, err := os.MkdirTemp("", "xw-transport-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			if err = os.Chmod(dir, 0700); err != nil {
				t.Fatal(err)
			}
			f.app.config.WorkerSocket = filepath.Join(dir, "publisher.sock")
			listener, err := f.app.WorkerListener()
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			server := Server("", f.app.WorkerHandler())
			defer server.Close()
			go server.Serve(listener)
			control, err := publishworker.NewUnixClient(f.app.config.WorkerSocket)
			if err != nil {
				t.Fatal(err)
			}
			job, err := control.Claim(context.Background())
			if err != nil || job == nil {
				t.Fatalf("private transport did not return an assignment: %v", err)
			}
			_, sealed, sealedHash, err := publishdata.Load(context.Background(), f.db, job.SnapshotID)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = publishworker.ValidateAssignment(*job, f.app.config.SourceRevision, f.app.config.BuilderID); err != nil {
				t.Fatalf("actual private HTTP claim rejected: %v; sealed bytes equal=%t, advertised hash matches sealed=%t, received hash matches sealed=%t", err, bytes.Equal(job.Snapshot, sealed), job.SnapshotSHA256 == sealedHash, publishfs.Hash(job.Snapshot) == sealedHash)
			}
			if !bytes.Equal(job.Snapshot, sealed) || publishfs.Hash(job.Snapshot) != sealedHash || job.SnapshotSHA256 != sealedHash {
				t.Fatal("private HTTP transport changed the sealed snapshot bytes")
			}
			var snapshot publishmodel.Snapshot
			if snapshot, err = publishworker.ValidateAssignment(*job, job.SourceRevision, job.BuilderID); err != nil {
				t.Fatal(err)
			}
			if uploaded && (len(snapshot.MediaManifest) != 1 || snapshot.MediaManifest[0].ID != assetID || snapshot.VisibleProjects[0].Cover.ID != assetID) {
				t.Fatal("actual confirmed upload missing from the sealed assignment")
			}
			t.Logf("same-UID UDS -> production UnixClient -> strict validator; uploaded=%t; frozen bytes and hash unchanged", uploaded)
		})
	}
}

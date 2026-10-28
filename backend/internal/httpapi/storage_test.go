package httpapi

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestStorageStatusIsAuthenticatedAndDoesNotExposePaths(t *testing.T) {
	f, c, _ := publicationFixture(t)
	f.request(t, f.client(t), "GET", "/publishing-status", nil, "", 401)
	envelope, _ := f.request(t, c, "GET", "/publishing-status", nil, "", 200)
	status := authData(t, envelope)["storage"].(map[string]any)
	if status["state"] == "critical" || len(status["areas"].([]any)) != 3 {
		t.Fatalf("unexpected storage status: %#v", status)
	}
	raw, _ := json.Marshal(status)
	for _, secretPath := range []string{f.app.config.UploadDir, f.app.config.PublicationsDir, f.app.storage.databaseDir} {
		if secretPath != "" && strings.Contains(string(raw), secretPath) {
			t.Fatal("private directory disclosed")
		}
	}
}

func TestUnknownUploadStorageRejectsPublicationWithoutPartialTask(t *testing.T) {
	f, c, csrf := publicationFixture(t)
	f.app.config.UploadDir = filepath.Join(t.TempDir(), "unavailable")
	response, _ := contentHTTP(t, f, c, "POST", "/preview-jobs", map[string]any{}, csrf, publicationRevision(t, f), "capacity-unavailable-key", 507)
	if response["error"].(map[string]any)["code"] != "STORAGE_CAPACITY" {
		t.Fatal("incorrect capacity response")
	}
	for _, table := range []string{"snapshots", "publish_jobs", "publication_job_details"} {
		var n int
		if err := f.db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("partial data in fixed table %s: %d %v", table, n, err)
		}
	}
}

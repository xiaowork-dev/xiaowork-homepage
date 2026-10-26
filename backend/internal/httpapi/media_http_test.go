package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/mediautils"
)

func mediaHTTPFixture(t *testing.T) (*authFixture, *http.Client, string) {
	t.Helper()
	f := newAuthFixture(t)
	if _, err := f.db.Exec("INSERT OR IGNORE INTO workspace(id,revision,updated_at) VALUES(1,0,?)", f.clock.Load()); err != nil {
		t.Fatal(err)
	}
	client := f.client(t)
	csrf, _ := f.loginAs(t, client, "xiaowork", authTestPassword, 200)
	return f, client, csrf
}

func mediaMultipart(t *testing.T, filename, mediaType string, body []byte, extra bool) ([]byte, string) {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
	header.Set("Content-Type", mediaType)
	part, err := w.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatal(err)
	}
	if extra {
		if err := w.WriteField("extra", "not allowed"); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes(), w.FormDataContentType()
}

func mediaRequest(t *testing.T, f *authFixture, client *http.Client, method, path string, body io.Reader, contentType, csrf, revision string, expected int) ([]byte, http.Header) {
	t.Helper()
	req, err := http.NewRequest(method, f.server.URL+apiPrefix+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if method != "GET" && method != "HEAD" {
		req.Header.Set("Origin", f.server.URL)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	if revision != "" {
		req.Header.Set("If-Match", revision)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != expected {
		t.Fatalf("%s %s expected=%d actual=%d body=%s", method, path, expected, res.StatusCode, b)
	}
	if res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("private media response missing no-store/nosniff")
	}
	t.Logf("HTTPS %s %s expected=%d actual=%d", method, path, expected, res.StatusCode)
	return b, res.Header
}

func mediaResponse(t *testing.T, body []byte) (mediaRecord, string) {
	t.Helper()
	var response struct {
		Data struct {
			Media    mediaRecord `json:"media"`
			Revision string      `json:"revision"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil || response.Data.Media.ID == "" {
		t.Fatalf("invalid media response: %s %v", body, err)
	}
	return response.Data.Media, fmt.Sprintf("%q", response.Data.Revision)
}

func TestMediaHTTPSLifecycleAndRejectedUploads(t *testing.T) {
	f, client, csrf := mediaHTTPFixture(t)
	png := mediaTestPNG(t)
	body, contentType := mediaMultipart(t, "screen.png", "image/png", png, false)
	mediaRequest(t, f, f.client(t), "POST", "/media", bytes.NewReader(body), contentType, csrf, `"ws-0"`, 401)
	mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), contentType, "", `"ws-0"`, 403)
	mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), contentType, csrf, "", 428)
	mediaRequest(t, f, client, "POST", "/media?unknown=1", bytes.NewReader(body), contentType, csrf, `"ws-0"`, 400)
	for _, tc := range []struct {
		name, mime string
		bytes      []byte
		extra      bool
		status     int
	}{
		{"fake.jpg", "image/jpeg", png, false, 415},
		{"../escape.png", "image/png", png, false, 415},
		{"bad.png", "image/png", []byte("<html>not a screenshot</html>"), false, 415},
		{"screen.png", "image/png", png, true, 400},
		{"huge.png", "image/png", make([]byte, mediautils.MaxOriginalBytes+1), false, 413},
	} {
		b, ct := mediaMultipart(t, tc.name, tc.mime, tc.bytes, tc.extra)
		mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(b), ct, csrf, `"ws-0"`, tc.status)
	}
	mediaRequest(t, f, client, "POST", "/media", io.MultiReader(bytes.NewReader(body), strings.NewReader(strings.Repeat("x", mediautils.MaxMultipartBytes))), contentType, csrf, `"ws-0"`, 413)
	response, headers := mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), contentType, csrf, `"ws-0"`, 201)
	m, revision := mediaResponse(t, response)
	if revision != `"ws-1"` || headers.Get("ETag") != revision || m.PublicUseConfirmed || m.ByteSize == 0 || m.ContentURL == "" {
		t.Fatalf("invalid upload state: %+v %s", m, revision)
	}
	if strings.Contains(string(response), "storageKey") || strings.Contains(string(response), f.app.config.UploadDir) {
		t.Fatal("private file path exposed")
	}
	for _, path := range []string{"/media?%zz=1", "/media?unknown=1", "/media?limit=1&limit=2", "/media/" + m.ID + "?unknown=1", "/media/" + m.ID + "/content?%zz=1"} {
		mediaRequest(t, f, client, "GET", path, nil, "", "", "", 400)
	}
	mediaRequest(t, f, client, "PATCH", "/media/"+m.ID+"?unknown=1", strings.NewReader(`{"alt":"demo"}`), "application/json", csrf, revision, 400)
	mediaRequest(t, f, client, "DELETE", "/media/"+m.ID+"?unknown=1", nil, "", csrf, revision, 400)
	mediaRequest(t, f, f.client(t), "GET", "/media/"+m.ID+"/content", nil, "", "", "", 401)
	content, headers := mediaRequest(t, f, client, "GET", "/media/"+m.ID+"/content", nil, "", "", "", 200)
	if headers.Get("Content-Type") != "image/png" || !bytes.Equal(content, png) {
		t.Fatal("sanitized PNG content mismatch")
	}
	mediaRequest(t, f, client, "PATCH", "/media/"+m.ID, strings.NewReader(`{"alt":null}`), "application/json", csrf, revision, 400)
	mediaRequest(t, f, client, "PATCH", "/media/"+m.ID, strings.NewReader(`{"storageKey":"../x"}`), "application/json", csrf, revision, 400)
	response, _ = mediaRequest(t, f, client, "PATCH", "/media/"+m.ID, strings.NewReader(`{"alt":"Demo screenshot","publicUseConfirmed":true,"publicConfirmationNote":"Test fixture: approved non-sensitive demo"}`), "application/json", csrf, revision, 200)
	m, revision = mediaResponse(t, response)
	if revision != `"ws-2"` || !m.PublicUseConfirmed || m.PublicConfirmedAt == nil || m.Alt != "Demo screenshot" {
		t.Fatal("public-use confirmation was not persisted")
	}
	var confirmedBy int
	if err := f.db.QueryRow("SELECT public_confirmed_by FROM asset_metadata WHERE asset_id=?", m.ID).Scan(&confirmedBy); err != nil || confirmedBy != 1 {
		t.Fatal("confirmation must bind to authenticated administrator", err)
	}
	mediaRequest(t, f, client, "GET", "/media?limit=1", nil, "", "", "", 200)
	mediaRequest(t, f, client, "GET", "/media?cursor=invalid!", nil, "", "", "", 400)
	mediaRequest(t, f, client, "GET", "/media?limit=1000", nil, "", "", "", 400)
	mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), contentType, csrf, `"ws-0"`, 409)
	response, _ = mediaRequest(t, f, client, "DELETE", "/media/"+m.ID, nil, "", csrf, revision, 200)
	m, revision = mediaResponse(t, response)
	if revision != `"ws-3"` || m.DeletedAt == nil || m.ContentURL != "" {
		t.Fatal("soft deletion state incorrect")
	}
	mediaRequest(t, f, client, "GET", "/media/"+m.ID+"/content", nil, "", "", "", 404)
	mediaRequest(t, f, client, "PATCH", "/media/"+m.ID, strings.NewReader(`{"alt":"changed"}`), "application/json", csrf, revision, 404)
	mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), contentType, csrf, revision, 409)
	var key string
	if err := f.db.QueryRow("SELECT storage_key FROM assets WHERE id=?", m.ID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(f.app.config.UploadDir, filepath.FromSlash(key))); err != nil {
		t.Fatal("soft deletion physically removed retained object", err)
	}
}

func TestMediaHTTPSReferenceProtectionAndCorruptContent(t *testing.T) {
	f, client, csrf := mediaHTTPFixture(t)
	body, contentType := mediaMultipart(t, "screen.png", "image/png", mediaTestPNG(t), false)
	response, _ := mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), contentType, csrf, `"ws-0"`, 201)
	m, revision := mediaResponse(t, response)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO project_categories(id,slug,name,created_at,updated_at) VALUES('c','category','Category',1,1)")
	exec("INSERT INTO project_drafts(id,category_id,slug,name,summary,created_at,updated_at) VALUES('p','c','project','Project','',1,1)")
	exec("INSERT INTO project_draft_assets(project_id,role,asset_id) VALUES('p','cover',?)", m.ID)
	mediaRequest(t, f, client, "DELETE", "/media/"+m.ID, nil, "", csrf, revision, 409)
	exec("DELETE FROM project_draft_assets WHERE project_id='p'")
	exec("INSERT INTO workspace_documents(kind,content_json,updated_at) VALUES('site','{}',1)")
	exec("INSERT INTO document_draft_assets(document_kind,field_path,asset_id) VALUES('site','shareImage',?)", m.ID)
	mediaRequest(t, f, client, "DELETE", "/media/"+m.ID, nil, "", csrf, revision, 409)
	exec("DELETE FROM document_draft_assets WHERE document_kind='site'")
	exec("INSERT INTO snapshots(id,source_revision,projection_version,public_json,content_sha256,created_at) VALUES('s',1,1,'{}',?,1)", strings.Repeat("a", 64))
	exec("INSERT INTO snapshot_assets(snapshot_id,asset_id,public_path) VALUES('s',?,'images/screen.png')", m.ID)
	exec("UPDATE snapshots SET sealed_at=2 WHERE id='s'")
	mediaRequest(t, f, client, "DELETE", "/media/"+m.ID, nil, "", csrf, revision, 409)
	response, _ = mediaRequest(t, f, client, "GET", "/media/"+m.ID, nil, "", "", "", 200)
	m, _ = mediaResponse(t, response)
	if m.References.Snapshots != 1 || m.DeletedAt != nil {
		t.Fatal("snapshot reference protection not reflected in metadata")
	}
	var key string
	if err := f.db.QueryRow("SELECT storage_key FROM assets WHERE id=?", m.ID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(f.app.config.UploadDir, filepath.FromSlash(key))
	if err := os.WriteFile(path, bytes.Repeat([]byte{'x'}, int(m.ByteSize)), 0600); err != nil {
		t.Fatal(err)
	}
	mediaRequest(t, f, client, "GET", "/media/"+m.ID+"/content", nil, "", "", "", 500)
	mediaRequest(t, f, client, "PATCH", "/media/"+m.ID, strings.NewReader(`{"publicUseConfirmed":true}`), "application/json", csrf, revision, 500)
	mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), contentType, csrf, revision, 500)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	mediaRequest(t, f, client, "GET", "/media/"+m.ID+"/content", nil, "", "", "", 500)
	var current int
	if err := f.db.QueryRow("SELECT revision FROM workspace WHERE id=1").Scan(&current); err != nil || current != 1 {
		t.Fatalf("rejected requests changed revision: %d %v", current, err)
	}
}

func TestMediaHTTPSConcurrentDecoderCapacityRecovers(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(fmt.Sprintf("workspace_changes_%t", changed), func(t *testing.T) { testMediaConcurrentUpload(t, changed) })
	}
}

func testMediaConcurrentUpload(t *testing.T, changed bool) {
	f, client, csrf := mediaHTTPFixture(t)
	read, write := io.Pipe()
	defer read.Close()
	defer write.Close()
	multi := multipart.NewWriter(write)
	req, err := http.NewRequest("POST", f.server.URL+apiPrefix+"/media", read)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", multi.FormDataContentType())
	req.Header.Set("Origin", f.server.URL)
	req.Header.Set("X-CSRF-Token", csrf)
	req.Header.Set("If-Match", `"ws-0"`)
	type outcome struct {
		res *http.Response
		err error
	}
	result := make(chan outcome, 1)
	go func() { res, err := client.Do(req); result <- outcome{res, err} }()
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="screen.png"`)
	header.Set("Content-Type", "image/png")
	part, err := multi.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for len(f.app.uploadSlot) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if len(f.app.uploadSlot) != 1 {
		t.Fatal("first upload did not acquire the decoder gate")
	}
	body, ct := mediaMultipart(t, "screen.png", "image/png", mediaTestPNG(t), false)
	_, headers := mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), ct, csrf, `"ws-0"`, 429)
	if headers.Get("Retry-After") == "" {
		t.Fatal("busy decoder must tell client when to retry")
	}
	if changed {
		mediaRequest(t, f, client, "POST", "/categories", strings.NewReader(`{"slug":"new-category","name":"New category"}`), "application/json", csrf, `"ws-0"`, 201)
	}
	if _, err := part.Write(mediaTestPNG(t)); err != nil {
		t.Fatal(err)
	}
	if err := multi.Close(); err != nil {
		t.Fatal(err)
	}
	write.Close()
	select {
	case outcome := <-result:
		if outcome.err != nil {
			t.Fatal(outcome.err)
		}
		b, err := io.ReadAll(outcome.res.Body)
		outcome.res.Body.Close()
		expected := 201
		if changed {
			expected = 409
		}
		if err != nil || outcome.res.StatusCode != expected {
			t.Fatalf("first upload failed: status=%d body=%s err=%v", outcome.res.StatusCode, b, err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("first upload did not complete")
	}
	if len(f.app.uploadSlot) != 0 {
		t.Fatal("decoder gate leaked after upload")
	}
	if changed {
		var count int
		if err := f.db.QueryRow("SELECT count(*) FROM assets WHERE storage_kind='upload'").Scan(&count); err != nil || count != 0 {
			t.Fatalf("conflicted upload was registered: count=%d err=%v", count, err)
		}
		entries, err := os.ReadDir(filepath.Join(f.app.config.UploadDir, "derived"))
		if err != nil || len(entries) != 1 {
			t.Fatalf("uncommitted blob must be conservatively retained: count=%d err=%v", len(entries), err)
		}
	}
	mediaRequest(t, f, client, "POST", "/media", bytes.NewReader(body), ct, csrf, `"ws-1"`, 201)
}

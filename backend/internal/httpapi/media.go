package httpapi

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/mediautils"
)

type mediaReferences struct {
	Projects  int `json:"projects"`
	Documents int `json:"documents"`
	Snapshots int `json:"snapshots"`
}

type mediaRecord struct {
	ID                     string          `json:"id"`
	SHA256                 string          `json:"sha256"`
	MediaType              string          `json:"mediaType"`
	ByteSize               int64           `json:"byteSize"`
	Width                  int             `json:"width"`
	Height                 int             `json:"height"`
	Alt                    string          `json:"alt"`
	DisplayName            string          `json:"displayName"`
	PublicUseConfirmed     bool            `json:"publicUseConfirmed"`
	PublicConfirmationNote string          `json:"publicConfirmationNote"`
	PublicConfirmedAt      *string         `json:"publicConfirmedAt"`
	CreatedAt              string          `json:"createdAt"`
	UpdatedAt              string          `json:"updatedAt"`
	DeletedAt              *string         `json:"deletedAt"`
	ContentURL             string          `json:"contentUrl"`
	References             mediaReferences `json:"references"`
	storageKey             string
}

const mediaSelect = `SELECT a.id,a.sha256,a.media_type,a.byte_size,a.width,a.height,
	m.alt,m.display_name,m.public_use_confirmed,m.public_confirmation_note,
	m.public_confirmed_at,m.created_at,m.updated_at,m.deleted_at,a.storage_key,
	(SELECT count(*) FROM project_draft_assets WHERE asset_id=a.id),
	(SELECT count(*) FROM document_draft_assets WHERE asset_id=a.id),
	(SELECT count(*) FROM snapshot_assets WHERE asset_id=a.id)
	FROM assets a JOIN asset_metadata m ON m.asset_id=a.id WHERE a.storage_kind='upload'`

type mediaScanner interface{ Scan(...any) error }
type mediaQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func scanMedia(row mediaScanner) (mediaRecord, error) {
	var m mediaRecord
	var confirmed int
	var created, updated int64
	var deleted, confirmedAt sql.NullInt64
	err := row.Scan(&m.ID, &m.SHA256, &m.MediaType, &m.ByteSize, &m.Width, &m.Height,
		&m.Alt, &m.DisplayName, &confirmed, &m.PublicConfirmationNote, &confirmedAt,
		&created, &updated, &deleted, &m.storageKey, &m.References.Projects, &m.References.Documents, &m.References.Snapshots)
	if err != nil {
		return m, err
	}
	m.PublicUseConfirmed = confirmed == 1
	m.CreatedAt, m.UpdatedAt = mediaTime(created), mediaTime(updated)
	if deleted.Valid {
		v := mediaTime(deleted.Int64)
		m.DeletedAt = &v
	}
	if confirmedAt.Valid {
		v := mediaTime(confirmedAt.Int64)
		m.PublicConfirmedAt = &v
	}
	if !deleted.Valid {
		m.ContentURL = apiPrefix + "/media/" + m.ID + "/content"
	}
	return m, nil
}

func mediaTime(value int64) string { return time.Unix(value, 0).UTC().Format(time.RFC3339) }

func getMedia(ctx context.Context, q mediaQuerier, id string) (mediaRecord, error) {
	if !validMediaID(id) {
		return mediaRecord{}, problem(http.StatusNotFound, "NOT_FOUND", "素材不存在。")
	}
	m, err := scanMedia(q.QueryRowContext(ctx, mediaSelect+" AND a.id=?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return m, problem(http.StatusNotFound, "NOT_FOUND", "素材不存在。")
	}
	return m, err
}

func validMediaID(id string) bool {
	if len(id) < 1 || len(id) > 80 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func (a *App) registerMedia(mux *http.ServeMux) {
	register := func(pattern string, handler http.HandlerFunc, allowed ...string) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if err := queryOnly(r, allowed...); err != nil {
				writeError(w, r, err)
				return
			}
			handler(w, r)
		})
	}
	register("GET "+apiPrefix+"/media", a.listMedia, "limit", "cursor", "status")
	register("POST "+apiPrefix+"/media", a.uploadMedia)
	register("GET "+apiPrefix+"/media/{id}", a.readMedia)
	register("PATCH "+apiPrefix+"/media/{id}", a.patchMedia)
	register("DELETE "+apiPrefix+"/media/{id}", a.deleteMedia)
	register("GET "+apiPrefix+"/media/{id}/content", a.mediaContent)
}

func (a *App) listMedia(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit := 20
	if raw := query.Get("limit"); raw != "" {
		var err error
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			writeError(w, r, problem(400, "INVALID_REQUEST", "分页数量应为1至100。"))
			return
		}
	}
	after := ""
	if raw := query.Get("cursor"); raw != "" {
		if len(raw) > 128 {
			writeError(w, r, problem(400, "INVALID_REQUEST", "分页游标无效。"))
			return
		}
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		if err != nil || !validMediaID(string(decoded)) {
			writeError(w, r, problem(400, "INVALID_REQUEST", "分页游标无效。"))
			return
		}
		after = string(decoded)
	}
	filter := " AND m.deleted_at IS NULL"
	switch query.Get("status") {
	case "", "active":
	case "deleted":
		filter = " AND m.deleted_at IS NOT NULL"
	case "all":
		filter = ""
	default:
		writeError(w, r, problem(400, "INVALID_REQUEST", "素材状态筛选无效。"))
		return
	}
	rows, err := a.db.QueryContext(r.Context(), mediaSelect+filter+" AND a.id>? ORDER BY a.id LIMIT ?", after, limit+1)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer rows.Close()
	items := make([]mediaRecord, 0, limit)
	for rows.Next() {
		m, err := scanMedia(rows)
		if err != nil {
			writeError(w, r, err)
			return
		}
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		writeError(w, r, err)
		return
	}
	next := ""
	if len(items) > limit {
		items = items[:limit]
		next = base64.RawURLEncoding.EncodeToString([]byte(items[len(items)-1].ID))
	}
	writeData(w, r, http.StatusOK, map[string]any{"items": items, "nextCursor": next})
}

func (a *App) readMedia(w http.ResponseWriter, r *http.Request) {
	m, err := getMedia(r.Context(), a.db, r.PathValue("id"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeData(w, r, 200, map[string]any{"media": m})
}

func (a *App) mediaRoot() (*os.Root, error) {
	if strings.TrimSpace(a.config.UploadDir) == "" {
		return nil, errors.New("private upload storage not configured")
	}
	if err := os.MkdirAll(a.config.UploadDir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(a.config.UploadDir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("invalid private upload storage")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("private upload storage permissions too broad")
	}
	root, err := os.OpenRoot(a.config.UploadDir)
	if err != nil {
		return nil, err
	}
	for _, dir := range []string{"tmp", "derived"} {
		if err := root.MkdirAll(dir, 0700); err != nil {
			root.Close()
			return nil, err
		}
		info, err := root.Lstat(dir)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			root.Close()
			return nil, errors.New("invalid media storage directory")
		}
	}
	return root, nil
}

func (a *App) uploadMedia(w http.ResponseWriter, r *http.Request) {
	expected, err := expectedRevision(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var current int64
	if err := a.db.QueryRowContext(r.Context(), "SELECT revision FROM workspace WHERE id=1").Scan(&current); err != nil {
		writeError(w, r, err)
		return
	}
	if current != expected {
		writeError(w, r, &apiError{Status: 409, Code: "REVISION_CONFLICT", Message: "内容已被其他操作更新，请刷新后重试。", CurrentRevision: revisionLabel(current)})
		return
	}
	select {
	case a.uploadSlot <- struct{}{}:
		defer func() { <-a.uploadSlot }()
	default:
		w.Header().Set("Retry-After", "2")
		writeError(w, r, problem(429, "UPLOAD_CAPACITY", "图片正在处理中，请稍后重试。"))
		return
	}
	outer, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || outer != "multipart/form-data" || len(r.Header.Values("Content-Type")) != 1 {
		writeError(w, r, problem(415, "UNSUPPORTED_MEDIA_TYPE", "请使用单文件multipart上传。"))
		return
	}
	if r.ContentLength > mediautils.MaxMultipartBytes {
		writeError(w, r, problem(413, "BODY_TOO_LARGE", "上传请求不得超过11MiB。"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, mediautils.MaxMultipartBytes)
	multipart, err := r.MultipartReader()
	if err != nil {
		writeError(w, r, problem(400, "INVALID_REQUEST", "上传请求格式无效。"))
		return
	}
	root, err := a.mediaRoot()
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer root.Close()
	tempName := "tmp/" + newID("upload")
	file, err := root.OpenFile(tempName, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer func() { file.Close(); root.Remove(tempName) }()
	part, err := multipart.NextPart()
	if err != nil {
		writeError(w, r, mediaBodyError(err))
		return
	}
	dispositionType, disposition, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
	if err != nil || dispositionType != "form-data" || disposition["name"] != "file" || disposition["filename"] == "" || len(part.Header.Values("Content-Type")) != 1 || len(part.Header.Values("Content-Disposition")) != 1 || part.Header.Get("Content-Transfer-Encoding") != "" {
		writeError(w, r, problem(400, "INVALID_REQUEST", "上传仅接受名为file的单文件。"))
		return
	}
	filename := disposition["filename"]
	n, err := io.Copy(file, io.LimitReader(part, mediautils.MaxOriginalBytes+1))
	if err != nil {
		writeError(w, r, mediaBodyError(err))
		return
	}
	if n > mediautils.MaxOriginalBytes {
		writeError(w, r, problem(413, "IMAGE_TOO_LARGE", "原图不得超过10MiB。"))
		return
	}
	if _, err := multipart.NextPart(); err != io.EOF {
		if err != nil {
			writeError(w, r, mediaBodyError(err))
		} else {
			writeError(w, r, problem(400, "INVALID_REQUEST", "每次只能上传一个文件，不能附加其他字段。"))
		}
		return
	}
	if _, err := io.Copy(io.Discard, r.Body); err != nil {
		writeError(w, r, mediaBodyError(err))
		return
	}
	image, err := mediautils.Sanitize(file, filename, part.Header.Get("Content-Type"))
	if err != nil {
		writeError(w, r, mediaImageError(err))
		return
	}
	if err := r.Context().Err(); err != nil {
		writeError(w, r, err)
		return
	}
	storageKey, err := storeMediaBlob(root, image)
	if err != nil {
		writeError(w, r, err)
		return
	}
	a.mutate(w, r, http.StatusCreated, "media.upload", func(tx *sql.Tx, nextRevision int64) (map[string]any, error) {
		var id string
		err := tx.QueryRowContext(r.Context(), "SELECT id FROM assets WHERE storage_key=?", storageKey).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			id = newID("med")
			now := a.now().Unix()
			if _, err := tx.ExecContext(r.Context(), "INSERT INTO assets(id,storage_kind,storage_key,sha256,media_type,byte_size,width,height,created_at) VALUES(?,'upload',?,?,?,?,?,?,?)", id, storageKey, image.SHA256, image.MediaType, len(image.Bytes), image.Width, image.Height, now); err != nil {
				return nil, err
			}
			display := []rune(filename)
			if len(display) > 160 {
				display = display[:160]
			}
			if _, err := tx.ExecContext(r.Context(), "INSERT INTO asset_metadata(asset_id,display_name,created_at,updated_at) VALUES(?,?,?,?)", id, string(display), now, now); err != nil {
				return nil, err
			}
		} else if err != nil {
			return nil, err
		}
		m, err := getMedia(r.Context(), tx, id)
		if err != nil {
			return nil, err
		}
		if m.DeletedAt != nil {
			return nil, problem(409, "MEDIA_DELETED", "相同内容的素材已软删除；请先核对素材保留记录。")
		}
		if m.SHA256 != image.SHA256 || m.MediaType != image.MediaType || m.ByteSize != int64(len(image.Bytes)) || m.Width != image.Width || m.Height != image.Height {
			return nil, errors.New("media storage metadata mismatch")
		}
		return map[string]any{"media": m}, nil
	})
}

func mediaBodyError(err error) error {
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) {
		return problem(413, "BODY_TOO_LARGE", "上传请求不得超过11MiB。")
	}
	return problem(400, "INVALID_REQUEST", "上传内容不完整或格式无效。")
}

func mediaImageError(err error) error {
	switch {
	case errors.Is(err, mediautils.ErrUnsupported):
		return problem(415, "UNSUPPORTED_MEDIA_TYPE", "仅接受扩展名、MIME与真实格式一致的静态PNG、JPEG、WebP。")
	case errors.Is(err, mediautils.ErrTooLarge):
		return problem(413, "IMAGE_TOO_LARGE", "图片尺寸、像素或派生文件超出处理上限。")
	default:
		return problem(422, "VALIDATION_FAILED", "图片无法安全解码。")
	}
}

func storeMediaBlob(root *os.Root, image mediautils.Image) (string, error) {
	key := "derived/" + image.SHA256 + image.Extension
	digest := sha256.Sum256(image.Bytes)
	if !validMediaStorageKey(key) || len(image.Bytes) < 1 || len(image.Bytes) > mediautils.MaxDerivedBytes || hex.EncodeToString(digest[:]) != image.SHA256 {
		return "", errors.New("invalid sanitized media output")
	}
	name := "tmp/" + newID("derived")
	f, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	defer func() { f.Close(); root.Remove(name) }()
	if _, err = f.Write(image.Bytes); err != nil {
		return "", err
	}
	if err = f.Sync(); err != nil {
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	// Same-filesystem hard-link creation is atomic and never replaces an existing
	// hash path. The private temporary name is then removed; no published file is linked.
	if err = root.Link(name, key); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return "", err
		}
		if err := verifyMediaBlob(root, key, image.SHA256, int64(len(image.Bytes))); err != nil {
			return "", err
		}
	}
	if runtime.GOOS != "windows" {
		dir, err := root.Open("derived")
		if err != nil {
			return "", err
		}
		err = dir.Sync()
		dir.Close()
		if err != nil {
			return "", err
		}
	}
	return key, nil
}

func verifyMediaBlob(root *os.Root, key, hash string, size int64) error {
	f, err := openMediaBlob(root, key, size)
	if err != nil {
		return err
	}
	defer f.Close()
	digest := sha256.New()
	n, err := io.Copy(digest, io.LimitReader(f, mediautils.MaxDerivedBytes+1))
	if err != nil || n != size || hex.EncodeToString(digest.Sum(nil)) != hash {
		return errors.New("media content integrity check failed")
	}
	return nil
}

func openMediaBlob(root *os.Root, key string, size int64) (*os.File, error) {
	if size < 1 || size > mediautils.MaxDerivedBytes || !validMediaStorageKey(key) {
		return nil, errors.New("invalid stored media")
	}
	info, err := root.Lstat(key)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("media content missing or not regular")
	}
	f, err := root.Open(key)
	if err != nil {
		return nil, err
	}
	actual, err := f.Stat()
	if err != nil || !actual.Mode().IsRegular() || actual.Size() != size {
		f.Close()
		return nil, errors.New("media content size mismatch")
	}
	return f, nil
}

func validMediaStorageKey(key string) bool {
	ext := filepath.Ext(key)
	if ext != ".png" && ext != ".jpg" {
		return false
	}
	hash := strings.TrimSuffix(strings.TrimPrefix(key, "derived/"), ext)
	if key != "derived/"+hash+ext || len(hash) != 64 {
		return false
	}
	for _, c := range hash {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func (a *App) mediaContent(w http.ResponseWriter, r *http.Request) {
	m, err := getMedia(r.Context(), a.db, r.PathValue("id"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	if m.DeletedAt != nil {
		writeError(w, r, problem(404, "NOT_FOUND", "素材不存在。"))
		return
	}
	root, err := a.mediaRoot()
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer root.Close()
	f, err := openMediaBlob(root, m.storageKey, m.ByteSize)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer f.Close()
	digest := sha256.New()
	n, err := io.Copy(digest, io.LimitReader(f, mediautils.MaxDerivedBytes+1))
	if err != nil || n != m.ByteSize || hex.EncodeToString(digest.Sum(nil)) != m.SHA256 {
		writeError(w, r, errors.New("media content integrity check failed"))
		return
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", m.MediaType)
	w.Header().Set("Content-Disposition", "inline; filename=\""+m.SHA256+filepath.Ext(m.storageKey)+"\"")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", time.Time{}, f)
}

type mediaPatch struct {
	Alt                    *string `json:"alt"`
	DisplayName            *string `json:"displayName"`
	PublicUseConfirmed     *bool   `json:"publicUseConfirmed"`
	PublicConfirmationNote *string `json:"publicConfirmationNote"`
}

func (patch *mediaPatch) UnmarshalJSON(value []byte) error {
	type fields mediaPatch
	var decoded fields
	if err := json.Unmarshal(value, &decoded); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(value, &raw); err != nil {
		return err
	}
	for name, value := range raw {
		if name != "alt" && name != "displayName" && name != "publicUseConfirmed" && name != "publicConfirmationNote" {
			return errors.New("unknown media field")
		}
		if strings.TrimSpace(string(value)) == "null" {
			return errors.New("media field cannot be null")
		}
	}
	*patch = mediaPatch(decoded)
	return nil
}

func (a *App) patchMedia(w http.ResponseWriter, r *http.Request) {
	var patch mediaPatch
	if err := decodeJSON(r, &patch, 256<<10); err != nil {
		writeError(w, r, err)
		return
	}
	if patch.Alt == nil && patch.DisplayName == nil && patch.PublicUseConfirmed == nil && patch.PublicConfirmationNote == nil {
		writeError(w, r, problem(422, "VALIDATION_FAILED", "请提供需要修改的素材信息。"))
		return
	}
	for _, field := range []struct {
		value     *string
		max       int
		multiline bool
	}{{patch.Alt, 500, false}, {patch.DisplayName, 160, false}, {patch.PublicConfirmationNote, 2000, true}} {
		if field.value != nil && !validMediaText(*field.value, field.max, field.multiline) {
			writeError(w, r, problem(422, "VALIDATION_FAILED", "素材文本长度或格式无效。"))
			return
		}
	}
	a.mutate(w, r, 200, "media.update", func(tx *sql.Tx, nextRevision int64) (map[string]any, error) {
		m, err := getMedia(r.Context(), tx, r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		if m.DeletedAt != nil {
			return nil, problem(404, "NOT_FOUND", "素材不存在。")
		}
		if patch.PublicUseConfirmed != nil && *patch.PublicUseConfirmed {
			root, err := a.mediaRoot()
			if err != nil {
				return nil, err
			}
			err = verifyMediaBlob(root, m.storageKey, m.SHA256, m.ByteSize)
			root.Close()
			if err != nil {
				return nil, err
			}
		}
		var confirmedAt, confirmedBy any
		if err := tx.QueryRowContext(r.Context(), "SELECT public_confirmed_at,public_confirmed_by FROM asset_metadata WHERE asset_id=?", m.ID).Scan(&confirmedAt, &confirmedBy); err != nil {
			return nil, err
		}
		if patch.Alt != nil {
			m.Alt = *patch.Alt
		}
		if patch.DisplayName != nil {
			m.DisplayName = *patch.DisplayName
		}
		if patch.PublicConfirmationNote != nil {
			m.PublicConfirmationNote = *patch.PublicConfirmationNote
		}
		now := a.now().Unix()
		if patch.PublicUseConfirmed != nil {
			m.PublicUseConfirmed = *patch.PublicUseConfirmed
			if m.PublicUseConfirmed {
				confirmedAt, confirmedBy = now, principal(r).ID
			} else {
				confirmedAt, confirmedBy = nil, nil
			}
		}
		if _, err := tx.ExecContext(r.Context(), "UPDATE asset_metadata SET alt=?,display_name=?,public_use_confirmed=?,public_confirmed_at=?,public_confirmed_by=?,public_confirmation_note=?,updated_at=? WHERE asset_id=?", m.Alt, m.DisplayName, m.PublicUseConfirmed, confirmedAt, confirmedBy, m.PublicConfirmationNote, now, m.ID); err != nil {
			return nil, err
		}
		m, err = getMedia(r.Context(), tx, m.ID)
		return map[string]any{"media": m}, err
	})
}

func validMediaText(value string, max int, multiline bool) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > max || strings.ContainsAny(value, "<>") {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\t')) {
			return false
		}
	}
	return true
}

func (a *App) deleteMedia(w http.ResponseWriter, r *http.Request) {
	a.mutate(w, r, 200, "media.delete", func(tx *sql.Tx, nextRevision int64) (map[string]any, error) {
		m, err := getMedia(r.Context(), tx, r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		if m.DeletedAt != nil {
			return nil, problem(404, "NOT_FOUND", "素材不存在。")
		}
		if m.References.Projects+m.References.Documents+m.References.Snapshots > 0 {
			return nil, problem(409, "MEDIA_REFERENCED", "素材仍被草稿或保留快照引用，不能删除。")
		}
		now := a.now().Unix()
		if _, err := tx.ExecContext(r.Context(), "UPDATE asset_metadata SET deleted_at=?,updated_at=? WHERE asset_id=?", now, now, m.ID); err != nil {
			return nil, err
		}
		m, err = getMedia(r.Context(), tx, m.ID)
		return map[string]any{"media": m}, err
	})
}

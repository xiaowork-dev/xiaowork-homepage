package httpapi

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

type requestStateKey struct{}
type requestState struct {
	ID      string
	Payload []byte
}
type apiError struct {
	Status          int
	Code            string
	Message         string
	CurrentRevision string
}

func (e *apiError) Error() string { return e.Code }
func problem(status int, code, msg string) error {
	return &apiError{Status: status, Code: code, Message: msg}
}
func requestID(r *http.Request) string {
	if s, ok := r.Context().Value(requestStateKey{}).(*requestState); ok {
		return s.ID
	}
	return ""
}
func newID(prefix string) string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic("secure randomness unavailable")
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}
func writeData(w http.ResponseWriter, r *http.Request, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data, "requestId": requestID(r)})
}
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	e := &apiError{Status: 500, Code: "INTERNAL_ERROR", Message: "请求处理失败。"}
	var known *apiError
	if errors.As(err, &known) {
		e = known
	} else {
		var public interface {
			HTTPStatus() int
			ErrorCode() string
			PublicMessage() string
		}
		if errors.As(err, &public) {
			e.Status = public.HTTPStatus()
			e.Code = public.ErrorCode()
			e.Message = public.PublicMessage()
			if rev, ok := err.(interface{ CurrentWorkspaceRevision() string }); ok {
				e.CurrentRevision = rev.CurrentWorkspaceRevision()
			}
		} else {
			var se interface{ Code() int }
			if errors.As(err, &se) && se.Code()&255 == 19 {
				e.Status = 409
				e.Code = "RECORD_CONFLICT"
				e.Message = "数据存在冲突或仍被引用。"
			}
		}
	}
	if e.Status >= 500 {
		log.Printf("request error id=%s code=%s", requestID(r), e.Code)
	}
	body := map[string]any{"code": e.Code, "message": e.Message, "fields": []any{}}
	if e.CurrentRevision != "" {
		body["currentRevision"] = e.CurrentRevision
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": body, "requestId": requestID(r)})
}
func decodeJSON(r *http.Request, target any, max int64) error {
	mt, p, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if e != nil || mt != "application/json" || (p["charset"] != "" && !strings.EqualFold(p["charset"], "utf-8")) {
		return problem(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 UTF-8 JSON。")
	}
	b, e := io.ReadAll(io.LimitReader(r.Body, max+1))
	if e != nil {
		return problem(400, "INVALID_REQUEST", "无法读取请求。")
	}
	if int64(len(b)) > max {
		return problem(413, "BODY_TOO_LARGE", "请求超过大小限制。")
	}
	trim := bytes.TrimSpace(b)
	if !utf8.Valid(b) || len(trim) == 0 || trim[0] != '{' {
		return problem(400, "INVALID_REQUEST", "请求必须是有效 JSON 对象。")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if e = checkJSONValue(d, 0); e != nil {
		return problem(400, "INVALID_REQUEST", "JSON 含重复字段、非法值或嵌套过深。")
	}
	if _, e = d.Token(); e != io.EOF {
		return problem(400, "INVALID_REQUEST", "JSON 含多余内容。")
	}
	var shape any
	d = json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if e = d.Decode(&shape); e != nil || !exactJSONShape(shape, reflect.TypeOf(target)) {
		return problem(400, "INVALID_REQUEST", "JSON 字段名称或结构不符合契约。")
	}
	d = json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e = d.Decode(target); e != nil {
		return problem(400, "INVALID_REQUEST", "JSON 含未知字段或字段类型错误。")
	}
	if s, ok := r.Context().Value(requestStateKey{}).(*requestState); ok {
		s.Payload = append([]byte(nil), b...)
	}
	return nil
}

// encoding/json accepts field names case-insensitively. The API contract does
// not: aliases such as Name/name must never silently overwrite one another.
func exactJSONShape(value any, t reflect.Type) bool {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if value == nil {
		return true
	}
	switch t.Kind() {
	case reflect.Struct:
		object, ok := value.(map[string]any)
		if !ok {
			return false
		}
		fields := map[string]reflect.Type{}
		var collect func(reflect.Type)
		collect = func(s reflect.Type) {
			for i := 0; i < s.NumField(); i++ {
				f := s.Field(i)
				if f.PkgPath != "" {
					continue
				}
				if f.Anonymous && f.Type.Kind() == reflect.Struct {
					collect(f.Type)
					continue
				}
				tag := strings.Split(f.Tag.Get("json"), ",")[0]
				if tag == "-" {
					continue
				}
				if tag == "" {
					tag = f.Name
				}
				fields[tag] = f.Type
			}
		}
		collect(t)
		for key, child := range object {
			ft, exists := fields[key]
			if !exists || !exactJSONShape(child, ft) {
				return false
			}
		}
	case reflect.Slice, reflect.Array:
		array, ok := value.([]any)
		if !ok {
			return false
		}
		for _, child := range array {
			if !exactJSONShape(child, t.Elem()) {
				return false
			}
		}
	case reflect.Map:
		object, ok := value.(map[string]any)
		if !ok {
			return false
		}
		for _, child := range object {
			if !exactJSONShape(child, t.Elem()) {
				return false
			}
		}
	}
	return true
}
func checkJSONValue(d *json.Decoder, depth int) error {
	if depth > 32 {
		return errors.New("depth")
	}
	t, e := d.Token()
	if e != nil {
		return e
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			key, e := d.Token()
			if e != nil {
				return e
			}
			s, ok := key.(string)
			if !ok || seen[s] {
				return errors.New("duplicate")
			}
			seen[s] = true
			if e = checkJSONValue(d, depth+1); e != nil {
				return e
			}
		}
	case '[':
		for d.More() {
			if e = checkJSONValue(d, depth+1); e != nil {
				return e
			}
		}
	default:
		return errors.New("delimiter")
	}
	end, e := d.Token()
	if e != nil {
		return e
	}
	if (delim == '{' && end != json.Delim('}')) || (delim == '[' && end != json.Delim(']')) {
		return errors.New("delimiter")
	}
	return nil
}

var revisionPattern = regexp.MustCompile(`^"ws-(0|[1-9][0-9]{0,15})"$`)
var idempotencyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

func expectedRevision(r *http.Request) (int64, error) {
	v := r.Header.Values("If-Match")
	if len(v) == 0 {
		return 0, problem(428, "REVISION_REQUIRED", "请提供工作区版本。")
	}
	if len(v) != 1 {
		return 0, problem(400, "INVALID_REQUEST", "工作区版本格式错误。")
	}
	m := revisionPattern.FindStringSubmatch(v[0])
	if m == nil {
		return 0, problem(400, "INVALID_REQUEST", "工作区版本格式错误。")
	}
	return strconv.ParseInt(m[1], 10, 64)
}
func revisionLabel(v int64) string { return fmt.Sprintf("ws-%d", v) }

// Callbacks must use tx rather than a.db, so checking, writes and history commit together.
func (a *App) mutate(w http.ResponseWriter, r *http.Request, status int, action string, fn func(*sql.Tx, int64) (map[string]any, error)) {
	expected, err := expectedRevision(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	p := principal(r)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer tx.Rollback()
	if err = requireActiveSessionTx(r.Context(), tx, p, a.now().UTC().Unix()); err != nil {
		writeError(w, r, err)
		return
	}
	var key, requestHash string
	if r.Method == "POST" && r.URL.Path == apiPrefix+"/projects" {
		key = r.Header.Get("Idempotency-Key")
		if len(r.Header.Values("Idempotency-Key")) != 1 || !idempotencyPattern.MatchString(key) {
			writeError(w, r, problem(400, "INVALID_REQUEST", "请提供合法 Idempotency-Key。"))
			return
		}
		state, _ := r.Context().Value(requestStateKey{}).(*requestState)
		if state == nil || len(state.Payload) == 0 {
			writeError(w, r, problem(400, "INVALID_REQUEST", "缺少项目内容。"))
			return
		}
		var value any
		d := json.NewDecoder(bytes.NewReader(state.Payload))
		d.UseNumber()
		if err = d.Decode(&value); err != nil {
			writeError(w, r, err)
			return
		}
		b, _ := json.Marshal(value)
		requestHash = fmt.Sprintf("%x", sha256.Sum256(b))
		var h, result string
		var previousStatus int
		if _, err = tx.ExecContext(r.Context(), "DELETE FROM idempotency_records WHERE expires_at<=?", a.now().UTC().Unix()); err != nil {
			writeError(w, r, err)
			return
		}
		err = tx.QueryRowContext(r.Context(), "SELECT request_sha256,response_json,response_status FROM idempotency_records WHERE administrator_id=? AND endpoint=? AND idempotency_key=?", p.ID, r.URL.Path, key).Scan(&h, &result, &previousStatus)
		if err == nil {
			if h != requestHash {
				writeError(w, r, problem(409, "IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求。"))
				return
			}
			var data map[string]any
			if err = json.Unmarshal([]byte(result), &data); err != nil {
				writeError(w, r, err)
				return
			}
			_ = tx.Rollback()
			if rev, ok := data["revision"].(string); ok {
				w.Header().Set("ETag", strconv.Quote(rev))
			}
			if project, ok := data["project"].(map[string]any); ok {
				if id, ok := project["id"].(string); ok {
					w.Header().Set("Location", apiPrefix+"/projects/"+id)
				}
			}
			writeData(w, r, previousStatus, data)
			return
		}
		if !errors.Is(err, sql.ErrNoRows) {
			writeError(w, r, err)
			return
		}
	}
	var current int64
	if err = tx.QueryRowContext(r.Context(), "SELECT revision FROM workspace WHERE id=1").Scan(&current); err != nil {
		writeError(w, r, problem(503, "SETUP_REQUIRED", "请先初始化工作区。"))
		return
	}
	if expected != current {
		writeError(w, r, &apiError{Status: 409, Code: "REVISION_CONFLICT", Message: "内容已被其他操作更新，请刷新后重试。", CurrentRevision: revisionLabel(current)})
		return
	}
	if current >= 9999999999999999 {
		writeError(w, r, problem(409, "REVISION_LIMIT", "工作区版本达到限制。"))
		return
	}
	data, err := fn(tx, current+1)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if data == nil {
		data = map[string]any{}
	}
	data["revision"] = revisionLabel(current + 1)
	change, err := json.Marshal(data)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if key != "" && utf8.RuneCount(change) > 65536 {
		writeError(w, r, problem(422, "VALIDATION_FAILED", "项目编码后的总内容超过 65536 字符。"))
		return
	}
	now := a.now().UTC().Unix()
	if _, err = tx.ExecContext(r.Context(), "UPDATE workspace SET revision=?,updated_at=? WHERE id=1 AND revision=?", current+1, now, current); err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO workspace_changes(revision,actor_administrator_id,action,changed_at,change_json) VALUES(?,?,?,?,?)", current+1, p.ID, action, now, string(change))
	}
	if err == nil {
		meta, _ := json.Marshal(map[string]any{"revision": revisionLabel(current + 1), "changeSha256": fmt.Sprintf("%x", sha256.Sum256(change))})
		_, err = tx.ExecContext(r.Context(), "INSERT INTO audit_events(actor_administrator_id,request_id,action,resource_type,resource_id,outcome,metadata_json,created_at) VALUES(?,?,?,?,?,'success',?,?)", p.ID, requestID(r), action, "workspace", "1", string(meta), now)
	}
	if err == nil && key != "" {
		var result struct {
			Project struct {
				ID string `json:"id"`
			} `json:"project"`
		}
		if err = json.Unmarshal(change, &result); err == nil && result.Project.ID == "" {
			err = errors.New("missing project identity")
		}
		if err == nil {
			_, err = tx.ExecContext(r.Context(), "INSERT INTO idempotency_records(administrator_id,endpoint,idempotency_key,request_sha256,resource_type,resource_id,response_status,response_json,created_at,expires_at) VALUES(?,?,?,?,'project',?,?,?,?,?)", p.ID, r.URL.Path, key, requestHash, result.Project.ID, status, string(change), now, now+86400)
		}
	}
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", strconv.Quote(revisionLabel(current+1)))
	writeData(w, r, status, data)
}

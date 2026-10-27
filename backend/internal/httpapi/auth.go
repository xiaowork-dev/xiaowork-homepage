package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/authn"
)

const sessionCookieName = "__Host-xiaowork-admin"
const challengeCookieName = "__Host-xiaowork-login"

type Principal struct {
	ID            int64
	SessionHash   string
	CSRF          string
	Username      string
	ExpiresAt     int64
	ReauthUntil   int64
	IdleExpiresAt int64
}

type principalKey struct{}

func principal(r *http.Request) Principal {
	p, _ := r.Context().Value(principalKey{}).(Principal)
	return p
}

// requireActiveSessionTx closes the gap between request authentication and a
// content mutation. Call it in the same transaction that writes the draft.
func requireActiveSessionTx(ctx context.Context, tx *sql.Tx, p Principal, now int64) error {
	var count int
	err := tx.QueryRowContext(ctx, `SELECT count(*) FROM sessions s JOIN administrators a ON a.id=s.administrator_id WHERE s.token_hash=? AND s.administrator_id=? AND s.revoked_at IS NULL AND s.credential_version=a.credential_version AND s.expires_at>? AND s.last_interactive_at>?`, p.SessionHash, p.ID, now, now-1800).Scan(&count)
	if err != nil {
		return err
	}
	if count != 1 {
		return problem(401, "AUTH_REQUIRED", "请重新登录。")
	}
	return nil
}

func (a *App) registerAuth(mux *http.ServeMux) {
	register := func(pattern string, handler http.HandlerFunc) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.RawQuery != "" {
				writeError(w, r, problem(400, "INVALID_REQUEST", "认证接口不接受查询参数。"))
				return
			}
			if (r.Method == "GET" || r.Method == "HEAD") && r.ContentLength != 0 {
				writeError(w, r, problem(400, "INVALID_REQUEST", "读取接口不接受请求体。"))
				return
			}
			handler(w, r)
		})
	}
	register("GET "+apiPrefix+"/auth/login-challenge", a.loginChallenge)
	register("POST "+apiPrefix+"/auth/login", a.login)
	register("GET "+apiPrefix+"/auth/session", a.session)
	register("POST "+apiPrefix+"/auth/logout", a.logout)
	register("POST "+apiPrefix+"/auth/reauth", a.reauthenticate)
	register("POST "+apiPrefix+"/auth/password", a.changePassword)
}

func writeAuthError(w http.ResponseWriter, r *http.Request, err error) {
	var apiErr *apiError
	if errors.As(err, &apiErr) && apiErr.Status == 429 {
		if apiErr.Code == "AUTH_CAPACITY" {
			w.Header().Set("Retry-After", "2")
		} else {
			w.Header().Set("Retry-After", "900")
		}
	}
	writeError(w, r, err)
}

func hashAuth(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func authToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func validAuthToken(value string) bool {
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	return err == nil && len(decoded) == 32
}

func authCookie(r *http.Request, name string) (string, bool) {
	value := ""
	count := 0
	for _, cookie := range r.Cookies() {
		if cookie.Name == name {
			value = cookie.Value
			count++
		}
	}
	return value, count == 1 && validAuthToken(value)
}

func setAuthCookie(w http.ResponseWriter, name, value string, expiry time.Time, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, Expires: expiry.UTC(), MaxAge: maxAge})
}

func clearAuthCookie(w http.ResponseWriter, name string) {
	setAuthCookie(w, name, "", time.Unix(1, 0), -1)
}

func (a *App) csrfToken(token string) string {
	decoded, _ := base64.RawURLEncoding.Strict().DecodeString(token)
	mac := hmac.New(sha256.New, a.config.Secret)
	mac.Write([]byte("xiaowork-admin-csrf-v1\x00"))
	mac.Write(decoded)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func remoteAddress(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	address, _ := netip.ParseAddr(strings.Trim(host, "[]"))
	return address.Unmap()
}

func (a *App) trustedAddress(address netip.Addr) bool {
	if !address.IsValid() {
		return false
	}
	for _, prefix := range a.config.TrustedProxyCIDRs {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

// secureRequest trusts the forwarding protocol only from explicitly configured
// proxy addresses. Request-supplied Cloudflare headers are never sufficient.
func (a *App) secureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return a.trustedAddress(remoteAddress(r)) && len(r.Header.Values("X-Forwarded-Proto")) == 1 && r.Header.Get("X-Forwarded-Proto") == "https"
}

func (a *App) sourceAddress(r *http.Request) string {
	address := remoteAddress(r)
	if !address.IsValid() {
		return "unparseable-peer"
	}
	if !a.trustedAddress(address) {
		return address.String()
	}
	values := r.Header.Values("X-Forwarded-For")
	if len(values) != 1 || len(values[0]) > 2048 {
		return address.String()
	}
	chain := strings.Split(values[0], ",")
	if len(chain) > 16 {
		return address.String()
	}
	for i := len(chain) - 1; i >= 0; i-- {
		candidate, err := netip.ParseAddr(strings.TrimSpace(chain[i]))
		if err != nil {
			return address.String()
		}
		address = candidate.Unmap()
		if !a.trustedAddress(address) {
			break
		}
	}
	return address.String()
}

func (a *App) authBucket(r *http.Request, suffix string) string {
	mac := hmac.New(sha256.New, a.config.Secret)
	mac.Write([]byte("xiaowork-rate-v1\x00" + a.sourceAddress(r) + "\x00" + suffix))
	return hex.EncodeToString(mac.Sum(nil))
}

func (a *App) originAllowed(r *http.Request, required bool) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	values := r.Header.Values("Origin")
	if len(values) == 0 {
		return !required
	}
	return len(values) == 1 && values[0] == a.config.Origin
}

type authResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *authResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *authResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (w *authResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (a *App) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.secureRequest(r) {
			writeError(w, r, problem(400, "HTTPS_REQUIRED", "管理接口只接受 HTTPS。"))
			return
		}
		write := r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions
		if !a.originAllowed(r, write) {
			writeError(w, r, problem(403, "ORIGIN_REJECTED", "请求来源不被允许。"))
			return
		}
		if (r.Method == http.MethodGet && r.URL.Path == apiPrefix+"/auth/login-challenge") || (r.Method == http.MethodPost && r.URL.Path == apiPrefix+"/auth/login") {
			next.ServeHTTP(w, r)
			return
		}
		token, ok := authCookie(r, sessionCookieName)
		if !ok {
			writeError(w, r, problem(401, "AUTH_REQUIRED", "请重新登录。"))
			return
		}
		p := Principal{SessionHash: hashAuth(token), CSRF: a.csrfToken(token)}
		var storedCSRF string
		var lastInteractive, version, currentVersion int64
		var revoked sql.NullInt64
		var reauth sql.NullInt64
		err := a.db.QueryRowContext(r.Context(), `SELECT s.administrator_id,s.csrf_token_hash,s.expires_at,s.last_interactive_at,s.credential_version,s.revoked_at,s.reauth_until,a.username,a.credential_version FROM sessions s JOIN administrators a ON a.id=s.administrator_id WHERE s.token_hash=?`, p.SessionHash).Scan(&p.ID, &storedCSRF, &p.ExpiresAt, &lastInteractive, &version, &revoked, &reauth, &p.Username, &currentVersion)
		now := a.now().UTC().Unix()
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			writeError(w, r, err)
			return
		}
		if err != nil || revoked.Valid || version != currentVersion || p.ExpiresAt <= now || lastInteractive+1800 <= now || subtle.ConstantTimeCompare([]byte(storedCSRF), []byte(hashAuth(p.CSRF))) != 1 {
			if err == nil && !revoked.Valid {
				_, _ = a.db.ExecContext(r.Context(), "UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL", now, p.SessionHash)
			}
			clearAuthCookie(w, sessionCookieName)
			writeError(w, r, problem(401, "AUTH_REQUIRED", "请重新登录。"))
			return
		}
		if write {
			csrfValues := r.Header.Values("X-CSRF-Token")
			if len(csrfValues) != 1 || !validAuthToken(csrfValues[0]) || subtle.ConstantTimeCompare([]byte(hashAuth(csrfValues[0])), []byte(storedCSRF)) != 1 {
				writeError(w, r, problem(403, "CSRF_REJECTED", "安全令牌无效，请刷新后重试。"))
				return
			}
		}
		p.ReauthUntil = reauth.Int64
		interactive := r.URL.Path != apiPrefix+"/auth/session" && r.URL.Path != apiPrefix+"/dashboard" && r.URL.Path != apiPrefix+"/publishing-status" && r.URL.Path != apiPrefix+"/jobs" && !strings.HasPrefix(r.URL.Path, apiPrefix+"/jobs/")
		p.IdleExpiresAt = min(lastInteractive+1800, p.ExpiresAt)
		response := &authResponseWriter{ResponseWriter: w}
		next.ServeHTTP(response, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
		// Errors, malformed forms and unknown routes cannot extend idle lifetime.
		// A failed best-effort activity write never changes an already committed
		// content result; it only causes the session to expire conservatively.
		if interactive && response.status >= 200 && response.status < 300 && now-lastInteractive >= 30 {
			if _, err := a.db.ExecContext(r.Context(), "UPDATE sessions SET last_seen_at=max(last_seen_at,?),last_interactive_at=max(last_interactive_at,?) WHERE token_hash=? AND revoked_at IS NULL AND credential_version=(SELECT credential_version FROM administrators WHERE id=1)", now, now, p.SessionHash); err != nil {
				log.Printf("session activity update failed request=%s", requestID(r))
			}
		}
	})
}

func (a *App) loginChallenge(w http.ResponseWriter, r *http.Request) {
	now := a.now().UTC().Unix()
	bucket := a.authBucket(r, "challenge")
	nonce, err := authToken()
	if err != nil {
		writeError(w, r, err)
		return
	}
	cookie, err := authToken()
	if err != nil {
		writeError(w, r, err)
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM login_challenges WHERE nonce_hash IN (SELECT nonce_hash FROM login_challenges WHERE expires_at<=? OR consumed_at IS NOT NULL LIMIT 1000)", now); err != nil {
		writeError(w, r, err)
		return
	}
	var total, source int
	if err = tx.QueryRowContext(r.Context(), "SELECT count(*),coalesce(sum(CASE WHEN source_bucket_hash=? THEN 1 ELSE 0 END),0) FROM login_challenges WHERE consumed_at IS NULL AND expires_at>?", bucket, now).Scan(&total, &source); err != nil {
		writeError(w, r, err)
		return
	}
	if source >= 10 || total >= 1000 {
		w.Header().Set("Retry-After", "300")
		writeError(w, r, problem(429, "RATE_LIMITED", "登录请求过多，请稍后重试。"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), "INSERT INTO login_challenges(nonce_hash,cookie_hash,source_bucket_hash,created_at,expires_at) VALUES(?,?,?,?,?)", hashAuth(nonce), hashAuth(cookie), bucket, now, now+300); err != nil {
		writeError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, r, err)
		return
	}
	setAuthCookie(w, challengeCookieName, cookie, time.Unix(now+300, 0), 300)
	writeData(w, r, 200, map[string]any{"loginNonce": nonce, "expiresAt": time.Unix(now+300, 0).UTC().Format(time.RFC3339)})
}

func (a *App) consumeChallenge(r *http.Request) error {
	cookie, ok := authCookie(r, challengeCookieName)
	values := r.Header.Values("X-CSRF-Token")
	if !ok || len(values) != 1 || !validAuthToken(values[0]) {
		return problem(403, "CSRF_REJECTED", "登录安全令牌无效，请重新申请。")
	}
	now := a.now().UTC().Unix()
	result, err := a.db.ExecContext(r.Context(), "UPDATE login_challenges SET consumed_at=? WHERE nonce_hash=? AND cookie_hash=? AND source_bucket_hash=? AND consumed_at IS NULL AND expires_at>?", now, hashAuth(values[0]), hashAuth(cookie), a.authBucket(r, "challenge"), now)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return problem(403, "CSRF_REJECTED", "登录安全令牌无效，请重新申请。")
	}
	return nil
}

// reserveLoginAttempt counts an in-flight check conservatively as a failure.
// A successful check clears the bucket; concurrency cannot race past the cap.
func (a *App) reserveLoginAttempt(r *http.Request, username string) (string, error) {
	bucket := a.authBucket(r, "password:"+strings.ToLower(username))
	now := a.now().UTC().Unix()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM login_rate_limits WHERE bucket_hash IN (SELECT bucket_hash FROM login_rate_limits WHERE expires_at<=? LIMIT 1000)", now); err != nil {
		return "", err
	}
	var started, attempts int64
	err = tx.QueryRowContext(r.Context(), "SELECT window_started_at,attempts FROM login_rate_limits WHERE bucket_hash=?", bucket).Scan(&started, &attempts)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if err == nil && now < started+900 && attempts >= 5 {
		return "", problem(429, "RATE_LIMITED", "登录尝试过多，请在15分钟窗口结束后重试。")
	}
	if err != nil || now >= started+900 {
		started = now
		attempts = 0
	}
	attempts++
	var blocked any
	if attempts >= 5 {
		blocked = started + 900
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO login_rate_limits(bucket_hash,window_started_at,attempts,blocked_until,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(bucket_hash) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=excluded.attempts,blocked_until=excluded.blocked_until,expires_at=excluded.expires_at`, bucket, started, attempts, blocked, started+900); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return bucket, nil
}

func (a *App) acquireAuth(ctx context.Context) (func(), error) {
	select {
	case a.authSlots <- struct{}{}:
		return func() { <-a.authSlots }, nil
	default:
	}
	select {
	case a.authQueue <- struct{}{}:
	default:
		return nil, problem(429, "AUTH_CAPACITY", "密码校验繁忙，请稍后重试。")
	}
	defer func() { <-a.authQueue }()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case a.authSlots <- struct{}{}:
		return func() { <-a.authSlots }, nil
	case <-timer.C:
		return nil, problem(429, "AUTH_CAPACITY", "密码校验繁忙，请稍后重试。")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (a *App) checkPassword(r *http.Request, username string, password []byte) (int64, string, error) {
	bucket, err := a.reserveLoginAttempt(r, username)
	if err != nil {
		var limited *apiError
		if errors.As(err, &limited) && limited.Status == 429 {
			if auditErr := a.authAudit(r, nil, "authentication.rate-limited", "denied"); auditErr != nil {
				return 0, "", auditErr
			}
		}
		return 0, "", err
	}
	release, err := a.acquireAuth(r.Context())
	if err != nil {
		return 0, "", err
	}
	defer release()
	var encoded, actualUsername string
	var version int64
	err = a.db.QueryRowContext(r.Context(), "SELECT username,password_hash,credential_version FROM administrators WHERE id=1 AND username=? COLLATE NOCASE", username).Scan(&actualUsername, &encoded, &version)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, "", err
	}
	valid := false
	if errors.Is(err, sql.ErrNoRows) {
		authn.DummyVerify(password)
	} else {
		valid = authn.VerifyPassword(encoded, password)
	}
	if !valid {
		if err := a.authAudit(r, nil, "authentication.login", "failure"); err != nil {
			return 0, "", err
		}
		return 0, "", problem(401, "INVALID_CREDENTIALS", "用户名或密码错误。")
	}
	if _, err = a.db.ExecContext(r.Context(), "DELETE FROM login_rate_limits WHERE bucket_hash=?", bucket); err != nil {
		return 0, "", err
	}
	return version, actualUsername, nil
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if err := a.consumeChallenge(r); err != nil {
		writeError(w, r, err)
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body, 8<<10); err != nil {
		writeError(w, r, err)
		return
	}
	if !authn.ValidUsername(body.Username) || len(body.Password) > 1024 {
		writeError(w, r, problem(422, "VALIDATION_FAILED", "登录资料格式无效。"))
		return
	}
	version, username, err := a.checkPassword(r, body.Username, []byte(body.Password))
	if err != nil {
		writeAuthError(w, r, err)
		return
	}
	token, err := authToken()
	if err != nil {
		writeError(w, r, err)
		return
	}
	csrf := a.csrfToken(token)
	now := a.now().UTC().Unix()
	expiry := now + 43200
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE expires_at<=? OR last_interactive_at<=? OR revoked_at IS NOT NULL", now, now-1800); err != nil {
		writeError(w, r, err)
		return
	}
	var active int
	if err = tx.QueryRowContext(r.Context(), "SELECT count(*) FROM sessions WHERE administrator_id=1 AND revoked_at IS NULL AND expires_at>?", now).Scan(&active); err != nil {
		writeError(w, r, err)
		return
	}
	if active >= 20 {
		writeError(w, r, problem(429, "SESSION_LIMIT", "有效会话过多，请先退出其他会话。"))
		return
	}
	result, err := tx.ExecContext(r.Context(), `INSERT INTO sessions(token_hash,administrator_id,credential_version,csrf_token_hash,created_at,expires_at,last_seen_at,last_interactive_at,reauth_until) SELECT ?,1,?,?, ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM administrators WHERE id=1 AND credential_version=?)`, hashAuth(token), version, hashAuth(csrf), now, expiry, now, now, now+300, version)
	if err != nil {
		writeError(w, r, err)
		return
	}
	inserted, _ := result.RowsAffected()
	if inserted != 1 {
		writeError(w, r, problem(401, "INVALID_CREDENTIALS", "凭据已变化，请重试。"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), "INSERT INTO audit_events(actor_administrator_id,action,resource_type,outcome,created_at) VALUES(1,'authentication.login','session','success',?)", now); err != nil {
		writeError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, r, err)
		return
	}
	setAuthCookie(w, sessionCookieName, token, time.Unix(expiry, 0), 43200)
	clearAuthCookie(w, challengeCookieName)
	writeData(w, r, 200, sessionData(Principal{ID: 1, Username: username, CSRF: csrf, ExpiresAt: expiry, IdleExpiresAt: now + 1800, ReauthUntil: now + 300}))
}

func sessionData(p Principal) map[string]any {
	return map[string]any{"administrator": map[string]any{"id": p.ID, "username": p.Username}, "csrfToken": p.CSRF, "expiresAt": time.Unix(p.ExpiresAt, 0).UTC().Format(time.RFC3339), "idleExpiresAt": time.Unix(p.IdleExpiresAt, 0).UTC().Format(time.RFC3339), "reauthUntil": time.Unix(p.ReauthUntil, 0).UTC().Format(time.RFC3339)}
}

func (a *App) session(w http.ResponseWriter, r *http.Request) {
	writeData(w, r, 200, sessionData(principal(r)))
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength != 0 {
		var empty struct{}
		if err := decodeJSON(r, &empty, 8<<10); err != nil {
			writeError(w, r, err)
			return
		}
	}
	p := principal(r)
	now := a.now().UTC().Unix()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), "UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL", now, p.SessionHash); err != nil {
		writeError(w, r, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), "INSERT INTO audit_events(actor_administrator_id,action,resource_type,outcome,created_at) VALUES(?,'authentication.logout','session','success',?)", p.ID, now); err != nil {
		writeError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, r, err)
		return
	}
	clearAuthCookie(w, sessionCookieName)
	w.WriteHeader(204)
}

func (a *App) reauthenticate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body, 8<<10); err != nil {
		writeError(w, r, err)
		return
	}
	if len(body.Password) > 1024 {
		writeError(w, r, problem(422, "VALIDATION_FAILED", "密码格式无效。"))
		return
	}
	p := principal(r)
	version, _, err := a.checkPassword(r, p.Username, []byte(body.Password))
	if err != nil {
		writeAuthError(w, r, err)
		return
	}
	now := a.now().UTC().Unix()
	until := min(now+300, p.ExpiresAt)
	result, err := a.db.ExecContext(r.Context(), "UPDATE sessions SET reauth_until=? WHERE token_hash=? AND revoked_at IS NULL AND credential_version=? AND credential_version=(SELECT credential_version FROM administrators WHERE id=1)", until, p.SessionHash, version)
	if err != nil {
		writeError(w, r, err)
		return
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		writeError(w, r, problem(401, "AUTH_REQUIRED", "请重新登录。"))
		return
	}
	if err = a.authAudit(r, &p.ID, "authentication.reauthenticate", "success"); err != nil {
		writeError(w, r, err)
		return
	}
	writeData(w, r, 200, map[string]any{"reauthUntil": time.Unix(until, 0).UTC().Format(time.RFC3339)})
}

func (a *App) changePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
		ConfirmPassword string `json:"confirmPassword"`
	}
	if err := decodeJSON(r, &body, 8<<10); err != nil {
		writeError(w, r, err)
		return
	}
	if len(body.CurrentPassword) > 1024 || body.NewPassword != body.ConfirmPassword || authn.ValidatePassword([]byte(body.NewPassword)) != nil {
		writeError(w, r, problem(422, "VALIDATION_FAILED", "新密码需为12～128个字符，两次输入须一致。"))
		return
	}
	p := principal(r)
	version, _, err := a.checkPassword(r, p.Username, []byte(body.CurrentPassword))
	if err != nil {
		writeAuthError(w, r, err)
		return
	}
	release, err := a.acquireAuth(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	encoded, err := authn.HashPassword([]byte(body.NewPassword))
	release()
	if err != nil {
		writeError(w, r, err)
		return
	}
	now := a.now().UTC().Unix()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer tx.Rollback()
	if err = requireActiveSessionTx(r.Context(), tx, p, now); err != nil {
		writeError(w, r, err)
		return
	}
	result, err := tx.ExecContext(r.Context(), "UPDATE administrators SET password_hash=?,credential_version=credential_version+1,updated_at=? WHERE id=? AND credential_version=?", encoded, now, p.ID, version)
	if err != nil {
		writeError(w, r, err)
		return
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		writeError(w, r, problem(401, "AUTH_REQUIRED", "凭据已变化，请重新登录。"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), "UPDATE sessions SET revoked_at=? WHERE administrator_id=? AND revoked_at IS NULL", now, p.ID); err != nil {
		writeError(w, r, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM login_challenges"); err != nil {
		writeError(w, r, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), "INSERT INTO audit_events(actor_administrator_id,action,resource_type,outcome,created_at) VALUES(?,'authentication.password-change','administrator','success',?)", p.ID, now); err != nil {
		writeError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, r, err)
		return
	}
	clearAuthCookie(w, sessionCookieName)
	w.WriteHeader(204)
}

func (a *App) authAudit(r *http.Request, actor *int64, action, outcome string) error {
	metadata, _ := json.Marshal(map[string]string{"sourceBucket": a.authBucket(r, "audit")})
	_, err := a.db.ExecContext(r.Context(), "INSERT INTO audit_events(actor_administrator_id,request_id,action,resource_type,outcome,metadata_json,created_at) VALUES(?,?,?,'session',?,?,?)", actor, requestID(r), action, outcome, string(metadata), a.now().UTC().Unix())
	return err
}

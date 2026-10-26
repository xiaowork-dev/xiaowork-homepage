package store

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
)

func securityExec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("execute %q: %v", query, err)
	}
}

func securityRejectConstraint(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	_, err := db.Exec(query, args...)
	if err == nil {
		t.Fatalf("expected SQLite constraint rejection: %s", query)
	}
	var coded interface{ Code() int }
	if !errors.As(err, &coded) || coded.Code()&0xff != 19 {
		t.Fatalf("expected SQLITE_CONSTRAINT, got %v", err)
	}
}

func securityAdministrator(t *testing.T, db *sql.DB) {
	t.Helper()
	securityExec(t, db, "INSERT INTO administrators(id,username,password_hash,created_at,updated_at) VALUES(1,'test-only',?,1,1)", strings.Repeat("x", 32))
}

func TestLoginChallengeLifetimeAndOneWayConsumption(t *testing.T) {
	db, _ := initialized(t)
	nonce := strings.Repeat("a", 64)
	cookie := strings.Repeat("b", 64)
	bucket := strings.Repeat("c", 64)
	insert := "INSERT INTO login_challenges(nonce_hash,cookie_hash,source_bucket_hash,created_at,expires_at) VALUES(?,?,?,100,?)"
	for _, expiry := range []int{100, 401} {
		securityRejectConstraint(t, db, insert, nonce, cookie, bucket, expiry)
	}
	securityExec(t, db, insert, nonce, cookie, bucket, 400)
	securityRejectConstraint(t, db, "UPDATE login_challenges SET consumed_at=99 WHERE nonce_hash=?", nonce)
	securityRejectConstraint(t, db, "UPDATE login_challenges SET consumed_at=401 WHERE nonce_hash=?", nonce)
	securityRejectConstraint(t, db, "UPDATE login_challenges SET consumed_at=200,expires_at=399 WHERE nonce_hash=?", nonce)
	securityExec(t, db, "UPDATE login_challenges SET consumed_at=400 WHERE nonce_hash=?", nonce)
	securityRejectConstraint(t, db, "UPDATE login_challenges SET consumed_at=NULL WHERE nonce_hash=?", nonce)
	securityRejectConstraint(t, db, "UPDATE login_challenges SET consumed_at=399 WHERE nonce_hash=?", nonce)
	var consumed int
	if err := db.QueryRow("SELECT consumed_at FROM login_challenges WHERE nonce_hash=?", nonce).Scan(&consumed); err != nil || consumed != 400 {
		t.Fatalf("consumption must remain at the accepted boundary: %d %v", consumed, err)
	}
}

func TestIdempotencyEndpointScopeRetentionAndImmutability(t *testing.T) {
	db, _ := initialized(t)
	securityAdministrator(t, db)
	key := "request-key-00001"
	hash := strings.Repeat("a", 64)
	insert := "INSERT INTO idempotency_records(administrator_id,endpoint,idempotency_key,request_sha256,resource_type,resource_id,response_status,response_json,created_at,expires_at) VALUES(1,?,?,?,'project','p',201,'{}',100,?)"
	securityRejectConstraint(t, db, insert, "/projects", key, hash, 86499)
	securityExec(t, db, insert, "/projects", key, hash, 86500)
	securityRejectConstraint(t, db, insert, "/projects", key, hash, 86500)
	securityExec(t, db, insert, "/publish", key, hash, 86500)
	for _, query := range []string{
		"UPDATE idempotency_records SET request_sha256=? WHERE endpoint='/projects'",
		"UPDATE idempotency_records SET response_json=? WHERE endpoint='/projects'",
		"UPDATE idempotency_records SET endpoint=? WHERE endpoint='/projects'",
	} {
		value := strings.Repeat("b", 64)
		if strings.Contains(query, "response_json") {
			value = `{"changed":true}`
		}
		securityRejectConstraint(t, db, query, value)
	}
	securityRejectConstraint(t, db, "UPDATE idempotency_records SET expires_at=86501 WHERE endpoint='/projects'")
	var count int
	if err := db.QueryRow("SELECT count(*) FROM idempotency_records WHERE idempotency_key=?", key).Scan(&count); err != nil || count != 2 {
		t.Fatalf("same key must have exactly two independent endpoint records: %d %v", count, err)
	}
}

func TestAssetMetadataSoftDeletionProtectsEveryReferenceKind(t *testing.T) {
	for _, reference := range []string{"unreferenced", "project", "document", "snapshot"} {
		t.Run(reference, func(t *testing.T) {
			db, _ := initialized(t)
			hash := strings.Repeat("a", 64)
			securityExec(t, db, "INSERT INTO assets(id,storage_kind,storage_key,sha256,media_type,byte_size,width,height,created_at) VALUES('a','upload','covers/a.webp',?,'image/webp',10,1,1,1)", hash)
			securityExec(t, db, "INSERT INTO asset_metadata(asset_id,created_at,updated_at) VALUES('a',1,1)")
			switch reference {
			case "project":
				securityExec(t, db, "INSERT INTO workspace(id,updated_at) VALUES(1,1)")
				securityExec(t, db, "INSERT INTO project_categories(id,slug,name,created_at,updated_at) VALUES('c','category','Category',1,1)")
				securityExec(t, db, "INSERT INTO project_drafts(id,category_id,slug,name,summary,created_at,updated_at) VALUES('p','c','project','Project','',1,1)")
				securityExec(t, db, "INSERT INTO project_draft_assets(project_id,role,asset_id) VALUES('p','cover','a')")
			case "document":
				securityExec(t, db, "INSERT INTO workspace(id,updated_at) VALUES(1,1)")
				securityExec(t, db, "INSERT INTO workspace_documents(kind,content_json,updated_at) VALUES('site','{}',1)")
				securityExec(t, db, "INSERT INTO document_draft_assets(document_kind,field_path,asset_id) VALUES('site','shareImage','a')")
			case "snapshot":
				securityExec(t, db, "INSERT INTO snapshots(id,source_revision,projection_version,public_json,content_sha256,created_at) VALUES('s',1,1,'{}',?,1)", hash)
				securityExec(t, db, "INSERT INTO snapshot_assets(snapshot_id,asset_id,public_path) VALUES('s','a','images/a.webp')")
				securityExec(t, db, "UPDATE snapshots SET sealed_at=2 WHERE id='s'")
			}
			securityExec(t, db, "UPDATE asset_metadata SET alt='Updated alternative text',updated_at=2 WHERE asset_id='a'")
			softDelete := "UPDATE asset_metadata SET deleted_at=3,updated_at=3 WHERE asset_id='a'"
			if reference == "unreferenced" {
				securityExec(t, db, softDelete)
			} else {
				securityRejectConstraint(t, db, softDelete)
			}
			var deleted sql.NullInt64
			if err := db.QueryRow("SELECT deleted_at FROM asset_metadata WHERE asset_id='a'").Scan(&deleted); err != nil {
				t.Fatal(err)
			}
			if deleted.Valid != (reference == "unreferenced") || (deleted.Valid && deleted.Int64 != 3) {
				t.Fatalf("unexpected deletion state for %s: %+v", reference, deleted)
			}
		})
	}
}

func TestSessionReauthenticationCannotOutliveSession(t *testing.T) {
	db, _ := initialized(t)
	securityAdministrator(t, db)
	token := strings.Repeat("a", 64)
	csrf := strings.Repeat("b", 64)
	insert := "INSERT INTO sessions(token_hash,administrator_id,credential_version,csrf_token_hash,created_at,expires_at,last_seen_at,last_interactive_at,reauth_until) VALUES(?,1,1,?,100,200,100,100,?)"
	for _, reauth := range []int{99, 201} {
		securityRejectConstraint(t, db, insert, token, csrf, reauth)
	}
	securityExec(t, db, insert, token, csrf, nil)
	securityExec(t, db, "UPDATE sessions SET reauth_until=200 WHERE token_hash=?", token)
	securityRejectConstraint(t, db, "UPDATE sessions SET reauth_until=201 WHERE token_hash=?", token)
	securityRejectConstraint(t, db, "UPDATE sessions SET expires_at=199 WHERE token_hash=?", token)
	var reauth, expiry int
	if err := db.QueryRow("SELECT reauth_until,expires_at FROM sessions WHERE token_hash=?", token).Scan(&reauth, &expiry); err != nil || reauth != 200 || expiry != 200 {
		t.Fatalf("session boundary changed after rejected updates: reauth=%d expiry=%d %v", reauth, expiry, err)
	}
}

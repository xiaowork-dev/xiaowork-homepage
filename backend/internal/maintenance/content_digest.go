package maintenance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
)

// ContentSHA256 identifies the retained logical state during a stopped-writer
// code transition. Authentication activity and its audit/idempotency records are
// intentionally outside this digest; backup still verifies their physical bytes.
// Table names are constants, never caller-controlled SQL identifiers.
func ContentSHA256(ctx context.Context, db *sql.DB) (string, error) {
	h := sha256.New()
	encode := json.NewEncoder(h)
	for _, table := range []string{"schema_migrations", "administrators", "workspace", "workspace_documents", "project_categories", "project_drafts", "assets", "asset_metadata", "project_draft_assets", "document_draft_assets", "snapshots", "snapshot_assets", "publish_jobs", "releases", "content_imports", "workspace_changes", "publication_job_details"} {
		if err := encode.Encode(table); err != nil {
			return "", err
		}
		rows, err := db.QueryContext(ctx, "SELECT * FROM "+table+" ORDER BY rowid")
		if err != nil {
			return "", err
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return "", err
		}
		if err = encode.Encode(columns); err != nil {
			rows.Close()
			return "", err
		}
		for rows.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			if err = rows.Scan(pointers...); err == nil {
				err = encode.Encode(values)
			}
			if err != nil {
				rows.Close()
				return "", err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

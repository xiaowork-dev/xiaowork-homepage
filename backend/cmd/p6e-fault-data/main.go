//go:build p6e_fault && linux

// Fixed commands for the dedicated fault-test volume only. No arbitrary SQL,
// database path, or secret output is accepted.
package main

import (
	"database/sql"
	"encoding/json"
	"os"

	_ "modernc.org/sqlite"
)

func main() {
	if len(os.Args) != 2 {
		os.Exit(2)
	}
	db, err := sql.Open("sqlite", "file:/data/content.sqlite?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		os.Exit(3)
	}
	defer db.Close()
	switch os.Args[1] {
	case "trigger-on":
		_, err = db.Exec(`CREATE TRIGGER p6e_stop_success BEFORE UPDATE OF status ON publish_jobs WHEN NEW.status='succeeded' BEGIN SELECT p6e_transaction_checkpoint(); END`)
	case "trigger-off":
		_, err = db.Exec(`DROP TRIGGER IF EXISTS p6e_stop_success`)
	case "inspect":
		rows, e := db.Query(`SELECT j.id,j.kind,j.status,coalesce(j.phase,''),d.release_id,'ws-'||s.source_revision,j.attempts,coalesce(j.error_code,''),coalesce(j.reconciled_release_id,''),j.error_code IS NULL,j.error_summary IS NULL,(SELECT count(*) FROM audit_events a WHERE a.resource_id=j.id AND a.action='publication.worker.reconciling' AND a.outcome='failure'),(SELECT count(*) FROM audit_events a WHERE a.resource_id=j.id AND a.action='publication.worker.succeeded' AND a.outcome='success') FROM publish_jobs j JOIN publication_job_details d ON d.job_id=j.id JOIN snapshots s ON s.id=j.snapshot_id ORDER BY j.created_at,j.id`)
		if e != nil {
			os.Exit(4)
		}
		defer rows.Close()
		var result []map[string]any
		for rows.Next() {
			var id, kind, status, phase, release, revision, code, reconciled string
			var attempts, failureAudits, successAudits int
			var codeNull, summaryNull bool
			if rows.Scan(&id, &kind, &status, &phase, &release, &revision, &attempts, &code, &reconciled, &codeNull, &summaryNull, &failureAudits, &successAudits) != nil {
				os.Exit(5)
			}
			result = append(result, map[string]any{"id": id, "kind": kind, "status": status, "phase": phase, "releaseId": release, "revision": revision, "attempts": attempts, "errorCode": code, "reconciledReleaseId": reconciled, "errorCodeIsNull": codeNull, "errorSummaryIsNull": summaryNull, "failureAuditEvents": failureAudits, "successAuditEvents": successAudits})
		}
		if rows.Err() != nil {
			os.Exit(6)
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
	default:
		os.Exit(2)
	}
	if err != nil {
		os.Exit(7)
	}
}

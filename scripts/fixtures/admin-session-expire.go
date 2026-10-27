// This is an offline test fixture, not an API/production command. The browser
// harness verifies the dedicated E2E volume label before mounting /data.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"regexp"
	"time"

	_ "modernc.org/sqlite"
)

func main() {
	if len(os.Args) != 2 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(os.Args[1]) {
		panic("expected one test session digest")
	}
	db, err := sql.Open("sqlite", "file:/data/content.sqlite?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		panic("test database unavailable")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := db.ExecContext(ctx, "UPDATE sessions SET expires_at=created_at+1,reauth_until=NULL WHERE token_hash=? AND revoked_at IS NULL AND created_at<unixepoch()-1", os.Args[1])
	if err != nil {
		panic("test expiry update failed")
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		panic("expected exactly one isolated session")
	}
	fmt.Println("EXPIRED_ONE_ISOLATED_TEST_SESSION")
}

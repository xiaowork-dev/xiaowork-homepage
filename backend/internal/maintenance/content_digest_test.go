package maintenance

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func TestContentDigestDetectsSameRevisionDraftChange(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(filepath.Join(t.TempDir(), "content.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = store.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	before, err := ContentSHA256(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	// A same-revision workspace timestamp mutation demonstrates that
	// counts/revision alone are not a retained-state proof.
	if _, err = db.ExecContext(ctx, "UPDATE workspace SET updated_at=updated_at+1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	after, err := ContentSHA256(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if before == after {
		t.Fatal("same-revision logical mutation was not detected")
	}
}

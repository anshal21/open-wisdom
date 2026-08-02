package sources

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/testsupport"
)

// The OSS-16 acceptance criterion, end to end: a DSN with ${VAR} connects, and
// the row in SQLite still holds the literal reference rather than the value.
func TestStoredDSNKeepsEnvReference(t *testing.T) {
	t.Setenv("ANALYST_E2E_PATH", testsupport.WarehousePath(t))

	db, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	repo := store.NewSources(db)
	src := &store.Source{Name: "envref", Kind: "duckdb", DSN: "${ANALYST_E2E_PATH}"}
	if err := repo.Create(context.Background(), src); err != nil {
		t.Fatal(err)
	}

	reg := NewRegistry(repo, nil)
	conn, err := reg.Connector(context.Background(), src.ID)
	if err != nil {
		t.Fatalf("connect via env-ref DSN: %v", err)
	}
	defer conn.Close()

	if _, err := conn.Query(context.Background(), "SELECT 1"); err != nil {
		t.Fatalf("query: %v", err)
	}

	back, err := repo.Get(context.Background(), src.ID)
	if err != nil {
		t.Fatal(err)
	}
	if back.DSN != "${ANALYST_E2E_PATH}" {
		t.Fatalf("stored DSN = %q; the resolved path must never be persisted", back.DSN)
	}
	if strings.Contains(back.DSN, "analyst-sample") {
		t.Fatalf("resolved value leaked into storage: %q", back.DSN)
	}
	t.Logf("stored DSN remained %q while the connection resolved it", back.DSN)
}

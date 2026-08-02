package store

import (
	"context"
	"path/filepath"
	"testing"
)

func testDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// seqs reads the cell order as a list of sources, which is easier to assert
// against than ids and proves the ordering means what the caller thinks.
func seqs(t *testing.T, r *Notebooks, nbID string) []string {
	t.Helper()
	nb, err := r.Get(context.Background(), nbID)
	if err != nil {
		t.Fatalf("get notebook: %v", err)
	}
	var out []string
	for i, c := range nb.Cells {
		if c.Seq != i+1 {
			t.Errorf("cell %d has seq %d — seqs must be dense and 1-based", i, c.Seq)
		}
		out = append(out, c.Source)
	}
	return out
}

func eq(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

// A cell inserted after another lands directly below it and pushes the rest
// down. Without the shift two cells would claim one position and the stack
// order would depend on which row SQLite happened to return first.
func TestAddCellInsertsAtPosition(t *testing.T) {
	ctx := context.Background()
	r := NewNotebooks(testDB(t))
	nb, err := r.Create(ctx, "n", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	a, _ := r.AddCell(ctx, nb.ID, "", Cell{Kind: "sql", Source: "A"})
	r.AddCell(ctx, nb.ID, "", Cell{Kind: "sql", Source: "B"})
	r.AddCell(ctx, nb.ID, "", Cell{Kind: "sql", Source: "C"})
	eq(t, seqs(t, r, nb.ID), []string{"A", "B", "C"})

	if _, err := r.AddCell(ctx, nb.ID, a.ID, Cell{Kind: "sql", Source: "A2"}); err != nil {
		t.Fatalf("insert after: %v", err)
	}
	eq(t, seqs(t, r, nb.ID), []string{"A", "A2", "B", "C"})
}

// Deleting from the middle must close the gap. A hole at seq 2 would make a
// later reorder — which writes 1..n — disagree with the stored positions.
func TestDeleteCellRenumbersDensely(t *testing.T) {
	ctx := context.Background()
	r := NewNotebooks(testDB(t))
	nb, _ := r.Create(ctx, "n", "")

	r.AddCell(ctx, nb.ID, "", Cell{Kind: "sql", Source: "A"})
	b, _ := r.AddCell(ctx, nb.ID, "", Cell{Kind: "sql", Source: "B"})
	r.AddCell(ctx, nb.ID, "", Cell{Kind: "sql", Source: "C"})

	if err := r.DeleteCell(ctx, nb.ID, b.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	// seqs() asserts density itself.
	eq(t, seqs(t, r, nb.ID), []string{"A", "C"})
}

// A reorder naming a cell from another notebook — or omitting one of this
// notebook's — is refused. A partial list would strand the cells it omits.
func TestReorderRejectsForeignOrPartialLists(t *testing.T) {
	ctx := context.Background()
	r := NewNotebooks(testDB(t))
	mine, _ := r.Create(ctx, "mine", "")
	theirs, _ := r.Create(ctx, "theirs", "")

	a, _ := r.AddCell(ctx, mine.ID, "", Cell{Kind: "sql", Source: "A"})
	b, _ := r.AddCell(ctx, mine.ID, "", Cell{Kind: "sql", Source: "B"})
	foreign, _ := r.AddCell(ctx, theirs.ID, "", Cell{Kind: "sql", Source: "X"})

	if err := r.Reorder(ctx, mine.ID, []string{a.ID}); err != ErrOrderMismatch {
		t.Errorf("partial list: got %v, want ErrOrderMismatch", err)
	}
	if err := r.Reorder(ctx, mine.ID, []string{a.ID, foreign.ID}); err != ErrOrderMismatch {
		t.Errorf("foreign id: got %v, want ErrOrderMismatch", err)
	}
	if err := r.Reorder(ctx, mine.ID, []string{a.ID, a.ID}); err != ErrOrderMismatch {
		t.Errorf("duplicate id: got %v, want ErrOrderMismatch", err)
	}
	if err := r.Reorder(ctx, mine.ID, []string{b.ID, a.ID}); err != nil {
		t.Fatalf("valid reorder: %v", err)
	}
	eq(t, seqs(t, r, mine.ID), []string{"B", "A"})
}

// Editing a cell's source clears its result. Keeping the old output would
// leave a seal describing a figure that nothing in the cell now produces.
func TestUpdateCellClearsStaleResult(t *testing.T) {
	ctx := context.Background()
	r := NewNotebooks(testDB(t))
	nb, _ := r.Create(ctx, "n", "")
	c, _ := r.AddCell(ctx, nb.ID, "", Cell{Kind: "sql", Source: "SELECT 1"})

	if err := r.SetCellOutput(ctx, nb.ID, c.ID, map[string]any{"row_count": 1}, "unverified"); err != nil {
		t.Fatalf("set output: %v", err)
	}

	src := "SELECT 2"
	got, err := r.UpdateCell(ctx, nb.ID, c.ID, CellPatch{Source: &src})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Output != nil {
		t.Errorf("changing source must clear output, got %v", got.Output)
	}
	if got.Confidence != "" {
		t.Errorf("changing source must clear confidence, got %q", got.Confidence)
	}

	// Re-saving the SAME source is not an edit and must not discard a result.
	r.SetCellOutput(ctx, nb.ID, c.ID, map[string]any{"row_count": 2}, "unverified")
	same := "SELECT 2"
	got, err = r.UpdateCell(ctx, nb.ID, c.ID, CellPatch{Source: &same})
	if err != nil {
		t.Fatalf("update same: %v", err)
	}
	if got.Output == nil {
		t.Error("re-saving identical source must keep the result — autosave fires on every keystroke")
	}
}

// Every mutation marks the notebook changed; the list surface sorts on it.
func TestMutationsTouchUpdatedAt(t *testing.T) {
	ctx := context.Background()
	r := NewNotebooks(testDB(t))
	nb, _ := r.Create(ctx, "n", "")

	before, err := r.Get(ctx, nb.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if before.UpdatedAt == "" {
		t.Fatal("a new notebook must carry updated_at, or the list renders 'last edited —'")
	}

	// Wind the stamp back so any touch is visibly newer, regardless of clock
	// resolution — RFC3339 seconds would otherwise make this flaky.
	if _, err := r.db.ExecContext(ctx,
		`UPDATE notebooks SET updated_at = '2000-01-01T00:00:00Z' WHERE id = ?`, nb.ID); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	if _, err := r.AddCell(ctx, nb.ID, "", Cell{Kind: "sql", Source: "A"}); err != nil {
		t.Fatalf("add cell: %v", err)
	}
	after, _ := r.Get(ctx, nb.ID)
	if after.UpdatedAt == "2000-01-01T00:00:00Z" {
		t.Error("adding a cell must touch the notebook's updated_at")
	}
}

// A pre-existing notebook — one written before updated_at existed — must not
// come back with an empty stamp. This is the migration's whole point.
func TestBackfillFillsUpdatedAt(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	r := NewNotebooks(db)
	nb, _ := r.Create(ctx, "legacy", "")

	// Simulate the pre-migration row.
	if _, err := db.sql.ExecContext(ctx,
		`UPDATE notebooks SET updated_at = NULL WHERE id = ?`, nb.ID); err != nil {
		t.Fatalf("null out: %v", err)
	}
	got, err := r.Get(ctx, nb.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.UpdatedAt == "" {
		t.Error("a NULL updated_at must read through as created_at, not empty")
	}
}

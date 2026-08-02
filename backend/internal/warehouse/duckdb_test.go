package warehouse

import (
	"context"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/testsupport"
)

// demoWarehouse resolves the warehouse this suite queries.
//
// Two generations of this helper skipped when the file was absent: first an
// absolute path under one developer's home directory, then an in-repo path to a
// ~1 GB download. Either way, on most machines the package that guards SQL
// printed "ok" while executing almost nothing — a green board is worse than a
// missing test.
//
// There is nothing left to skip for. testsupport serves a warehouse generated
// from CSVs embedded in this binary, so it is present by construction.
func demoWarehouse(t *testing.T) string {
	t.Helper()
	return testsupport.WarehousePath(t)
}

// openDemo works on a copy: DuckDB permits many readers or one writer, and an
// interactive session holding the file read-write would otherwise fail the
// suite.
func openDemo(t *testing.T) *DuckDB {
	t.Helper()
	path := demoWarehouse(t)
	src, err := os.Open(path)
	if err != nil {
		t.Fatalf("open fixture warehouse %s: %v", path, err)
	}
	defer src.Close()

	dstPath := t.TempDir() + "/demo.duckdb"
	dst, err := os.Create(dstPath)
	if err != nil {
		t.Fatalf("create copy: %v", err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		t.Fatalf("copy: %v", err)
	}
	dst.Close()

	d, err := OpenDuckDB(dstPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestIntrospectDiscoversSchema(t *testing.T) {
	d := openDemo(t)
	cat, err := d.Introspect(context.Background())
	if err != nil {
		t.Fatalf("introspect: %v", err)
	}
	if len(cat.Tables) == 0 {
		t.Fatal("no tables discovered")
	}
	for _, tb := range cat.Tables {
		if len(tb.Columns) == 0 {
			t.Errorf("table %s has no columns", tb.Name)
		}
		if tb.RowCount < 0 {
			t.Errorf("table %s negative row count", tb.Name)
		}
		t.Logf("%-22s %8d rows  %2d cols", tb.Name, tb.RowCount, len(tb.Columns))
	}
}

// TestProfileCapturesLiteralCasing is the regression test for the failure mode
// the whole product exists to catch: a model writes status <> 'cancelled' when
// the stored literals are capitalized. Profiling must surface the real values.
func TestProfileCapturesLiteralCasing(t *testing.T) {
	d := openDemo(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	cat, err := d.Introspect(ctx)
	if err != nil {
		t.Fatalf("introspect: %v", err)
	}
	if err := NewProfiler(d).Profile(ctx, cat); err != nil {
		t.Fatalf("profile: %v", err)
	}

	var found bool
	for _, tb := range cat.Tables {
		for _, c := range tb.Columns {
			if c.Profile == nil || len(c.Profile.DistinctValues) == 0 {
				continue
			}
			found = true
			t.Logf("%s.%s (%d distinct): %v", tb.Name, c.Name,
				c.Profile.DistinctCount, c.Profile.DistinctValues)
		}
	}
	if !found {
		t.Fatal("no low-cardinality column enumerated; filter-literal check would be blind")
	}
}

func TestRejectWrites(t *testing.T) {
	cases := []struct {
		sql  string
		want bool // true = must be rejected
	}{
		{"SELECT 1", false},
		{"WITH a AS (SELECT 1) SELECT * FROM a", false},
		{"SELECT 1;", false},
		{"DROP TABLE users", true},
		{"SELECT 1; DROP TABLE users", true},
		{"select 1 /* hidden */ ; delete from orders", true},
		{"INSERT INTO t VALUES (1)", true},
		{"SELECT 1 -- comment\n", false},
		{"", true},
		{"ATTACH 'x.db'", true},
	}
	for _, c := range cases {
		err := RejectWrites(c.sql)
		if (err != nil) != c.want {
			t.Errorf("RejectWrites(%q) err=%v, want rejected=%v", c.sql, err, c.want)
		}
	}
}

// Session timezone must hold on EVERY pooled connection, not just the one a
// SET happened to run on. Regression test for the IST-shifted month buckets.
func TestTimestampsAreUTCOnEveryConnection(t *testing.T) {
	path := demoWarehouse(t)
	d, err := OpenDuckDB(path)
	if err != nil {
		t.Fatalf("open fixture warehouse %s: %v", path, err)
	}
	defer d.Close()
	for i := 0; i < 8; i++ {
		res, err := d.Query(context.Background(),
			"SELECT DATE_TRUNC('month', TIMESTAMPTZ '2023-01-15 12:00:00+00')")
		if err != nil {
			t.Fatal(err)
		}
		got, _ := res.Rows[0][0].(string)
		if got != "2023-01-01T00:00:00Z" {
			t.Fatalf("connection %d bucketed January at %q — session is not UTC", i, got)
		}
	}
}

func TestClassifyColumnRoles(t *testing.T) {
	cases := []struct {
		col  Column
		want string
	}{
		{Column{Name: "user_id", Type: "BIGINT"}, "key"},
		{Column{Name: "id", Type: "BIGINT"}, "key"},
		{Column{Name: "email", Type: "VARCHAR"}, "pii"},
		{Column{Name: "created_at", Type: "TIMESTAMP"}, "date"},
		{Column{Name: "sale_price", Type: "DOUBLE"}, "measure"},
		{Column{Name: "status", Type: "VARCHAR", Profile: &ColumnProfile{DistinctCount: 5}}, "dimension"},
		{Column{Name: "status_code", Type: "INTEGER", Profile: &ColumnProfile{DistinctCount: 4}}, "dimension"},
	}
	for _, tc := range cases {
		if got := classifyColumn(tc.col); got != tc.want {
			t.Errorf("%s: want %s, got %s", tc.col.Name, tc.want, got)
		}
	}
}

func TestInferRelationshipsByNaming(t *testing.T) {
	cat := &Catalog{Tables: []Table{
		{Name: "orders", Columns: []Column{{Name: "id"}, {Name: "user_id"}}},
		{Name: "users", Columns: []Column{{Name: "id"}}},
		{Name: "categories", Columns: []Column{{Name: "id"}}},
		{Name: "items", Columns: []Column{{Name: "id"}, {Name: "order_id"}, {Name: "category_id"}, {Name: "ghost_id"}}},
	}}
	rels := inferRelationships(cat.Tables[3], cat)
	got := map[string]string{}
	for _, r := range rels {
		got[r.FromColumn] = r.ToTable
	}
	if got["order_id"] != "orders" || got["category_id"] != "categories" {
		t.Errorf("expected order_id→orders and category_id→categories, got %v", got)
	}
	if _, ok := got["ghost_id"]; ok {
		t.Error("ghost_id matches no table and must produce no edge")
	}
}

// TestEngineBlocksHostReads is the regression test for the vulnerability this
// guard exists to close: a read-only SELECT that returns a local file.
//
// It asserts the ENGINE refuses, not the guard — the statements are executed
// through the raw handle, bypassing RejectWrites entirely. Defence in depth
// only means anything if the inner layer holds on its own.
func TestEngineBlocksHostReads(t *testing.T) {
	d := openDemo(t)
	ctx := context.Background()

	escapes := []struct {
		name string
		sql  string
	}{
		{"read_csv_auto", `SELECT * FROM read_csv_auto('/etc/hosts') LIMIT 1`},
		{"read_text", `SELECT content FROM read_text('/etc/hosts')`},
		{"glob", `SELECT file FROM glob('/etc/*') LIMIT 1`},
		{"https", `SELECT * FROM read_csv_auto('https://example.com/a.csv') LIMIT 1`},
	}
	for _, e := range escapes {
		t.Run(e.name, func(t *testing.T) {
			var v any
			err := d.db.QueryRowContext(ctx, e.sql).Scan(&v)
			if err == nil {
				t.Fatalf("ENGINE ALLOWED HOST READ: %s returned data", e.sql)
			}
			if !strings.Contains(err.Error(), "disabled by configuration") &&
				!strings.Contains(err.Error(), "Permission Error") {
				t.Errorf("blocked, but not by the lockdown: %v", err)
			}
		})
	}
}

// The lockdown must survive across pooled connections — the same failure mode
// the TimeZone comment describes. A setting applied to one connection and not
// its siblings is a hole that opens under load.
func TestLockdownHoldsOnEveryConnection(t *testing.T) {
	d := openDemo(t)
	for i := 0; i < 8; i++ {
		var v any
		if err := d.db.QueryRowContext(context.Background(),
			`SELECT * FROM read_csv_auto('/etc/hosts') LIMIT 1`).Scan(&v); err == nil {
			t.Fatalf("connection %d permitted a host read — lockdown is not per-connection", i)
		}
	}
}

// A statement must not be able to undo the lockdown. DuckDB itself refuses;
// this pins that behaviour so a driver or engine upgrade that relaxes it fails
// here rather than in production.
func TestLockdownCannotBeUndone(t *testing.T) {
	d := openDemo(t)
	ctx := context.Background()
	for _, stmt := range []string{
		`SET disabled_filesystems=''`,
		`RESET disabled_filesystems`,
		`SET enable_external_access=true`,
		`SET GLOBAL disabled_filesystems=''`,
	} {
		if _, err := d.db.ExecContext(ctx, stmt); err == nil {
			t.Errorf("engine allowed %q — the lockdown is reversible", stmt)
		}
	}
	var v any
	if err := d.db.QueryRowContext(ctx,
		`SELECT * FROM read_csv_auto('/etc/hosts') LIMIT 1`).Scan(&v); err == nil {
		t.Fatal("host read succeeded after undo attempts")
	}
}

// The lockdown must not cost the product anything it legitimately needs.
func TestLockdownLeavesNormalQueriesWorking(t *testing.T) {
	d := openDemo(t)
	ctx := context.Background()

	// ICU must still be available: TimeZone=UTC depends on it, and
	// enable_external_access=false blocks extension autoloading if applied in
	// the wrong order. This is the regression test for that ordering.
	res, err := d.Query(ctx, `SELECT DATE_TRUNC('month', TIMESTAMPTZ '2023-01-15 12:00:00+00') AS m`)
	if err != nil {
		t.Fatalf("timezone bucketing broke under lockdown: %v", err)
	}
	if got, _ := res.Rows[0][0].(string); got != "2023-01-01T00:00:00Z" {
		t.Errorf("month bucket = %q, want 2023-01-01T00:00:00Z", got)
	}

	cat, err := d.Introspect(ctx)
	if err != nil || len(cat.Tables) == 0 {
		t.Fatalf("introspection broke under lockdown: %v", err)
	}
	if _, err := d.Query(ctx, "SELECT count(*) FROM "+cat.Tables[0].FQN()); err != nil {
		t.Errorf("ordinary aggregate broke under lockdown: %v", err)
	}
}

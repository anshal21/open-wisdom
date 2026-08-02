// Package conformance is the contract a data connector must satisfy.
//
// It exists so a warehouse connector from someone nobody has met can be
// trusted on evidence rather than on good intentions. The failure mode this
// guards against is specific and quiet: a connector that reports a DATE column
// as a plain string does not crash and does not look wrong — it produces a
// chart with a categorical x-axis, sorted alphabetically, and an answer that
// is confidently misleading while still wearing a "verified" seal.
//
// # Using it
//
// A connector author loads testdata/*.csv into their engine, then:
//
//	func TestConformance(t *testing.T) {
//	    conformance.Run(t, conformance.Target{
//	        Name: "postgres",
//	        Connect: func(t *testing.T) warehouse.Connector { ... },
//	        ExtraHostReads: []string{"SELECT pg_read_file('/etc/passwd')"},
//	    })
//	}
//
// The CSVs are the portable part of the contract. How they get into the engine
// is the connector's business; what the connector then reports about them is
// this package's business.
package conformance

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// Target describes one connector under test.
type Target struct {
	// Name appears in failure messages.
	Name string

	// Connect returns a connector against a warehouse already loaded with the
	// fixture dataset (testdata/orders.csv and testdata/regions.csv, table
	// names `orders` and `regions`). The suite closes it.
	Connect func(t *testing.T) warehouse.Connector

	// ExtraHostReads are engine-specific escapes to the host that this suite
	// cannot know about. Postgres has pg_read_file and COPY FROM PROGRAM;
	// MySQL has LOAD_FILE; ClickHouse has url() and file().
	//
	// The base suite asserts the escapes it knows. Every connector author is
	// expected to add their own, because the person who knows how to read
	// /etc/passwd through an engine is the person who works with it daily —
	// and this is the one assertion where being wrong is a CVE rather than a
	// bad chart.
	ExtraHostReads []string

	// SkipTimezone opts out of the timezone assertion for engines with no
	// timezone-naive timestamp type. Use sparingly and say why in a comment.
	SkipTimezone bool
}

// Run executes the full suite. Every sub-test is independent so a partial
// implementation gets a useful report rather than one early failure.
func Run(t *testing.T, target Target) {
	t.Helper()
	if target.Name == "" {
		t.Fatal("conformance: Target.Name is required")
	}
	if target.Connect == nil {
		t.Fatal("conformance: Target.Connect is required")
	}

	t.Run(target.Name+"/catalog_shape", func(t *testing.T) { testCatalogShape(t, target) })
	t.Run(target.Name+"/type_mapping", func(t *testing.T) { testTypeMapping(t, target) })
	t.Run(target.Name+"/dialect", func(t *testing.T) { testDialect(t, target) })
	t.Run(target.Name+"/query", func(t *testing.T) { testQuery(t, target) })
	t.Run(target.Name+"/nulls", func(t *testing.T) { testNulls(t, target) })
	if !target.SkipTimezone {
		t.Run(target.Name+"/timezone", func(t *testing.T) { testTimezone(t, target) })
	}
	t.Run(target.Name+"/read_only", func(t *testing.T) { testReadOnly(t, target) })
	t.Run(target.Name+"/host_reads", func(t *testing.T) { testHostReads(t, target) })
}

func connect(t *testing.T, target Target) warehouse.Connector {
	t.Helper()
	c := target.Connect(t)
	if c == nil {
		t.Fatal("Connect returned a nil connector")
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func ctx(t *testing.T) context.Context {
	c, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	return c
}

// ---------------------------------------------------------------- catalog

func testCatalogShape(t *testing.T, target Target) {
	c := connect(t, target)
	cat, err := c.Introspect(ctx(t))
	if err != nil {
		t.Fatalf("Introspect: %v", err)
	}
	if len(cat.Tables) == 0 {
		t.Fatal("catalog has no tables; the planner builds its prompt from this")
	}

	for _, want := range []string{"orders", "regions"} {
		tb := findTable(cat, want)
		if tb == nil {
			t.Errorf("fixture table %q missing from catalog", want)
			continue
		}
		if len(tb.Columns) == 0 {
			t.Errorf("table %q has no columns", want)
		}
		for _, col := range tb.Columns {
			if col.Name == "" {
				t.Errorf("table %q has a column with an empty name", want)
			}
			// An empty type is the specific thing that breaks downstream:
			// classification, chart form and sort order all read it.
			if strings.TrimSpace(col.Type) == "" {
				t.Errorf("%s.%s has an empty type", want, col.Name)
			}
		}
	}
}

// ---------------------------------------------------------------- types

// typeExpectations maps fixture columns to the semantic type the product must
// derive. These are the assertions that catch the silent-wrongness class.
var typeExpectations = []struct {
	table, column, want string
	why                 string
}{
	{"orders", "placed_on", "temporal", "a DATE rendered as a category sorts alphabetically and the trend is a lie"},
	{"orders", "placed_at", "temporal", "a TIMESTAMP must drive a time axis, not a category axis"},
	{"orders", "region", "nominal", "a label must never be treated as a measure"},
	{"orders", "total", "quantitative", "the money column must be summable"},
	{"orders", "items", "quantitative", "an integer count must be summable"},
	{"orders", "order_id", "quantitative", "reported as a number; role heuristics demote keys separately"},
	{"regions", "manager", "nominal", "a name is a label"},
	{"regions", "opened_on", "temporal", "a DATE in a dimension table is still a date"},
}

// testTypeMapping is the highest-value assertion in this suite.
//
// It runs the connector's reported type through ask.FieldType — the SAME
// function the production chart resolver uses — rather than a copy of the
// rule. A connector reporting "DATETIME2" that the classifier does not know
// fails here, which is the moment to either normalize the type name in the
// connector or teach the classifier, instead of discovering it as a wrong
// chart in someone's board deck.
func testTypeMapping(t *testing.T, target Target) {
	c := connect(t, target)
	cat, err := c.Introspect(ctx(t))
	if err != nil {
		t.Fatalf("Introspect: %v", err)
	}

	for _, exp := range typeExpectations {
		tb := findTable(cat, exp.table)
		if tb == nil {
			t.Errorf("table %q missing", exp.table)
			continue
		}
		col := findColumn(tb, exp.column)
		if col == nil {
			t.Errorf("%s.%s missing", exp.table, exp.column)
			continue
		}
		got := ask.FieldType(col.Type)
		if got != exp.want {
			t.Errorf("%s.%s: engine type %q classifies as %q, want %q\n  why it matters: %s",
				exp.table, exp.column, col.Type, got, exp.want, exp.why)
		}
	}
}

func testDialect(t *testing.T, target Target) {
	c := connect(t, target)
	d := c.Dialect()
	if strings.TrimSpace(d.Name) == "" {
		t.Error("Dialect().Name is empty; prompts identify the SQL flavour by it")
	}
	// No assertion on which capabilities are true — that is the connector's
	// honest declaration about its engine. The contract is only that the name
	// exists and PromptLine renders.
	if d.PromptLine() == "" {
		t.Error("Dialect().PromptLine() is empty")
	}
}

// ---------------------------------------------------------------- queries

func testQuery(t *testing.T, target Target) {
	c := connect(t, target)
	res, err := c.Query(ctx(t), `SELECT region, COUNT(*) AS n FROM orders GROUP BY region ORDER BY region`)
	if err != nil {
		t.Fatalf("group-by query: %v", err)
	}
	if len(res.Columns) != 2 {
		t.Fatalf("got %d columns, want 2", len(res.Columns))
	}
	if len(res.Rows) != 4 {
		t.Fatalf("got %d region groups, want 4", len(res.Rows))
	}
	for _, col := range res.Columns {
		if col.Name == "" {
			t.Error("result column has an empty name")
		}
	}

	// A join must work: every non-trivial question in this product is a join,
	// and fan-out detection depends on the shape being right.
	joined, err := c.Query(ctx(t), `
		SELECT r.manager, SUM(o.total) AS revenue
		FROM orders o JOIN regions r ON r.region = o.region
		GROUP BY r.manager ORDER BY r.manager`)
	if err != nil {
		t.Fatalf("join query: %v", err)
	}
	if len(joined.Rows) != 4 {
		t.Errorf("join produced %d rows, want 4", len(joined.Rows))
	}
}

// testNulls pins how absence crosses the wire.
//
// The verification engine compares two independent derivations numerically. If
// one connector returns Go nil for an absent value and another returns the
// string "NULL" or "", the two derivations disagree over data that is
// identical, and the product reports `contested` — telling a user their
// warehouse is inconsistent when only the connector is.
func testNulls(t *testing.T, target Target) {
	c := connect(t, target)
	res, err := c.Query(ctx(t), `SELECT memo FROM orders WHERE order_id = 2`)
	if err != nil {
		t.Fatalf("null query: %v", err)
	}
	if len(res.Rows) != 1 || len(res.Rows[0]) != 1 {
		t.Fatalf("got shape %dx%d, want 1x1", len(res.Rows), len(res.Columns))
	}
	if v := res.Rows[0][0]; v != nil {
		t.Errorf("an empty CSV field came back as %#v (%T), want nil — "+
			"a connector that invents \"\" or \"NULL\" makes two identical "+
			"derivations disagree", v, v)
	}

	// COUNT over a nullable column must skip nulls, which is SQL's rule and
	// not every engine's default for empty strings.
	cnt, err := c.Query(ctx(t), `SELECT COUNT(memo) AS n FROM orders`)
	if err != nil {
		t.Fatalf("count query: %v", err)
	}
	// orders.csv has 8 rows; 4 carry a memo and 4 leave the field empty.
	if got := asInt(t, cnt.Rows[0][0]); got != 4 {
		t.Errorf("COUNT(memo) = %d, want 4 (4 of the 8 fixture rows have an empty memo)", got)
	}
}

// testTimezone guards the wall-clock contract.
//
// A timezone-naive TIMESTAMP must round-trip with the clock reading it was
// written with. Interpreting it in the host's zone and re-serializing shifts
// every value by the host offset: a midnight bucket lands on the previous day,
// and every month label downstream is wrong for anyone east or west of UTC.
func testTimezone(t *testing.T, target Target) {
	c := connect(t, target)
	res, err := c.Query(ctx(t), `SELECT placed_at FROM orders WHERE order_id = 4`)
	if err != nil {
		t.Fatalf("timestamp query: %v", err)
	}
	got := strings.ToUpper(toString(res.Rows[0][0]))
	// Fixture value is 2023-02-14 00:15:00 — deliberately just after midnight,
	// so any offset shift moves it to the previous day and is unmissable.
	if !strings.Contains(got, "2023-02-14") || !strings.Contains(got, "00:15") {
		t.Errorf("timestamp came back as %q, want the wall clock 2023-02-14 00:15 preserved; "+
			"a host-offset shift moves this to 13 February and every period label with it", got)
	}
}

// ---------------------------------------------------------------- safety

// writeForms must every one be refused. A connector that permits any of these
// is a connector that lets a model mutate the warehouse it is describing.
var writeForms = []string{
	`INSERT INTO orders (order_id) VALUES (99)`,
	`UPDATE orders SET total = 0`,
	`DELETE FROM orders`,
	`DROP TABLE orders`,
	`TRUNCATE orders`,
	`ALTER TABLE orders ADD COLUMN x INTEGER`,
	`CREATE TABLE evil (id INTEGER)`,
	`CREATE OR REPLACE VIEW v AS SELECT 1`,
	`SELECT 1; DROP TABLE orders`,
	`SELECT 1; -- harmless
	 DELETE FROM orders`,
	`SELECT 1 /* hidden */; UPDATE orders SET total = 0`,
}

func testReadOnly(t *testing.T, target Target) {
	c := connect(t, target)
	for _, sql := range writeForms {
		if _, err := c.Query(ctx(t), sql); err == nil {
			t.Errorf("write was PERMITTED: %s", oneLine(sql))
		}
	}

	// The mirror failure: rejecting legitimate SQL because a keyword appears
	// inside a string literal or a quoted identifier. That teaches people to
	// route around the guard, which is its own security failure.
	for _, sql := range []string{
		`SELECT * FROM orders WHERE memo = 'create'`,
		`SELECT * FROM orders WHERE memo = 'drop table orders'`,
		`SELECT * FROM orders WHERE memo = 'a;b'`,
		`SELECT COUNT(*) AS "Delete Count" FROM orders`,
	} {
		if _, err := c.Query(ctx(t), sql); err != nil {
			t.Errorf("legitimate query REJECTED: %s\n  %v", oneLine(sql), err)
		}
	}
}

// hostReads are escapes out of the warehouse that this suite knows about.
//
// The DuckDB lockdown that closed this hole is engine-specific. A Postgres
// connector inherits none of it and reopens the same arbitrary-file-read with
// pg_read_file. This assertion is where that gets caught, for every connector,
// before it ships.
var hostReads = []string{
	`SELECT * FROM read_csv_auto('/etc/passwd')`,
	`SELECT * FROM read_csv('/etc/passwd')`,
	`SELECT * FROM read_parquet('/etc/passwd')`,
	`SELECT * FROM read_json_auto('/etc/passwd')`,
	`SELECT * FROM glob('/etc/*')`,
	`SELECT * FROM '/etc/passwd'`,
	`SELECT * FROM 'https://example.com/data.parquet'`,
	`SELECT * FROM read_csv_auto('https://example.com/data.csv')`,
}

func testHostReads(t *testing.T, target Target) {
	c := connect(t, target)
	all := append(append([]string{}, hostReads...), target.ExtraHostReads...)
	for _, sql := range all {
		res, err := c.Query(ctx(t), sql)
		if err == nil {
			t.Errorf("HOST READ PERMITTED (arbitrary file/network disclosure): %s\n  returned %d rows",
				oneLine(sql), len(res.Rows))
		}
	}
	if len(target.ExtraHostReads) == 0 {
		t.Logf("note: %s declared no ExtraHostReads. The base list covers DuckDB-style "+
			"readers only. If this engine has its own (pg_read_file, LOAD_FILE, url(), "+
			"COPY FROM PROGRAM), add them — this suite cannot guess them.", target.Name)
	}
}

// ---------------------------------------------------------------- helpers

func findTable(cat *warehouse.Catalog, name string) *warehouse.Table {
	for i := range cat.Tables {
		if strings.EqualFold(cat.Tables[i].Name, name) {
			return &cat.Tables[i]
		}
	}
	return nil
}

func findColumn(t *warehouse.Table, name string) *warehouse.Column {
	for i := range t.Columns {
		if strings.EqualFold(t.Columns[i].Name, name) {
			return &t.Columns[i]
		}
	}
	return nil
}

func asInt(t *testing.T, v any) int64 {
	t.Helper()
	switch n := v.(type) {
	case int64:
		return n
	case int32:
		return int64(n)
	case int:
		return int64(n)
	case float64:
		return int64(n)
	default:
		t.Fatalf("expected a number, got %#v (%T)", v, v)
		return 0
	}
}

// toString renders a driver value for comparison. Connectors are free to
// return a time.Time or a pre-formatted string; both must carry the same wall
// clock, which is what the timezone assertion reads.
func toString(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case []byte:
		return string(s)
	case time.Time:
		return s.Format(time.RFC3339)
	default:
		return fmt.Sprint(v)
	}
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

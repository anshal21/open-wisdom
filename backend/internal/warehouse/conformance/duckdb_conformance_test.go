package conformance_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/marcboeker/go-duckdb/v2"

	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse/conformance"
)

// TestDuckDBConformance is both a regression test for the reference connector
// and the worked example a contributor copies.
//
// The shape to notice: the harness loads the fixture CSVs however the engine
// prefers, then hands the suite a connector opened through the ORDINARY path.
// Testing a specially-constructed handle would prove nothing about what
// production does.
func TestDuckDBConformance(t *testing.T) {
	conformance.Run(t, conformance.Target{
		Name: "duckdb",
		Connect: func(t *testing.T) warehouse.Connector {
			path := buildFixture(t)
			conn, err := warehouse.Open("duckdb", path, warehouse.Options{})
			if err != nil {
				t.Fatalf("open fixture through the registry: %v", err)
			}
			return conn
		},
		// DuckDB's escapes are the ones in the suite's base list, so there is
		// nothing engine-specific to add here. A Postgres connector would list
		// pg_read_file and COPY FROM PROGRAM.
		ExtraHostReads: nil,
	})
}

// buildFixture materializes the CSVs into a DuckDB file.
//
// This uses a RAW driver handle, deliberately. warehouse.Open returns a
// read-only connector with the filesystem locked down — it cannot create
// tables and it cannot read a CSV, which is exactly the property the suite
// then verifies. Loading fixtures is a setup concern that lives outside the
// boundary being tested.
func buildFixture(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "conformance.duckdb")

	db, err := sql.Open("duckdb", path)
	if err != nil {
		t.Fatalf("create fixture database: %v", err)
	}
	defer db.Close()

	testdata, err := filepath.Abs("testdata")
	if err != nil {
		t.Fatalf("resolve testdata: %v", err)
	}

	// Types are declared explicitly rather than sniffed. The suite asserts how
	// a DATE and a TIMESTAMP are classified, so letting the loader guess would
	// make the test's subject depend on inference rather than on the schema.
	stmts := []string{
		`CREATE TABLE orders (
			order_id  INTEGER,
			placed_on DATE,
			placed_at TIMESTAMP,
			region    VARCHAR,
			total     DECIMAL(10,2),
			items     INTEGER,
			is_gift   BOOLEAN,
			memo      VARCHAR
		)`,
		`INSERT INTO orders SELECT * FROM read_csv('` + filepath.Join(testdata, "orders.csv") + `',
			header = true, nullstr = '',
			columns = {
				'order_id':  'INTEGER',
				'placed_on': 'DATE',
				'placed_at': 'TIMESTAMP',
				'region':    'VARCHAR',
				'total':     'DECIMAL(10,2)',
				'items':     'INTEGER',
				'is_gift':   'BOOLEAN',
				'memo':      'VARCHAR'
			})`,
		`CREATE TABLE regions (
			region    VARCHAR,
			manager   VARCHAR,
			opened_on DATE
		)`,
		`INSERT INTO regions SELECT * FROM read_csv('` + filepath.Join(testdata, "regions.csv") + `',
			header = true, nullstr = '',
			columns = {
				'region':    'VARCHAR',
				'manager':   'VARCHAR',
				'opened_on': 'DATE'
			})`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("load fixture: %v\n%s", err, s)
		}
	}
	return path
}

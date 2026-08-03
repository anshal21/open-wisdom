package conformance_test

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	sf "github.com/snowflakedb/gosnowflake"

	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse/conformance"
)

// snowflakeEnv gates the live suite. It must point at an account where the
// configured role can CREATE SCHEMA in the configured database — the suite
// builds its fixture in a throwaway schema and drops it afterwards.
//
//	ANALYST_TEST_SNOWFLAKE_DSN='user:${SNOWFLAKE_PASSWORD}@acct/TESTDB?warehouse=WH' \
//	  go test ./internal/warehouse/conformance -run TestSnowflakeConformance -v
const snowflakeEnv = "ANALYST_TEST_SNOWFLAKE_DSN"

// TestSnowflakeConformance runs the full connector contract against a live
// account.
//
// The skip carries [needs-live-warehouse]: like [needs-real-provider] for the
// model suites, it marks a test whose subject is an external system CI does
// not have, and the CI gate accepts exactly these two markers. Every other
// skip fails the build.
func TestSnowflakeConformance(t *testing.T) {
	dsn := os.Getenv(snowflakeEnv)
	if dsn == "" {
		t.Skipf("[needs-live-warehouse] set %s to run the Snowflake conformance suite against a live account", snowflakeEnv)
	}

	schema := fmt.Sprintf("ANALYST_CONFORMANCE_%d", os.Getpid())
	loadSnowflakeFixture(t, dsn, schema)

	conformance.Run(t, conformance.Target{
		Name: "snowflake",
		Connect: func(t *testing.T) warehouse.Connector {
			conn, err := warehouse.Open("snowflake", withSchema(dsn, schema), warehouse.Options{})
			if err != nil {
				t.Fatalf("open snowflake through the registry: %v", err)
			}
			return conn
		},
		// The escapes this engine adds beyond the base suite: stages are a
		// file store reachable from SELECT, and scoped URLs mint public
		// download links to stage files. snowflakeGuard must refuse them all;
		// asserting it here means a regression is caught by the same suite a
		// contributor runs.
		ExtraHostReads: []string{
			"SELECT $1 FROM @~",
			"SELECT $1 FROM @%orders",
			"LIST @~",
			"SELECT GET_PRESIGNED_URL(@~, 'x.csv')",
			"EXECUTE IMMEDIATE 'SELECT 1'",
		},
	})
}

// loadSnowflakeFixture creates a throwaway schema and loads the suite's CSVs
// through a RAW driver handle — deliberately outside the connector, which is
// read-only and must stay that way (the same reasoning as the DuckDB
// fixture loader).
func loadSnowflakeFixture(t *testing.T, dsn, schema string) {
	t.Helper()

	resolved, err := warehouse.ResolveDSN(dsn)
	if err != nil {
		t.Fatalf("resolve dsn: %v", err)
	}
	cfg, err := sf.ParseDSN(resolved)
	if err != nil {
		t.Fatalf("parse dsn: %v", err)
	}
	connector := sf.NewConnector(sf.SnowflakeDriver{}, *cfg)
	db := sql.OpenDB(connector)
	t.Cleanup(func() {
		_, _ = db.Exec("DROP SCHEMA IF EXISTS " + schema + " CASCADE")
		db.Close()
	})

	stmts := []string{
		"CREATE SCHEMA " + schema,
		"USE SCHEMA " + schema,
		// Types declared explicitly, mirroring the DuckDB loader: the suite
		// asserts how a DATE and a TIMESTAMP_NTZ are classified, so the
		// loader must not let the engine sniff them.
		`CREATE TABLE orders (
			order_id  INTEGER,
			placed_on DATE,
			placed_at TIMESTAMP_NTZ,
			region    VARCHAR,
			total     NUMBER(10,2),
			items     INTEGER,
			is_gift   BOOLEAN,
			memo      VARCHAR
		)`,
		`CREATE TABLE regions (
			region    VARCHAR,
			manager   VARCHAR,
			opened_on DATE
		)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("fixture setup %q: %v", firstLine(s), err)
		}
	}

	insertCSV(t, db, "orders", filepath.Join("testdata", "orders.csv"))
	insertCSV(t, db, "regions", filepath.Join("testdata", "regions.csv"))
}

// insertCSV loads one CSV as multi-row INSERTs. The fixtures are tens of
// rows; a stage-based bulk load would be faster and is exactly the mechanism
// the connector exists to refuse, so plain INSERTs keep the loader boring.
func insertCSV(t *testing.T, db *sql.DB, table, path string) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()

	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if len(rows) < 2 {
		t.Fatalf("%s has no data rows", path)
	}

	var b strings.Builder
	b.WriteString("INSERT INTO " + table + " VALUES ")
	for i, row := range rows[1:] {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString("(")
		for j, cell := range row {
			if j > 0 {
				b.WriteString(", ")
			}
			if cell == "" {
				b.WriteString("NULL")
				continue
			}
			b.WriteString(warehouse.QuoteLiteral(cell))
		}
		b.WriteString(")")
	}
	if _, err := db.Exec(b.String()); err != nil {
		t.Fatalf("load %s: %v", table, err)
	}
}

func withSchema(dsn, schema string) string {
	if i := strings.Index(dsn, "?"); i >= 0 {
		return dsn[:i] + "/" + schema + dsn[i:]
	}
	return dsn + "/" + schema
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

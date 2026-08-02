package warehouse

import (
	"strings"
	"testing"
)

// The guard is the last gate before the engine on SQL the model wrote. Its two
// failure modes are equally serious:
//
//   - letting a read escape the warehouse (read_csv of a local file), which is
//     arbitrary file disclosure on any deployed instance;
//   - rejecting a legitimate question because a keyword appeared inside a
//     string literal, which teaches people to route around the guard.
//
// Every row below is one of those two claims.
func TestRejectWritesTable(t *testing.T) {
	cases := []struct {
		name   string
		sql    string
		reject bool
	}{
		// --- ordinary analytics must pass -------------------------------
		{"plain select", "SELECT 1", false},
		{"cte", "WITH a AS (SELECT 1) SELECT * FROM a", false},
		{"trailing semicolon", "SELECT 1;", false},
		{"line comment", "SELECT 1 -- comment\n", false},
		{
			"join aggregate with cte",
			`WITH recent AS (
			   SELECT order_id, sale_price FROM order_items WHERE created_at >= DATE '2023-01-01'
			 )
			 SELECT u.country, COUNT(*) AS n, SUM(r.sale_price) AS revenue
			 FROM recent r
			 JOIN orders o ON o.order_id = r.order_id
			 JOIN users u ON u.id = o.user_id
			 GROUP BY 1 ORDER BY revenue DESC`,
			false,
		},

		// --- keywords inside string literals are DATA, not code ----------
		{"literal create", "SELECT * FROM orders WHERE status = 'create'", false},
		{"literal delete", "SELECT * FROM audit WHERE action = 'delete'", false},
		{"literal drop table", "SELECT * FROM t WHERE note = 'drop table users'", false},
		{"literal with escaped quote", "SELECT * FROM t WHERE note = 'it''s a copy'", false},
		{"literal containing semicolon", "SELECT * FROM t WHERE note = 'a;b'", false},
		{"literal containing comment marker", "SELECT * FROM t WHERE note = 'a -- b'", false},

		// --- quoted identifiers are names, not code ----------------------
		{"quoted identifier", `SELECT "Load Factor" FROM t`, false},
		{"quoted identifier keyword", `SELECT "insert" FROM t`, false},
		{"quoted table name", `SELECT * FROM "update"`, false},

		// --- writes and DDL ----------------------------------------------
		{"insert", "INSERT INTO t VALUES (1)", true},
		{"update", "UPDATE t SET a = 1", true},
		{"delete", "DELETE FROM t", true},
		{"drop", "DROP TABLE users", true},
		{"truncate", "TRUNCATE t", true},
		{"alter", "ALTER TABLE t ADD COLUMN c INT", true},
		{"create", "CREATE TABLE t (a INT)", true},
		{"create as select", "CREATE TABLE t AS SELECT * FROM u", true},
		{"attach", "ATTACH 'x.db'", true},
		{"detach", "DETACH x", true},
		{"copy to", "COPY (SELECT 1) TO 'out.csv'", true},
		{"install", "INSTALL httpfs", true},
		{"load", "LOAD httpfs", true},
		{"empty", "", true},

		// --- statement stacking -------------------------------------------
		{"stacked", "SELECT 1; DROP TABLE users", true},
		{"stacked behind block comment", "select 1 /* hidden */ ; delete from orders", true},
		{"stacked behind line comment", "SELECT 1 -- x\n; DROP TABLE users", true},

		// --- settings changes from a bare SELECT --------------------------
		// A SELECT that flips engine configuration would undo the defence in
		// depth applied at connection time.
		{"set via select", "SELECT set_config('enable_external_access', 'true', false)", true},
		{"pragma", "PRAGMA disabled_filesystems=''", true},
		{"set", "SET enable_external_access=true", true},

		// --- THE VULNERABILITY: reads that escape the warehouse ------------
		{"read_csv_auto absolute path", "SELECT * FROM read_csv_auto('/etc/passwd')", true},
		{"read_csv", "SELECT * FROM read_csv('/etc/hosts')", true},
		{"read_parquet", "SELECT * FROM read_parquet('/tmp/x.parquet')", true},
		{"read_json_auto", "SELECT * FROM read_json_auto('/tmp/x.json')", true},
		{"read_json", "SELECT * FROM read_json('/tmp/x.json')", true},
		{"read_text", "SELECT * FROM read_text('/etc/passwd')", true},
		{"read_blob", "SELECT * FROM read_blob('/etc/passwd')", true},
		{"glob", "SELECT * FROM glob('/etc/*')", true},
		{"parquet_scan", "SELECT * FROM parquet_scan('/tmp/x.parquet')", true},
		{"csv_scan", "SELECT * FROM csv_scan('/tmp/x.csv')", true},
		{"iceberg_scan", "SELECT * FROM iceberg_scan('/tmp/x')", true},
		{"sniff_csv", "SELECT * FROM sniff_csv('/etc/passwd')", true},
		{"https url as table", "SELECT * FROM 'https://evil.example/x.csv'", true},
		{"http url as table", "SELECT * FROM 'http://evil.example/x.csv'", true},
		{"s3 url as table", "SELECT * FROM 's3://bucket/x.parquet'", true},
		{"bare csv path as table", "SELECT * FROM '/etc/passwd'", true},

		// A future engine release adding a new reader must be refused by
		// default rather than by our remembering to list it.
		{"hypothetical future reader", "SELECT * FROM read_avro('/tmp/x.avro')", true},
		{"hypothetical future scan", "SELECT * FROM delta_scan('/tmp/x')", true},

		// Nested inside a CTE or a join is the same escape.
		{"reader inside cte", "WITH a AS (SELECT * FROM read_csv_auto('/etc/passwd')) SELECT * FROM a", true},
		{"reader in join", "SELECT * FROM orders o JOIN read_csv_auto('/etc/passwd') p ON true", true},
		{"reader in subquery", "SELECT * FROM (SELECT * FROM read_parquet('/x')) z", true},

		// Case and whitespace must not be an evasion.
		{"reader uppercase", "SELECT * FROM READ_CSV_AUTO('/etc/passwd')", true},
		{"reader spaced paren", "SELECT * FROM read_csv_auto ('/etc/passwd')", true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := RejectWrites(c.sql)
			if (err != nil) != c.reject {
				t.Errorf("RejectWrites(%q)\n  err    = %v\n  reject = %v, want %v",
					c.sql, err, err != nil, c.reject)
			}
		})
	}
}

// Scalar functions that merely share a prefix with a reader must not be
// collateral damage — the guard rejects function-shaped TABLE sources, not
// every identifier containing "read".
func TestGuardDoesNotOverreachOnScalarFunctions(t *testing.T) {
	ok := []string{
		"SELECT count(*) FROM orders",
		"SELECT upper(name) FROM users",
		"SELECT date_trunc('month', created_at) FROM orders",
		"SELECT regexp_matches(name, 'read_csv') FROM users",
		"SELECT * FROM orders WHERE json_extract(payload, '$.a') = 1",
		// A column literally named read_count is not a table function.
		"SELECT read_count FROM articles",
		"SELECT SUM(thread_count) FROM t",
		// `replace` was on the forbidden-keyword list, which refused ordinary
		// string cleaning. It is a scalar function first and a DDL modifier
		// second; see the note on `forbidden`.
		"SELECT replace(sku, '-', '') FROM products",
		"SELECT REPLACE(name, 'a', 'b') AS n FROM users",
		"SELECT regexp_replace(name, '[0-9]+', '') FROM users",
	}
	for _, q := range ok {
		if err := RejectWrites(q); err != nil {
			t.Errorf("RejectWrites(%q) = %v, want allowed", q, err)
		}
	}
}

// TestReplaceStillBlockedAsDDL is the other half of dropping `replace` from the
// keyword list: allowing the scalar function must not open a catalog write.
// Both spellings reach the catalog only behind CREATE or INSERT, and those are
// what actually do the blocking.
func TestReplaceStillBlockedAsDDL(t *testing.T) {
	ddl := []string{
		"CREATE OR REPLACE VIEW v AS SELECT 1",
		"CREATE OR REPLACE TABLE t AS SELECT 1",
		"INSERT OR REPLACE INTO t VALUES (1)",
		"select 1; create or replace view v as select 1",
	}
	for _, q := range ddl {
		if err := RejectWrites(q); err == nil {
			t.Errorf("RejectWrites(%q) = nil, want rejection", q)
		}
	}
}

func TestGuardErrorsAreSpecific(t *testing.T) {
	// The operator reading a log needs to know which rule fired.
	if err := RejectWrites("SELECT * FROM read_csv_auto('/etc/passwd')"); err == nil {
		t.Fatal("expected rejection")
	} else if !strings.Contains(err.Error(), "read_csv_auto") {
		t.Errorf("error should name the offending function, got %q", err)
	}
	if err := RejectWrites("SELECT 1; DROP TABLE t"); err == nil {
		t.Fatal("expected rejection")
	} else if !strings.Contains(err.Error(), "multiple statements") {
		t.Errorf("error should explain stacking, got %q", err)
	}
}

package warehouse

import (
	"errors"
	"strings"
	"testing"
)

// Everything in this file runs with no Snowflake account. The live half of
// the contract — introspection shapes, type mapping, timezone handling — is
// the conformance suite (conformance/snowflake_conformance_test.go), which
// requires credentials and says so.

func TestSnowflakeGuardBlocksStageReads(t *testing.T) {
	// A stage is a file store reachable from SELECT. These are this engine's
	// read_csv_auto('/etc/passwd') — every one must be refused.
	hostile := []string{
		"SELECT $1 FROM @~",                          // user stage
		"SELECT $1 FROM @%orders",                    // table stage
		"SELECT $1 FROM @my_stage/exports/full.csv",  // named stage
		"SELECT t.$1 FROM @ext_stage (pattern=>'.*') t",
		"select metadata$filename from @s",
		"WITH x AS (SELECT $1 FROM @leak) SELECT * FROM x",
	}
	for _, q := range hostile {
		if err := snowflakeGuard(q); err == nil {
			t.Errorf("snowflakeGuard(%q) = nil, want rejection", q)
		} else if !errors.Is(err, ErrExternalRead) {
			t.Errorf("snowflakeGuard(%q) error is not ErrExternalRead: %v", q, err)
		}
	}
}

func TestSnowflakeGuardBlocksFileAndScriptingStatements(t *testing.T) {
	hostile := []string{
		"GET @~/data.csv file:///tmp/out",
		"PUT file:///etc/passwd @~",
		"LIST @my_stage",
		"REMOVE @my_stage/x.csv",
		"EXECUTE IMMEDIATE $$ BEGIN RETURN 1; END $$",
		"  execute immediate 'select 1'",
		"SELECT 1; GET @~/x file:///tmp/x", // second statement in a batch
	}
	for _, q := range hostile {
		if err := snowflakeGuard(q); err == nil {
			t.Errorf("snowflakeGuard(%q) = nil, want rejection", q)
		}
	}
}

func TestSnowflakeGuardBlocksURLMintingFunctions(t *testing.T) {
	hostile := []string{
		"SELECT GET_PRESIGNED_URL(@my_stage, 'x.csv')",
		"SELECT build_scoped_file_url(@s, 'f')",
		"SELECT BUILD_STAGE_FILE_URL(@s, 'f')",
		"SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))",
	}
	for _, q := range hostile {
		if err := snowflakeGuard(q); err == nil {
			t.Errorf("snowflakeGuard(%q) = nil, want rejection", q)
		}
	}
}

func TestSnowflakeGuardAllowsOrdinaryAnalytics(t *testing.T) {
	// The names the guard denies at statement START are ordinary identifiers
	// everywhere else — GET(v,'k') is the semi-structured accessor, `list` is
	// a fine column name, and an '@' inside a string literal is data.
	benign := []string{
		"SELECT sum(sale_price) FROM order_items WHERE year(created_at) = 2023",
		"SELECT GET(payload, 'status') FROM events",
		"SELECT list, count(*) FROM segments GROUP BY list",
		"SELECT * FROM users WHERE email = 'a@b.com'",
		"SELECT 'contact us @support' AS banner",
		"WITH t AS (SELECT 1 AS n) SELECT n FROM t QUALIFY row_number() OVER (ORDER BY n) = 1",
		"SELECT approx_percentile(x, 0.5) FROM m",
	}
	for _, q := range benign {
		if err := snowflakeGuard(q); err != nil {
			t.Errorf("snowflakeGuard(%q) = %v, want allowed", q, err)
		}
	}
}

func TestSnowflakeDialectIsHonest(t *testing.T) {
	d := (&Snowflake{}).Dialect()
	if !d.Metered {
		t.Fatal("Snowflake bills per credit; Metered=false would hide that verification doubles the bill")
	}
	// The engine has all five capabilities; the prompt line should carry no
	// limits section at all.
	if line := d.PromptLine(); strings.Contains(line, "Engine limits") {
		t.Fatalf("prompt line lists limits for an engine that has none: %q", line)
	}
}

func TestBuildSnowflakeDSNKeepsSecretReferences(t *testing.T) {
	dsn := BuildSnowflakeDSN("analyst", "${SNOWFLAKE_PASSWORD}", "xy12345.eu-west-1",
		"ANALYTICS", "PUBLIC", map[string]string{"warehouse": "WH", "role": "ANALYST_RO"})

	if !strings.Contains(dsn, "${SNOWFLAKE_PASSWORD}") {
		t.Fatalf("the env reference must survive verbatim for ResolveDSN; got %s", dsn)
	}
	if want := "analyst:${SNOWFLAKE_PASSWORD}@xy12345.eu-west-1/ANALYTICS/PUBLIC?role=ANALYST_RO&warehouse=WH"; dsn != want {
		t.Fatalf("dsn = %s, want %s", dsn, want)
	}
	// And the redactor must keep the reference legible (it names a secret
	// without being one) while masking a literal password.
	if red := RedactDSN(dsn); !strings.Contains(red, "${SNOWFLAKE_PASSWORD}") {
		t.Fatalf("redaction destroyed the env reference: %s", red)
	}
	literal := BuildSnowflakeDSN("analyst", "hunter2", "acct", "DB", "", nil)
	if red := RedactDSN(literal); strings.Contains(red, "hunter2") {
		t.Fatalf("a literal password survived redaction: %s", red)
	}
}

func TestSnowflakeRegistered(t *testing.T) {
	for _, k := range Registered() {
		if k == "snowflake" {
			return
		}
	}
	t.Fatalf("snowflake is not in the registry: %v", Registered())
}

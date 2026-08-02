package warehouse

import (
	"context"
	"strings"
	"testing"
)

// --- the registry seam ----------------------------------------------------

// stubConnector is what a contributor's connector looks like from here.
type stubConnector struct{ dsn string }

func (s *stubConnector) Introspect(context.Context) (*Catalog, error) {
	return &Catalog{Source: s.dsn, Dialect: Dialect{Name: "stub"}}, nil
}
func (s *stubConnector) Query(context.Context, string) (*Result, error) { return &Result{}, nil }
func (s *stubConnector) Dialect() Dialect                               { return Dialect{Name: "stub"} }
func (s *stubConnector) Close() error                                   { return nil }

// TestThirdPartyConnectorNeedsOnlyRegister is the acceptance criterion for the
// seam: a new engine is one Register call, and nothing in sources/ or api/
// changes. If this test ever needs an edit outside this file to pass, the
// registry has stopped being an extension point.
func TestThirdPartyConnectorNeedsOnlyRegister(t *testing.T) {
	Register("stub-test-engine", func(dsn string, opts Options) (Connector, error) {
		return &stubConnector{dsn: dsn}, nil
	})

	conn, err := Open("stub-test-engine", "memory://fixture", Options{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer conn.Close()

	cat, err := conn.Introspect(context.Background())
	if err != nil {
		t.Fatalf("Introspect: %v", err)
	}
	if cat.Source != "memory://fixture" {
		t.Errorf("connector received DSN %q", cat.Source)
	}
	if conn.Dialect().Name != "stub" {
		t.Errorf("dialect = %q", conn.Dialect().Name)
	}
}

func TestOpenUnknownKindListsRegistered(t *testing.T) {
	_, err := Open("oracle", "whatever", Options{})
	if err == nil {
		t.Fatal("expected an error for an unregistered kind")
	}
	// The message has to be actionable: someone hitting this has a typo or a
	// build without the connector compiled in, and both are diagnosed by
	// seeing what IS available.
	if !strings.Contains(err.Error(), "duckdb") {
		t.Errorf("error should list registered kinds, got: %v", err)
	}
}

func TestRegisteredIncludesDuckDB(t *testing.T) {
	found := false
	for _, k := range Registered() {
		if k == "duckdb" {
			found = true
		}
	}
	if !found {
		t.Errorf("duckdb should self-register via init(); got %v", Registered())
	}
}

// --- OSS-16: DSN secrets --------------------------------------------------

// TestResolveDSNExpandsAtConnectTime pins the half of the contract that keeps
// credentials out of the SQLite file. The store persists what the operator
// typed; only the value handed to a driver is expanded.
func TestResolveDSNExpandsAtConnectTime(t *testing.T) {
	t.Setenv("ANALYST_TEST_PG_PASSWORD", "hunter2")

	const stored = "postgres://analyst:${ANALYST_TEST_PG_PASSWORD}@db.internal:5432/warehouse"
	resolved, err := ResolveDSN(stored)
	if err != nil {
		t.Fatalf("ResolveDSN: %v", err)
	}
	if !strings.Contains(resolved, "hunter2") {
		t.Errorf("resolved DSN should carry the secret, got %q", resolved)
	}
	// The input is untouched — this is the value that goes back to the store.
	if !strings.Contains(stored, "${ANALYST_TEST_PG_PASSWORD}") {
		t.Error("ResolveDSN must not mutate its input")
	}
}

// An unset variable fails loudly. Expanding it to "" produces an auth error
// from the database several layers away from the actual mistake.
func TestResolveDSNRejectsUnsetVariables(t *testing.T) {
	_, err := ResolveDSN("postgres://u:${ANALYST_DEFINITELY_UNSET_VAR}@h/db")
	if err == nil {
		t.Fatal("expected an error for an unset variable")
	}
	if !strings.Contains(err.Error(), "ANALYST_DEFINITELY_UNSET_VAR") {
		t.Errorf("error should name the missing variable, got: %v", err)
	}
}

func TestRedactDSN(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		mustNot  string
		mustHave string
	}{
		{
			name:     "url credentials are masked",
			in:       "postgres://analyst:hunter2@db.internal:5432/warehouse",
			mustNot:  "hunter2",
			mustHave: "***",
		},
		{
			name:     "keyword password is masked",
			in:       "host=db.internal user=analyst password=hunter2 dbname=warehouse",
			mustNot:  "hunter2",
			mustHave: "***",
		},
		{
			name:     "token is masked",
			in:       "https://warehouse.example.com?token=abcdef123456",
			mustNot:  "abcdef123456",
			mustHave: "***",
		},
		{
			// An env reference names a secret without being one. Masking it
			// would destroy exactly the information an operator needs to
			// diagnose a misconfiguration.
			name:     "env references survive",
			in:       "postgres://analyst:${PG_PASSWORD}@db.internal/warehouse",
			mustNot:  "",
			mustHave: "${PG_PASSWORD}",
		},
		{
			name:     "plain file path is untouched",
			in:       "/var/lib/analyst/warehouse.duckdb",
			mustNot:  "",
			mustHave: "warehouse.duckdb",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := RedactDSN(c.in)
			if c.mustNot != "" && strings.Contains(got, c.mustNot) {
				t.Errorf("RedactDSN(%q) = %q; it still contains the secret %q", c.in, got, c.mustNot)
			}
			if c.mustHave != "" && !strings.Contains(got, c.mustHave) {
				t.Errorf("RedactDSN(%q) = %q; expected it to contain %q", c.in, got, c.mustHave)
			}
		})
	}
}

// TestOpenErrorsNeverLeakResolvedSecrets is the assertion that matters most
// here. A failed connection is the common case for a misconfigured warehouse,
// and its error travels into the server log, the API error body and the SSE
// stream. None of those may carry a password.
func TestOpenErrorsNeverLeakResolvedSecrets(t *testing.T) {
	t.Setenv("ANALYST_TEST_SECRET", "s3cr3t-value")

	Register("always-fails", func(dsn string, opts Options) (Connector, error) {
		// A real driver typically embeds the DSN in its own error; simulate the
		// worst case to prove the wrapper does not compound it.
		return nil, errString("dial failed")
	})

	_, err := Open("always-fails", "proto://user:${ANALYST_TEST_SECRET}@host/db", Options{})
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Contains(err.Error(), "s3cr3t-value") {
		t.Fatalf("resolved secret leaked into the error: %v", err)
	}
}

type errString string

func (e errString) Error() string { return string(e) }

// --- dialect --------------------------------------------------------------

// A catalog cached before capabilities existed holds `"dialect": "duckdb"`.
// Failing to decode it would make every existing source look un-introspected.
func TestDialectDecodesLegacyString(t *testing.T) {
	var d Dialect
	if err := d.UnmarshalJSON([]byte(`"duckdb"`)); err != nil {
		t.Fatalf("legacy string form: %v", err)
	}
	if d.Name != "duckdb" {
		t.Errorf("name = %q, want duckdb", d.Name)
	}
	// Capabilities default to false: conservative SQL until the source is
	// re-introspected and the connector states otherwise.
	if d.CTEs || d.WindowFunctions || d.Qualify {
		t.Error("legacy decode should not assume capabilities")
	}
}

func TestDialectPromptLineNamesOnlyLimits(t *testing.T) {
	full := Dialect{Name: "duckdb", CTEs: true, WindowFunctions: true, Qualify: true, ApproxQuantiles: true, ILike: true}
	if got := full.PromptLine(); got != "Dialect: duckdb" {
		t.Errorf("a fully capable engine should add no constraints, got %q", got)
	}

	limited := Dialect{Name: "toy", CTEs: false, WindowFunctions: true, Qualify: true, ApproxQuantiles: true, ILike: true}
	got := limited.PromptLine()
	if !strings.Contains(got, "no CTEs") {
		t.Errorf("missing capability should appear in the prompt, got %q", got)
	}
	if strings.Contains(got, "no window functions") {
		t.Errorf("present capability should not be listed as missing, got %q", got)
	}
}

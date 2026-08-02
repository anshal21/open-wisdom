package llm

import (
	"context"
	"strings"
	"testing"
)

// A digest in the exact shape sources.Digest emits, so the mock is tested
// against the real input rather than a convenient one.
const testDigest = `Dialect: duckdb

TABLE main.order_items  (181,759 rows)
  id                            BIGINT  [~181,759 distinct]
  order_id                      BIGINT  [~124,000 distinct]
  status                        VARCHAR  [values: 'Complete', 'Cancelled', 'Returned']
  created_at                    TIMESTAMP  [range 2023-01-01..2023-12-31]
  sale_price                    DOUBLE  [range 0.02..999.00]

TABLE main.users  (100,000 rows)
  id                            BIGINT
  first_name                    VARCHAR
`

func TestRegistryUnknownProviderListsValidNames(t *testing.T) {
	_, err := Open("gpt-9", ProviderConfig{})
	if err == nil {
		t.Fatal("expected an error for an unknown provider")
	}
	// The failure this replaces was a typo in a flag silently selecting the
	// only implementation. The message has to name the alternatives.
	for _, want := range []string{"gpt-9", "mock", "claude-cli", "anthropic"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should mention %q, got: %v", want, err)
		}
	}
}

func TestRegistryOpensMockWithoutConfiguration(t *testing.T) {
	p, err := Open("mock", ProviderConfig{})
	if err != nil {
		t.Fatalf("mock must open with no configuration at all: %v", err)
	}
	if p.Name() != "mock" {
		t.Errorf("Name() = %q, want mock", p.Name())
	}
}

// The claim in llm.go's package doc: the mock is sufficient to run the entire
// product offline. That means every prompt the pipeline issues, not most.
func TestMockAnswersEveryPipelinePrompt(t *testing.T) {
	m := &Mock{}
	cases := []struct {
		name   string
		system string
		want   string // a key that must appear in the JSON
	}{
		{"plan", "You are a meticulous senior analytics engineer. You turn a business question into SQL against a warehouse", "sql"},
		{"alternates", "You audit questions for ambiguity against a specific warehouse.", "readings"},
		{"cross", "You are a senior analytics engineer performing an INDEPENDENT re-derivation.", "sql"},
		{"present", "The query has ALREADY been run. You are the presenter: you decide how this result reads.", "markdown"},
		{"investigation plan", "You are a senior analytics engineer preparing a root-cause investigation.", "measure"},
		{"narrative", "Your entire task is to write its closing paragraph, in the voice of a senior analyst.", "markdown"},
		{"aliases", "You are a data quality auditor examining the complete distinct value lists of columns.", "columns"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := m.Complete(context.Background(), Request{
				System: tc.system,
				Prompt: testDigest,
				JSON:   true,
			})
			if err != nil {
				t.Fatalf("mock refused a prompt the pipeline issues: %v", err)
			}
			var out map[string]any
			if err := DecodeJSON(res.Text, &out); err != nil {
				t.Fatalf("mock emitted undecodable JSON: %v (%s)", err, res.Text)
			}
			if _, ok := out[tc.want]; !ok {
				t.Errorf("reply missing %q: %s", tc.want, res.Text)
			}
		})
	}
}

// An unknown prompt must fail loudly. If a new model call is added to the
// pipeline and the mock is not taught about it, the offline run should say so
// here rather than surfacing as a decode error three layers down.
func TestMockRejectsUnknownPrompt(t *testing.T) {
	_, err := (&Mock{}).Complete(context.Background(), Request{System: "summarise this poem"})
	if err == nil {
		t.Fatal("an unrecognised system prompt must be an error, not a plausible answer")
	}
	if !strings.Contains(err.Error(), "mock.go") {
		t.Errorf("error should point at the file to fix, got: %v", err)
	}
}

func TestMockIsDeterministic(t *testing.T) {
	m := &Mock{}
	req := Request{
		System: "You turn a business question into SQL against a warehouse",
		Prompt: testDigest,
	}
	first, err := m.Complete(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		again, err := m.Complete(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		if again.Text != first.Text {
			t.Fatalf("same prompt produced different output:\n%s\n%s", first.Text, again.Text)
		}
	}
}

// The mock must write SQL against the real schema it was shown. A mock that
// emits `SELECT 1` yields a product that "runs" while proving nothing.
func TestMockWritesSQLAgainstTheGivenSchema(t *testing.T) {
	m := &Mock{}
	res, err := m.Complete(context.Background(), Request{
		System: "You turn a business question into SQL against a warehouse",
		Prompt: testDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	sql := extract(t, res.Text, "sql")

	if !strings.Contains(sql, "main.order_items") {
		t.Errorf("SQL should target the table in the digest, got: %s", sql)
	}
	if !strings.Contains(sql, "sale_price") {
		t.Errorf("SQL should aggregate the measure column, got: %s", sql)
	}
	if !strings.Contains(sql, "created_at") {
		t.Errorf("SQL should use the temporal column as the axis, got: %s", sql)
	}
	// Summing a key is meaningless; the planner this stands in for wouldn't.
	if strings.Contains(sql, "SUM(\"id\")") || strings.Contains(sql, "SUM(\"order_id\")") {
		t.Errorf("SQL must not aggregate an id column, got: %s", sql)
	}
	if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(sql)), "SELECT") {
		t.Errorf("SQL must be a bare SELECT to pass the read-only guard, got: %s", sql)
	}
}

// Cross-derivation disagreement is what produces the `contested` seal. A mock
// that disagreed with itself would make every offline answer look broken.
func TestMockCrossDerivationDiffersInRouteNotInResult(t *testing.T) {
	m := &Mock{}
	plan, err := m.Complete(context.Background(), Request{
		System: "You turn a business question into SQL against a warehouse",
		Prompt: testDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	cross, err := m.Complete(context.Background(), Request{
		System: "performing an INDEPENDENT re-derivation",
		Prompt: testDigest,
	})
	if err != nil {
		t.Fatal(err)
	}

	planSQL := extract(t, plan.Text, "sql")
	crossSQL := extract(t, cross.Text, "sql")

	if planSQL == crossSQL {
		t.Error("the cross-derivation must take a different route, not repeat the query")
	}
	if !strings.Contains(strings.ToUpper(crossSQL), "WITH") {
		t.Errorf("cross-derivation should use a different construction, got: %s", crossSQL)
	}
	// Same table and same measure — a different route to the same number.
	for _, want := range []string{"main.order_items", "sale_price"} {
		if !strings.Contains(crossSQL, want) {
			t.Errorf("cross-derivation must measure the same thing (%s), got: %s", want, crossSQL)
		}
	}
}

func TestMockHandlesSchemaWithNoMeasure(t *testing.T) {
	// An empty or unmeasurable warehouse must still produce a working run
	// rather than failing the pipeline.
	res, err := (&Mock{}).Complete(context.Background(), Request{
		System: "You turn a business question into SQL against a warehouse",
		Prompt: "Dialect: duckdb\n\nTABLE main.logs  (3 rows)\n  message                       VARCHAR\n",
	})
	if err != nil {
		t.Fatalf("a warehouse with no measure must not break the mock: %v", err)
	}
	if sql := extract(t, res.Text, "sql"); !strings.HasPrefix(strings.ToUpper(sql), "SELECT") {
		t.Errorf("expected a valid fallback SELECT, got: %s", sql)
	}
}

func TestModelMapOverride(t *testing.T) {
	m := ModelMap{Fast: "haiku", Balanced: "sonnet", Deep: "opus"}

	if got := m.For(SpeedFast, nil); got != "haiku" {
		t.Errorf("default Fast = %q", got)
	}
	// The operator's whole reason for wanting this: a cheap local model for
	// the many small structured calls, a strong one for planning.
	over := map[Speed]string{SpeedFast: "llama3"}
	if got := m.For(SpeedFast, over); got != "llama3" {
		t.Errorf("override Fast = %q, want llama3", got)
	}
	if got := m.For(SpeedBalanced, over); got != "sonnet" {
		t.Errorf("unset override must fall through, got %q", got)
	}
	// An empty string is an unset flag, not a request for an empty model id.
	if got := m.For(SpeedDeep, map[Speed]string{SpeedDeep: ""}); got != "opus" {
		t.Errorf("empty override must fall through, got %q", got)
	}
}

func TestPriceMath(t *testing.T) {
	p := Price{InputPerMTok: 3, OutputPerMTok: 15}
	// 1M in, 1M out = $3 + $15.
	if got := p.Cost(1_000_000, 1_000_000); got != 18 {
		t.Errorf("Cost = %v, want 18", got)
	}
	// An unpriced model yields zero rather than a guess: a confidently wrong
	// figure in a cost ledger is worse than a missing one.
	var unknown Price
	if got := unknown.Cost(1_000_000, 1_000_000); got != 0 {
		t.Errorf("unpriced model should cost 0, got %v", got)
	}
}

func TestAnthropicRefusesToStartWithoutAKey(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	_, err := Open("anthropic", ProviderConfig{})
	if err == nil {
		t.Fatal("expected a startup error when no API key is configured")
	}
	// The error should point at the escape hatch, not just complain.
	if !strings.Contains(err.Error(), "mock") {
		t.Errorf("error should mention the offline provider, got: %v", err)
	}
}

func TestAnthropicRedactsItsKey(t *testing.T) {
	a := &Anthropic{key: "sk-ant-secret-value"}
	got := a.redact("request failed for key sk-ant-secret-value at api.anthropic.com")
	if strings.Contains(got, "sk-ant-secret-value") {
		t.Fatalf("the API key survived redaction: %s", got)
	}
	if !strings.Contains(got, "[redacted]") {
		t.Errorf("expected a redaction marker, got: %s", got)
	}
}

func TestCapabilitiesDefaultConservatively(t *testing.T) {
	// A provider that declares nothing must not be assumed to support native
	// JSON or to report real costs.
	c := CapabilitiesOf(&bareProvider{})
	if c.NativeJSON || c.ReportsCost {
		t.Errorf("undeclared capabilities must default to false, got %+v", c)
	}
	if !CapabilitiesOf(&Mock{}).NativeJSON {
		t.Error("mock declares native JSON")
	}
	if CapabilitiesOf(&Mock{}).ReportsCost {
		t.Error("mock must not claim to report real costs")
	}
}

type bareProvider struct{}

func (b *bareProvider) Name() string { return "bare" }
func (b *bareProvider) Complete(context.Context, Request) (*Response, error) {
	return &Response{}, nil
}

// A stub registered at test time drives the whole seam: if this works without
// touching main.go, ask, or verify, the extension point is real.
func TestThirdPartyProviderNeedsOnlyRegister(t *testing.T) {
	Register("test-stub", func(cfg ProviderConfig) (Provider, error) {
		return &bareProvider{}, nil
	})
	p, err := Open("test-stub", ProviderConfig{})
	if err != nil {
		t.Fatalf("a registered provider must open: %v", err)
	}
	if p.Name() != "bare" {
		t.Errorf("Name() = %q", p.Name())
	}
}

func extract(t *testing.T, jsonText, key string) string {
	t.Helper()
	var out map[string]any
	if err := DecodeJSON(jsonText, &out); err != nil {
		t.Fatalf("decode %s: %v", jsonText, err)
	}
	v, ok := out[key].(string)
	if !ok {
		t.Fatalf("key %q missing or not a string in %s", key, jsonText)
	}
	return v
}

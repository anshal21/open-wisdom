package conformance

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
)

var (
	providerName = flag.String("provider", "mock",
		"model provider to score, e.g. mock, claude-cli, anthropic")
	onlyCase = flag.String("case", "",
		"run only cases whose name contains this substring")
	timeout = flag.Duration("suite-timeout", 20*time.Minute,
		"wall-clock limit for the whole run; a hosted provider on 12 cases is ~48 calls")
)

// TestConformance scores a provider and prints the report.
//
// It does not fail on a low score. That is deliberate and is the whole design:
// the suite exists to make a provider's quality VISIBLE so a reviewer can
// decide, not to encode one project's threshold as a pass/fail. A hidden gate
// would answer "is this merged?" while hiding "is this good enough to trust a
// `verified` seal from?" — which is the only question that matters.
//
// It fails only when the suite itself could not run.
//
//	go test ./internal/llm/conformance -run TestConformance -v
//	go test ./internal/llm/conformance -run TestConformance -v -provider claude-cli
//	go test ./internal/llm/conformance -run TestConformance -v -provider mock -case revenue
func TestConformance(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	p, err := llm.Open(*providerName, llm.ProviderConfig{
		MaxConcurrent: 4,
		Timeout:       5 * time.Minute,
	})
	if err != nil {
		t.Fatalf("open provider: %v", err)
	}

	rep := Run(ctx, p, Options{Only: *onlyCase})
	if rep.Setup != nil {
		t.Fatalf("suite could not run: %v", rep.Setup)
	}

	t.Log("\n" + rep.String())

	// Also write the report to a file when asked, so CI can attach it.
	if out := os.Getenv("ANALYST_CONFORMANCE_OUT"); out != "" {
		if err := os.WriteFile(out, []byte(rep.String()), 0o644); err != nil {
			t.Errorf("write report: %v", err)
		}
	}

	if passed, total := rep.Score(""); total == 0 {
		t.Fatal("no assertions ran — the suite is not exercising the provider")
	} else {
		t.Logf("%s scored %d/%d", *providerName, passed, total)
	}
}

// TestPromptsLoadFromSource guards the mechanism the whole suite rests on: the
// prompts are read from internal/ask/prompts.go rather than copied. If someone
// renames a prompt constant, this fails at the rename instead of the suite
// quietly scoring providers against text the product no longer sends.
func TestPromptsLoadFromSource(t *testing.T) {
	p, err := LoadPrompts()
	if err != nil {
		t.Fatalf("load prompts: %v", err)
	}
	for name, got := range map[string]string{
		"plan": p.Plan, "alternates": p.Alternates,
		"cross": p.Cross, "present": p.Present,
	} {
		if len(got) < 200 {
			t.Errorf("%s prompt is %d bytes — suspiciously short, check the parser", name, len(got))
		}
	}
	// planSystem is assembled as a literal + sqlRules + a literal. If constant
	// folding broke, the shared rules would silently vanish from the prompt and
	// providers would be scored without the constraints the product imposes.
	if !strings.Contains(p.Plan, "Read-only. A single SELECT") {
		t.Error("plan prompt is missing sqlRules — constant concatenation was not folded")
	}
	if !strings.Contains(p.Alternates, "Read-only. A single SELECT") {
		t.Error("alternates prompt is missing sqlRules")
	}
}

// TestMateriallyDifferent pins the independence rule.
//
// This is the assertion that stops a provider from manufacturing a `verified`
// seal by emitting the same query twice, so its own semantics are worth testing
// directly rather than only through a provider.
func TestMateriallyDifferent(t *testing.T) {
	const base = "SELECT sum(sale_price) AS total FROM order_items WHERE year(created_at) = 2023"

	same := []struct{ name, alt string }{
		{"identical", base},
		{"whitespace", "SELECT   sum(sale_price) AS total\nFROM order_items\n  WHERE year(created_at) = 2023"},
		{"keyword casing", "select sum(sale_price) as total from order_items where year(created_at) = 2023"},
		{"different alias", "SELECT sum(sale_price) AS revenue FROM order_items WHERE year(created_at) = 2023"},
		{"quoted identifiers", `SELECT sum("sale_price") AS total FROM "order_items" WHERE year("created_at") = 2023`},
		{"trailing semicolon", base + ";"},
		{"line comment", base + " -- independent derivation"},
	}
	for _, c := range same {
		t.Run("copy/"+c.name, func(t *testing.T) {
			if materiallyDifferent(base, c.alt) {
				t.Errorf("cosmetic change counted as an independent derivation:\n%s", c.alt)
			}
		})
	}

	different := []struct{ name, alt string }{
		{"CTE route", "WITH r AS (SELECT sale_price p, created_at c FROM order_items) SELECT sum(p) FROM r WHERE year(c) = 2023"},
		{"different table", "SELECT sum(oi.sale_price) FROM orders o JOIN order_items oi ON oi.order_id = o.order_id WHERE year(oi.created_at) = 2023"},
		{"different predicate", "SELECT sum(sale_price) FROM order_items WHERE created_at >= '2023-01-01' AND created_at < '2024-01-01'"},
	}
	for _, c := range different {
		t.Run("independent/"+c.name, func(t *testing.T) {
			if !materiallyDifferent(base, c.alt) {
				t.Errorf("genuinely different route counted as a copy:\n%s", c.alt)
			}
		})
	}
}

// TestReportRendersScore keeps the pasteable output honest: a reader must be
// able to see the denominator, not just a percentage.
func TestReportRendersScore(t *testing.T) {
	r := &Report{Provider: "stub"}
	c := Case{Name: "x"}
	r.add(c, CatStructured, "a", true, "")
	r.add(c, CatStructured, "b", false, "because")
	r.add(c, CatGroundTruth, "c", true, "")

	out := r.String()
	for _, want := range []string{"structured output", "1 | 2", "overall", "**2**", "**3**", "because"} {
		if !strings.Contains(out, want) {
			t.Errorf("report missing %q:\n%s", want, out)
		}
	}
}

/* --------------------------------------------------------------------------
   Deliberate degradation

   A conformance suite nobody has watched fail is a conformance suite nobody
   should trust. These two stubs are broken in the exact ways a real provider
   degrades — quietly, while still returning well-formed JSON — and assert that
   the score moves.
-------------------------------------------------------------------------- */

// copycat answers every prompt correctly EXCEPT that its "independent"
// derivation is the primary query verbatim. This is the failure the whole
// product is most exposed to: two identical queries always agree, so every
// answer earns a `verified` seal that carries no evidence at all.
type copycat struct{ p *Prompts }

func (c *copycat) Name() string { return "copycat" }

func (c *copycat) Complete(_ context.Context, req llm.Request) (*llm.Response, error) {
	const sql = "SELECT count(*) AS n FROM users"
	var body string
	switch req.System {
	case c.p.Plan:
		body = `{"restated":"row count","assumptions":[],"unit":"count","format_hint":"integer","label":"Users","sql":"` + sql + `"}`
	case c.p.Alternates:
		body = `{"readings":[]}`
	case c.p.Cross:
		// The copy. Same statement, presented as an independent route.
		body = `{"sql":"` + sql + `","approach":"counted the users table"}`
	case c.p.Present:
		body = `{"markdown":"There are some users.","chart":{"type":"scalar","x":"","y":[],"series":""}}`
	default:
		return nil, fmt.Errorf("copycat: unexpected prompt")
	}
	return &llm.Response{Text: body, Model: "copycat"}, nil
}

// TestSuiteCatchesCopiedDerivation proves the independence category has teeth.
func TestSuiteCatchesCopiedDerivation(t *testing.T) {
	p, err := LoadPrompts()
	if err != nil {
		t.Fatalf("load prompts: %v", err)
	}
	rep := Run(context.Background(), &copycat{p: p}, Options{})
	if rep.Setup != nil {
		t.Skipf("suite could not run: %v", rep.Setup)
	}

	passed, total := rep.Score(CatIndependent)
	if total == 0 {
		t.Fatal("no independence assertions ran")
	}
	if passed != 0 {
		t.Errorf("a provider that copies its own query scored %d/%d on independence; "+
			"the check that produces the `verified` seal is not doing anything", passed, total)
	}

	// The rest of the suite must still pass, or this test proves nothing about
	// the independence category specifically.
	if sp, st := rep.Score(CatStructured); sp != st {
		t.Errorf("copycat should be structurally valid, got %d/%d", sp, st)
	}
	t.Logf("\n%s", rep.String())
}

// hallucinator returns well-formed JSON whose SQL names a column that does not
// exist. A provider can degrade this way while looking perfectly healthy to a
// JSON-shape check.
type hallucinator struct{ p *Prompts }

func (h *hallucinator) Name() string { return "hallucinator" }

func (h *hallucinator) Complete(_ context.Context, req llm.Request) (*llm.Response, error) {
	const sql = "SELECT sum(revenue_total) AS total FROM order_items"
	switch req.System {
	case h.p.Plan:
		return &llm.Response{Text: `{"restated":"revenue","assumptions":[],"unit":"currency","format_hint":"currency","label":"Revenue","sql":"` + sql + `"}`}, nil
	case h.p.Alternates:
		return &llm.Response{Text: `{"readings":[]}`}, nil
	case h.p.Cross:
		return &llm.Response{Text: `{"sql":"WITH r AS (SELECT revenue_total v FROM order_items) SELECT sum(v) FROM r","approach":"via a CTE"}`}, nil
	case h.p.Present:
		return &llm.Response{Text: `{"markdown":"Revenue.","chart":{"type":"scalar","x":"","y":[],"series":""}}`}, nil
	}
	return nil, fmt.Errorf("hallucinator: unexpected prompt")
}

// TestSuiteCatchesHallucinatedColumns proves the executable-SQL category has
// teeth: valid JSON is not evidence that the query runs.
func TestSuiteCatchesHallucinatedColumns(t *testing.T) {
	p, err := LoadPrompts()
	if err != nil {
		t.Fatalf("load prompts: %v", err)
	}
	rep := Run(context.Background(), &hallucinator{p: p}, Options{})
	if rep.Setup != nil {
		t.Skipf("suite could not run: %v", rep.Setup)
	}
	if passed, total := rep.Score(CatExecutable); passed != 0 {
		t.Errorf("SQL against a non-existent column scored %d/%d as executable", passed, total)
	}
	if sp, _ := rep.Score(CatStructured); sp == 0 {
		t.Error("hallucinator should still pass structural checks — otherwise this proves nothing")
	}
}

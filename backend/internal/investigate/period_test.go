package investigate

import (
	"context"
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// stubConn answers the one probe the calendar rung makes: how far the data
// reaches. Everything else about the rung is arithmetic on figures the caller
// already measured, so a stub is enough to test it in isolation.
type stubConn struct{ maxSeen string }

func (s stubConn) Query(context.Context, string) (*warehouse.Result, error) {
	return &warehouse.Result{
		Columns: []warehouse.ResultColumn{{Name: "max_seen", Type: "DATE"}},
		Rows:    [][]any{{s.maxSeen}},
	}, nil
}
func (stubConn) Introspect(context.Context) (*warehouse.Catalog, error) { return nil, nil }
func (stubConn) Dialect() warehouse.Dialect                            { return warehouse.Dialect{Name: "duckdb"} }
func (stubConn) Close() error                                          { return nil }

// dataThrough2024 covers every period these tests examine, so the partial-period
// branch never fires and the calendar arithmetic is what is under test.
var dataThrough2024 = stubConn{maxSeen: "2024-01-31"}

func TestParsePeriodAndItsPredecessor(t *testing.T) {
	cases := []struct {
		in        string
		days      float64
		priorIn   string
		priorDays float64
	}{
		{"2023-02", 28, "2023-01", 31},
		{"2023-01", 31, "2022-12", 31},
		{"2023", 365, "2022", 365},
		{"2023-03-01..2023-03-07", 7, "2023-02-22..2023-02-28", 7},
	}
	for _, c := range cases {
		p, err := parsePeriod(c.in)
		if err != nil {
			t.Fatalf("parsePeriod(%q): %v", c.in, err)
		}
		if p.Days() != c.days {
			t.Errorf("parsePeriod(%q).Days() = %v, want %v", c.in, p.Days(), c.days)
		}
		prior := priorPeriod(p)
		if prior.Label != c.priorIn {
			t.Errorf("priorPeriod(%q).Label = %q, want %q", c.in, prior.Label, c.priorIn)
		}
		if prior.Days() != c.priorDays {
			t.Errorf("priorPeriod(%q).Days() = %v, want %v", c.in, prior.Days(), c.priorDays)
		}
		// Periods placed end to end must not overlap, or the boundary day is
		// counted in both and the movement is fiction.
		if !prior.To.Equal(p.From) {
			t.Errorf("priorPeriod(%q) ends at %v but the period starts at %v", c.in, prior.To, p.From)
		}
	}

	if _, err := parsePeriod("last quarter"); err == nil {
		t.Error("an unparseable period was accepted; investigating the wrong window is worse than refusing")
	}
}

// The February trap: a shorter month looks like a decline until it is
// normalized, and the ladder must stop rather than hand the artifact to a
// driver hunt that will invent a cause for it.
func TestPeriodRuleOutStopsOnTheShortMonthArtifact(t *testing.T) {
	feb, _ := parsePeriod("2023-02")
	jan, _ := parsePeriod("2023-01")

	s := &Service{}
	r, stop := s.ruleOutPeriod(context.Background(), dataThrough2024, &plan{}, feb, jan,
		totals{Measure: 203220, Rows: 2426}, totals{Measure: 214915, Rows: 2580})

	if !stop {
		t.Fatalf("the ladder continued past a pure calendar artifact: %+v", r)
	}
	if r.Status != "implicated" {
		t.Errorf("status = %q, want implicated", r.Status)
	}
	if r.Kind != "period" {
		t.Errorf("kind = %q, want period", r.Kind)
	}
	t.Logf("finding: %s", r.Finding)
}

// A movement that survives normalization is a real movement, and the ladder
// must let it through.
func TestPeriodRuleOutClearsARealDecline(t *testing.T) {
	feb, _ := parsePeriod("2023-02")
	jan, _ := parsePeriod("2023-01")

	s := &Service{}
	r, stop := s.ruleOutPeriod(context.Background(), dataThrough2024, &plan{}, feb, jan,
		totals{Measure: 100000, Rows: 1000}, totals{Measure: 214915, Rows: 2580})
	if stop {
		t.Fatalf("a halving was dismissed as a calendar artifact: %s", r.Finding)
	}
	if r.Status != "cleared" {
		t.Errorf("status = %q, want cleared", r.Status)
	}
}

// A movement smaller than normal variation is not a movement, and hunting for
// its cause is confabulation by construction.
func TestLadderStopsWhenNothingMoved(t *testing.T) {
	cur, _ := parsePeriod("2023-02")
	base, _ := parsePeriod("2023-01")
	inv := &store.Investigation{}

	s := &Service{}
	stopped := s.runLadder(nil, nil, &plan{}, cur, base,
		totals{Measure: 100000, Rows: 1000}, totals{Measure: 100200, Rows: 1002}, inv, discard{})

	if stopped != "period" || inv.StoppedAt != "period" {
		t.Fatalf("stopped at %q, want period", stopped)
	}
	if len(inv.RuleOuts) != 1 {
		t.Errorf("emitted %d rule-outs before concluding nothing moved; want 1", len(inv.RuleOuts))
	}
}

// The decomposition must attribute a segment that only grew to mix, and a
// segment whose per-row value changed to rate. Conflating them is how "category
// X is down" gets reported when category X is merely smaller.
func TestDecomposeSeparatesMixFromRate(t *testing.T) {
	// Twice the rows, same value per row: pure mix.
	mix, rate := decompose(segTotals{Measure: 100, Rows: 10}, segTotals{Measure: 200, Rows: 20})
	if mix != 100 || rate != 0 {
		t.Errorf("pure volume growth gave mix=%v rate=%v, want 100 and 0", mix, rate)
	}

	// Same rows, half the value per row: pure rate.
	mix, rate = decompose(segTotals{Measure: 100, Rows: 10}, segTotals{Measure: 50, Rows: 10})
	if mix != 0 || rate != -50 {
		t.Errorf("pure rate decline gave mix=%v rate=%v, want 0 and -50", mix, rate)
	}

	// The two parts must always reconstruct the movement exactly, or the
	// waterfall's residual is meaningless.
	base, cur := segTotals{Measure: 340, Rows: 17}, segTotals{Measure: 900, Rows: 30}
	mix, rate = decompose(base, cur)
	if got, want := mix+rate, cur.Measure-base.Measure; got != want {
		t.Errorf("mix+rate = %v, want the actual delta %v", got, want)
	}
}

type discard struct{}

func (discard) Emit(string, any) error { return nil }

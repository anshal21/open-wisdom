package verify

import (
	"strings"
	"math/big"
	"context"
	"io"
	"os"
	"testing"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/testsupport"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// demoDB resolves through testsupport: fixture location is configuration, and
// a missing fixture skips loudly rather than silently passing.
func demoDBPath(t *testing.T) string { return testsupport.WarehousePath(t) }

func subject(t *testing.T, question, sql string) *Subject {
	t.Helper()
	src, err := os.Open(demoDBPath(t))
	if err != nil {
		t.Skipf("demo warehouse not present: %v", err)
	}
	defer src.Close()
	path := t.TempDir() + "/demo.duckdb"
	dst, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		t.Fatalf("copy: %v", err)
	}
	dst.Close()

	conn, err := warehouse.OpenDuckDB(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	t.Cleanup(cancel)

	cat, err := conn.Introspect(ctx)
	if err != nil {
		t.Fatalf("introspect: %v", err)
	}
	if err := warehouse.NewProfiler(conn).Profile(ctx, cat); err != nil {
		t.Fatalf("profile: %v", err)
	}
	parsed, err := ParseQuery(ctx, conn, sql)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return &Subject{Question: question, SQL: sql, Parsed: parsed, Catalog: cat, Conn: conn}
}

// TestFilterSensitivityCatchesCaseMismatch is the flagship regression: the SQL
// below is what a model actually generated for "total revenue in 2023". It runs
// without error and returns a wrong number, because the stored status values
// are capitalized.
func TestFilterSensitivityCatchesCaseMismatch(t *testing.T) {
	const badSQL = `SELECT sum(sale_price) FROM order_items
		WHERE status NOT IN ('cancelled', 'returned')
		  AND created_at >= '2023-01-01' AND created_at < '2024-01-01'`

	s := subject(t, "what was total revenue in 2023?", badSQL)
	c := FilterSensitivity(context.Background(), s)

	if c.Status != StatusFail {
		t.Fatalf("expected FAIL, got %s (%s)", c.Status, c.Finding)
	}
	t.Logf("finding: %s", c.Finding)

	// Prove the finding is not academic: the wrong query returns a materially
	// different number than the corrected one.
	bad, err := s.Conn.Query(context.Background(), badSQL)
	if err != nil {
		t.Fatalf("bad query: %v", err)
	}
	good, err := s.Conn.Query(context.Background(), `SELECT sum(sale_price) FROM order_items
		WHERE status NOT IN ('Cancelled', 'Returned')
		  AND created_at >= '2023-01-01' AND created_at < '2024-01-01'`)
	if err != nil {
		t.Fatalf("good query: %v", err)
	}
	bv, _ := bad.Scalar()
	gv, _ := good.Scalar()
	t.Logf("wrong answer: %v   correct answer: %v", bv, gv)
	if bv == gv {
		t.Fatal("expected the case mismatch to change the result")
	}
}

func TestFilterSensitivityPassesOnCorrectLiterals(t *testing.T) {
	s := subject(t, "revenue", `SELECT sum(sale_price) FROM order_items
		WHERE status NOT IN ('Cancelled', 'Returned')`)
	c := FilterSensitivity(context.Background(), s)
	if c.Status != StatusPass {
		t.Fatalf("expected PASS, got %s (%s)", c.Status, c.Finding)
	}
	t.Logf("finding: %s", c.Finding)
}

// TestJoinLossDetectsOrphans uses events.user_id, which is nullable for
// anonymous sessions — joining to users silently drops them.
func TestJoinLossDetectsOrphans(t *testing.T) {
	s := subject(t, "events per user", `SELECT count(*) FROM events e
		JOIN users u ON e.user_id = u.id`)
	c := JoinLoss(context.Background(), s)
	t.Logf("status=%s finding=%s skip=%s", c.Status, c.Finding, c.SkipReason)
	if c.Status == StatusSkipped {
		t.Fatalf("join loss check should have run: %s", c.SkipReason)
	}
}

// TestFanOutDetectsMultiplication joins orders to order_items (one-to-many) and
// sums an orders-level column, the canonical inflation bug.
func TestFanOutDetectsMultiplication(t *testing.T) {
	s := subject(t, "total items", `SELECT sum(o.num_of_item) FROM orders o
		JOIN order_items oi ON o.order_id = oi.order_id`)
	c := FanOut(context.Background(), s)
	t.Logf("status=%s finding=%s skip=%s", c.Status, c.Finding, c.SkipReason)
	if c.Status == StatusSkipped {
		t.Fatalf("fan-out check should have run: %s", c.SkipReason)
	}
}

func TestPeriodNormalizationFlagsIncompleteRange(t *testing.T) {
	s := subject(t, "revenue through 2026", `SELECT sum(sale_price) FROM order_items
		WHERE created_at >= '2024-01-01' AND created_at < '2026-01-01'`)
	c := PeriodNormalization(context.Background(), s)
	t.Logf("status=%s finding=%s skip=%s", c.Status, c.Finding, c.SkipReason)
}

func TestSummarizePrecedence(t *testing.T) {
	contested := Summarize([]Check{
		{ID: CheckCrossDerivation, Status: StatusFail},
		{ID: CheckFilterSensitivity, Status: StatusPass},
	})
	if contested.Confidence != ConfContested {
		t.Errorf("cross-derivation failure must yield contested, got %s", contested.Confidence)
	}
	if contested.Total != 2 || contested.Passed != 1 {
		t.Errorf("seal counts wrong: %d of %d", contested.Passed, contested.Total)
	}

	skipped := Summarize([]Check{{ID: CheckGrain, Status: StatusSkipped}})
	if skipped.Confidence != ConfUnverified {
		t.Errorf("all-skipped must yield unverified, got %s", skipped.Confidence)
	}
	if skipped.Total != 0 {
		t.Errorf("skipped checks must not count toward the seal, got total=%d", skipped.Total)
	}
}

// A NULL aggregate over an empty set must never verify: two derivations that
// both return NULL agree there is no data, not on a figure. This is the
// regression test for the "verified null" incident (revenue for a year with
// no data came back verified 6/6).
func TestCrossDeriveFailsWhenBothDerivationsReturnNull(t *testing.T) {
	nullRes := &warehouse.Result{Columns: []warehouse.ResultColumn{{Name: "total"}}, Rows: [][]any{{nil}}}
	primary := nullRes
	conn := stubConn{result: nullRes}
	c := CrossDerive(context.Background(), conn, primary, "SELECT 1")
	if c.Status != StatusFail {
		t.Fatalf("both-null cross-derivation must fail, got %s (%s)", c.Status, c.Finding)
	}
}

type stubConn struct{ result *warehouse.Result }

func (s stubConn) Query(ctx context.Context, sql string) (*warehouse.Result, error) {
	return s.result, nil
}
func (s stubConn) Close() error { return nil }
func (s stubConn) Dialect() warehouse.Dialect { return warehouse.Dialect{Name: "duckdb"} }
func (s stubConn) Introspect(ctx context.Context) (*warehouse.Catalog, error) { return nil, nil }

// The February trap: 28 days vs 31 makes revenue "drop" while the per-day rate
// rose. The check must say both numbers, not just the raw delta.
func TestPeriodNormalizationFlagsUnequalMonths(t *testing.T) {
	jan := time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)
	feb := time.Date(2023, 2, 1, 0, 0, 0, 0, time.UTC)
	res := &warehouse.Result{
		Columns: []warehouse.ResultColumn{{Name: "month"}, {Name: "total_revenue"}},
		Rows:    [][]any{{jan, float64(287451)}, {feb, float64(271458)}},
	}
	c := PeriodNormalization(context.Background(), &Subject{Result: res, Parsed: &Query{}})
	if c.Status != StatusWarn {
		t.Fatalf("unequal months must warn, got %s (%s)", c.Status, c.Finding)
	}
	raw := c.Detail["raw_delta_pct"].(float64)
	perDay := c.Detail["per_day_delta_pct"].(float64)
	if raw >= 0 || perDay <= 0 {
		t.Errorf("expected raw negative and per-day positive, got raw=%.1f perDay=%.1f", raw, perDay)
	}
}

func TestPeriodNormalizationQuietOnEqualMonths(t *testing.T) {
	mar := time.Date(2023, 3, 1, 0, 0, 0, 0, time.UTC)
	may := time.Date(2023, 5, 1, 0, 0, 0, 0, time.UTC)
	res := &warehouse.Result{
		Columns: []warehouse.ResultColumn{{Name: "month"}, {Name: "v"}},
		Rows:    [][]any{{mar, float64(100)}, {may, float64(90)}},
	}
	c := PeriodNormalization(context.Background(), &Subject{Result: res, Parsed: &Query{}})
	if c.Status != StatusPass {
		t.Fatalf("equal-length months must pass, got %s (%s)", c.Status, c.Finding)
	}
}

// COUNT(*) counts result rows — a 1:N join cannot repeat a value into it, so
// fan-out must not cry wolf on the commonest query shape there is. A value
// aggregate over the multiplied side must still be flagged.
func TestAggregatesFromDistinguishesCountStar(t *testing.T) {
	s := &Subject{Parsed: &Query{Aggregates: []string{"count_star"}}}
	if s.aggregatesFrom("users") {
		t.Error("bare COUNT(*) must not count as aggregating from any table")
	}
	s = &Subject{Parsed: &Query{Aggregates: []string{"sum"}}}
	if !s.aggregatesFrom("users") {
		t.Error("a value aggregate with unattributed columns must stay conservative")
	}
}

// Column ORDER between two derivations is presentation, not disagreement:
// [revenue, share] against [share, revenue] must compare as equal. Regression
// for the pie-share false contested (identical totals reported 99% apart).
func TestCrossDeriveTotalsIgnoresColumnOrder(t *testing.T) {
	num := func(vals ...[]any) *warehouse.Result {
		return &warehouse.Result{
			Columns: []warehouse.ResultColumn{{Name: "d"}, {Name: "a", Type: "DOUBLE"}, {Name: "b", Type: "DOUBLE"}},
			Rows:    vals,
		}
	}
	primary := num([]any{"Men", 100.0, 40.0}, []any{"Women", 150.0, 60.0})
	// Same figures, numeric columns swapped.
	alt := num([]any{"Men", 40.0, 100.0}, []any{"Women", 60.0, 150.0})
	conn := stubConn{result: alt}
	c := CrossDerive(context.Background(), conn, primary, "SELECT 1")
	if c.Status != StatusPass {
		t.Fatalf("order-swapped identical totals must pass, got %s (%s)", c.Status, c.Finding)
	}
}

// Percent in one derivation, fraction in the other: 100 vs 1.0 is the same
// share in different units, never a 99% disagreement.
func TestCrossDeriveTotalsTreatsPercentAndFractionAsEqual(t *testing.T) {
	mk := func(share float64) *warehouse.Result {
		return &warehouse.Result{
			Columns: []warehouse.ResultColumn{{Name: "d"}, {Name: "rev", Type: "DOUBLE"}, {Name: "share", Type: "DOUBLE"}},
			Rows:    [][]any{{"Men", 100.0, share * 0.4}, {"Women", 150.0, share * 0.6}},
		}
	}
	primary := mk(100) // shares sum to 100 (percent)
	alt := mk(1)       // shares sum to 1 (fraction)
	c := CrossDerive(context.Background(), stubConn{result: alt}, primary, "SELECT 1")
	if c.Status != StatusPass {
		t.Fatalf("percent vs fraction shares must agree, got %s (%s)", c.Status, c.Finding)
	}
}

// TestAsFloatHandlesDriverWideIntegers guards a bug that was invisible in the
// UI: DuckDB returns HUGEINT for SUM over BIGINT, which the driver surfaces as
// *big.Int. asFloat did not handle it, so columnTotals found no numeric column,
// cross-derivation SKIPPED, and the answer silently fell from `verified` to
// `qualified` while still rendering the correct figure.
func TestAsFloatHandlesDriverWideIntegers(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want float64
		ok   bool
	}{
		{"float64", float64(1.5), 1.5, true},
		{"int64", int64(42), 42, true},
		{"uint64", uint64(42), 42, true},
		{"big.Int pointer", big.NewInt(4351367), 4351367, true},
		{"big.Int value", *big.NewInt(99), 99, true},
		{"big.Float", big.NewFloat(2.25), 2.25, true},
		{"nil big.Int", (*big.Int)(nil), 0, false},
		{"string", "42", 0, false},
		{"nil", nil, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := asFloat(c.in)
			if ok != c.ok {
				t.Fatalf("ok = %v, want %v", ok, c.ok)
			}
			if ok && got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

// TestVerifiedRequiresCrossDerivation pins the product's central claim.
//
// `Summarize` used to start at `verified` and only downgrade on checks that
// RAN, so a skipped cross-derivation left the seal untouched — and the seal's
// own headline says "Independently re-derived and structurally checked" over a
// number derived exactly once. Measured against a real ledger when found:
// 7 of 16 verified answers, 44%.
//
// TestSummarizePrecedence already covered the two neighbours (a cross-derivation
// FAILURE becomes contested; everything skipped becomes unverified). The case
// between them — cross-derivation skipped, other checks passing — was the one
// nobody wrote, and it was the one that mattered.
func TestVerifiedRequiresCrossDerivation(t *testing.T) {
	pass := func(id CheckID) Check { return Check{ID: id, Status: StatusPass} }

	t.Run("skipped cross-derivation cannot be verified", func(t *testing.T) {
		rep := Summarize([]Check{
			{ID: CheckCrossDerivation, Status: StatusSkipped,
				SkipReason: "neither derivation produced a numeric column to total"},
			pass(CheckJoinLoss),
			pass(CheckGrain),
			pass(CheckCoverage),
		})
		if rep.Confidence == ConfVerified {
			t.Fatal("sealed verified without an independent re-derivation")
		}
		if rep.Confidence != ConfQualified {
			t.Fatalf("want qualified (checks ran and passed), got %q", rep.Confidence)
		}
		if rep.CrossDerived {
			t.Error("CrossDerived must be false when the check skipped")
		}
		if strings.Contains(rep.Headline, "re-derived and structurally checked") {
			t.Fatalf("headline claims a re-derivation that did not happen: %q", rep.Headline)
		}
	})

	// A cross-derivation missing entirely is the same claim as one that
	// skipped: it did not happen.
	t.Run("absent cross-derivation cannot be verified", func(t *testing.T) {
		rep := Summarize([]Check{pass(CheckJoinLoss), pass(CheckGrain)})
		if rep.Confidence == ConfVerified {
			t.Fatal("sealed verified with no cross-derivation check at all")
		}
	})

	t.Run("passing cross-derivation still verifies", func(t *testing.T) {
		rep := Summarize([]Check{
			pass(CheckCrossDerivation),
			pass(CheckJoinLoss),
			pass(CheckGrain),
		})
		if rep.Confidence != ConfVerified {
			t.Fatalf("want verified, got %q", rep.Confidence)
		}
		if !rep.CrossDerived {
			t.Error("CrossDerived must be true when the check passed")
		}
	})

	// The inverted incentive: a provider whose second query fails to execute
	// gets that check skipped. It must not be REWARDED with a stronger seal
	// than a provider whose second query ran and disagreed.
	t.Run("a broken alternate query does not earn a better seal than a disagreeing one", func(t *testing.T) {
		broken := Summarize([]Check{
			{ID: CheckCrossDerivation, Status: StatusSkipped,
				SkipReason: "the independent derivation did not execute: syntax error"},
			pass(CheckJoinLoss),
		})
		disagreed := Summarize([]Check{
			{ID: CheckCrossDerivation, Status: StatusFail, Finding: "1000 vs 2000"},
			pass(CheckJoinLoss),
		})
		if broken.Confidence == ConfVerified {
			t.Fatalf("a broken second query earned %q", broken.Confidence)
		}
		if disagreed.Confidence != ConfContested {
			t.Fatalf("a disagreeing second query should be contested, got %q", disagreed.Confidence)
		}
	})
}

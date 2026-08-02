package verify

import (
	"context"
	"fmt"
	"math"
	"math/big"
	"sort"
	"sync"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// Engine runs the check suite for one candidate answer.
type Engine struct {
	llm llm.Provider
}

func NewEngine(p llm.Provider) *Engine { return &Engine{llm: p} }

// checkFunc is one deterministic check.
type checkFunc func(context.Context, *Subject) Check

// deterministicChecks run without a model. They are cheap, parallel, and
// produce the findings that carry actual figures.
var deterministicChecks = []checkFunc{
	FilterSensitivity,
	FanOut,
	JoinLoss,
	PeriodNormalization,
	Grain,
	Freshness,
	DefinitionSource,
}

// Run executes every applicable check concurrently and returns the report.
//
// The cross-derivation check is supplied by the caller because it requires a
// second model call that the pipeline issues in parallel with the primary
// query, not after it.
func (e *Engine) Run(ctx context.Context, s *Subject, cross *Check) Report {
	var supplied []Check
	if cross != nil {
		supplied = append(supplied, *cross)
	}
	return e.RunStream(ctx, s, nil, supplied...)
}

// RunStream is Run with per-check delivery. emit is called once per check the
// moment it completes, so the client can render findings as they land instead
// of waiting for the slowest probe. emit may be nil.
//
// supplied carries checks the pipeline computed itself — cross-derivation
// (a second model call issued in parallel with the primary query), coverage,
// and precedent, which needs the answer ledger this package must not depend on.
func (e *Engine) RunStream(ctx context.Context, s *Subject, emit func(Check), supplied ...Check) Report {
	var mu sync.Mutex
	deliver := func(c Check) {
		if emit == nil || c.ID == "" {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		emit(c)
	}

	checks := make([]Check, 0, len(deterministicChecks)+len(supplied))
	for _, c := range supplied {
		if c.ID == "" {
			continue
		}
		checks = append(checks, c)
		deliver(c)
	}

	// Contributed checks run alongside the built-ins. Their results pass
	// through constrain(), which enforces the two registry guarantees: a
	// contributed check cannot mint `contested`, and it cannot skip silently.
	extra := RegisteredChecks()

	results := make([]Check, len(deterministicChecks)+len(extra))
	var wg sync.WaitGroup
	for i, fn := range deterministicChecks {
		wg.Add(1)
		go func(i int, fn checkFunc) {
			defer wg.Done()
			// A panicking or erroring check must degrade to "skipped", never
			// take down an answer.
			defer func() {
				if r := recover(); r != nil {
					results[i] = Check{
						Status:     StatusSkipped,
						SkipReason: fmt.Sprintf("check failed to execute: %v", r),
					}
				}
				deliver(results[i])
			}()
			results[i] = fn(ctx, s)
		}(i, fn)
	}
	for j, rc := range extra {
		i := len(deterministicChecks) + j
		wg.Add(1)
		go func(i int, rc RegisteredCheck) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					results[i] = Check{
						ID:         rc.ID,
						Label:      rc.Label,
						Status:     StatusSkipped,
						SkipReason: fmt.Sprintf("check failed to execute: %v", r),
					}
				}
				deliver(results[i])
			}()
			results[i] = constrain(rc, rc.Run(ctx, s))
		}(i, rc)
	}
	wg.Wait()

	for _, c := range results {
		if c.ID == "" {
			continue
		}
		checks = append(checks, c)
	}
	return Summarize(checks)
}

// CrossDerive runs an independently generated query and compares its scalar
// result against the primary one.
//
// The second derivation is generated without sight of the first, and is
// instructed to reach the number by a different path where one exists. Two
// paths agreeing is the strongest cheap evidence available; disagreement means
// we do not know the answer and must say so.
func CrossDerive(ctx context.Context, conn warehouse.Connector, primary *warehouse.Result, altSQL string) Check {
	c := Check{ID: CheckCrossDerivation, Label: CheckCrossDerivation.Label()}
	start := time.Now()
	defer func() { c.Elapsed = time.Since(start) }()

	if altSQL == "" {
		c.Status = StatusSkipped
		c.SkipReason = "no independent derivation was available for this question"
		return c
	}
	altRes, err := conn.Query(ctx, altSQL)
	if err != nil {
		c.Status = StatusSkipped
		c.SkipReason = "the independent derivation did not execute: " + err.Error()
		return c
	}

	pv, pScalar := primary.Scalar()
	av, aScalar := altRes.Scalar()

	// Two derivations that both returned NULL have not agreed on a figure —
	// they have agreed there is no data. That is a failed derivation, not a
	// verified one; agreement on nothing must never earn a seal.
	if pScalar && aScalar && pv == nil && av == nil {
		c.Status = StatusFail
		c.Finding = "Both derivations returned no data. The question as interpreted matches nothing in the warehouse."
		return c
	}

	if !pScalar || !aScalar {
		// A breakdown has no single figure to compare, but it still has totals.
		// Two derivations of the same breakdown must agree on how many groups
		// there are and on what each measure sums to across them, and that is a
		// real comparison rather than a reason to skip.
		return crossDeriveTotals(c, primary, altRes, altSQL)
	}

	pf, pok := asFloat(pv)
	af, aok := asFloat(av)
	if !pok || !aok {
		if fmt.Sprint(pv) == fmt.Sprint(av) {
			c.Status = StatusPass
			c.Finding = "A second, independent derivation produced the same result."
			return c
		}
		c.Status = StatusFail
		c.Finding = fmt.Sprintf("A second derivation produced %v where the first produced %v.", av, pv)
		return c
	}

	diff := math.Abs(pf - af)
	rel := diff / math.Max(math.Abs(pf), 1e-9)
	c.Detail = map[string]any{"primary": pf, "alternate": af, "relative_difference": rel, "alternate_sql": altSQL}

	switch {
	case rel <= 0.0001:
		c.Status = StatusPass
		c.Finding = fmt.Sprintf("A second, independent derivation produced the same figure (%s).", formatNum(pf))
	case rel <= 0.01:
		c.Status = StatusWarn
		c.Finding = fmt.Sprintf(
			"A second derivation produced %s against %s — a %.2f%% difference, likely rounding or a boundary condition.",
			formatNum(af), formatNum(pf), rel*100)
	default:
		c.Status = StatusFail
		c.Finding = fmt.Sprintf(
			"Two independent derivations disagree: %s versus %s (%.1f%% apart). The interpretation is not settled.",
			formatNum(pf), formatNum(af), rel*100)
	}
	return c
}

// crossDeriveTotals compares two derivations that returned breakdowns rather
// than single figures.
//
// It compares the group count and the column totals, because those are the two
// things any two correct derivations of the same breakdown must agree on. It
// deliberately does not try to match rows to each other: two derivations are
// free to label and order their groups differently, and treating that as a
// disagreement would make the check cry wolf on every grouped answer.
func crossDeriveTotals(c Check, primary, alt *warehouse.Result, altSQL string) Check {
	pTotals, pOK := columnTotals(primary)
	aTotals, aOK := columnTotals(alt)
	if !pOK || !aOK {
		c.Status = StatusSkipped
		c.SkipReason = "neither derivation produced a numeric column to total"
		return c
	}
	if len(pTotals) != len(aTotals) {
		c.Status = StatusSkipped
		c.SkipReason = fmt.Sprintf(
			"the derivations returned different shapes (%s against %s), so their totals are not comparable",
			plural(len(pTotals), "numeric column"), plural(len(aTotals), "numeric column"))
		return c
	}

	c.Detail = map[string]any{
		"primary_rows": len(primary.Rows), "alternate_rows": len(alt.Rows),
		"primary_totals": pTotals, "alternate_totals": aTotals, "alternate_sql": altSQL,
	}

	// Two derivations are free to order their numeric columns differently —
	// [revenue, share] against [share, revenue] is agreement, not a 99%
	// discrepancy. Compare magnitude-ranked totals so column order cannot
	// manufacture a disagreement.
	sortDesc := func(v []float64) []float64 {
		out := append([]float64(nil), v...)
		sort.Slice(out, func(i, j int) bool { return math.Abs(out[i]) > math.Abs(out[j]) })
		return out
	}
	ps, as := sortDesc(pTotals), sortDesc(aTotals)

	// A ratio expressed as percent by one derivation and as a fraction by the
	// other (100 vs 1.0) is the same quantity in different units — a scale
	// difference of exactly 100 between otherwise-agreeing totals is
	// convention, not disagreement.
	pairDiff := func(a, b float64) float64 {
		d := math.Abs(a-b) / math.Max(math.Abs(a), 1e-9)
		d100 := math.Abs(a-b*100) / math.Max(math.Abs(a), 1e-9)
		d001 := math.Abs(a*100-b) / math.Max(math.Abs(a*100), 1e-9)
		return math.Min(d, math.Min(d100, d001))
	}

	var worst float64
	var worstP, worstA float64 = ps[0], as[0]
	for i := range ps {
		diff := pairDiff(ps[i], as[i])
		if diff > worst {
			worst, worstP, worstA = diff, ps[i], as[i]
		}
	}

	switch {
	case len(primary.Rows) != len(alt.Rows):
		c.Status = StatusFail
		c.Finding = fmt.Sprintf(
			"A second, independent derivation returned %s where the first returned %d. One of them is splitting or merging the population.",
			plural(len(alt.Rows), "group"), len(primary.Rows))
	case worst <= 0.0001:
		c.Status = StatusPass
		c.Finding = fmt.Sprintf(
			"A second, independent derivation produced the same %d groups totalling the same figures (%s).",
			len(primary.Rows), formatNum(ps[0]))
	case worst <= 0.01:
		c.Status = StatusWarn
		c.Finding = fmt.Sprintf(
			"A second derivation agreed on all %d groups but its totals differ by %.2f%% (%s against %s) — likely rounding or a boundary condition.",
			len(primary.Rows), worst*100, formatNum(worstA), formatNum(worstP))
	default:
		c.Status = StatusFail
		c.Finding = fmt.Sprintf(
			"Two independent derivations of the same breakdown disagree on its totals: %s against %s (%.1f%% apart). The interpretation is not settled.",
			formatNum(worstP), formatNum(worstA), worst*100)
	}
	return c
}

// columnTotals sums every numeric column of a result.
func columnTotals(r *warehouse.Result) ([]float64, bool) {
	if r == nil || len(r.Rows) == 0 {
		return nil, false
	}
	var idx []int
	for i := range r.Columns {
		for _, row := range r.Rows {
			if i < len(row) {
				if _, ok := asFloat(row[i]); ok {
					idx = append(idx, i)
				}
				break
			}
		}
	}
	if len(idx) == 0 {
		return nil, false
	}
	totals := make([]float64, len(idx))
	for _, row := range r.Rows {
		for k, i := range idx {
			if i < len(row) {
				if f, ok := asFloat(row[i]); ok {
					totals[k] += f
				}
			}
		}
	}
	return totals, true
}

// asFloat coerces a driver value to a float for comparison.
//
// *big.Int is not an exotic case: DuckDB returns HUGEINT for SUM over a BIGINT
// column, and the Go driver surfaces that as *big.Int. Omitting it made
// columnTotals find no numeric column at all, so cross-derivation SKIPPED.
//
// A correction, because the previous version of this comment asserted the
// opposite and was wrong: at the time, a skipped cross-derivation did NOT
// downgrade the answer. `Summarize` began at `verified` and only stepped down
// on checks that ran, so the answer kept a `verified` seal and the headline
// "Independently re-derived and structurally checked" over a figure derived
// exactly once. Summarize now requires the check to have run and agreed, so
// the downgrade this comment once claimed is finally real.
func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int64:
		return float64(t), true
	case int32:
		return float64(t), true
	case int:
		return float64(t), true
	case uint64:
		return float64(t), true
	case *big.Int:
		if t == nil {
			return 0, false
		}
		f, _ := new(big.Float).SetInt(t).Float64()
		return f, true
	case big.Int:
		f, _ := new(big.Float).SetInt(&t).Float64()
		return f, true
	case *big.Float:
		if t == nil {
			return 0, false
		}
		f, _ := t.Float64()
		return f, true
	}
	return 0, false
}

func formatNum(f float64) string {
	if f == math.Trunc(f) && math.Abs(f) < 1e15 {
		return humanInt(int64(f))
	}
	return fmt.Sprintf("%.2f", f)
}

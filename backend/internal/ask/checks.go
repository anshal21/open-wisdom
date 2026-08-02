package ask

import (
	"fmt"
	"math"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// precedentCheck compares this answer against the last time the same question
// was asked.
//
// Inconsistency is what actually destroys trust in an analytics function: the
// same question answered two ways on two days is worse than either answer being
// slightly off. The ledger is the only place that can see this, so the check is
// computed here and handed to the engine.
func precedentCheck(value *float64, prior *store.Answer) verify.Check {
	c := verify.Check{ID: verify.CheckPrecedent, Label: verify.CheckPrecedent.Label()}
	if prior == nil || prior.Value == nil || value == nil {
		c.Status = verify.StatusSkipped
		c.SkipReason = "no prior answer to this question to compare against"
		return c
	}

	rel := relDiff(*prior.Value, *value)
	c.Detail = map[string]any{
		"previous_answer_id":  prior.ID,
		"previous_value":      *prior.Value,
		"previous_at":         prior.CreatedAt,
		"relative_difference": rel,
	}
	switch {
	case rel <= valuesEqualRel:
		c.Status = verify.StatusPass
		c.Finding = fmt.Sprintf("Matches the answer given on %s (%s).",
			prior.CreatedAt[:10], formatFloat(*prior.Value))
	case rel <= 0.02:
		c.Status = verify.StatusPass
		c.Finding = fmt.Sprintf("Within %.1f%% of the answer given on %s (%s versus %s).",
			rel*100, prior.CreatedAt[:10], formatFloat(*value), formatFloat(*prior.Value))
	default:
		c.Status = verify.StatusWarn
		c.Finding = fmt.Sprintf("This question was answered %s on %s; it now returns %s, a %.1f%% change. If the data did not move, the interpretation did.",
			formatFloat(*prior.Value), prior.CreatedAt[:10], formatFloat(*value), rel*100)
	}
	return c
}

// coverageCheck reports how much of the driving table reached the answer.
//
// It reports only what it can prove. Rows dropped by a join are measurable, so
// they are named with figures; rows removed by a WHERE clause are the point of
// the question and are not "lost". When neither can be established the check
// skips rather than reporting a reassuring number it did not measure.
func coverageCheck(parsed *verify.Query, cat *warehouse.Catalog, joinLoss *verify.Check, result *warehouse.Result) (verify.Check, *store.ChartCoverage) {
	c := verify.Check{ID: verify.CheckCoverage, Label: verify.CheckCoverage.Label()}

	// A result that matched nothing is the strongest coverage failure there
	// is: the data does not cover the question as interpreted. Without this
	// guard, SUM over zero rows returns NULL, two derivations "agree" on it,
	// and a hollow answer walks out wearing a verified seal.
	if isEmptyResult(result) {
		c.Status = verify.StatusFail
		c.Finding = "The query matched no rows — nothing in the data answers this question as interpreted. " +
			"The requested period or filters may lie outside what the warehouse contains."
		return c, nil
	}

	driving := drivingTable(parsed, cat)
	if driving == nil {
		c.Status = verify.StatusSkipped
		c.SkipReason = "could not attribute the statement to a base table"
		return c, nil
	}

	var excluded int64
	var reason string
	if joinLoss != nil && joinLoss.Status != verify.StatusSkipped {
		for key, v := range joinLoss.Detail {
			d, ok := v.(map[string]any)
			if !ok {
				continue
			}
			n, _ := toFloat(d["orphan_rows"])
			if int64(n) > excluded {
				excluded = int64(n)
				reason = "rows in " + strings.SplitN(key, "→", 2)[0] + " with no match on the other side of the join"
			}
		}
	}

	included := driving.RowCount - excluded
	cov := &store.ChartCoverage{IncludedRows: included, ExcludedRows: excluded, Reason: reason}

	switch {
	case excluded == 0:
		c.Status = verify.StatusPass
		c.Finding = fmt.Sprintf("All %s rows of %s were available to this answer; no join removed any.",
			commas(driving.RowCount), driving.Name)
	case driving.RowCount > 0 && float64(excluded)/float64(driving.RowCount) >= 0.05:
		c.Status = verify.StatusWarn
		c.Finding = fmt.Sprintf("%s of %s rows in %s (%.1f%%) never reached the answer: %s.",
			commas(excluded), commas(driving.RowCount), driving.Name,
			float64(excluded)/float64(driving.RowCount)*100, reason)
	default:
		c.Status = verify.StatusPass
		c.Finding = fmt.Sprintf("%s of %s rows in %s reached the answer.",
			commas(included), commas(driving.RowCount), driving.Name)
	}
	c.Detail = map[string]any{"included_rows": included, "excluded_rows": excluded, "table": driving.Name}
	return c, cov
}

// isEmptyResult reports whether a result carries no actual data: zero rows, or
// the single all-NULL row an aggregate over an empty set produces.
func isEmptyResult(r *warehouse.Result) bool {
	if r == nil || len(r.Rows) == 0 {
		return true
	}
	if len(r.Rows) == 1 {
		for _, v := range r.Rows[0] {
			if v != nil {
				return false
			}
		}
		return true
	}
	return false
}

// drivingTable is the largest base table the statement reads. Coverage is only
// meaningful relative to the table that supplies the rows.
func drivingTable(parsed *verify.Query, cat *warehouse.Catalog) *warehouse.Table {
	var best *warehouse.Table
	for _, ref := range parsed.Tables {
		for i := range cat.Tables {
			t := &cat.Tables[i]
			if !strings.EqualFold(t.Name, ref.Name) {
				continue
			}
			if best == nil || t.RowCount > best.RowCount {
				best = t
			}
		}
	}
	return best
}

func formatFloat(f float64) string {
	if f == math.Trunc(f) && math.Abs(f) < 1e15 {
		return commas(int64(f))
	}
	return fmt.Sprintf("%.2f", f)
}

func commas(n int64) string {
	s := fmt.Sprint(n)
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	if len(s) > 3 {
		var out []byte
		for i := 0; i < len(s); i++ {
			if i > 0 && (len(s)-i)%3 == 0 {
				out = append(out, ',')
			}
			out = append(out, s[i])
		}
		s = string(out)
	}
	if neg {
		return "-" + s
	}
	return s
}

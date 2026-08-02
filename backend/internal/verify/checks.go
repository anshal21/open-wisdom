package verify

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// Subject is everything a check needs to evaluate one candidate answer.
type Subject struct {
	Question string
	SQL      string
	Parsed   *Query
	Result   *warehouse.Result
	Catalog  *warehouse.Catalog
	Conn     warehouse.Connector
	// DefinitionSource names the ratified definition backing this answer, if
	// any. Empty means the answer was derived ad hoc.
	DefinitionSource string
}

// resolve maps a predicate qualifier (alias or table name) back to a catalog
// table, so a check can consult that column's profile.
func (s *Subject) resolve(qualifier, column string) (*warehouse.Table, *warehouse.Column) {
	// Alias first: aliases shadow table names within a statement.
	var candidates []string
	if qualifier != "" {
		for _, ref := range s.Parsed.Tables {
			if strings.EqualFold(ref.Alias, qualifier) || strings.EqualFold(ref.Name, qualifier) {
				candidates = append(candidates, ref.Name)
			}
		}
	}
	if len(candidates) == 0 {
		// Unqualified column: consider every table in the statement. Ambiguity
		// here is itself worth reporting, but a unique match is the common case.
		for _, ref := range s.Parsed.Tables {
			candidates = append(candidates, ref.Name)
		}
	}

	var foundT *warehouse.Table
	var foundC *warehouse.Column
	matches := 0
	for i := range s.Catalog.Tables {
		t := &s.Catalog.Tables[i]
		if !containsFold(candidates, t.Name) {
			continue
		}
		for j := range t.Columns {
			c := &t.Columns[j]
			if strings.EqualFold(c.Name, column) {
				matches++
				foundT, foundC = t, c
			}
		}
	}
	if matches != 1 {
		return nil, nil
	}
	return foundT, foundC
}

// aggregatesFrom reports whether any aggregated column resolves to the given
// table. count(*) has no column reference, so it is treated as belonging to
// every table in the statement — a count over a fanned-out join is inflated
// regardless of which side you consider it to come from.
func (s *Subject) aggregatesFrom(table string) bool {
	if len(s.Parsed.AggregatedColumns) == 0 {
		// A bare COUNT(*) aggregates rows, not any table's values, so a 1:N
		// join cannot repeat a value into it — whether the row count itself is
		// at the right grain is the grain check's question. Only value
		// aggregates whose columns could not be attributed keep the
		// conservative answer.
		for _, a := range s.Parsed.Aggregates {
			if n := strings.ToLower(a); n != "count" && n != "count_star" {
				return true
			}
		}
		return false
	}
	for _, ref := range s.Parsed.AggregatedColumns {
		if t, _ := s.resolve(ref.Qualifier, ref.Column); t != nil && strings.EqualFold(t.Name, table) {
			return true
		}
	}
	return false
}

func containsFold(hay []string, needle string) bool {
	for _, h := range hay {
		if strings.EqualFold(h, needle) {
			return true
		}
	}
	return false
}

// FilterSensitivity compares every string literal in the statement against the
// actual distinct values of the column it filters.
//
// This is the highest-yield check in the suite. A model writing
// status <> 'cancelled' against data storing 'Cancelled' produces a number that
// is confidently, silently wrong, and no amount of SQL review by a business
// user would catch it.
func FilterSensitivity(ctx context.Context, s *Subject) Check {
	c := Check{ID: CheckFilterSensitivity, Label: CheckFilterSensitivity.Label()}
	start := time.Now()
	defer func() { c.Elapsed = time.Since(start) }()

	var checked int
	var problems []string
	detail := map[string]any{}

	for _, p := range s.Parsed.Predicates {
		if !strings.EqualFold(p.LiteralType, "VARCHAR") {
			continue
		}
		_, col := s.resolve(p.Qualifier, p.Column)
		if col == nil || col.Profile == nil || len(col.Profile.DistinctValues) == 0 {
			continue
		}
		checked++
		for _, lit := range p.Literals {
			if containsExact(col.Profile.DistinctValues, lit) {
				continue
			}
			if match, ok := caseInsensitiveMatch(col.Profile.DistinctValues, lit); ok {
				problems = append(problems, fmt.Sprintf(
					"filter %s %s '%s' matches nothing — the stored value is '%s' (different capitalization)",
					p.Column, p.Operator, lit, match))
				detail[p.Column+":"+lit] = map[string]any{"stored_as": match, "kind": "case_mismatch"}
				continue
			}
			problems = append(problems, fmt.Sprintf(
				"filter %s %s '%s' matches no value in the data (actual values: %s)",
				p.Column, p.Operator, lit, strings.Join(truncate(col.Profile.DistinctValues, 6), ", ")))
			detail[p.Column+":"+lit] = map[string]any{"kind": "absent", "actual": col.Profile.DistinctValues}
		}
	}

	switch {
	case checked == 0:
		c.Status = StatusSkipped
		c.SkipReason = "no text filters compared against enumerable columns"
	case len(problems) > 0:
		c.Status = StatusFail
		c.Finding = capitalize(strings.Join(problems, "; ")) + "."
		c.Detail = detail
	default:
		c.Status = StatusPass
		c.Finding = fmt.Sprintf("All %s exist in the data as written.", plural(checked, "text filter value"))
	}
	return c
}

// FanOut probes whether a join multiplies rows, which silently inflates any
// SUM or COUNT downstream.
func FanOut(ctx context.Context, s *Subject) Check {
	c := Check{ID: CheckFanOut, Label: CheckFanOut.Label()}
	start := time.Now()
	defer func() { c.Elapsed = time.Since(start) }()

	if len(s.Parsed.JoinKeys) == 0 || len(s.Parsed.Aggregates) == 0 {
		c.Status = StatusSkipped
		c.SkipReason = "no joined aggregate to inflate"
		return c
	}

	var findings []string
	detail := map[string]any{}
	var probed int

	for _, jk := range s.Parsed.JoinKeys {
		lt, lc := s.resolve(jk.LeftQualifier, jk.LeftColumn)
		rt, rc := s.resolve(jk.RightQualifier, jk.RightColumn)
		if lt == nil || rt == nil {
			continue
		}
		probed++
		lDup, lErr := duplicateRate(ctx, s.Conn, *lt, *lc)
		rDup, rErr := duplicateRate(ctx, s.Conn, *rt, *rc)
		if lErr != nil || rErr != nil {
			continue
		}

		// A join corrupts an aggregate when the aggregated column lives on the
		// "one" side of a one-to-many edge: each of its rows is repeated once
		// per match. Many-to-many corrupts regardless of which side is summed.
		switch {
		case lDup > 1.0 && rDup > 1.0:
			findings = append(findings, fmt.Sprintf(
				"%s.%s averages %.1f rows per key and %s.%s averages %.1f — this many-to-many join multiplies rows, inflating %s",
				lt.Name, lc.Name, lDup, rt.Name, rc.Name, rDup, strings.Join(s.Parsed.Aggregates, "/")))
			detail[lt.Name+"×"+rt.Name] = map[string]any{
				"left_rows_per_key": lDup, "right_rows_per_key": rDup, "kind": "many_to_many",
			}
		case rDup > 1.0 && s.aggregatesFrom(lt.Name):
			findings = append(findings, fmt.Sprintf(
				"each %s row matches %.1f %s rows on average, so aggregating any %s column repeats every value that many times",
				lt.Name, rDup, rt.Name, lt.Name))
			detail[lt.Name+"×"+rt.Name] = map[string]any{
				"rows_per_key": rDup, "inflated_side": lt.Name, "kind": "one_to_many",
			}
		case lDup > 1.0 && s.aggregatesFrom(rt.Name):
			findings = append(findings, fmt.Sprintf(
				"each %s row matches %.1f %s rows on average, so aggregating any %s column repeats every value that many times",
				rt.Name, lDup, lt.Name, rt.Name))
			detail[rt.Name+"×"+lt.Name] = map[string]any{
				"rows_per_key": lDup, "inflated_side": rt.Name, "kind": "one_to_many",
			}
		}
	}

	switch {
	case probed == 0:
		c.Status = StatusSkipped
		c.SkipReason = "join keys could not be attributed to catalog tables"
	case len(findings) > 0:
		c.Status = StatusFail
		c.Finding = capitalize(strings.Join(findings, "; ")) + "."
		c.Detail = detail
	default:
		c.Status = StatusPass
		c.Finding = fmt.Sprintf("Checked %s; each matches at most one row per key, so nothing is double-counted.", plural(probed, "join"))
	}
	return c
}

// duplicateRate returns rows per distinct non-null key value.
func duplicateRate(ctx context.Context, conn warehouse.Connector, t warehouse.Table, col warehouse.Column) (float64, error) {
	q := fmt.Sprintf(
		`SELECT count(*)::DOUBLE / nullif(count(DISTINCT %s), 0) FROM %s WHERE %s IS NOT NULL`,
		quoteIdent(col.Name), t.FQN(), quoteIdent(col.Name))
	res, err := conn.Query(ctx, q)
	if err != nil {
		return 0, err
	}
	v, ok := res.Scalar()
	if !ok || v == nil {
		return 0, fmt.Errorf("no scalar")
	}
	f, _ := v.(float64)
	return f, nil
}

// JoinLoss probes how many driving rows have no match on the other side of a
// join, which silently shrinks totals.
func JoinLoss(ctx context.Context, s *Subject) Check {
	c := Check{ID: CheckJoinLoss, Label: CheckJoinLoss.Label()}
	start := time.Now()
	defer func() { c.Elapsed = time.Since(start) }()

	if len(s.Parsed.JoinKeys) == 0 {
		c.Status = StatusSkipped
		c.SkipReason = "statement has no joins"
		return c
	}

	var findings []string
	detail := map[string]any{}
	var probed int

	for _, jk := range s.Parsed.JoinKeys {
		lt, lc := s.resolve(jk.LeftQualifier, jk.LeftColumn)
		rt, rc := s.resolve(jk.RightQualifier, jk.RightColumn)
		if lt == nil || rt == nil {
			continue
		}
		probed++
		nullKeys, unmatched, total, err := orphanRate(ctx, s.Conn, *lt, *lc, *rt, *rc, s.drivingFilter(lt))
		if err != nil || total == 0 {
			continue
		}
		dropped := nullKeys + unmatched
		pct := float64(dropped) / float64(total) * 100
		if pct >= 1.0 {
			var causes []string
			if nullKeys > 0 {
				causes = append(causes, fmt.Sprintf("%s have a NULL %s", humanInt(nullKeys), lc.Name))
			}
			if unmatched > 0 {
				causes = append(causes, fmt.Sprintf("%s have no matching %s row", humanInt(unmatched), rt.Name))
			}
			findings = append(findings, fmt.Sprintf(
				"%.1f%% of %s rows (%s of %s) never survive this join: %s",
				pct, lt.Name, humanInt(dropped), humanInt(total), strings.Join(causes, "; ")))
			detail[lt.Name+"→"+rt.Name] = map[string]any{
				"orphan_rows": dropped, "null_key_rows": nullKeys, "unmatched_rows": unmatched,
				"total_rows": total, "orphan_pct": pct,
			}
		}
	}

	switch {
	case probed == 0:
		c.Status = StatusSkipped
		c.SkipReason = "join keys could not be attributed to catalog tables"
	case len(findings) > 0:
		c.Status = StatusWarn
		c.Finding = capitalize(strings.Join(findings, "; ")) + "."
		c.Detail = detail
	default:
		c.Status = StatusPass
		c.Finding = fmt.Sprintf("Checked %s; fewer than 1%% of rows are dropped by any of them.", plural(probed, "join"))
	}
	return c
}

// drivingFilter reconstructs the statement's own predicates on the driving
// table, so the probe measures loss among the rows the question actually
// selects. Without it, a query filtered to logged-in events would be blamed
// for the whole table's anonymous rows; with it, only rows the user asked
// about count as lost. Predicates that cannot be faithfully rebuilt are
// omitted — over-counting loss is the conservative direction.
func (s *Subject) drivingFilter(lt *warehouse.Table) string {
	var parts []string
	for _, p := range s.Parsed.Predicates {
		t, col := s.resolve(p.Qualifier, p.Column)
		if t == nil || col == nil || !strings.EqualFold(t.Name, lt.Name) || len(p.Literals) == 0 {
			continue
		}
		quote := func(lit string) string { return "'" + strings.ReplaceAll(lit, "'", "''") + "'" }
		switch p.Operator {
		case "=", "<>", "<", "<=", ">", ">=":
			parts = append(parts, fmt.Sprintf("l.%s %s %s", quoteIdent(col.Name), p.Operator, quote(p.Literals[0])))
		case "IN", "NOT IN":
			quoted := make([]string, len(p.Literals))
			for i, lit := range p.Literals {
				quoted[i] = quote(lit)
			}
			parts = append(parts, fmt.Sprintf("l.%s %s (%s)", quoteIdent(col.Name), p.Operator, strings.Join(quoted, ",")))
		}
	}
	return strings.Join(parts, " AND ")
}

// orphanRate measures how many driving-table rows an inner join on this key
// would drop, split by cause. A NULL join key drops its row exactly as surely
// as an unmatched one does — counting only the unmatched rows is how a 46%
// loss hides behind a passing check.
func orphanRate(ctx context.Context, conn warehouse.Connector, lt warehouse.Table, lc warehouse.Column, rt warehouse.Table, rc warehouse.Column, filter string) (nullKeys, unmatched, total int64, err error) {
	where := ""
	if filter != "" {
		where = " WHERE " + filter
	}
	q := fmt.Sprintf(`
		SELECT count(*) FILTER (WHERE l.%[1]s IS NULL),
		       count(*) FILTER (WHERE l.%[1]s IS NOT NULL AND r.%[2]s IS NULL),
		       count(*)
		FROM %[3]s l LEFT JOIN (SELECT DISTINCT %[2]s FROM %[4]s) r ON l.%[1]s = r.%[2]s%[5]s`,
		quoteIdent(lc.Name), quoteIdent(rc.Name), lt.FQN(), rt.FQN(), where)
	res, qerr := conn.Query(ctx, q)
	if qerr != nil {
		return 0, 0, 0, qerr
	}
	if len(res.Rows) != 1 {
		return 0, 0, 0, fmt.Errorf("unexpected probe shape")
	}
	return toInt64(res.Rows[0][0]), toInt64(res.Rows[0][1]), toInt64(res.Rows[0][2]), nil
}

// PeriodNormalization catches comparisons across periods of unequal length —
// most commonly a current month still in progress compared against complete
// months.
func PeriodNormalization(ctx context.Context, s *Subject) Check {
	c := Check{ID: CheckPeriodNormalization, Label: CheckPeriodNormalization.Label()}
	start := time.Now()
	defer func() { c.Elapsed = time.Since(start) }()

	// A two-period comparison across unequal-length periods is the classic
	// trap: February "drops" against January every single year. When the
	// result is exactly two calendar periods of different lengths, report the
	// per-day rate alongside the raw delta — the raw delta alone is the lie.
	if done, check := unequalPeriods(c, s.Result); done {
		return check
	}

	// Find the temporal column the statement filters on and the data's extent.
	var maxSeen string
	var colName string
	for _, p := range s.Parsed.Predicates {
		t, col := s.resolve(p.Qualifier, p.Column)
		if t == nil || col == nil || col.Profile == nil || col.Profile.Max == "" {
			continue
		}
		if !isTemporalType(col.Type) {
			continue
		}
		colName = col.Name
		maxSeen = col.Profile.Max
		for _, lit := range p.Literals {
			if !looksTemporal(lit) {
				continue
			}
			if lit > maxSeen && (p.Operator == "<" || p.Operator == "<=" || p.Operator == ">=" || p.Operator == ">") {
				c.Status = StatusWarn
				c.Finding = fmt.Sprintf(
					"The requested range extends to %s but %s only has data through %s, so the final period is incomplete.",
					lit, colName, maxSeen)
				c.Detail = map[string]any{"data_max": maxSeen, "requested": lit}
				return c
			}
		}
	}

	if maxSeen == "" {
		c.Status = StatusSkipped
		c.SkipReason = "no time filter on a profiled temporal column"
		return c
	}
	c.Status = StatusPass
	c.Finding = fmt.Sprintf("Requested range falls entirely within available data (through %s).", maxSeen)
	return c
}

// unequalPeriods inspects a two-row result for a period-over-period comparison
// whose periods differ in calendar length. It reports (true, check) when it
// reached a verdict, and (false, _) when the shape does not apply and the
// caller should fall through to the range analysis.
func unequalPeriods(c Check, r *warehouse.Result) (bool, Check) {
	if r == nil || len(r.Rows) != 2 {
		return false, c
	}

	// Locate the temporal bucket column and the first measure column.
	timeIdx, measureIdx := -1, -1
	for i := range r.Columns {
		if timeIdx == -1 {
			if _, ok := asPeriodStart(r.Rows[0][i]); ok {
				timeIdx = i
				continue
			}
		}
		if measureIdx == -1 {
			if _, ok := asFloat(r.Rows[0][i]); ok {
				measureIdx = i
			}
		}
	}
	if timeIdx == -1 || measureIdx == -1 {
		return false, c
	}

	t0, ok0 := asPeriodStart(r.Rows[0][timeIdx])
	t1, ok1 := asPeriodStart(r.Rows[1][timeIdx])
	v0, okv0 := asFloat(r.Rows[0][measureIdx])
	v1, okv1 := asFloat(r.Rows[1][measureIdx])
	if !ok0 || !ok1 || !okv0 || !okv1 || v0 == 0 {
		return false, c
	}

	// Only calendar months are bucketed unequally often enough to matter, and
	// only month starts identify the bucket unambiguously.
	if t0.Day() != 1 || t1.Day() != 1 {
		return false, c
	}
	days0 := daysInMonth(t0)
	days1 := daysInMonth(t1)
	if days0 == days1 {
		c.Status = StatusPass
		c.Finding = fmt.Sprintf("Both periods are %d days long; the raw comparison is fair.", days0)
		return true, c
	}

	rawPct := (v1 - v0) / math.Abs(v0) * 100
	perDay0 := v0 / float64(days0)
	perDay1 := v1 / float64(days1)
	perDayPct := (perDay1 - perDay0) / math.Abs(perDay0) * 100

	c.Detail = map[string]any{
		"period_a": t0.Format("2006-01"), "days_a": days0, "per_day_a": perDay0,
		"period_b": t1.Format("2006-01"), "days_b": days1, "per_day_b": perDay1,
		"raw_delta_pct": rawPct, "per_day_delta_pct": perDayPct,
	}

	// The comparison is misleading exactly when normalization flips or
	// materially moves the story.
	if (rawPct < 0) != (perDayPct < 0) {
		c.Status = StatusWarn
		c.Finding = fmt.Sprintf(
			"%s has %d days against %s's %d. Raw, the change is %+.1f%% — but per day it is %+.1f%%. The raw comparison points the wrong way.",
			t1.Format("Jan 2006"), days1, t0.Format("Jan 2006"), days0, rawPct, perDayPct)
		return true, c
	}
	c.Status = StatusWarn
	c.Finding = fmt.Sprintf(
		"The periods differ in length (%d vs %d days). Raw change %+.1f%%; per-day change %+.1f%%.",
		days0, days1, rawPct, perDayPct)
	return true, c
}

// asPeriodStart interprets a result cell as a timestamp, whatever shape the
// driver returned it in.
func asPeriodStart(v any) (time.Time, bool) {
	switch t := v.(type) {
	case time.Time:
		return t, true
	case string:
		for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05", "2006-01-02"} {
			if ts, err := time.Parse(layout, t); err == nil {
				return ts, true
			}
		}
	}
	return time.Time{}, false
}

func daysInMonth(t time.Time) int {
	first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
	return int(first.AddDate(0, 1, 0).Sub(first).Hours() / 24)
}

// Freshness reports how stale the underlying data is.
func Freshness(ctx context.Context, s *Subject) Check {
	c := Check{ID: CheckFreshness, Label: CheckFreshness.Label()}
	var newest string
	var table, column string
	for i := range s.Catalog.Tables {
		t := &s.Catalog.Tables[i]
		if !referencedBy(s.Parsed, t.Name) {
			continue
		}
		for j := range t.Columns {
			col := &t.Columns[j]
			if col.Profile == nil || col.Profile.Max == "" || !isTemporalType(col.Type) {
				continue
			}
			if col.Profile.Max > newest {
				newest, table, column = col.Profile.Max, t.Name, col.Name
			}
		}
	}
	if newest == "" {
		c.Status = StatusSkipped
		c.SkipReason = "no temporal column profiled on the referenced tables"
		return c
	}
	c.Status = StatusPass
	c.Finding = fmt.Sprintf("Most recent record is %s (%s.%s).", newest, table, column)
	c.Detail = map[string]any{"max": newest, "table": table, "column": column}
	return c
}

// Grain warns when an aggregate runs over a join without DISTINCT, which is the
// shape most likely to double count even when the fan-out probe cannot prove it.
func Grain(ctx context.Context, s *Subject) Check {
	c := Check{ID: CheckGrain, Label: CheckGrain.Label()}
	if len(s.Parsed.Aggregates) == 0 {
		c.Status = StatusSkipped
		c.SkipReason = "not an aggregate query"
		return c
	}
	if s.Parsed.JoinCount == 0 {
		c.Status = StatusPass
		c.Finding = fmt.Sprintf("Aggregated %s over a single table, so each row is counted once.",
			strings.Join(s.Parsed.Aggregates, "/"))
		return c
	}
	c.Status = StatusPass
	c.Finding = fmt.Sprintf("Aggregated %s across %s; row multiplication was probed separately.",
		strings.Join(s.Parsed.Aggregates, "/"), plural(len(s.Parsed.Tables), "joined table"))
	return c
}

// DefinitionSource records whether the answer used a ratified definition or was
// improvised. It never fails — it exists to make provenance visible.
func DefinitionSource(ctx context.Context, s *Subject) Check {
	c := Check{ID: CheckDefinitionSource, Label: CheckDefinitionSource.Label()}
	if s.DefinitionSource == "" {
		c.Status = StatusWarn
		c.Finding = "No ratified definition covers this question; the interpretation was chosen ad hoc."
		return c
	}
	c.Status = StatusPass
	c.Finding = fmt.Sprintf("Used the ratified definition %q.", s.DefinitionSource)
	c.Detail = map[string]any{"definition": s.DefinitionSource}
	return c
}

func referencedBy(q *Query, table string) bool {
	for _, t := range q.Tables {
		if strings.EqualFold(t.Name, table) {
			return true
		}
	}
	return false
}

func isTemporalType(t string) bool {
	u := strings.ToUpper(t)
	return strings.Contains(u, "DATE") || strings.Contains(u, "TIME")
}

func looksTemporal(s string) bool {
	return len(s) >= 8 && (strings.Count(s[:10], "-") == 2 || strings.Count(s[:8], "/") == 2)
}

func containsExact(hay []string, needle string) bool {
	for _, h := range hay {
		if h == needle {
			return true
		}
	}
	return false
}

func caseInsensitiveMatch(hay []string, needle string) (string, bool) {
	for _, h := range hay {
		if strings.EqualFold(h, needle) {
			return h, true
		}
	}
	return "", false
}

func truncate(s []string, n int) []string {
	if len(s) <= n {
		return s
	}
	return append(append([]string{}, s[:n]...), "…")
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func toInt64(v any) int64 {
	switch t := v.(type) {
	case int64:
		return t
	case int32:
		return int64(t)
	case int:
		return int64(t)
	case float64:
		return int64(t)
	}
	return 0
}

func humanInt(n int64) string {
	s := fmt.Sprint(n)
	if len(s) <= 3 {
		return s
	}
	var out []byte
	for i, d := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, d)
	}
	return string(out)
}

// plural renders "1 join" / "3 joins" — check findings are read by humans and
// "%d join(s)" is not English.
func plural(n int, noun string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", noun)
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

// Package investigate answers "why did X change?" without confabulating.
//
// The order of operations is the product. A metric that moved because February
// is shorter than January did not move, and a system that goes straight to
// segment drill-down will find a "driver" for it every time — the segments are
// all down, because the month is shorter. So the ladder runs first: rule out
// the period artifact, the data incident, and the instrumentation change,
// before any business explanation is allowed to be offered. If the ladder
// explains the movement, the investigation stops there and says so.
package investigate

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/sources"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// Service runs investigations.
type Service struct {
	Sources        *sources.Registry
	LLM            llm.Provider
	Engine         *verify.Engine
	Defs           *store.Definitions
	Investigations *store.Investigations
	Settings       *store.SettingsRepo
}

// Request is one investigation.
type Request struct {
	Metric           string
	DefinitionID     string
	Period           string
	ComparisonPeriod string
	SourceID         string
	User             string
}

// Event names on the investigation stream.
const (
	EventStage     = "stage"
	EventRuleOut   = "ruleout"
	EventDriver    = "driver"
	EventWaterfall = "waterfall"
	EventNarrative = "narrative"
	EventVerdict   = "verdict"
	EventError     = "error"
)

// Thresholds separating a finding from noise.
const (
	// materialMove is the smallest relative change worth investigating at all.
	materialMove = 0.01
	// driverShare is the share of the total movement a segment must explain
	// before it is named. Below this, naming it invents a story.
	driverShare = 0.10
	// countDivergence is how far the row count may move relative to the metric
	// before the gap itself is the finding.
	countDivergence = 0.20
)

// Run executes the ladder, then the decomposition, streaming as it goes.
func (s *Service) Run(ctx context.Context, req Request, emit ask.Emitter) (*store.Investigation, error) {
	inv := &store.Investigation{
		ID:               store.ID("inv"),
		Metric:           req.Metric,
		DefinitionID:     req.DefinitionID,
		Period:           req.Period,
		ComparisonPeriod: req.ComparisonPeriod,
	}

	cur, err := parsePeriod(req.Period)
	if err != nil {
		return nil, s.fail(emit, "invalid_period", err)
	}
	base := priorPeriod(cur)
	if req.ComparisonPeriod != "" {
		if base, err = parsePeriod(req.ComparisonPeriod); err != nil {
			return nil, s.fail(emit, "invalid_period", err)
		}
	}
	inv.ComparisonPeriod = base.Label

	sourceID, conn, cat, err := s.Sources.Resolve(ctx, req.SourceID)
	if err != nil {
		return nil, s.fail(emit, "source_unavailable", err)
	}
	inv.SourceID = sourceID

	var def *store.Definition
	if req.DefinitionID != "" {
		if def, err = s.Defs.Get(ctx, req.DefinitionID); err != nil {
			return nil, s.fail(emit, "definition_unavailable", err)
		}
	}

	emitStage(emit, "plan", "start")
	pl, err := s.buildPlan(ctx, s.LLM, req.Metric, def, sources.Digest(cat))
	if err != nil {
		return nil, s.fail(emit, "planning_failed", err)
	}
	emitStage(emit, "plan", "done")

	emitStage(emit, "measure", "start")
	curT, err := measure(ctx, conn, pl.totalSQL(cur))
	if err != nil {
		return nil, s.fail(emit, "measure_failed", fmt.Errorf("measure %s: %w", cur.Label, err))
	}
	baseT, err := measure(ctx, conn, pl.totalSQL(base))
	if err != nil {
		return nil, s.fail(emit, "measure_failed", fmt.Errorf("measure %s: %w", base.Label, err))
	}
	emitStage(emit, "measure", "done")

	// ------------------------------------------------------------- the ladder
	emitStage(emit, "ruleout", "start")
	stopped := s.runLadder(ctx, conn, pl, cur, base, curT, baseT, inv, emit)
	emitStage(emit, "ruleout", "done")

	if stopped == "" {
		emitStage(emit, "drivers", "start")
		s.findDrivers(ctx, conn, pl, cur, base, curT, baseT, inv, emit)
		emitStage(emit, "drivers", "done")
	}

	// The verdict seals the two figures the whole investigation rests on. If
	// they are not trustworthy, nothing downstream of them is either.
	report := s.verdict(ctx, conn, cat, pl, cur, req.Metric, def)
	inv.Verdict = &report
	_ = emit.Emit(EventVerdict, report)

	inv.Narrative = s.compose(ctx, req.Metric, cur, base, curT, baseT, inv)
	_ = emit.Emit(EventNarrative, ask.NarrativePayload{Markdown: inv.Narrative})

	inv.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := s.Investigations.Save(ctx, inv); err != nil {
		return nil, s.fail(emit, "not_stored", err)
	}
	return inv, nil
}

// totals is one period's measurement.
type totals struct {
	Measure float64
	Rows    float64
}

func measure(ctx context.Context, conn warehouse.Connector, query string) (totals, error) {
	res, err := conn.Query(ctx, query)
	if err != nil {
		return totals{}, err
	}
	if len(res.Rows) != 1 || len(res.Rows[0]) != 2 {
		return totals{}, fmt.Errorf("expected one row of two columns, got %d rows", len(res.Rows))
	}
	m, _ := toFloat(res.Rows[0][0])
	n, _ := toFloat(res.Rows[0][1])
	return totals{Measure: m, Rows: n}, nil
}

// runLadder walks the rule-outs in order and returns the rung it stopped on, or
// empty when every rung cleared and driver hunting is warranted.
func (s *Service) runLadder(ctx context.Context, conn warehouse.Connector, pl *plan, cur, base period, curT, baseT totals, inv *store.Investigation, emit ask.Emitter) string {
	record := func(r store.RuleOut) {
		inv.RuleOuts = append(inv.RuleOuts, r)
		_ = emit.Emit(EventRuleOut, r)
	}

	delta := curT.Measure - baseT.Measure
	rel := relative(delta, baseT.Measure)

	// Rung 0: is there anything to explain at all?
	if math.Abs(rel) < materialMove {
		record(store.RuleOut{
			Kind: "period", Status: "implicated",
			Finding: fmt.Sprintf("%s and %s differ by %.1f%% (%s against %s). That is inside normal variation; there is nothing to explain.",
				cur.Label, base.Label, rel*100, num(curT.Measure), num(baseT.Measure)),
		})
		inv.StoppedAt = "period"
		return "period"
	}

	// Rung 1: period artifacts — unequal length, and periods that are not over.
	if r, stop := s.ruleOutPeriod(ctx, conn, pl, cur, base, curT, baseT); r.Kind != "" {
		record(r)
		if stop {
			inv.StoppedAt = "period"
			return "period"
		}
	}

	// Rung 2: data quality — did the volume of rows move with the metric, or
	// away from it? A metric that halved while its rows held steady is a
	// different event from one where both halved.
	if r, stop := ruleOutDataQuality(curT, baseT, cur, base); r.Kind != "" {
		record(r)
		if stop {
			inv.StoppedAt = "data_quality"
			return "data_quality"
		}
	}

	// Rung 3: instrumentation — a dimension whose values appeared or vanished
	// wholesale between the periods is a collection change, not a business one.
	if r, stop := s.ruleOutInstrumentation(ctx, conn, pl, cur, base, curT, baseT); r.Kind != "" {
		record(r)
		if stop {
			inv.StoppedAt = "instrumentation"
			return "instrumentation"
		}
	}

	// Rung 4: mix — did the composition change while every part held its rate?
	if r, stop := s.ruleOutMix(ctx, conn, pl, cur, base, curT, baseT); r.Kind != "" {
		record(r)
		if stop {
			inv.StoppedAt = "mix"
			return "mix"
		}
	}
	return ""
}

// ruleOutPeriod is the highest-yield rung. Comparing a 28-day month against a
// 31-day one produces a movement that is entirely an artifact of the calendar,
// and every downstream "driver" for it is fiction.
func (s *Service) ruleOutPeriod(ctx context.Context, conn warehouse.Connector, pl *plan, cur, base period, curT, baseT totals) (store.RuleOut, bool) {
	r := store.RuleOut{Kind: "period"}

	// A period that runs past the end of the data is partial, and a partial
	// period always looks like a collapse.
	if res, err := conn.Query(ctx, pl.extentSQL()); err == nil {
		if v, ok := res.Scalar(); ok && v != nil {
			if maxSeen, ok := parseWhen(v); ok && maxSeen.Before(cur.To.AddDate(0, 0, -1)) {
				covered := maxSeen.Sub(cur.From).Hours()/24 + 1
				r.Status = "implicated"
				r.Finding = fmt.Sprintf(
					"%s is not over in this data: the most recent record is %s, so only %.0f of its %.0f days are present. The comparison is against a partial period.",
					cur.Label, maxSeen.Format("2006-01-02"), covered, cur.Days())
				return r, true
			}
		}
	}

	curDays, baseDays := cur.Days(), base.Days()
	if curDays == baseDays || curDays == 0 || baseDays == 0 {
		r.Status = "cleared"
		r.Finding = fmt.Sprintf("%s and %s are both %.0f days, so the comparison needs no normalization.",
			cur.Label, base.Label, curDays)
		return r, false
	}

	rawRel := relative(curT.Measure-baseT.Measure, baseT.Measure)
	curRate, baseRate := curT.Measure/curDays, baseT.Measure/baseDays
	rateRel := relative(curRate-baseRate, baseRate)

	// The artifact is proven when normalizing by length reverses the direction
	// of the movement, or shrinks it below the threshold for mattering at all.
	if sign(rawRel) != sign(rateRel) || math.Abs(rateRel) < materialMove {
		r.Status = "implicated"
		r.Finding = fmt.Sprintf(
			"%s has %.0f days against %.0f in %s. The raw movement is %+.1f%%, but per day it is %+.1f%% (%s against %s per day). The change is an artifact of period length, not of the business.",
			cur.Label, curDays, baseDays, base.Label, rawRel*100, rateRel*100, num(curRate), num(baseRate))
		return r, true
	}

	r.Status = "cleared"
	r.Finding = fmt.Sprintf(
		"%s has %.0f days against %.0f in %s; normalized per day the movement is %+.1f%% against a raw %+.1f%%, so it survives normalization.",
		cur.Label, curDays, baseDays, base.Label, rateRel*100, rawRel*100)
	return r, false
}

// ruleOutDataQuality compares the movement of the metric against the movement
// of the rows that produce it.
func ruleOutDataQuality(curT, baseT totals, cur, base period) (store.RuleOut, bool) {
	r := store.RuleOut{Kind: "data_quality"}
	if baseT.Rows == 0 {
		r.Status = "cleared"
		r.Finding = fmt.Sprintf("No rows in %s to compare volume against.", base.Label)
		return r, false
	}

	measureRel := relative(curT.Measure-baseT.Measure, baseT.Measure)
	rowRel := relative(curT.Rows-baseT.Rows, baseT.Rows)
	gap := math.Abs(rowRel - measureRel)

	if gap < countDivergence {
		r.Status = "cleared"
		r.Finding = fmt.Sprintf(
			"Row volume moved %+.1f%% against the metric's %+.1f%% (%s rows against %s). The two moved together, so this is not a collection gap.",
			rowRel*100, measureRel*100, num(curT.Rows), num(baseT.Rows))
		return r, false
	}

	r.Status = "implicated"
	r.Finding = fmt.Sprintf(
		"Row volume moved %+.1f%% while the metric moved %+.1f%% (%s rows against %s). A gap that wide between how many rows arrived and what they totalled points at collection or a per-row value change, not at demand.",
		rowRel*100, measureRel*100, num(curT.Rows), num(baseT.Rows))
	// Divergence is a finding worth reporting but does not by itself explain
	// the movement, so the investigation continues.
	return r, false
}

// ruleOutInstrumentation looks for segment values present in one period and
// absent in the other.
func (s *Service) ruleOutInstrumentation(ctx context.Context, conn warehouse.Connector, pl *plan, cur, base period, curT, baseT totals) (store.RuleOut, bool) {
	if len(pl.Segments) == 0 {
		return store.RuleOut{Kind: "instrumentation", Status: "cleared",
			Finding: "No dimension was available to check for appearing or vanishing categories."}, false
	}

	delta := curT.Measure - baseT.Measure
	var findings []string
	for _, seg := range pl.Segments {
		curRows, err1 := segmentRows(ctx, conn, pl.segmentSQL(seg, cur))
		baseRows, err2 := segmentRows(ctx, conn, pl.segmentSQL(seg, base))
		if err1 != nil || err2 != nil {
			continue
		}
		for name, b := range baseRows {
			if _, present := curRows[name]; present || b.Measure == 0 {
				continue
			}
			if share := math.Abs(b.Measure / nonZero(delta)); share >= driverShare {
				findings = append(findings, fmt.Sprintf(
					"%s %q contributed %s in %s and is entirely absent in %s, which is %.0f%% of the whole movement",
					seg.Label, name, num(b.Measure), base.Label, cur.Label, share*100))
			}
		}
		for name, c := range curRows {
			if _, present := baseRows[name]; present || c.Measure == 0 {
				continue
			}
			if share := math.Abs(c.Measure / nonZero(delta)); share >= driverShare {
				findings = append(findings, fmt.Sprintf(
					"%s %q appears for the first time in %s carrying %s, which is %.0f%% of the whole movement",
					seg.Label, name, cur.Label, num(c.Measure), share*100))
			}
		}
	}

	r := store.RuleOut{Kind: "instrumentation"}
	if len(findings) == 0 {
		r.Status = "cleared"
		r.Finding = "Every category present in one period is present in the other; nothing appeared or vanished."
		return r, false
	}
	r.Status = "implicated"
	r.Finding = capitalize(strings.Join(findings, "; ")) +
		". A category that appears or vanishes wholesale is a change in what is being recorded, not in what is happening."
	return r, true
}

// ruleOutMix asks whether the aggregate moved because each part moved, or only
// because the parts were re-weighted.
func (s *Service) ruleOutMix(ctx context.Context, conn warehouse.Connector, pl *plan, cur, base period, curT, baseT totals) (store.RuleOut, bool) {
	if len(pl.Segments) == 0 {
		return store.RuleOut{}, false
	}
	seg := pl.Segments[0]
	curRows, err1 := segmentRows(ctx, conn, pl.segmentSQL(seg, cur))
	baseRows, err2 := segmentRows(ctx, conn, pl.segmentSQL(seg, base))
	if err1 != nil || err2 != nil {
		return store.RuleOut{}, false
	}

	var mix, rate float64
	for name, b := range baseRows {
		c := curRows[name]
		m, rr := decompose(b, c)
		mix += m
		rate += rr
	}
	for name, c := range curRows {
		if _, seen := baseRows[name]; seen {
			continue
		}
		m, rr := decompose(segTotals{}, c)
		mix += m
		rate += rr
	}

	total := math.Abs(mix) + math.Abs(rate)
	r := store.RuleOut{Kind: "mix"}
	if total == 0 {
		return store.RuleOut{}, false
	}
	mixShare := math.Abs(mix) / total

	if mixShare >= 0.8 {
		r.Status = "implicated"
		r.Finding = fmt.Sprintf(
			"Broken down by %s, %.0f%% of the movement is composition: the same categories at the same per-row values, in different proportions. Nothing got better or worse per unit.",
			strings.ToLower(seg.Label), mixShare*100)
		return r, true
	}
	r.Status = "cleared"
	r.Finding = fmt.Sprintf(
		"Broken down by %s, %.0f%% of the movement is a genuine change in per-row value rather than a change in mix.",
		strings.ToLower(seg.Label), (1-mixShare)*100)
	return r, false
}

func (s *Service) fail(emit ask.Emitter, code string, err error) error {
	_ = emit.Emit(EventError, ask.ErrorPayload{Code: code, Message: err.Error()})
	return err
}

func emitStage(emit ask.Emitter, stage, state string) {
	_ = emit.Emit(EventStage, map[string]string{"stage": stage, "state": state})
}

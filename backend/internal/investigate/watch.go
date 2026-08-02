package investigate

import (
	"context"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/sources"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// Evaluator turns watches into fired events. A watch is a standing question —
// "tell me when this metric moves" — and firing one produces an investigation,
// never a bare number: the alert that cannot explain itself is the alert
// people learn to ignore.
type Evaluator struct {
	Service *Service
	Watches *store.Watches
}

// Evaluate measures one watch now and fires an event if its condition is met.
// It returns the event when one fired, nil when the condition held.
func (e *Evaluator) Evaluate(ctx context.Context, watchID string) (*store.WatchEvent, error) {
	watch, err := e.Watches.Get(ctx, watchID)
	if err != nil {
		return nil, err
	}

	// A snoozed watch does not fire, and does not pay for the investigation it
	// would have produced. Checked before any warehouse work: the point of a
	// snooze is silence, and silence that still costs a model call and two
	// queries is only half the feature.
	//
	// The check is against the clock rather than a stored flag, so an expired
	// snooze wakes on its own with no sweeper to remember it.
	if watch.Status == "snoozed" {
		return nil, nil
	}

	def, err := e.Service.Defs.Get(ctx, watch.DefinitionID)
	if err != nil {
		return nil, fmt.Errorf("watch %s definition: %w", watchID, err)
	}

	sourceID, conn, cat, err := e.Service.Sources.Resolve(ctx, "")
	if err != nil {
		return nil, err
	}
	pl, err := e.Service.buildPlan(ctx, e.Service.LLM, def.Name, def, sources.Digest(cat))
	if err != nil {
		return nil, fmt.Errorf("watch %s plan: %w", watchID, err)
	}

	cur, prev, err := latestCompletePeriods(ctx, conn, pl)
	if err != nil {
		return nil, err
	}

	curT, err := measure(ctx, conn, pl.totalSQL(cur))
	if err != nil {
		return nil, fmt.Errorf("watch %s current period: %w", watchID, err)
	}
	prevT, err := measure(ctx, conn, pl.totalSQL(prev))
	if err != nil {
		return nil, fmt.Errorf("watch %s comparison period: %w", watchID, err)
	}

	if !conditionMet(watch.Condition, prevT.Measure, curT.Measure) {
		return nil, nil
	}

	event := &store.WatchEvent{Value: curT.Measure, Previous: prevT.Measure}

	// The investigation is the alert's substance. Its failure downgrades the
	// event to an unexplained firing — it must not suppress the firing itself.
	inv, err := e.Service.Run(ctx, Request{
		Metric:           def.Name,
		DefinitionID:     def.ID,
		Period:           cur.Label,
		ComparisonPeriod: prev.Label,
		SourceID:         sourceID,
		User:             "watch:" + watch.ID,
	}, noopEmitter{})
	if err != nil {
		log.Printf("watch %s: investigation failed: %v", watch.ID, err)
	} else {
		event.InvestigationID = inv.ID
	}

	if err := e.Watches.AddEvent(ctx, watch.ID, event); err != nil {
		return nil, err
	}
	return event, nil
}

// EvaluateAll runs every watch once, returning how many fired. Errors on
// individual watches are logged, not fatal: one broken watch must not silence
// the rest.
func (e *Evaluator) EvaluateAll(ctx context.Context) int {
	watches, err := e.Watches.List(ctx)
	if err != nil {
		log.Printf("watch sweep: %v", err)
		return 0
	}
	fired := 0
	for _, w := range watches {
		ev, err := e.Evaluate(ctx, w.ID)
		if err != nil {
			log.Printf("watch %s: %v", w.ID, err)
			continue
		}
		if ev != nil {
			fired++
		}
	}
	return fired
}

// RunSchedule sweeps every interval until the context ends.
func (e *Evaluator) RunSchedule(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			e.EvaluateAll(ctx)
		}
	}
}

// latestCompletePeriods picks the last full calendar month the data covers and
// the month before it. The month containing the newest row is treated as
// partial and never compared — that is the period-normalization trap wearing a
// scheduler costume.
func latestCompletePeriods(ctx context.Context, conn warehouse.Connector, pl *plan) (period, period, error) {
	res, err := conn.Query(ctx, pl.extentSQL())
	if err != nil {
		return period{}, period{}, fmt.Errorf("data extent: %w", err)
	}
	if len(res.Rows) != 1 || len(res.Rows[0]) != 1 {
		return period{}, period{}, fmt.Errorf("data extent returned an unexpected shape")
	}
	maxSeen, ok := asTime(res.Rows[0][0])
	if !ok {
		return period{}, period{}, fmt.Errorf("data extent %v is not a timestamp", res.Rows[0][0])
	}

	partialStart := time.Date(maxSeen.Year(), maxSeen.Month(), 1, 0, 0, 0, 0, time.UTC)
	curStart := partialStart.AddDate(0, -1, 0)
	cur := period{Label: curStart.Format("2006-01"), From: curStart, To: partialStart}
	return cur, priorPeriod(cur), nil
}

func conditionMet(c store.Condition, previous, current float64) bool {
	switch c.Kind {
	case "change_pct":
		if previous == 0 {
			return current != 0
		}
		return math.Abs((current-previous)/previous)*100 >= c.Value
	case "threshold":
		return current >= c.Value
	default:
		return false
	}
}

type noopEmitter struct{}

func (noopEmitter) Emit(string, any) error { return nil }

// asTime parses the extent probe's cell.
func asTime(v any) (time.Time, bool) {
	switch t := v.(type) {
	case time.Time:
		return t, true
	case string:
		for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"} {
			if ts, err := time.Parse(layout, strings.TrimSpace(t)); err == nil {
				return ts, true
			}
		}
	}
	return time.Time{}, false
}

package investigate

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// segTotals is one segment's contribution within one period.
type segTotals struct {
	Measure float64
	Rows    float64
}

func segmentRows(ctx context.Context, conn warehouse.Connector, query string) (map[string]segTotals, error) {
	res, err := conn.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	out := make(map[string]segTotals, len(res.Rows))
	for _, row := range res.Rows {
		if len(row) < 3 {
			continue
		}
		name := fmt.Sprint(row[0])
		if row[0] == nil {
			// A null dimension value is a real population, not an absence, and
			// dropping it would make the decomposition stop adding up.
			name = "(not set)"
		}
		m, _ := toFloat(row[1])
		n, _ := toFloat(row[2])
		out[name] = segTotals{Measure: m, Rows: n}
	}
	return out, nil
}

// decompose splits one segment's movement into volume and per-row parts.
//
//	Δv = (n' - n)·r  +  n'·(r' - r)
//
// The first term is the segment getting bigger or smaller at an unchanged rate;
// the second is the same population behaving differently. Conflating them is
// how "category X is down" gets reported when category X is simply smaller.
func decompose(base, cur segTotals) (mix, rate float64) {
	if base.Rows == 0 && cur.Rows == 0 {
		return 0, 0
	}
	var baseRate, curRate float64
	if base.Rows > 0 {
		baseRate = base.Measure / base.Rows
	}
	if cur.Rows > 0 {
		curRate = cur.Measure / cur.Rows
	}
	mix = (cur.Rows - base.Rows) * baseRate
	rate = cur.Rows * (curRate - baseRate)
	return mix, rate
}

// findDrivers ranks segments by how much of the movement each explains, and
// always reports what it could not explain.
//
// "No significant driver found" is a first-class outcome here, not a failure.
// A system that must always name a cause will always name one, and on data with
// no causal structure that name is fiction.
func (s *Service) findDrivers(ctx context.Context, conn warehouse.Connector, pl *plan, cur, base period, curT, baseT totals, inv *store.Investigation, emit ask.Emitter) {
	delta := curT.Measure - baseT.Measure
	if delta == 0 || len(pl.Segments) == 0 {
		return
	}

	// The first segment is the planner's best guess at the explanatory
	// dimension; decomposing every dimension would produce overlapping,
	// double-counted "drivers" that do not sum to the movement.
	seg := pl.Segments[0]
	curRows, err1 := segmentRows(ctx, conn, pl.segmentSQL(seg, cur))
	baseRows, err2 := segmentRows(ctx, conn, pl.segmentSQL(seg, base))
	if err1 != nil || err2 != nil {
		return
	}

	names := map[string]bool{}
	for n := range curRows {
		names[n] = true
	}
	for n := range baseRows {
		names[n] = true
	}

	type part struct {
		name      string
		mix, rate float64
	}
	var parts []part
	for name := range names {
		m, rt := decompose(baseRows[name], curRows[name])
		parts = append(parts, part{name: name, mix: m, rate: rt})
	}
	// Rank by the total movement each segment carries, so a segment whose mix
	// and rate cancel out is correctly treated as uninteresting.
	sort.Slice(parts, func(i, j int) bool {
		return math.Abs(parts[i].mix+parts[i].rate) > math.Abs(parts[j].mix+parts[j].rate)
	})

	scale := math.Abs(nonZero(baseT.Measure))
	var explained float64
	var bars []store.WaterfallBar

	for _, p := range parts {
		for _, c := range []struct {
			kind  string
			value float64
		}{{"mix", p.mix}, {"rate", p.rate}} {
			if math.Abs(c.value/nonZero(delta)) < driverShare {
				continue
			}
			d := store.Driver{
				Segment:      fmt.Sprintf("%s: %s", seg.Label, p.name),
				Contribution: round4(c.value / scale),
				Kind:         c.kind,
			}
			inv.Drivers = append(inv.Drivers, d)
			_ = emit.Emit(EventDriver, d)

			explained += c.value
			bars = append(bars, store.WaterfallBar{
				Label: fmt.Sprintf("%s (%s)", p.name, c.kind),
				Value: round4(c.value / scale),
			})
		}
	}

	// The residual is mandatory. A waterfall whose bars sum to the total
	// implies the decomposition was complete, and it almost never is.
	wf := &store.Waterfall{
		Bars:        bars,
		Unexplained: round4((delta - explained) / scale),
	}
	inv.Waterfall = wf
	_ = emit.Emit(EventWaterfall, wf)
}

// ------------------------------------------------------------------ helpers

func relative(delta, base float64) float64 {
	if base == 0 {
		return 0
	}
	return delta / math.Abs(base)
}

func nonZero(f float64) float64 {
	if f == 0 {
		return 1e-9
	}
	return f
}

func sign(f float64) int {
	switch {
	case f > 0:
		return 1
	case f < 0:
		return -1
	}
	return 0
}

func round4(f float64) float64 { return math.Round(f*10000) / 10000 }

func toFloat(v any) (float64, bool) {
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
	}
	return 0, false
}

func num(f float64) string {
	if f == math.Trunc(f) && math.Abs(f) < 1e15 {
		s := fmt.Sprintf("%d", int64(f))
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
	return fmt.Sprintf("%.2f", f)
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

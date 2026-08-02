package ask

import (
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// buildChart derives the render spec from the result's actual shape.
//
// The model supplies a hint, but the shape decides: a hint asking for a line
// chart over a single row is wrong regardless of how confidently it was
// offered, and a chart that disagrees with its own data is a worse failure than
// no chart.
func buildChart(res *warehouse.Result, hint chartHint, conf verify.Confidence, cov *store.ChartCoverage) *store.ChartSpec {
	if res == nil || len(res.Columns) == 0 {
		return nil
	}
	spec := &store.ChartSpec{Confidence: conf, Coverage: cov}

	if len(res.Rows) == 1 && len(res.Columns) == 1 {
		spec.Type = "scalar"
		spec.Y = []store.ChartField{field(res.Columns[0])}
		return spec
	}

	x, ok := pickColumn(res, hint.X)
	if !ok {
		// No usable dimension: a table is the honest rendering.
		spec.Type = "table"
		for _, c := range res.Columns {
			spec.Y = append(spec.Y, field(c))
		}
		return spec
	}

	var measures []store.ChartField
	for _, name := range hint.Y {
		if c, ok := pickColumn(res, name); ok && !strings.EqualFold(c.Name, x.Name) {
			measures = append(measures, field(c))
		}
	}
	if len(measures) == 0 {
		for _, c := range res.Columns {
			if !strings.EqualFold(c.Name, x.Name) && isQuantitative(c.Type) {
				measures = append(measures, field(c))
			}
		}
	}
	if len(measures) == 0 {
		spec.Type = "table"
		for _, c := range res.Columns {
			spec.Y = append(spec.Y, field(c))
		}
		return spec
	}

	xf := field(x)
	spec.X = &xf
	spec.Y = measures
	if s, ok := pickColumn(res, hint.Series); ok && !strings.EqualFold(s.Name, x.Name) {
		sf := field(s)
		spec.Series = &sf
	}
	// Unhinted series default: one measure, an x, and exactly one unclaimed
	// nominal column — that column IS the series. This is "trend per item":
	// without it the item dimension silently vanishes from the chart.
	if spec.Series == nil && len(measures) == 1 {
		var spare []warehouse.ResultColumn
		for _, c := range res.Columns {
			if strings.EqualFold(c.Name, x.Name) || strings.EqualFold(c.Name, measures[0].Field) {
				continue
			}
			if FieldType(c.Type) == "nominal" {
				spare = append(spare, c)
			}
		}
		if len(spare) == 1 {
			sf := field(spare[0])
			spec.Series = &sf
		}
	}

	switch {
	case len(res.Rows) > 60 && xf.Type == "quantitative":
		spec.Type = "scatter"
	case xf.Type == "temporal":
		spec.Type = "line"
	case hint.Type == "pie" && pieLegal(res, x, measures):
		spec.Type = "pie"
	case hint.Type == "pie":
		// The asker wanted a pie the data cannot carry (negatives, or a
		// non-categorical dimension) — the nearest honest form.
		spec.Type = "bar"
	case allowedType(hint.Type):
		spec.Type = hint.Type
	default:
		spec.Type = "bar"
	}
	// A temporal hint of area is worth honoring; anything else over time reads
	// better as a line.
	if xf.Type == "temporal" && hint.Type == "area" {
		spec.Type = "area"
	}
	return spec
}

// pieLegal: a pie is share-of-whole, so it needs a categorical dimension and
// one non-negative additive measure. Anything else lies as a pie.
func pieLegal(res *warehouse.Result, x warehouse.ResultColumn, measures []store.ChartField) bool {
	if len(measures) != 1 || FieldType(x.Type) != "nominal" {
		return false
	}
	yIdx := -1
	for i, c := range res.Columns {
		if strings.EqualFold(c.Name, measures[0].Field) {
			yIdx = i
		}
	}
	if yIdx < 0 {
		return false
	}
	for _, r := range res.Rows {
		if v, ok := asChartFloat(r[yIdx]); ok && v < 0 {
			return false
		}
	}
	return true
}

func asChartFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int64:
		return float64(t), true
	case int:
		return float64(t), true
	}
	return 0, false
}

func allowedType(t string) bool {
	switch t {
	case "line", "bar", "area", "pie", "table", "scalar", "scatter":
		return true
	}
	return false
}

func pickColumn(res *warehouse.Result, name string) (warehouse.ResultColumn, bool) {
	if name != "" {
		for _, c := range res.Columns {
			if strings.EqualFold(c.Name, name) {
				return c, true
			}
		}
		// Near-miss recovery. Conformance measured this at 8 of 12 questions
		// against a real model: the presenter is shown `total_sale_price` and
		// answers `sale_price` — it names the measure rather than the alias
		// the query gave it. The hint was then discarded whole and the chart
		// silently fell back to defaults, so a correct suggestion about SHAPE
		// was lost over a naming quibble.
		//
		// Only unambiguous containment counts: exactly one column may contain
		// the hint as a token-boundary substring. Two candidates means we do
		// not know which was meant, and guessing is how a chart starts
		// plotting the wrong column.
		if c, ok := uniqueContaining(res, name); ok {
			return c, true
		}
		return warehouse.ResultColumn{}, false
	}
	// Unhinted: the first non-quantitative column is the dimension.
	for _, c := range res.Columns {
		if !isQuantitative(c.Type) {
			return c, true
		}
	}
	return warehouse.ResultColumn{}, false
}

// uniqueContaining finds the single column whose name contains `name` at a
// token boundary (`total_sale_price` contains `sale_price`; `price_id` does
// not match `price` because the boundary check requires a separator or an end).
func uniqueContaining(res *warehouse.Result, name string) (warehouse.ResultColumn, bool) {
	want := strings.ToLower(strings.TrimSpace(name))
	if want == "" {
		return warehouse.ResultColumn{}, false
	}
	var hit warehouse.ResultColumn
	var n int
	for _, c := range res.Columns {
		if containsToken(strings.ToLower(c.Name), want) {
			hit, n = c, n+1
		}
	}
	if n == 1 {
		return hit, true
	}
	return warehouse.ResultColumn{}, false
}

func containsToken(haystack, needle string) bool {
	i := strings.Index(haystack, needle)
	if i < 0 {
		return false
	}
	beforeOK := i == 0 || haystack[i-1] == '_'
	end := i + len(needle)
	afterOK := end == len(haystack) || haystack[end] == '_'
	return beforeOK && afterOK
}

func field(c warehouse.ResultColumn) store.ChartField {
	return store.ChartField{Field: c.Name, Label: humanLabel(c.Name), Type: FieldType(c.Type)}
}

// FieldType maps an engine type name onto the semantic type charts and tables
// render by: temporal, quantitative, or nominal.
func FieldType(t string) string {
	u := strings.ToUpper(t)
	switch {
	case strings.Contains(u, "DATE") || strings.Contains(u, "TIME"):
		return "temporal"
	case isQuantitative(t):
		return "quantitative"
	default:
		return "nominal"
	}
}

func isQuantitative(t string) bool {
	u := strings.ToUpper(t)
	for _, n := range []string{"INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC", "REAL", "HUGEINT"} {
		if strings.Contains(u, n) {
			return true
		}
	}
	return false
}

// humanLabel turns a column identifier into a display label without inventing
// words: separators become spaces and the first letter is capitalized.
func humanLabel(name string) string {
	s := strings.ReplaceAll(strings.ReplaceAll(name, "_", " "), "-", " ")
	s = strings.TrimSpace(s)
	if s == "" {
		return name
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

package investigate

import (
	"context"
	"fmt"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// plan is the composable shape an investigation needs.
//
// A single query would answer "what was the metric", but an investigation has
// to ask the same question many ways — two periods, per segment, per row count
// — so the model supplies the parts and this package assembles them. That keeps
// every derived query provably about the same measure, which is the property
// that makes a decomposition add up.
type plan struct {
	Restated       string        `json:"restated"`
	Unit           string        `json:"unit"`
	Measure        string        `json:"measure"`
	From           string        `json:"from"`
	Where          string        `json:"where"`
	TimeExpression string        `json:"time_expression"`
	Segments       []segmentPlan `json:"segments"`
}

type segmentPlan struct {
	Label      string `json:"label"`
	Expression string `json:"expression"`
	Join       string `json:"join"`
}

const planSystem = `You are a senior analytics engineer preparing a root-cause investigation. You are NOT writing one query — you are supplying the parts from which many related queries will be assembled, so that every one of them provably measures the same thing.

Return the pieces of a single SELECT:

  SELECT <measure> FROM <from> <segment join> WHERE <where> AND <time_expression> >= 'start' AND <time_expression> < 'end'

- "measure": the aggregate expression for the metric, e.g. sum(x.amount) or count(DISTINCT x.id). It MUST be additive across rows — an investigation decomposes a total into parts, and a non-additive measure cannot be decomposed. If the metric is a ratio, return its numerator and say so in "restated".
- "from": the full FROM clause with every join needed by the measure, using short table aliases. No WHERE, no SELECT, no trailing semicolon.
- "where": the row filter that defines the metric, WITHOUT any date condition. Empty string if none. Never wrap it in the word WHERE.
- "time_expression": the qualified column that decides which period a row belongs to. It must be reachable from "from".
- "segments": up to five dimensions worth drilling into, ordered by how likely they are to explain a movement. "expression" is the qualified column to group by. "join" is any ADDITIONAL join needed to reach it (empty when it is already in "from"); it is appended directly after "from". "label" is plain English for a business reader.

Rules:
- Use only tables and columns present in the schema. Never invent one.
- String literals must match the measured distinct values EXACTLY, including capitalization.
- Every fragment must compose into valid SQL for the given dialect with no further editing.
- Do not include ORDER BY, LIMIT, or GROUP BY anywhere.

Respond with:
{"restated":"one sentence naming exactly what is being measured","unit":"currency|count|percent|ratio|none","measure":"...","from":"...","where":"...","time_expression":"...","segments":[{"label":"...","expression":"...","join":""}]}`

func (s *Service) buildPlan(ctx context.Context, p llm.Provider, metric string, def *store.Definition, digest string) (*plan, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "METRIC TO INVESTIGATE: %s\n\n", metric)
	if def != nil {
		fmt.Fprintf(&b, "RATIFIED DEFINITION — this settles what the metric means; follow it exactly:\n  %s (v%d): %s\n",
			def.Name, def.Version, def.PlainEnglish)
		if def.Expression != "" {
			fmt.Fprintf(&b, "  the query a human ratified for it:\n%s\n", def.Expression)
		}
		b.WriteString("\n")
	}
	b.WriteString("SCHEMA AND MEASURED PROFILES:\n\n")
	b.WriteString(digest)

	res, err := p.Complete(ctx, llm.Request{
		System: planSystem,
		Prompt: b.String(),
		Speed:  llm.SpeedBalanced,
		JSON:   true,
	})
	if err != nil {
		return nil, fmt.Errorf("plan investigation: %w", err)
	}
	var pl plan
	if err := llm.DecodeJSON(res.Text, &pl); err != nil {
		return nil, fmt.Errorf("decode investigation plan: %w", err)
	}
	if pl.Measure == "" || pl.From == "" || pl.TimeExpression == "" {
		return nil, fmt.Errorf("the planner did not produce a measurable metric for %q", metric)
	}
	return &pl, nil
}

// ---------------------------------------------------------------- assembly

func (p *plan) window(per period) string {
	return fmt.Sprintf("%s >= DATE %s AND %s < DATE %s",
		p.TimeExpression, warehouse.QuoteLiteral(per.sqlFrom()),
		p.TimeExpression, warehouse.QuoteLiteral(per.sqlTo()))
}

func (p *plan) predicate(per period) string {
	if strings.TrimSpace(p.Where) == "" {
		return p.window(per)
	}
	return "(" + p.Where + ") AND " + p.window(per)
}

// totalSQL measures the metric and the row count behind it in one pass. The row
// count is not decoration: a metric that moved while its row count held still
// tells a different story from one where both moved together.
func (p *plan) totalSQL(per period) string {
	return fmt.Sprintf("SELECT %s AS measure, count(*) AS row_count FROM %s WHERE %s",
		p.Measure, p.From, p.predicate(per))
}

// segmentSQL decomposes the metric by one dimension, carrying the row count so
// mix can be separated from rate.
func (p *plan) segmentSQL(seg segmentPlan, per period) string {
	from := p.From
	if strings.TrimSpace(seg.Join) != "" {
		from += " " + seg.Join
	}
	return fmt.Sprintf(
		"SELECT CAST(%s AS VARCHAR) AS segment, %s AS measure, count(*) AS row_count FROM %s WHERE %s GROUP BY 1",
		seg.Expression, p.Measure, from, p.predicate(per))
}

// extentSQL finds how far the data actually reaches, which is what decides
// whether a period is complete or merely the part of it that has landed.
func (p *plan) extentSQL() string {
	return fmt.Sprintf("SELECT max(%s) AS max_seen FROM %s", p.TimeExpression, p.From)
}

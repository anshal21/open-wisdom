package investigate

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// verdict seals the two figures the investigation rests on.
//
// The conclusion of an investigation is only as good as the totals it compared,
// so the same check suite that guards an answer guards these. There is no
// cross-derivation: the comparison is between two periods of one query, not
// between two paths to one number.
func (s *Service) verdict(ctx context.Context, conn warehouse.Connector, cat *warehouse.Catalog, pl *plan, cur period, metric string, def *store.Definition) verify.Report {
	query := pl.totalSQL(cur)
	res, err := conn.Query(ctx, query)
	if err != nil {
		return verify.Summarize(nil)
	}

	parsed := &verify.Query{}
	if parser, ok := conn.(verify.Parser); ok {
		if q, perr := verify.ParseQuery(ctx, parser, query); perr == nil {
			parsed = q
		}
	}
	subject := &verify.Subject{
		Question: "why did " + metric + " change in " + cur.Label,
		SQL:      query,
		Parsed:   parsed,
		Result:   res,
		Catalog:  cat,
		Conn:     conn,
	}
	if def != nil {
		subject.DefinitionSource = def.Name
	}
	return s.Engine.Run(ctx, subject, nil)
}

const narrativeSystem = `The investigation has ALREADY been run and every figure it produced is given to you below. You have no database to query and none is needed. Your entire task is to write its closing paragraph, in the voice of a senior analyst who is not trying to impress anyone.

Structure, in this order, in at most five sentences:
1. What moved, with both figures.
2. What it was NOT — the rule-outs that cleared, stated as facts, not as process.
3. What it WAS — the drivers, with their magnitudes. If no driver cleared the threshold, say plainly that no significant driver was found and that this is a real finding, not a gap.
4. How confident, and what would change the conclusion.

Hard rules:
- If the investigation stopped on a rule-out, the answer is that the metric did not really move. Say so first and do not offer any business explanation afterwards. Inventing a cause for an artifact is the specific failure this exists to prevent.
- Use only the figures given to you. Never introduce a number that is not in the input.
- Never say "the system", "the analysis", "we", or "I". Never describe your own steps.
- No headings, no bullets, no preamble.

Respond with: {"markdown":"..."}`

func (s *Service) compose(ctx context.Context, metric string, cur, base period, curT, baseT totals, inv *store.Investigation) string {
	var b strings.Builder
	fmt.Fprintf(&b, "METRIC: %s\n", metric)
	fmt.Fprintf(&b, "%s: %s\n%s: %s\n", cur.Label, num(curT.Measure), base.Label, num(baseT.Measure))
	fmt.Fprintf(&b, "CHANGE: %+.1f%%\n", relative(curT.Measure-baseT.Measure, baseT.Measure)*100)
	fmt.Fprintf(&b, "PER DAY: %s over %.0f days against %s over %.0f days\n",
		num(curT.Measure/nonZero(cur.Days())), cur.Days(), num(baseT.Measure/nonZero(base.Days())), base.Days())

	b.WriteString("\nRULE-OUTS, in the order they ran:\n")
	for _, r := range inv.RuleOuts {
		fmt.Fprintf(&b, "  [%s / %s] %s\n", r.Kind, r.Status, r.Finding)
	}
	if inv.StoppedAt != "" {
		fmt.Fprintf(&b, "\nTHE LADDER STOPPED AT: %s. No driver hunt was run, and none should be reported.\n", inv.StoppedAt)
	}

	if len(inv.Drivers) == 0 && inv.StoppedAt == "" {
		b.WriteString("\nDRIVERS: none cleared the significance threshold. No significant driver was found.\n")
	}
	for _, d := range inv.Drivers {
		fmt.Fprintf(&b, "  %s (%s): %+.1f%% of the base total\n", d.Segment, d.Kind, d.Contribution*100)
	}
	if inv.Waterfall != nil {
		fmt.Fprintf(&b, "UNEXPLAINED RESIDUAL: %+.1f%% of the base total\n", inv.Waterfall.Unexplained*100)
	}

	res, err := s.LLM.Complete(ctx, llm.Request{
		System: narrativeSystem,
		Prompt: b.String(),
		Speed:  llm.SpeedBalanced,
		JSON:   true,
	})
	if err != nil {
		return fallback(cur, base, curT, baseT, inv)
	}
	var reply struct {
		Markdown string `json:"markdown"`
	}
	if err := llm.DecodeJSON(res.Text, &reply); err != nil || strings.TrimSpace(reply.Markdown) == "" {
		return fallback(cur, base, curT, baseT, inv)
	}
	return reply.Markdown
}

func fallback(cur, base period, curT, baseT totals, inv *store.Investigation) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s was %s against %s in %s (%+.1f%%).",
		cur.Label, num(curT.Measure), num(baseT.Measure), base.Label,
		relative(curT.Measure-baseT.Measure, baseT.Measure)*100)
	if inv.StoppedAt != "" {
		for _, r := range inv.RuleOuts {
			if r.Kind == inv.StoppedAt {
				b.WriteString(" " + r.Finding)
				break
			}
		}
		return b.String()
	}
	if len(inv.Drivers) == 0 {
		b.WriteString(" No segment explained enough of the movement to be named a driver. That is the finding, not a gap in the analysis.")
		return b.String()
	}
	d := inv.Drivers[0]
	fmt.Fprintf(&b, " The largest contributor is %s (%s), at %+.1f%% of the base total.",
		d.Segment, d.Kind, d.Contribution*100)
	return b.String()
}

// parseWhen reads whatever shape the driver returned a timestamp in. The
// connector normalizes times to RFC3339 strings, but a date column can arrive
// as a bare date and a text column as anything at all.
func parseWhen(v any) (time.Time, bool) {
	switch t := v.(type) {
	case time.Time:
		return t, true
	case string:
		for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"} {
			if parsed, err := time.Parse(layout, t); err == nil {
				return parsed, true
			}
		}
	}
	return time.Time{}, false
}

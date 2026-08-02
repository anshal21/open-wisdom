package sources

import (
	"context"
	"fmt"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// aliasCandidate is one column offered to the detector.
type aliasCandidate struct {
	Table  string   `json:"table"`
	Column string   `json:"column"`
	Values []string `json:"values"`
}

type aliasReply struct {
	Columns []struct {
		Table  string     `json:"table"`
		Column string     `json:"column"`
		Groups [][]string `json:"groups"`
	} `json:"columns"`
}

// DetectAliases finds distinct values within one column that denote the same
// real-world entity, and records them on the column profile.
//
// This runs at introspection time, once per source. It is deliberately not a
// per-question step: whether 'Germany' and 'Deutschland' are the same country
// does not depend on what anyone asked. Failure is silent — the catalog is
// still usable, it simply cannot warn about split entities.
func DetectAliases(ctx context.Context, p llm.Provider, cat *warehouse.Catalog) {
	if p == nil {
		return
	}
	var cands []aliasCandidate
	for ti := range cat.Tables {
		t := &cat.Tables[ti]
		for ci := range t.Columns {
			c := &t.Columns[ci]
			// Only enumerable text columns can split an entity across rows, and
			// a two-value column has nothing interesting to collapse.
			if c.Profile == nil || len(c.Profile.DistinctValues) < 3 {
				continue
			}
			cands = append(cands, aliasCandidate{Table: t.Name, Column: c.Name, Values: c.Profile.DistinctValues})
		}
	}
	if len(cands) == 0 {
		return
	}

	var b strings.Builder
	for _, c := range cands {
		fmt.Fprintf(&b, "%s.%s: %s\n", c.Table, c.Column, strings.Join(c.Values, " | "))
	}

	res, err := p.Complete(ctx, llm.Request{
		Speed:  llm.SpeedFast,
		JSON:   true,
		System: aliasSystem,
		Prompt: "Columns and their complete distinct value lists:\n\n" + b.String(),
	})
	if err != nil {
		return
	}
	var reply aliasReply
	if err := llm.DecodeJSON(res.Text, &reply); err != nil {
		return
	}

	for _, rc := range reply.Columns {
		for ti := range cat.Tables {
			t := &cat.Tables[ti]
			if !strings.EqualFold(t.Name, rc.Table) {
				continue
			}
			for ci := range t.Columns {
				c := &t.Columns[ci]
				if !strings.EqualFold(c.Name, rc.Column) || c.Profile == nil {
					continue
				}
				c.Profile.Aliases = validGroups(rc.Groups, c.Profile.DistinctValues)
			}
		}
	}
}

// validGroups keeps only groups whose members are all values that actually
// exist in the column. A model inventing a spelling must not become evidence.
func validGroups(groups [][]string, actual []string) [][]string {
	var out [][]string
	for _, g := range groups {
		var kept []string
		for _, v := range g {
			for _, a := range actual {
				if a == v {
					kept = append(kept, v)
					break
				}
			}
		}
		if len(kept) > 1 {
			out = append(out, kept)
		}
	}
	return out
}

const aliasSystem = `You are a data quality auditor examining the complete distinct value lists of columns in a warehouse.

Your single task: find groups of values within the SAME column that refer to the same real-world entity but are stored under different spellings, languages, casings, abbreviations, or codes. Examples of the pattern: a country column containing both an English and a native-language name for one country; a channel column containing both an abbreviation and its expansion; a status column containing the same state in two casings.

Rules:
- Only group values that denote the SAME entity. Values that are merely related, adjacent, or in the same category are NOT aliases.
- Copy values EXACTLY as given, character for character. Never invent, correct, or normalize a spelling.
- List the most standard/canonical spelling first in each group.
- Most columns have no alias groups. Returning an empty list is the correct and common answer.

Respond with:
{"columns":[{"table":"...","column":"...","groups":[["Canonical","Alias","Alias"]]}]}

Omit any column with no groups.`

package sources

import (
	"fmt"
	"sort"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// Digest renders a catalog as prompt context.
//
// It carries profile evidence, not just names and types, because that evidence
// is what lets the planner see an ambiguity instead of inventing one: the exact
// stored literals of a status column, the range of a date column, the alias
// groups that mean grouping by a column would split one entity in two.
func Digest(cat *warehouse.Catalog) string {
	var b strings.Builder
	// PromptLine names the engine and, more usefully, the things it CANNOT do.
	// A planner that knows an engine lacks QUALIFY writes a subquery; one that
	// does not writes QUALIFY and discovers the limit as a syntax error the
	// model then tries to guess its way out of.
	fmt.Fprintf(&b, "%s\n\n", cat.Dialect.PromptLine())

	tables := make([]warehouse.Table, len(cat.Tables))
	copy(tables, cat.Tables)
	sort.Slice(tables, func(i, j int) bool { return tables[i].RowCount > tables[j].RowCount })

	for _, t := range tables {
		fmt.Fprintf(&b, "TABLE %s  (%s rows)", t.FQN(), commas(t.RowCount))
		if t.Comment != "" {
			fmt.Fprintf(&b, "  -- %s", t.Comment)
		}
		b.WriteString("\n")
		for _, c := range t.Columns {
			fmt.Fprintf(&b, "  %-28s %s", c.Name, c.Type)
			if c.Comment != "" {
				fmt.Fprintf(&b, "  -- %s", c.Comment)
			}
			b.WriteString(describeProfile(c.Profile, t.RowCount))
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	if warn := aliasWarnings(cat); warn != "" {
		b.WriteString(warn)
	}
	return b.String()
}

func describeProfile(p *warehouse.ColumnProfile, rowCount int64) string {
	if p == nil {
		return ""
	}
	var parts []string
	if len(p.DistinctValues) > 0 {
		parts = append(parts, "values: "+strings.Join(quoteAll(p.DistinctValues), ", "))
	} else if p.DistinctCount > 0 {
		parts = append(parts, fmt.Sprintf("~%s distinct", commas(p.DistinctCount)))
	}
	if p.Min != "" || p.Max != "" {
		parts = append(parts, fmt.Sprintf("range %s..%s", p.Min, p.Max))
	}
	if p.NullCount > 0 && rowCount > 0 {
		parts = append(parts, fmt.Sprintf("%.1f%% NULL", float64(p.NullCount)/float64(rowCount)*100))
	}
	if len(parts) == 0 {
		return ""
	}
	return "  [" + strings.Join(parts, "; ") + "]"
}

// aliasWarnings promotes detected alias groups to their own section. Buried in
// a column line they read as trivia; stated separately they read as a
// double-counting hazard, which is what they are.
func aliasWarnings(cat *warehouse.Catalog) string {
	var b strings.Builder
	for _, t := range cat.Tables {
		for _, c := range t.Columns {
			if c.Profile == nil || len(c.Profile.Aliases) == 0 {
				continue
			}
			if b.Len() == 0 {
				b.WriteString("SPLIT-ENTITY HAZARDS (measured from the data — grouping or filtering on these columns as stored will split one real entity across several rows, and filtering on one spelling will silently miss the others):\n")
			}
			for _, g := range c.Profile.Aliases {
				fmt.Fprintf(&b, "  %s.%s: %s all denote the same entity\n",
					t.Name, c.Name, strings.Join(quoteAll(g), " = "))
			}
		}
	}
	return b.String()
}

func quoteAll(vs []string) []string {
	out := make([]string, len(vs))
	for i, v := range vs {
		out[i] = "'" + v + "'"
	}
	return out
}

func commas(n int64) string {
	s := fmt.Sprint(n)
	if len(s) <= 3 {
		return s
	}
	var out []byte
	for i := 0; i < len(s); i++ {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, s[i])
	}
	return string(out)
}

// HasAliases reports whether any column in the catalog has a detected split
// entity, which the planner uses to decide whether to force a canonicalized
// reading into the candidate set.
func HasAliases(cat *warehouse.Catalog, table, column string) [][]string {
	for _, t := range cat.Tables {
		if table != "" && !strings.EqualFold(t.Name, table) {
			continue
		}
		for _, c := range t.Columns {
			if strings.EqualFold(c.Name, column) && c.Profile != nil {
				return c.Profile.Aliases
			}
		}
	}
	return nil
}

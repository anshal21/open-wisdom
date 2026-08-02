package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// The mock provider — the one this package's doc comment has always promised
// and never had.
//
// Without it there is no offline development, no deterministic test, no CI that
// exercises the ask pipeline without spending real money, and a first run that
// fails for anyone who is not already a Claude Code user. That is the single
// largest adoption barrier in the project after the licence.
//
// It is NOT a stub that returns fixed strings. The pipeline executes whatever
// SQL it is handed, verifies the result, and charts it — so a mock that emits
// `SELECT 1` produces a product that "runs" while demonstrating nothing. This
// one reads the schema digest out of the prompt it was given and writes real,
// executable SQL against whatever warehouse is attached. Same prompt in, same
// SQL out, every time.
//
// What it deliberately does not do: invent ambiguity, disagree with itself, or
// pretend to cost money. Those states are reachable in tests by other means;
// manufacturing them here would make every offline run look alarming.
func init() {
	Register("mock", func(cfg ProviderConfig) (Provider, error) {
		return &Mock{}, nil
	})
}

type Mock struct{}

func (m *Mock) Name() string { return "mock" }

// The mock emits bare JSON and knows exactly what its calls cost: nothing.
// Reporting cost honestly as zero — rather than leaving the field unset and
// letting the UI imply a real price — is the point of the capability flag.
func (m *Mock) Capabilities() Capabilities {
	return Capabilities{NativeJSON: true, ReportsCost: false}
}

func (m *Mock) Complete(ctx context.Context, req Request) (*Response, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	start := time.Now()

	body, err := m.reply(req)
	if err != nil {
		return nil, err
	}
	return &Response{
		Text:      body,
		CostUSD:   0,
		Model:     "mock",
		ElapsedMS: time.Since(start).Milliseconds(),
	}, nil
}

// reply routes on the system prompt.
//
// Matching on distinctive prose rather than an enum is deliberate: the prompts
// live in `ask`, `investigate` and `sources`, all of which import this package,
// so a shared constant would be an import cycle. The markers are the opening
// clause of each system prompt — stable text that states the call's purpose.
func (m *Mock) reply(req Request) (string, error) {
	sys := req.System
	switch {
	case strings.Contains(sys, "turn a business question into SQL"):
		return m.plan(req.Prompt), nil
	case strings.Contains(sys, "audit questions for ambiguity"):
		return `{"readings":[]}`, nil
	case strings.Contains(sys, "INDEPENDENT re-derivation"):
		return m.cross(req.Prompt), nil
	case strings.Contains(sys, "You are the presenter"):
		return m.present(req.Prompt), nil
	case strings.Contains(sys, "root-cause investigation"):
		return m.investigationPlan(req.Prompt), nil
	case strings.Contains(sys, "closing paragraph"):
		return `{"markdown":"The change is concentrated in a small number of segments. The residual is stated above rather than absorbed into them."}`, nil
	case strings.Contains(sys, "data quality auditor"):
		return `{"columns":[]}`, nil
	}
	// An unrecognised prompt is a real failure: it means a new model call was
	// added to the pipeline and the mock was not taught about it, which would
	// otherwise surface as a mysterious decode error much further downstream.
	return "", fmt.Errorf(
		"mock provider: unrecognised system prompt (%.80q…) — a new model call was added without teaching internal/llm/mock.go about it",
		strings.TrimSpace(sys))
}

/* --------------------------------------------------------------------------
   Reading the schema out of the prompt

   sources.Digest renders each table as:

       TABLE main.orders  (12,345 rows)  -- comment
         order_id                     BIGINT  [~12,345 distinct]
         created_at                   TIMESTAMP  [range 2023-01-01..2023-12-31]

   Parsing it back is what lets the mock write SQL that actually runs.
-------------------------------------------------------------------------- */

type mockColumn struct {
	Name string
	Type string
}

type mockTable struct {
	Name    string
	Columns []mockColumn
}

var tableLine = regexp.MustCompile(`^TABLE\s+(\S+)`)

func parseDigest(prompt string) []mockTable {
	var tables []mockTable
	for _, line := range strings.Split(prompt, "\n") {
		if mt := tableLine.FindStringSubmatch(line); mt != nil {
			tables = append(tables, mockTable{Name: mt[1]})
			continue
		}
		// Column lines are indented under the table they belong to.
		if len(tables) == 0 || !strings.HasPrefix(line, "  ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name, typ := fields[0], fields[1]
		// The profile block opens with '[' and the comment with '--'; neither
		// is a type.
		if strings.HasPrefix(typ, "[") || strings.HasPrefix(typ, "--") {
			continue
		}
		t := &tables[len(tables)-1]
		t.Columns = append(t.Columns, mockColumn{Name: name, Type: typ})
	}
	return tables
}

func isTemporal(t string) bool {
	u := strings.ToUpper(t)
	return strings.HasPrefix(u, "TIMESTAMP") || strings.HasPrefix(u, "DATE") ||
		strings.HasPrefix(u, "TIME")
}

func isNumeric(t string) bool {
	u := strings.ToUpper(t)
	for _, p := range []string{"INT", "DOUBLE", "DECIMAL", "NUMERIC", "FLOAT", "REAL", "BIGINT", "HUGEINT"} {
		if strings.Contains(u, p) {
			return true
		}
	}
	return false
}

// An id is numeric but summing one is meaningless. So is summing a row
// counter. The planner this stands in for would never do either, so neither
// does the mock — and picking a real measure is what lets the offline run
// exercise cross-derivation instead of silently skipping it.
func isKey(name string) bool {
	n := strings.ToLower(name)
	if n == "id" || strings.HasSuffix(n, "_id") || strings.HasSuffix(n, "id") {
		return true
	}
	for _, counter := range []string{"sequence", "seq_num", "row_number", "index", "_num", "number"} {
		if strings.Contains(n, counter) {
			return true
		}
	}
	return false
}

// measureRank orders candidate measures. A floating-point column is almost
// always the quantity someone means (price, amount, rate); an integer column
// is more often a count or a code.
//
// This ordering also has a correctness consequence worth knowing: DuckDB's
// SUM over a BIGINT yields HUGEINT, which the Go driver hands back as
// *big.Int — a type the verification engine's asFloat does not recognise, so
// the cross-derivation check skips itself. Preferring a real measure keeps
// the offline run exercising the product's strongest check.
func measureRank(t string) int {
	u := strings.ToUpper(t)
	switch {
	case strings.Contains(u, "DOUBLE"), strings.Contains(u, "DECIMAL"),
		strings.Contains(u, "NUMERIC"), strings.Contains(u, "FLOAT"),
		strings.Contains(u, "REAL"):
		return 0
	default:
		return 1
	}
}

// shape picks a table and the columns to answer with: the first table that has
// a measure, preferring one that also has a time axis so the default chart is
// a trend rather than a bare number.
type mockShape struct {
	Table   string
	Time    string
	Measure string
	Group   string
	OK      bool
}

func shapeOf(prompt string) mockShape {
	var best mockShape
	bestScore := -1

	for _, t := range parseDigest(prompt) {
		s := mockShape{Table: t.Name}
		measureRankFound := 99
		for _, c := range t.Columns {
			if isTemporal(c.Type) {
				if s.Time == "" {
					s.Time = c.Name
				}
				continue
			}
			if isNumeric(c.Type) {
				if !isKey(c.Name) && measureRank(c.Type) < measureRankFound {
					s.Measure, measureRankFound = c.Name, measureRank(c.Type)
				}
				continue
			}
			if s.Group == "" && !isKey(c.Name) {
				s.Group = c.Name
			}
		}
		if s.Measure == "" {
			continue
		}
		s.OK = true

		// Rank tables: a real (floating-point) measure beats an integer one,
		// and a time axis beats none — so the default answer is a trend over
		// a genuine quantity rather than a sum of row counters.
		score := 0
		if measureRankFound == 0 {
			score += 2
		}
		if s.Time != "" {
			score++
		}
		if score > bestScore {
			best, bestScore = s, score
		}
	}
	return best
}

func quote(id string) string {
	return `"` + strings.ReplaceAll(id, `"`, `""`) + `"`
}

/* --------------------------------------------------------------------------
   The four ask-pipeline calls
-------------------------------------------------------------------------- */

func (m *Mock) plan(prompt string) string {
	s := shapeOf(prompt)
	if !s.OK {
		// No measurable column anywhere. Answer honestly with a constant
		// rather than failing the pipeline: an empty warehouse should still
		// produce a working end-to-end run.
		return mustJSON(planOut{
			Restated:    "No measurable column is available in this warehouse.",
			Unit:        "rows",
			FormatHint:  "count",
			Label:       "Row count",
			SQL:         "SELECT 1 AS value",
			Assumptions: []string{},
			Readings:    []struct{}{},
		})
	}

	var sql string
	switch {
	case s.Time != "":
		sql = fmt.Sprintf(
			"SELECT date_trunc('month', %s) AS period, SUM(%s) AS total FROM %s GROUP BY 1 ORDER BY 1",
			quote(s.Time), quote(s.Measure), s.Table)
	case s.Group != "":
		sql = fmt.Sprintf(
			"SELECT %s AS category, SUM(%s) AS total FROM %s GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
			quote(s.Group), quote(s.Measure), s.Table)
	default:
		sql = fmt.Sprintf("SELECT SUM(%s) AS total FROM %s", quote(s.Measure), s.Table)
	}

	return mustJSON(planOut{
		Restated:    fmt.Sprintf("Total %s from %s, as the offline mock provider reads the schema.", s.Measure, s.Table),
		FormatHint:  "number",
		Label:       "Total " + s.Measure,
		SQL:         sql,
		Assumptions: []string{},
		Readings:    []struct{}{},
	})
}

// cross derives the same quantity by a different syntactic route.
//
// It must AGREE with the plan: cross-derivation disagreement is what produces
// the `contested` seal, and a mock that contested every answer would make the
// offline product look broken rather than working. Different route, same
// number — which is exactly the claim the check exists to test.
func (m *Mock) cross(prompt string) string {
	s := shapeOf(prompt)
	if !s.OK {
		return mustJSON(crossOut{SQL: "SELECT 1 AS value", Approach: "constant"})
	}

	var sql string
	switch {
	case s.Time != "":
		sql = fmt.Sprintf(
			"WITH rows AS (SELECT date_trunc('month', %s) AS period, %s AS amount FROM %s) SELECT period, SUM(amount) AS total FROM rows GROUP BY period ORDER BY period",
			quote(s.Time), quote(s.Measure), s.Table)
	case s.Group != "":
		sql = fmt.Sprintf(
			"WITH rows AS (SELECT %s AS category, %s AS amount FROM %s) SELECT category, SUM(amount) AS total FROM rows GROUP BY category ORDER BY total DESC LIMIT 20",
			quote(s.Group), quote(s.Measure), s.Table)
	default:
		sql = fmt.Sprintf(
			"WITH rows AS (SELECT %s AS amount FROM %s) SELECT SUM(amount) AS total FROM rows",
			quote(s.Measure), s.Table)
	}

	return mustJSON(crossOut{
		SQL:      sql,
		Approach: "aggregate over a CTE rather than grouping the base table directly",
	})
}

// present writes the narrative and the chart hint from the result it was
// handed. It reads the RESULT section of the prompt rather than the schema,
// because that is what the real presenter sees.
func (m *Mock) present(prompt string) string {
	out := presentOut{
		Markdown: "Produced offline by the mock provider: the figures are real, read from the attached warehouse, but no model wrote this sentence.",
		Chart:    chartOut{Y: []string{}},
	}
	if cols := resultColumns(prompt); len(cols) >= 2 {
		out.Chart = chartOut{
			Type: chartTypeFor(cols[0]),
			X:    cols[0],
			Y:    []string{cols[len(cols)-1]},
		}
	}
	return mustJSON(out)
}

// resultColumns pulls column names out of the presenter prompt's result line,
// which pipeline.present renders as:
//
//	RESULT: a table of 12 rows with columns period, total
//
// A scalar result has no column list and yields no chart hint, which is
// correct — a single figure is a hero number, not a plot.
var headerLine = regexp.MustCompile(`(?m)^RESULT: a table of \d+ rows with columns\s+(.+)$`)

func resultColumns(prompt string) []string {
	m := headerLine.FindStringSubmatch(prompt)
	if m == nil {
		return nil
	}
	var out []string
	for _, f := range strings.Split(m[1], ",") {
		if f = strings.TrimSpace(f); f != "" {
			// Columns may be rendered as `name (type)`.
			if i := strings.IndexByte(f, ' '); i > 0 {
				f = f[:i]
			}
			out = append(out, f)
		}
	}
	return out
}

func chartTypeFor(x string) string {
	l := strings.ToLower(x)
	if strings.Contains(l, "period") || strings.Contains(l, "month") ||
		strings.Contains(l, "date") || strings.Contains(l, "day") {
		return "line"
	}
	return "bar"
}

/* --------------------------------------------------------------------------
   The investigation planner
-------------------------------------------------------------------------- */

func (m *Mock) investigationPlan(prompt string) string {
	s := shapeOf(prompt)
	if !s.OK {
		return mustJSON(investigationOut{
			Restated:       "No measurable column is available offline.",
			Measure:        "COUNT(*)",
			From:           "(SELECT 1) t",
			Where:          "1=1",
			TimeExpression: "CURRENT_DATE",
			Segments:       []segmentOut{},
		})
	}
	out := investigationOut{
		Restated:       fmt.Sprintf("Movement in %s.", s.Measure),
		Measure:        fmt.Sprintf("SUM(%s)", quote(s.Measure)),
		From:           s.Table,
		Where:          "1=1",
		TimeExpression: "CURRENT_DATE",
		Segments:       []segmentOut{},
	}
	if s.Time != "" {
		out.TimeExpression = quote(s.Time)
	}
	if s.Group != "" {
		out.Segments = append(out.Segments, segmentOut{
			Label:      s.Group,
			Expression: quote(s.Group),
		})
	}
	return mustJSON(out)
}

/* -------------------------------------------------------------------------- */

// Reply shapes.
//
// These mirror the private reply structs in ask/ and investigate/. They are
// duplicated rather than imported because those packages import this one — and
// they are encoded with encoding/json rather than fmt, because a hand-rolled
// object breaks the moment a value contains a quoted SQL identifier. That is
// not hypothetical: it was caught by TestMockAnswersEveryPipelinePrompt.

type planOut struct {
	Restated    string     `json:"restated"`
	Assumptions []string   `json:"assumptions"`
	Unit        string     `json:"unit"`
	FormatHint  string     `json:"format_hint"`
	Label       string     `json:"label"`
	SQL         string     `json:"sql"`
	Readings    []struct{} `json:"readings"`
}

type crossOut struct {
	SQL      string `json:"sql"`
	Approach string `json:"approach"`
}

type chartOut struct {
	Type   string   `json:"type"`
	X      string   `json:"x"`
	Y      []string `json:"y"`
	Series string   `json:"series"`
}

type presentOut struct {
	Markdown string   `json:"markdown"`
	Chart    chartOut `json:"chart"`
}

type segmentOut struct {
	Label      string `json:"label"`
	Expression string `json:"expression"`
	Join       string `json:"join"`
}

type investigationOut struct {
	Restated       string       `json:"restated"`
	Unit           string       `json:"unit"`
	Measure        string       `json:"measure"`
	From           string       `json:"from"`
	Where          string       `json:"where"`
	TimeExpression string       `json:"time_expression"`
	Segments       []segmentOut `json:"segments"`
}

// mustJSON encodes a reply. A failure here is a programming error in this
// file, not a runtime condition — every shape above is trivially encodable.
func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic("llm/mock: unencodable reply: " + err.Error())
	}
	return string(b)
}

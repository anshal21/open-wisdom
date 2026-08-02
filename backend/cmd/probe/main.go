// Command probe runs one question end to end and prints the verification
// report. It exists to exercise the wedge from a terminal before the HTTP
// service and UI are finished.
//
//	go run ./cmd/probe -q "what was total revenue in 2023?"
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

func main() {
	question := flag.String("q", "what was total revenue in 2023?", "question to ask")
	dbPath := flag.String("db", "", "duckdb file (required)")
	flag.Parse()
	if *dbPath == "" {
		fmt.Fprintln(os.Stderr, "probe: -db <path to duckdb file> is required")
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if err := run(ctx, *question, *dbPath); err != nil {
		fmt.Fprintf(os.Stderr, "\n%s %v\n", red("error:"), err)
		os.Exit(1)
	}
}

func run(ctx context.Context, question, dbPath string) error {
	overall := time.Now()

	// Prefer opening in place; DuckDB allows concurrent readers. Only fall back
	// to a copy when another process holds the file read-write, since these
	// warehouses are large and disk is not free.
	conn, err := warehouse.OpenDuckDB(dbPath)
	if err != nil {
		if !strings.Contains(err.Error(), "lock") {
			return err
		}
		fmt.Printf("%s warehouse is locked by another process; working on a copy\n", dim("!"))
		path, cleanup, cerr := snapshot(dbPath)
		if cerr != nil {
			return cerr
		}
		defer cleanup()
		if conn, err = warehouse.OpenDuckDB(path); err != nil {
			return err
		}
	}
	defer conn.Close()

	step("Introspecting warehouse")
	cat, err := conn.Introspect(ctx)
	if err != nil {
		return err
	}
	step(fmt.Sprintf("Profiling %d tables", len(cat.Tables)))
	if err := warehouse.NewProfiler(conn).Profile(ctx, cat); err != nil {
		return err
	}

	model := llm.NewRecorder(llm.NewClaudeCLI("", 4))

	// The two derivations are generated concurrently and independently. The
	// alternate generator never sees the primary SQL — that independence is
	// what makes agreement meaningful.
	step("Planning two independent derivations")
	var primarySQL, altSQL string
	var perr, aerr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); primarySQL, perr = generate(ctx, model, cat, question, false) }()
	go func() { defer wg.Done(); altSQL, aerr = generate(ctx, model, cat, question, true) }()
	wg.Wait()
	if perr != nil {
		return fmt.Errorf("primary derivation: %w", perr)
	}
	if aerr != nil {
		fmt.Printf("  %s alternate derivation unavailable: %v\n", dim("!"), aerr)
	}

	fmt.Printf("\n%s\n%s\n", bold("PRIMARY SQL"), indent(primarySQL))
	if altSQL != "" {
		fmt.Printf("\n%s\n%s\n", bold("INDEPENDENT DERIVATION"), indent(altSQL))
	}

	step("Executing")
	res, err := conn.Query(ctx, primarySQL)
	if err != nil {
		return fmt.Errorf("primary query failed: %w", err)
	}

	step("Verifying")
	parsed, err := verify.ParseQuery(ctx, conn, primarySQL)
	if err != nil {
		return err
	}
	subject := &verify.Subject{
		Question: question, SQL: primarySQL, Parsed: parsed,
		Result: res, Catalog: cat, Conn: conn,
	}
	cross := verify.CrossDerive(ctx, conn, res, altSQL)
	report := verify.NewEngine(model).Run(ctx, subject, &cross)

	printResult(res)
	printReport(report)

	calls, cost := model.Stats()
	fmt.Printf("\n%s %d model calls, $%.4f, %.1fs total\n",
		dim("cost:"), calls, cost, time.Since(overall).Seconds())
	return nil
}

// generate asks for SQL. When alternate is set, the model is told to reach the
// same figure by a different route.
func generate(ctx context.Context, p llm.Provider, cat *warehouse.Catalog, question string, alternate bool) (string, error) {
	system := `You translate a question into a single read-only SQL query for the given warehouse.
Return JSON: {"sql":"..."}. The query must return a single scalar value where the question asks for one figure.
Use only tables and columns present in the schema. Never invent names.`
	if alternate {
		system += `
You are producing an INDEPENDENT SECOND derivation for cross-checking. Where the data allows, reach the
figure by a different route than the most obvious one (a different table, a different aggregation path).
If only one route exists, use it.`
	}

	prompt := fmt.Sprintf("Schema (dialect %s):\n%s\n\nQuestion: %s",
		cat.Dialect, renderSchema(cat), question)

	speed := llm.SpeedBalanced
	res, err := p.Complete(ctx, llm.Request{System: system, Prompt: prompt, Speed: speed, JSON: true})
	if err != nil {
		return "", err
	}
	var out struct {
		SQL string `json:"sql"`
	}
	if err := llm.DecodeJSON(res.Text, &out); err != nil {
		return "", err
	}
	if strings.TrimSpace(out.SQL) == "" {
		return "", fmt.Errorf("model returned no sql")
	}
	return out.SQL, nil
}

// renderSchema serializes the catalog compactly, including the real values of
// enum-like columns so the model has no excuse to guess casing.
func renderSchema(cat *warehouse.Catalog) string {
	var b strings.Builder
	for _, t := range cat.Tables {
		fmt.Fprintf(&b, "%s (%d rows)\n", t.Name, t.RowCount)
		for _, c := range t.Columns {
			fmt.Fprintf(&b, "  %s %s", c.Name, c.Type)
			if c.Profile != nil && len(c.Profile.DistinctValues) > 0 {
				fmt.Fprintf(&b, "  values: [%s]", strings.Join(c.Profile.DistinctValues, ", "))
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}

func printResult(res *warehouse.Result) {
	fmt.Printf("\n%s\n", bold("RESULT"))
	if v, ok := res.Scalar(); ok {
		fmt.Printf("  %s\n", green(fmt.Sprint(v)))
		return
	}
	names := make([]string, len(res.Columns))
	for i, c := range res.Columns {
		names[i] = c.Name
	}
	fmt.Printf("  %s\n", dim(strings.Join(names, " | ")))
	for i, row := range res.Rows {
		if i >= 10 {
			fmt.Printf("  %s\n", dim(fmt.Sprintf("… %d more rows", len(res.Rows)-10)))
			break
		}
		cells := make([]string, len(row))
		for j, v := range row {
			cells[j] = fmt.Sprint(v)
		}
		fmt.Printf("  %s\n", strings.Join(cells, " | "))
	}
}

func printReport(r verify.Report) {
	fmt.Printf("\n%s  %s  (%d of %d checks)\n",
		bold("VERDICT"), seal(r.Confidence), r.Passed, r.Total)
	fmt.Printf("  %s\n\n", r.Headline)

	for _, c := range r.Checks {
		mark, colorize := statusGlyph(c.Status)
		fmt.Printf("  %s %s\n", colorize(mark), bold(c.Label))
		text := c.Finding
		if c.Status == verify.StatusSkipped {
			text = "not run — " + c.SkipReason
		}
		for _, line := range wrap(text, 88) {
			fmt.Printf("      %s\n", dim(line))
		}
	}
}

func statusGlyph(s verify.Status) (string, func(string) string) {
	switch s {
	case verify.StatusPass:
		return "✓", green
	case verify.StatusWarn:
		return "!", yellow
	case verify.StatusFail:
		return "✗", red
	default:
		return "–", dim
	}
}

func seal(c verify.Confidence) string {
	switch c {
	case verify.ConfVerified:
		return green(strings.ToUpper(string(c)))
	case verify.ConfQualified:
		return yellow(strings.ToUpper(string(c)))
	case verify.ConfContested, verify.ConfRefused:
		return red(strings.ToUpper(string(c)))
	default:
		return dim(strings.ToUpper(string(c)))
	}
}

func snapshot(src string) (string, func(), error) {
	in, err := os.Open(src)
	if err != nil {
		return "", nil, fmt.Errorf("open warehouse: %w", err)
	}
	defer in.Close()
	tmp, err := os.CreateTemp("", "probe-*.duckdb")
	if err != nil {
		return "", nil, err
	}
	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", nil, err
	}
	tmp.Close()
	return tmp.Name(), func() { os.Remove(tmp.Name()) }, nil
}

func step(msg string) { fmt.Printf("%s %s\n", dim("›"), msg) }

func indent(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i, l := range lines {
		lines[i] = "  " + dim(strings.TrimSpace(l))
	}
	return strings.Join(lines, "\n")
}

func wrap(s string, width int) []string {
	words := strings.Fields(s)
	if len(words) == 0 {
		return nil
	}
	var lines []string
	cur := words[0]
	for _, w := range words[1:] {
		if len(cur)+1+len(w) > width {
			lines = append(lines, cur)
			cur = w
			continue
		}
		cur += " " + w
	}
	return append(lines, cur)
}

func color(code string) func(string) string {
	return func(s string) string {
		if os.Getenv("NO_COLOR") != "" {
			return s
		}
		return "\033[" + code + "m" + s + "\033[0m"
	}
}

var (
	bold   = color("1")
	dim    = color("2;37")
	red    = color("31")
	green  = color("32")
	yellow = color("33")
)

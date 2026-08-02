package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

// ErrNotFound is returned by every repository for a missing row, so handlers
// map one error to 404 rather than each knowing about SQL.
var ErrNotFound = errors.New("not found")

// Answers is the ledger repository.
type Answers struct{ db *sql.DB }

func NewAnswers(d *DB) *Answers { return &Answers{db: d.sql} }

// AnswerFilter scopes a ledger listing.
type AnswerFilter struct {
	Query      string
	Confidence string
	From       string
	To         string
	Limit      int
}

func (r *Answers) Create(ctx context.Context, a *Answer) error {
	if a.ID == "" {
		a.ID = ID("ans")
	}
	if a.CreatedAt == "" {
		a.CreatedAt = now()
	}
	if a.QuestionKey == "" {
		a.QuestionKey = NormalizeQuestion(a.Question)
	}

	var defID, defName string
	if a.DefinitionUsed != nil {
		defID, defName = a.DefinitionUsed.ID, a.DefinitionUsed.Name
	}
	var value any
	hasValue := 0
	if a.Value != nil {
		value, hasValue = *a.Value, 1
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO answers (id, thread_id, source_id, question, restated, assumptions_json,
			value, has_value, unit, format_hint, columns_json, rows_json, row_count,
			sql_text, alt_sql, report_json, chart_json, ambiguity_json, narrative, confidence,
			definition_id, definition_name, created_by, created_at, cost_json, rerun_of, question_key)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.ID, a.ThreadID, a.SourceID, a.Question, a.Restated, mustJSON(a.Assumptions),
		value, hasValue, a.Unit, a.FormatHint, mustJSON(a.Columns), mustJSON(a.Rows), a.RowCount,
		a.SQL, a.AltSQL, mustJSON(a.Report), mustJSON(a.Chart), mustJSON(a.Ambiguity), a.Narrative, string(a.Confidence),
		defID, defName, a.CreatedBy, a.CreatedAt, mustJSON(a.Cost), a.RerunOf, a.QuestionKey)
	if err != nil {
		return fmt.Errorf("insert answer %s: %w", a.ID, err)
	}
	return nil
}

const answerCols = `id, thread_id, source_id, question, restated, assumptions_json,
	value, has_value, unit, format_hint, columns_json, rows_json, row_count,
	sql_text, alt_sql, report_json, chart_json, ambiguity_json, narrative, confidence,
	definition_id, definition_name, created_by, created_at, cost_json, rerun_of, question_key`

func scanAnswer(s interface{ Scan(...any) error }) (*Answer, error) {
	var a Answer
	var threadID, sourceID, restated, assumptions, unit, formatHint sql.NullString
	var columns, rows, sqlText, altSQL, report, chart, ambiguity, narrative sql.NullString
	var defID, defName, createdBy, cost, rerunOf, qkey sql.NullString
	var value sql.NullFloat64
	var hasValue int
	var confidence string

	err := s.Scan(&a.ID, &threadID, &sourceID, &a.Question, &restated, &assumptions,
		&value, &hasValue, &unit, &formatHint, &columns, &rows, &a.RowCount,
		&sqlText, &altSQL, &report, &chart, &ambiguity, &narrative, &confidence,
		&defID, &defName, &createdBy, &a.CreatedAt, &cost, &rerunOf, &qkey)
	if err != nil {
		return nil, err
	}

	a.ThreadID, a.SourceID = threadID.String, sourceID.String
	a.Restated, a.Unit, a.FormatHint = restated.String, unit.String, formatHint.String
	a.SQL, a.AltSQL, a.Narrative = sqlText.String, altSQL.String, narrative.String
	a.CreatedBy, a.RerunOf, a.QuestionKey = createdBy.String, rerunOf.String, qkey.String
	a.Confidence = verify.Confidence(confidence)
	if hasValue == 1 && value.Valid {
		v := value.Float64
		a.Value = &v
	}
	if p := fromJSON[[]string](assumptions.String); p != nil {
		a.Assumptions = *p
	}
	if p := fromJSON[[]ResultColumn](columns.String); p != nil && len(*p) > 0 && (*p)[0].Name != "" {
		a.Columns = *p
	} else if p := fromJSON[[]string](columns.String); p != nil {
		// Answers stored before columns carried types decode as bare names;
		// they render as untyped nominal columns rather than not at all.
		for _, name := range *p {
			a.Columns = append(a.Columns, ResultColumn{Name: name, Label: name, Type: "nominal"})
		}
	}
	if p := fromJSON[[][]any](rows.String); p != nil {
		a.Rows = *p
	}
	a.Report = fromJSON[verify.Report](report.String)
	a.Chart = fromJSON[ChartSpec](chart.String)
	a.Ambiguity = fromJSON[Ambiguity](ambiguity.String)
	a.Cost = fromJSON[Cost](cost.String)
	if defID.String != "" || defName.String != "" {
		a.DefinitionUsed = &DefinitionRef{ID: defID.String, Name: defName.String}
	}
	return &a, nil
}

func (r *Answers) Get(ctx context.Context, id string) (*Answer, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+answerCols+` FROM answers WHERE id = ?`, id)
	a, err := scanAnswer(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get answer %s: %w", id, err)
	}
	return a, nil
}

func (r *Answers) List(ctx context.Context, f AnswerFilter) ([]AnswerSummary, error) {
	q := `SELECT id, question, value, has_value, unit, format_hint, confidence, row_count, created_by, created_at
	      FROM answers WHERE 1=1`
	var args []any
	if f.Query != "" {
		q += ` AND (lower(question) LIKE ? OR lower(coalesce(narrative,'')) LIKE ? OR lower(coalesce(definition_name,'')) LIKE ?)`
		like := "%" + strings.ToLower(f.Query) + "%"
		args = append(args, like, like, like)
	}
	if f.Confidence != "" {
		q += ` AND confidence = ?`
		args = append(args, f.Confidence)
	}
	if f.From != "" {
		q += ` AND created_at >= ?`
		args = append(args, f.From)
	}
	if f.To != "" {
		q += ` AND created_at <= ?`
		args = append(args, f.To)
	}
	q += ` ORDER BY created_at DESC`
	if f.Limit > 0 {
		q += fmt.Sprintf(` LIMIT %d`, f.Limit)
	}

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list answers: %w", err)
	}
	defer rows.Close()

	var out []AnswerSummary
	for rows.Next() {
		var s AnswerSummary
		var value sql.NullFloat64
		var hasValue int
		var unit, formatHint, createdBy sql.NullString
		var confidence string
		if err := rows.Scan(&s.ID, &s.Question, &value, &hasValue, &unit, &formatHint,
			&confidence, &s.RowCount, &createdBy, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan answer summary: %w", err)
		}
		if hasValue == 1 && value.Valid {
			v := value.Float64
			s.Value = &v
		}
		s.Unit, s.FormatHint, s.CreatedBy = unit.String, formatHint.String, createdBy.String
		s.Confidence = verify.Confidence(confidence)
		out = append(out, s)
	}
	return out, rows.Err()
}

// ByDefinition returns answers produced under a definition lineage. This is the
// backbone of the impact endpoint: changing a definition must be able to name
// every answer it invalidates.
func (r *Answers) ByDefinition(ctx context.Context, defIDs []string, limit int) ([]AnswerSummary, int, error) {
	if len(defIDs) == 0 {
		return nil, 0, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(defIDs)), ",")
	args := make([]any, len(defIDs))
	for i, id := range defIDs {
		args[i] = id
	}

	var total int
	if err := r.db.QueryRowContext(ctx,
		`SELECT count(*) FROM answers WHERE definition_id IN (`+ph+`)`, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count answers by definition: %w", err)
	}

	rows, err := r.db.QueryContext(ctx, fmt.Sprintf(
		`SELECT id, question, value, has_value, unit, format_hint, confidence, row_count, created_by, created_at
		 FROM answers WHERE definition_id IN (%s) ORDER BY created_at DESC LIMIT %d`, ph, limit), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list answers by definition: %w", err)
	}
	defer rows.Close()

	var out []AnswerSummary
	for rows.Next() {
		var s AnswerSummary
		var value sql.NullFloat64
		var hasValue int
		var unit, formatHint, createdBy sql.NullString
		var confidence string
		if err := rows.Scan(&s.ID, &s.Question, &value, &hasValue, &unit, &formatHint,
			&confidence, &s.RowCount, &createdBy, &s.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan answer summary: %w", err)
		}
		if hasValue == 1 && value.Valid {
			v := value.Float64
			s.Value = &v
		}
		s.Unit, s.FormatHint, s.CreatedBy = unit.String, formatHint.String, createdBy.String
		s.Confidence = verify.Confidence(confidence)
		out = append(out, s)
	}
	return out, total, rows.Err()
}

// Precedent returns the most recent prior answer to an equivalent question,
// excluding one id. The precedent check compares against it.
//
// Equivalence has two signals: the normalized question text, and the executed
// SQL. Two phrasings that compiled to the same statement are the same question
// by construction — that is the match that catches "2023 total revenue"
// against "what was total revenue in 2023?" when a ratified definition drove
// both to identical SQL.
func (r *Answers) Precedent(ctx context.Context, questionKey, sqlKey, excludeID string) (*Answer, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+answerCols+`
		FROM answers WHERE id <> ? AND has_value = 1 AND confidence <> 'refused'
		ORDER BY created_at DESC LIMIT 50`, excludeID)
	if err != nil {
		return nil, fmt.Errorf("precedent for %q: %w", questionKey, err)
	}
	defer rows.Close()
	for rows.Next() {
		a, err := scanAnswer(rows)
		if err != nil {
			return nil, fmt.Errorf("precedent scan: %w", err)
		}
		if a.QuestionKey == questionKey || (sqlKey != "" && NormalizeSQL(a.SQL) == sqlKey) {
			return a, nil
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("precedent iterate: %w", err)
	}
	return nil, ErrNotFound
}

// Flag is a human's "this is wrong" on a specific answer. Flags are never
// deleted: a correction is part of the answer's history, and an answer that
// was once contested by a human should say so forever.
type Flag struct {
	ID        string `json:"id"`
	AnswerID  string `json:"answer_id"`
	Reason    string `json:"reason"`
	CreatedBy string `json:"created_by,omitempty"`
	CreatedAt string `json:"created_at"`
}

func (r *Answers) Flag(ctx context.Context, f *Flag) error {
	if f.ID == "" {
		f.ID = ID("flag")
	}
	f.CreatedAt = now()
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO answer_flags (id, answer_id, reason, created_by, created_at) VALUES (?,?,?,?,?)`,
		f.ID, f.AnswerID, f.Reason, f.CreatedBy, f.CreatedAt); err != nil {
		return fmt.Errorf("flag answer %s: %w", f.AnswerID, err)
	}
	return nil
}

// Runs returns the re-run lineage containing `id`, oldest first.
//
// `rerun_of` is a linked list — each re-run points at its immediate
// predecessor — so a given answer may sit anywhere in the chain. Reaching the
// whole lineage means walking backwards to the root AND forwards to the newest
// run, which is why this is a recursive CTE rather than one lookup.
//
// `UNION` (not `UNION ALL`) is load-bearing: it dedupes, so a corrupt cycle in
// `rerun_of` terminates instead of spinning forever. A malformed ledger should
// degrade to a short history, never to a hung request.
//
// A lineage of one — an answer never re-run — returns nil rather than a
// single-entry history: "run 1 of 1" is chrome, not information.
func (r *Answers) Runs(ctx context.Context, id string) ([]AnswerRun, error) {
	const q = `
WITH RECURSIVE lineage(id) AS (
    SELECT ?
  UNION
    SELECT a.rerun_of FROM answers a, lineage l
     WHERE a.id = l.id AND a.rerun_of IS NOT NULL AND a.rerun_of <> ''
  UNION
    SELECT a.id FROM answers a, lineage l WHERE a.rerun_of = l.id
)
SELECT a.id, a.value, a.has_value, a.confidence, a.created_at, coalesce(a.rerun_of,'')
  FROM answers a JOIN lineage ON lineage.id = a.id`

	rows, err := r.db.QueryContext(ctx, q, id)
	if err != nil {
		return nil, fmt.Errorf("answer runs %s: %w", id, err)
	}
	defer rows.Close()

	type node struct {
		run     AnswerRun
		rerunOf string
	}
	nodes := map[string]*node{}
	next := map[string]string{} // predecessor id -> successor id
	for rows.Next() {
		var (
			n        node
			value    sql.NullFloat64
			hasValue bool
		)
		if err := rows.Scan(&n.run.ID, &value, &hasValue, &n.run.Confidence,
			&n.run.CreatedAt, &n.rerunOf); err != nil {
			return nil, fmt.Errorf("scan answer run: %w", err)
		}
		if hasValue && value.Valid {
			v := value.Float64
			n.run.Value = &v
		}
		nodes[n.run.ID] = &n
		if n.rerunOf != "" {
			next[n.rerunOf] = n.run.ID
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(nodes) < 2 {
		return nil, nil
	}

	// Order by walking the chain, not by created_at. Two re-runs inside the
	// same second tie on the timestamp and the tiebreak would be a random id —
	// a history that claims to show sequence cannot be sorted by a key that
	// ties. The links are the sequence; the clock only labels it.
	var root string
	for id, n := range nodes {
		if n.rerunOf == "" || nodes[n.rerunOf] == nil {
			root = id
			break
		}
	}
	if root == "" {
		// Every node claims a predecessor inside the set: the chain is a cycle.
		// A corrupt ledger yields no history rather than an arbitrary one.
		return nil, nil
	}

	out := make([]AnswerRun, 0, len(nodes))
	seen := map[string]bool{}
	for cur := root; cur != "" && !seen[cur]; cur = next[cur] {
		seen[cur] = true
		n := nodes[cur]
		if n == nil {
			break
		}
		n.run.Run = len(out) + 1
		out = append(out, n.run)
	}
	if len(out) < 2 {
		return nil, nil
	}
	out[len(out)-1].Current = true
	return out, nil
}

func (r *Answers) FlagsFor(ctx context.Context, answerID string) ([]Flag, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, answer_id, reason, coalesce(created_by,''), created_at
		 FROM answer_flags WHERE answer_id = ? ORDER BY created_at`, answerID)
	if err != nil {
		return nil, fmt.Errorf("flags for %s: %w", answerID, err)
	}
	defer rows.Close()
	var out []Flag
	for rows.Next() {
		var f Flag
		if err := rows.Scan(&f.ID, &f.AnswerID, &f.Reason, &f.CreatedBy, &f.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan flag: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CoverageStats reports how many answers in a period were produced from a
// ratified definition. This is the adoption metric for the earned semantic layer.
func (r *Answers) CoverageStats(ctx context.Context, periodPrefix string) (fromRatified, total int, err error) {
	err = r.db.QueryRowContext(ctx, `
		SELECT count(*) FILTER (WHERE definition_id IS NOT NULL AND definition_id <> ''), count(*)
		FROM answers WHERE created_at LIKE ? AND confidence <> 'refused'`, periodPrefix+"%").
		Scan(&fromRatified, &total)
	if err != nil {
		return 0, 0, fmt.Errorf("coverage stats %s: %w", periodPrefix, err)
	}
	return fromRatified, total, nil
}

// CoveragePoint is one bucket of the coverage trend.
type CoveragePoint struct {
	Period string  `json:"period"`
	Pct    float64 `json:"pct"`
}

// CoverageHistory buckets coverage by ISO week over the trailing `weeks`
// weeks. Weeks with no answered questions are omitted rather than reported as
// zero: no data is not the same claim as zero coverage.
func (r *Answers) CoverageHistory(ctx context.Context, weeks int) ([]CoveragePoint, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT strftime('%Y-%W', created_at) AS wk,
		       100.0 * count(*) FILTER (WHERE definition_id IS NOT NULL AND definition_id <> '') / count(*)
		FROM answers
		WHERE confidence <> 'refused'
		GROUP BY wk ORDER BY wk DESC LIMIT ?`, weeks)
	if err != nil {
		return nil, fmt.Errorf("coverage history: %w", err)
	}
	defer rows.Close()
	var out []CoveragePoint
	for rows.Next() {
		var p CoveragePoint
		if err := rows.Scan(&p.Period, &p.Pct); err != nil {
			return nil, fmt.Errorf("scan coverage point: %w", err)
		}
		out = append(out, p)
	}
	// Oldest first, the order a sparkline reads in.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

// ClarificationRate reports what share of a period's questions ended in a
// refusal that asked the human to choose a reading.
func (r *Answers) ClarificationRate(ctx context.Context, periodPrefix string) (refused, total int, err error) {
	err = r.db.QueryRowContext(ctx, `
		SELECT count(*) FILTER (WHERE confidence = 'refused'), count(*)
		FROM answers WHERE created_at LIKE ?`, periodPrefix+"%").
		Scan(&refused, &total)
	if err != nil {
		return 0, 0, fmt.Errorf("clarification rate %s: %w", periodPrefix, err)
	}
	return refused, total, nil
}

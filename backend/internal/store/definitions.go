package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Definitions is the earned semantic layer.
//
// A definition is never authored in a modeling UI; it arrives because the
// system proved a question was ambiguous and a human chose a reading. Versions
// share a lineage id: editing supersedes rather than mutates, so an answer can
// always name the exact version it used.
type Definitions struct{ db *sql.DB }

func NewDefinitions(d *DB) *Definitions { return &Definitions{db: d.sql} }

const defCols = `id, lineage_id, name, plain_english, coalesce(expression,''), version, status,
	coalesce(ratified_by,''), coalesce(ratified_at,''), coalesce(source_answer_id,''), usage_count, created_at`

func scanDef(s interface{ Scan(...any) error }) (*Definition, error) {
	var d Definition
	err := s.Scan(&d.ID, &d.LineageID, &d.Name, &d.PlainEnglish, &d.Expression, &d.Version,
		&d.Status, &d.RatifiedBy, &d.RatifiedAt, &d.SourceAnswerID, &d.UsageCount, &d.UpdatedAt)
	if err != nil {
		return &d, err
	}
	if d.RatifiedAt != "" {
		d.UpdatedAt = d.RatifiedAt
	}
	d.Confidence = definitionConfidence(d.Status)
	return &d, nil
}

// definitionConfidence maps a definition's lifecycle status onto the standing
// its seal renders with. A ratified rule has been chosen by a human over
// measured alternatives — that is the verified state; anything not yet ratified
// is unverified by definition.
func definitionConfidence(status string) string {
	if status == DefRatified {
		return "verified"
	}
	return "unverified"
}

// Create inserts a first-version definition. Status decides whether it is a
// ratified rule or a proposal awaiting a human.
func (r *Definitions) Create(ctx context.Context, d *Definition) error {
	if d.ID == "" {
		d.ID = ID("def")
	}
	if d.LineageID == "" {
		d.LineageID = d.ID
	}
	if d.Version == 0 {
		d.Version = 1
	}
	if d.Status == "" {
		d.Status = DefRatified
	}
	if d.Status == DefRatified && d.RatifiedAt == "" {
		d.RatifiedAt = now()
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO definitions (id, lineage_id, name, plain_english, expression, version, status,
			ratified_by, ratified_at, source_answer_id, usage_count, created_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		d.ID, d.LineageID, d.Name, d.PlainEnglish, d.Expression, d.Version, d.Status,
		d.RatifiedBy, d.RatifiedAt, d.SourceAnswerID, d.UsageCount, now())
	if err != nil {
		return fmt.Errorf("insert definition %s: %w", d.Name, err)
	}

	// Ratifying a term settles it: open proposals for the same term are done —
	// their question has been answered. Leaving them in the queue asks a human
	// to re-decide something already decided.
	if d.Status == DefRatified {
		if _, err := r.db.ExecContext(ctx, `
			UPDATE definitions SET status = ? WHERE status = ? AND lower(name) = lower(?) AND id <> ?`,
			DefSuperseded, DefProposed, d.Name, d.ID); err != nil {
			return fmt.Errorf("supersede proposals for %s: %w", d.Name, err)
		}
	}
	return nil
}

func (r *Definitions) Get(ctx context.Context, id string) (*Definition, error) {
	d, err := scanDef(r.db.QueryRowContext(ctx, `SELECT `+defCols+` FROM definitions WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get definition %s: %w", id, err)
	}
	// A single read must agree with the listing about whether the name is
	// contested — two surfaces disagreeing on a definition's standing would be
	// this product failing its own test.
	if d.Status == DefRatified {
		var n int
		if err := r.db.QueryRowContext(ctx,
			`SELECT count(*) FROM definitions WHERE status = ? AND lower(name) = lower(?)`,
			DefRatified, d.Name).Scan(&n); err == nil && n > 1 {
			d.Confidence = "contested"
		}
	}
	return d, nil
}

// List returns definitions, newest lineage first. An empty status returns all.
func (r *Definitions) List(ctx context.Context, status string) ([]Definition, error) {
	// Dismissed proposals are excluded everywhere they would be offered. The
	// row survives — dismissal is a decision worth keeping — but a suggestion
	// somebody already declined must not keep asking.
	q := `SELECT ` + defCols + ` FROM definitions WHERE dismissed_at IS NULL`
	var args []any
	if status != "" {
		q += ` AND status = ?`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC`

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list definitions: %w", err)
	}
	defer rows.Close()
	var out []Definition
	for rows.Next() {
		d, err := scanDef(rows)
		if err != nil {
			return nil, fmt.Errorf("scan definition: %w", err)
		}
		out = append(out, *d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	markContested(out)
	return out, nil
}

// markContested downgrades ratified definitions that share a name: one word
// ratified to mean two different things is exactly the dispute this product
// exists to surface, and neither side of it may present as settled. Derived at
// read time from the rows themselves — never stored, so it clears the moment
// the collision does.
func markContested(defs []Definition) {
	ratified := map[string]int{}
	for _, d := range defs {
		if d.Status == DefRatified {
			ratified[strings.ToLower(d.Name)]++
		}
	}
	for i := range defs {
		if defs[i].Status == DefRatified && ratified[strings.ToLower(defs[i].Name)] > 1 {
			defs[i].Confidence = "contested"
		}
	}
}

// NewVersion supersedes the current version and inserts its successor sharing
// the lineage. The old row is kept: answers point at the version they used.
func (r *Definitions) NewVersion(ctx context.Context, id string, next *Definition) (*Definition, error) {
	cur, err := r.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	var maxVersion int
	if err := r.db.QueryRowContext(ctx,
		`SELECT max(version) FROM definitions WHERE lineage_id = ?`, cur.LineageID).Scan(&maxVersion); err != nil {
		return nil, fmt.Errorf("max version for %s: %w", cur.LineageID, err)
	}

	out := &Definition{
		ID:             ID("def"),
		LineageID:      cur.LineageID,
		Name:           firstNonEmpty(next.Name, cur.Name),
		PlainEnglish:   firstNonEmpty(next.PlainEnglish, cur.PlainEnglish),
		Expression:     firstNonEmpty(next.Expression, cur.Expression),
		Version:        maxVersion + 1,
		Status:         DefRatified,
		RatifiedBy:     next.RatifiedBy,
		SourceAnswerID: firstNonEmpty(next.SourceAnswerID, cur.SourceAnswerID),
	}
	if err := r.Create(ctx, out); err != nil {
		return nil, err
	}
	if _, err := r.db.ExecContext(ctx,
		`UPDATE definitions SET status = ? WHERE lineage_id = ? AND id <> ? AND status <> ?`,
		DefSuperseded, cur.LineageID, out.ID, DefProposed); err != nil {
		return nil, fmt.Errorf("supersede lineage %s: %w", cur.LineageID, err)
	}
	return out, nil
}

// LineageIDs returns every version id in a definition's lineage, which is the
// set the impact query counts against.
func (r *Definitions) LineageIDs(ctx context.Context, id string) ([]string, error) {
	cur, err := r.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM definitions WHERE lineage_id = ?`, cur.LineageID)
	if err != nil {
		return nil, fmt.Errorf("lineage ids %s: %w", cur.LineageID, err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, fmt.Errorf("scan lineage id: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RecordUsage increments the usage counter for a definition version.
func (r *Definitions) RecordUsage(ctx context.Context, id string) error {
	if id == "" {
		return nil
	}
	if _, err := r.db.ExecContext(ctx,
		`UPDATE definitions SET usage_count = usage_count + 1 WHERE id = ?`, id); err != nil {
		return fmt.Errorf("record usage %s: %w", id, err)
	}
	return nil
}

// Dismiss hides a proposal without deleting it.
//
// The row stays because a declined suggestion is itself a signal — it says a
// human looked at this term and decided it did not need settling. Only
// proposals are dismissible: hiding a ratified definition would remove a rule
// answers actively depend on, which is a deletion wearing a softer word.
//
// If the same ambiguity recurs, the ask pipeline raises a NEW proposal rather
// than resurrecting this one. That is deliberate: the question came up again,
// and pretending otherwise would suppress a real signal. It is also why the UI
// must not promise "never proposed again" — only that this one is gone.
func (r *Definitions) Dismiss(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE definitions SET dismissed_at = ? WHERE id = ? AND status = ?`,
		now(), id, DefProposed)
	if err != nil {
		return fmt.Errorf("dismiss definition %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("dismiss definition %s: %w", id, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// FindProposed locates an existing proposal by name so a repeated ambiguity
// does not pile up duplicates.
func (r *Definitions) FindProposed(ctx context.Context, name string) (*Definition, error) {
	d, err := scanDef(r.db.QueryRowContext(ctx,
		`SELECT `+defCols+` FROM definitions
		 WHERE lower(name) = lower(?) AND status = ? AND dismissed_at IS NULL LIMIT 1`,
		name, DefProposed))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find proposed %s: %w", name, err)
	}
	return d, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

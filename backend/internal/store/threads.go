package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Threads is the conversation repository. A thread owns the active context, so
// a follow-up inherits filters, grain, and time range without restating them.
type Threads struct{ db *sql.DB }

func NewThreads(d *DB) *Threads { return &Threads{db: d.sql} }

// Create starts a thread titled from the opening question.
func (r *Threads) Create(ctx context.Context, question, sourceID string, c *Context) (*Thread, error) {
	t := &Thread{
		ID:        ID("th"),
		Title:     title(question),
		SourceID:  sourceID,
		Context:   c,
		UpdatedAt: now(),
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO threads (id, title, context_json, source_id, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
		t.ID, t.Title, mustJSON(c), sourceID, t.UpdatedAt, t.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert thread: %w", err)
	}
	return t, nil
}

func title(q string) string {
	q = strings.TrimSpace(strings.Join(strings.Fields(q), " "))
	if len(q) <= 72 {
		return q
	}
	return q[:69] + "..."
}

func (r *Threads) Get(ctx context.Context, id string) (*Thread, error) {
	var t Thread
	var contextJSON, sourceID sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT id, title, context_json, source_id, updated_at FROM threads WHERE id = ?`, id).
		Scan(&t.ID, &t.Title, &contextJSON, &sourceID, &t.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get thread %s: %w", id, err)
	}
	t.SourceID = sourceID.String
	t.Context = fromJSON[Context](contextJSON.String)

	rows, err := r.db.QueryContext(ctx,
		`SELECT question, coalesce(answer_id,''), created_at FROM turns WHERE thread_id = ? ORDER BY seq`, id)
	if err != nil {
		return nil, fmt.Errorf("list turns %s: %w", id, err)
	}
	defer rows.Close()
	for rows.Next() {
		var turn Turn
		if err := rows.Scan(&turn.Question, &turn.AnswerID, &turn.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan turn: %w", err)
		}
		t.Turns = append(t.Turns, turn)
		if turn.AnswerID != "" {
			t.AnswerCount++
		}
	}
	return &t, rows.Err()
}

func (r *Threads) List(ctx context.Context) ([]Thread, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT t.id, t.title, t.updated_at,
		       (SELECT count(*) FROM turns u WHERE u.thread_id = t.id AND u.answer_id IS NOT NULL)
		FROM threads t ORDER BY t.updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list threads: %w", err)
	}
	defer rows.Close()
	var out []Thread
	for rows.Next() {
		var t Thread
		if err := rows.Scan(&t.ID, &t.Title, &t.UpdatedAt, &t.AnswerCount); err != nil {
			return nil, fmt.Errorf("scan thread: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// SetContext replaces the thread's context. The caller decides whether to
// re-run the last question; the repository only stores.
func (r *Threads) SetContext(ctx context.Context, id string, c *Context) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE threads SET context_json = ?, updated_at = ? WHERE id = ?`, mustJSON(c), now(), id)
	if err != nil {
		return fmt.Errorf("set thread context %s: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AddTurn appends a question to a thread and returns the turn id.
func (r *Threads) AddTurn(ctx context.Context, threadID, question string) (string, error) {
	var seq int
	if err := r.db.QueryRowContext(ctx,
		`SELECT coalesce(max(seq), 0) + 1 FROM turns WHERE thread_id = ?`, threadID).Scan(&seq); err != nil {
		return "", fmt.Errorf("next turn seq: %w", err)
	}
	id := ID("turn")
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO turns (id, thread_id, seq, question, created_at) VALUES (?,?,?,?,?)`,
		id, threadID, seq, question, now()); err != nil {
		return "", fmt.Errorf("insert turn: %w", err)
	}
	if _, err := r.db.ExecContext(ctx, `UPDATE threads SET updated_at = ? WHERE id = ?`, now(), threadID); err != nil {
		return "", fmt.Errorf("touch thread: %w", err)
	}
	return id, nil
}

// AttachAnswer links a completed answer to its turn.
func (r *Threads) AttachAnswer(ctx context.Context, turnID, answerID string) error {
	if _, err := r.db.ExecContext(ctx, `UPDATE turns SET answer_id = ? WHERE id = ?`, answerID, turnID); err != nil {
		return fmt.Errorf("attach answer to turn %s: %w", turnID, err)
	}
	return nil
}

// LastQuestion returns the most recent question asked in a thread, used when
// editing context re-runs the last turn.
func (r *Threads) LastQuestion(ctx context.Context, threadID string) (string, error) {
	var q string
	err := r.db.QueryRowContext(ctx,
		`SELECT question FROM turns WHERE thread_id = ? ORDER BY seq DESC LIMIT 1`, threadID).Scan(&q)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("last question %s: %w", threadID, err)
	}
	return q, nil
}

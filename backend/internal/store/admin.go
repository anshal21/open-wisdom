package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/anshal21/ai-analyst/backend/internal/verify"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

func confidenceOf(s string) verify.Confidence {
	if s == "" {
		return verify.ConfUnverified
	}
	return verify.Confidence(s)
}

// ---------------------------------------------------------------- sources

// Sources records connections and caches the last introspected catalog, so the
// planner has schema and profile evidence without re-scanning per question.
type Sources struct{ db *sql.DB }

func NewSources(d *DB) *Sources { return &Sources{db: d.sql} }

func (r *Sources) Create(ctx context.Context, s *Source) error {
	if s.ID == "" {
		s.ID = ID("src")
	}
	if s.Status == "" {
		s.Status = "pending"
	}
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO sources (id, name, kind, dsn, status, table_count, created_at) VALUES (?,?,?,?,?,?,?)`,
		s.ID, s.Name, s.Kind, s.DSN, s.Status, s.TableCount, now()); err != nil {
		return fmt.Errorf("insert source %s: %w", s.Name, err)
	}
	return nil
}

func (r *Sources) List(ctx context.Context) ([]Source, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, name, kind, dsn, status, table_count, coalesce(last_introspected_at,'')
		 FROM sources ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	defer rows.Close()
	var out []Source
	for rows.Next() {
		var s Source
		if err := rows.Scan(&s.ID, &s.Name, &s.Kind, &s.DSN, &s.Status, &s.TableCount, &s.LastIntrospectedAt); err != nil {
			return nil, fmt.Errorf("scan source: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Sources) Get(ctx context.Context, id string) (*Source, error) {
	var s Source
	err := r.db.QueryRowContext(ctx,
		`SELECT id, name, kind, dsn, status, table_count, coalesce(last_introspected_at,'')
		 FROM sources WHERE id = ?`, id).
		Scan(&s.ID, &s.Name, &s.Kind, &s.DSN, &s.Status, &s.TableCount, &s.LastIntrospectedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get source %s: %w", id, err)
	}
	return &s, nil
}

// First returns the source a request falls back to when none is named.
//
// It prefers the oldest healthy source: a source stuck in "error" must not
// shadow a working one, or a single bad registration bricks every question
// that does not name a source explicitly.
func (r *Sources) First(ctx context.Context) (*Source, error) {
	all, err := r.List(ctx)
	if err != nil {
		return nil, err
	}
	if len(all) == 0 {
		return nil, ErrNotFound
	}
	for i := range all {
		if all[i].Status != "error" {
			return &all[i], nil
		}
	}
	return &all[0], nil
}

// SaveCatalog persists the introspected catalog alongside the source.
func (r *Sources) SaveCatalog(ctx context.Context, id string, cat *warehouse.Catalog) error {
	if _, err := r.db.ExecContext(ctx,
		`UPDATE sources SET catalog_json = ?, table_count = ?, status = 'connected', last_introspected_at = ?
		 WHERE id = ?`, mustJSON(cat), len(cat.Tables), now(), id); err != nil {
		return fmt.Errorf("save catalog %s: %w", id, err)
	}
	return nil
}

// Catalog returns the cached catalog, or ErrNotFound when the source has never
// been introspected.
func (r *Sources) Catalog(ctx context.Context, id string) (*warehouse.Catalog, error) {
	var payload sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT catalog_json FROM sources WHERE id = ?`, id).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get catalog %s: %w", id, err)
	}
	cat := fromJSON[warehouse.Catalog](payload.String)
	if cat == nil {
		return nil, ErrNotFound
	}
	return cat, nil
}

func (r *Sources) SetStatus(ctx context.Context, id, status string) error {
	if _, err := r.db.ExecContext(ctx, `UPDATE sources SET status = ? WHERE id = ?`, status, id); err != nil {
		return fmt.Errorf("set source status %s: %w", id, err)
	}
	return nil
}

// Delete removes a source.
//
// Sources could be created and never removed, which was survivable while one
// was registered from a flag at boot and invisible otherwise. It stops being
// survivable the moment connecting is something you do in the UI: a mistyped
// path leaves a permanently broken row, and the only remedy is deleting the
// workspace database.
//
// Answers are not touched. An answer records the source it was computed
// against, and deleting the connection does not un-compute the answer or make
// its provenance untrue — losing the ledger because a connection string was
// wrong would be a far worse trade.
func (r *Sources) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM sources WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete source %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete source %s: %w", id, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------------------------------------------------------------- users

type Users struct{ db *sql.DB }

func NewUsers(d *DB) *Users { return &Users{db: d.sql} }

func (r *Users) Create(ctx context.Context, u *User) error {
	if u.ID == "" {
		u.ID = ID("usr")
	}
	if u.Role == "" {
		u.Role = "viewer"
	}
	u.CreatedAt = now()
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`,
		u.ID, u.Name, u.Email, u.Role, u.CreatedAt); err != nil {
		return fmt.Errorf("insert user %s: %w", u.Email, err)
	}
	return nil
}

func (r *Users) List(ctx context.Context) ([]User, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name, email, role, created_at FROM users ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *Users) SetRole(ctx context.Context, id, role string) (*User, error) {
	res, err := r.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, role, id)
	if err != nil {
		return nil, fmt.Errorf("set role %s: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	var u User
	if err := r.db.QueryRowContext(ctx,
		`SELECT id, name, email, role, created_at FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.CreatedAt); err != nil {
		return nil, fmt.Errorf("get user %s: %w", id, err)
	}
	return &u, nil
}

// ---------------------------------------------------------------- settings

type SettingsRepo struct{ db *sql.DB }

func NewSettingsRepo(d *DB) *SettingsRepo { return &SettingsRepo{db: d.sql} }

func (r *SettingsRepo) Get(ctx context.Context) (Settings, error) {
	var payload string
	err := r.db.QueryRowContext(ctx, `SELECT payload FROM settings WHERE id = 1`).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSettings(), nil
	}
	if err != nil {
		return DefaultSettings(), fmt.Errorf("get settings: %w", err)
	}
	s := fromJSON[Settings](payload)
	if s == nil {
		return DefaultSettings(), nil
	}
	// Settings stored before a field existed backfill from defaults, so a new
	// surface never reads a hole where a policy should be.
	if len(s.CheckPolicy) == 0 {
		s.CheckPolicy = DefaultCheckPolicy()
	}
	if s.Timezone == "" {
		s.Timezone = "UTC"
	}
	if s.WorkspaceName == "" {
		s.WorkspaceName = "Workspace"
	}
	return *s, nil
}

// Put replaces the settings, normalizing in place so the caller can echo back
// exactly what was stored rather than what was sent.
func (r *SettingsRepo) Put(ctx context.Context, s *Settings) error {
	if s.AmbiguitySpreadRatio <= 1 {
		s.AmbiguitySpreadRatio = DefaultSettings().AmbiguitySpreadRatio
	}
	if s.ModelSpeed == "" {
		s.ModelSpeed = DefaultSettings().ModelSpeed
	}
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO settings (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
		mustJSON(s)); err != nil {
		return fmt.Errorf("put settings: %w", err)
	}
	return nil
}

package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

// ---------------------------------------------------------------- dashboards

// Dashboards holds compositions of ledger answers. A tile is a permalinked
// answer, never a standalone chart, which is what keeps every tile auditable.
type Dashboards struct{ db *sql.DB }

func NewDashboards(d *DB) *Dashboards { return &Dashboards{db: d.sql} }

func (r *Dashboards) Create(ctx context.Context, name string) (*Dashboard, error) {
	d := &Dashboard{ID: ID("dash"), Name: name}
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO dashboards (id, name, created_at) VALUES (?,?,?)`, d.ID, d.Name, now()); err != nil {
		return nil, fmt.Errorf("insert dashboard: %w", err)
	}
	return d, nil
}

func (r *Dashboards) List(ctx context.Context) ([]Dashboard, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT d.id, d.name,
		       (SELECT count(*) FROM dashboard_tiles t WHERE t.dashboard_id = d.id)
		FROM dashboards d ORDER BY d.created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list dashboards: %w", err)
	}
	defer rows.Close()
	var out []Dashboard
	for rows.Next() {
		var d Dashboard
		if err := rows.Scan(&d.ID, &d.Name, &d.TileCount); err != nil {
			return nil, fmt.Errorf("scan dashboard: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *Dashboards) Get(ctx context.Context, id string) (*Dashboard, error) {
	var d Dashboard
	err := r.db.QueryRowContext(ctx, `SELECT id, name FROM dashboards WHERE id = ?`, id).Scan(&d.ID, &d.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get dashboard %s: %w", id, err)
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, answer_id, position, size, x, y, w, h, coalesce(viz_json,'') FROM dashboard_tiles WHERE dashboard_id = ? ORDER BY position`, id)
	if err != nil {
		return nil, fmt.Errorf("list tiles %s: %w", id, err)
	}
	defer rows.Close()
	for rows.Next() {
		var t Tile
		var viz string
		if err := rows.Scan(&t.ID, &t.AnswerID, &t.Position, &t.Size, &t.X, &t.Y, &t.W, &t.H, &viz); err != nil {
			return nil, fmt.Errorf("scan tile: %w", err)
		}
		if viz != "" && viz != "null" {
			t.Viz = json.RawMessage(viz)
		}
		d.Tiles = append(d.Tiles, t)
	}
	return &d, rows.Err()
}

func (r *Dashboards) AddTile(ctx context.Context, dashboardID string, t Tile) (*Tile, error) {
	t.ID = ID("tile")
	if t.Size == "" {
		t.Size = "medium"
	}
	if t.W <= 0 {
		t.W = 3
	}
	if t.H <= 0 {
		t.H = 2
	}
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO dashboard_tiles (id, dashboard_id, answer_id, position, size, x, y, w, h) VALUES (?,?,?,?,?,?,?,?,?)`,
		t.ID, dashboardID, t.AnswerID, t.Position, t.Size, t.X, t.Y, t.W, t.H); err != nil {
		return nil, fmt.Errorf("insert tile: %w", err)
	}
	return &t, nil
}

// TileLayout is one tile's placement, as the canvas reports it.
type TileLayout struct {
	TileID string `json:"tile_id"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	W      int    `json:"w"`
	H      int    `json:"h"`
}

// SaveLayout persists the whole canvas at once — a drag that displaces three
// neighbours is one edit, not four.
func (r *Dashboards) SaveLayout(ctx context.Context, dashboardID string, layout []TileLayout) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("layout tx: %w", err)
	}
	defer tx.Rollback()
	for _, l := range layout {
		if _, err := tx.ExecContext(ctx,
			`UPDATE dashboard_tiles SET x = ?, y = ?, w = ?, h = ?, position = ? WHERE id = ? AND dashboard_id = ?`,
			l.X, l.Y, l.W, l.H, l.Y*12+l.X, l.TileID, dashboardID); err != nil {
			return fmt.Errorf("layout tile %s: %w", l.TileID, err)
		}
	}
	return tx.Commit()
}

// SetTileViz stores a tile's chart override verbatim. The backend does not
// interpret it — resolution stays in the one frontend module.
func (r *Dashboards) SetTileViz(ctx context.Context, dashboardID, tileID string, viz json.RawMessage) error {
	if _, err := r.db.ExecContext(ctx,
		`UPDATE dashboard_tiles SET viz_json = ? WHERE id = ? AND dashboard_id = ?`,
		string(viz), tileID, dashboardID); err != nil {
		return fmt.Errorf("set tile viz %s: %w", tileID, err)
	}
	return nil
}

// DeleteTile removes a tile from a dashboard. Scoped by dashboard_id as well
// as tile id so a stale client cannot delete another board's tile.
func (r *Dashboards) DeleteTile(ctx context.Context, dashboardID, tileID string) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM dashboard_tiles WHERE id = ? AND dashboard_id = ?`, tileID, dashboardID)
	if err != nil {
		return fmt.Errorf("delete tile %s: %w", tileID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete tile %s: %w", tileID, err)
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ReplaceTileAnswer repoints a tile after a refresh produced a new answer id.
//
// Scoped by dashboard as well as tile. It previously matched on tile id alone,
// which meant PATCH /dashboards/{B}/tiles/{tileFromA} silently repointed
// dashboard A's tile — every sibling operation (SetTileViz, DeleteTile,
// SaveLayout) was scoped, and this one being the exception is precisely how
// that kind of hole survives review. Returns sql.ErrNoRows when the tile does
// not belong to the dashboard, so callers cannot mistake a no-op for success.
func (r *Dashboards) ReplaceTileAnswer(ctx context.Context, dashboardID, tileID, answerID string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE dashboard_tiles SET answer_id = ? WHERE id = ? AND dashboard_id = ?`,
		answerID, tileID, dashboardID)
	if err != nil {
		return fmt.Errorf("repoint tile %s: %w", tileID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repoint tile %s: %w", tileID, err)
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ---------------------------------------------------------------- notebooks

type Notebooks struct{ db *sql.DB }

func NewNotebooks(d *DB) *Notebooks { return &Notebooks{db: d.sql} }

func (r *Notebooks) Create(ctx context.Context, name, sourceID string) (*Notebook, error) {
	ts := now()
	n := &Notebook{ID: ID("nb"), Name: name, SourceID: sourceID, CreatedAt: ts, UpdatedAt: ts}
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO notebooks (id, name, source_id, created_at, updated_at) VALUES (?,?,?,?,?)`,
		n.ID, n.Name, n.SourceID, ts, ts); err != nil {
		return nil, fmt.Errorf("insert notebook: %w", err)
	}
	return n, nil
}

// touch stamps the notebook as changed. Every mutation below funnels through
// it — a handler cannot forget what it never has to remember.
func (r *Notebooks) touch(ctx context.Context, tx execer, notebookID string) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE notebooks SET updated_at = ? WHERE id = ?`, now(), notebookID); err != nil {
		return fmt.Errorf("touch notebook %s: %w", notebookID, err)
	}
	return nil
}

// execer is the intersection of *sql.DB and *sql.Tx, so a helper can run
// inside a transaction or on its own.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func (r *Notebooks) List(ctx context.Context) ([]Notebook, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT n.id, n.name, coalesce(n.source_id,''), n.created_at,
		       coalesce(n.updated_at, n.created_at),
		       (SELECT count(*) FROM notebook_cells c WHERE c.notebook_id = n.id)
		FROM notebooks n
		ORDER BY coalesce(n.updated_at, n.created_at) DESC`)
	if err != nil {
		return nil, fmt.Errorf("list notebooks: %w", err)
	}
	defer rows.Close()
	var out []Notebook
	for rows.Next() {
		var n Notebook
		if err := rows.Scan(&n.ID, &n.Name, &n.SourceID, &n.CreatedAt, &n.UpdatedAt, &n.CellCount); err != nil {
			return nil, fmt.Errorf("scan notebook: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *Notebooks) Get(ctx context.Context, id string) (*Notebook, error) {
	var n Notebook
	err := r.db.QueryRowContext(ctx,
		`SELECT id, name, coalesce(source_id,''), created_at, coalesce(updated_at, created_at)
		 FROM notebooks WHERE id = ?`, id).
		Scan(&n.ID, &n.Name, &n.SourceID, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get notebook %s: %w", id, err)
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, kind, source, coalesce(output_json,''), coalesce(confidence,''), seq,
		        coalesce(updated_at,'')
		 FROM notebook_cells WHERE notebook_id = ? ORDER BY seq`, id)
	if err != nil {
		return nil, fmt.Errorf("list cells %s: %w", id, err)
	}
	defer rows.Close()
	for rows.Next() {
		var c Cell
		var output, confidence string
		if err := rows.Scan(&c.ID, &c.Kind, &c.Source, &output, &confidence, &c.Seq, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan cell: %w", err)
		}
		if p := fromJSON[any](output); p != nil {
			c.Output = *p
		}
		c.Confidence = cellConfidence(confidence)
		n.Cells = append(n.Cells, c)
	}
	n.CellCount = len(n.Cells)
	return &n, rows.Err()
}

// Rename is the only field of a notebook a user can edit directly.
func (r *Notebooks) Rename(ctx context.Context, id, name string) (*Notebook, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?`, name, now(), id)
	if err != nil {
		return nil, fmt.Errorf("rename notebook %s: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

func (r *Notebooks) Delete(ctx context.Context, id string) error {
	// Cells go with it: notebook_cells declares ON DELETE CASCADE and the
	// connection enables foreign_keys.
	res, err := r.db.ExecContext(ctx, `DELETE FROM notebooks WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete notebook %s: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AddCell appends, or inserts directly after afterCellID when given. Inserting
// shifts every later cell down one seq inside the same transaction, so the
// stack never holds two cells claiming one position.
func (r *Notebooks) AddCell(ctx context.Context, notebookID, afterCellID string, c Cell) (*Cell, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin add cell: %w", err)
	}
	defer tx.Rollback()

	// The notebook must exist: without this check a cell can be written
	// against a typo'd id and simply never be seen again.
	var exists int
	if err := tx.QueryRowContext(ctx,
		`SELECT count(*) FROM notebooks WHERE id = ?`, notebookID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check notebook %s: %w", notebookID, err)
	}
	if exists == 0 {
		return nil, ErrNotFound
	}

	seq := 0
	if afterCellID == "" {
		if err := tx.QueryRowContext(ctx,
			`SELECT coalesce(max(seq),0)+1 FROM notebook_cells WHERE notebook_id = ?`,
			notebookID).Scan(&seq); err != nil {
			return nil, fmt.Errorf("next cell seq: %w", err)
		}
	} else {
		var anchor int
		err := tx.QueryRowContext(ctx,
			`SELECT seq FROM notebook_cells WHERE notebook_id = ? AND id = ?`,
			notebookID, afterCellID).Scan(&anchor)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("anchor cell %s: %w", afterCellID, err)
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE notebook_cells SET seq = seq + 1 WHERE notebook_id = ? AND seq > ?`,
			notebookID, anchor); err != nil {
			return nil, fmt.Errorf("shift cells: %w", err)
		}
		seq = anchor + 1
	}

	ts := now()
	c.ID = ID("cell")
	c.Seq = seq
	c.UpdatedAt = ts
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO notebook_cells (id, notebook_id, seq, kind, source, output_json, confidence, updated_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		c.ID, notebookID, seq, c.Kind, c.Source, mustJSON(c.Output), string(c.Confidence), ts); err != nil {
		return nil, fmt.Errorf("insert cell: %w", err)
	}
	if err := r.touch(ctx, tx, notebookID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit add cell: %w", err)
	}
	return &c, nil
}

func (r *Notebooks) GetCell(ctx context.Context, notebookID, cellID string) (*Cell, error) {
	var c Cell
	var output, confidence string
	err := r.db.QueryRowContext(ctx,
		`SELECT id, kind, source, coalesce(output_json,''), coalesce(confidence,''), seq,
		        coalesce(updated_at,'')
		 FROM notebook_cells WHERE notebook_id = ? AND id = ?`, notebookID, cellID).
		Scan(&c.ID, &c.Kind, &c.Source, &output, &confidence, &c.Seq, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get cell %s: %w", cellID, err)
	}
	if p := fromJSON[any](output); p != nil {
		c.Output = *p
	}
	c.Confidence = cellConfidence(confidence)
	return &c, nil
}

// cellConfidence preserves the difference between a cell that has NOT been run
// and one that ran without being verifiable.
//
// confidenceOf() defaults an empty string to `unverified`, which is right for
// an answer — every answer has been produced by something. A cell is different:
// before its first run it has produced nothing, and stamping it `unverified`
// would put a seal on a result that does not exist. Empty stays empty; the
// client renders that as "not run yet".
func cellConfidence(s string) verify.Confidence {
	return verify.Confidence(s)
}

// CellPatch carries only what the caller actually set. A nil field is
// untouched — distinct from a field set to its zero value, which is a real
// edit (clearing a cell's source is a legitimate thing to do).
type CellPatch struct {
	Source     *string
	Kind       *string
	Output     any
	Confidence *string
}

// UpdateCell applies a patch.
//
// Changing `source` or `kind` CLEARS the stored output and confidence. A cell
// whose question changed is no longer described by its old result, and keeping
// the seal would leave a verified stamp sitting above a figure nothing
// produced — the notebook's version of a superseded answer, which this product
// never renders silently. An explicit Output in the same patch wins, so the
// run path can write a fresh result without tripping the rule.
func (r *Notebooks) UpdateCell(ctx context.Context, notebookID, cellID string, p CellPatch) (*Cell, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin update cell: %w", err)
	}
	defer tx.Rollback()

	var curSource, curKind string
	err = tx.QueryRowContext(ctx,
		`SELECT source, kind FROM notebook_cells WHERE notebook_id = ? AND id = ?`,
		notebookID, cellID).Scan(&curSource, &curKind)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read cell %s: %w", cellID, err)
	}

	sets := []string{"updated_at = ?"}
	args := []any{now()}
	if p.Source != nil {
		sets = append(sets, "source = ?")
		args = append(args, *p.Source)
	}
	if p.Kind != nil {
		sets = append(sets, "kind = ?")
		args = append(args, *p.Kind)
	}

	staleResult := (p.Source != nil && *p.Source != curSource) ||
		(p.Kind != nil && *p.Kind != curKind)

	switch {
	case p.Output != nil:
		sets = append(sets, "output_json = ?")
		args = append(args, mustJSON(p.Output))
	case staleResult:
		sets = append(sets, "output_json = NULL")
	}
	switch {
	case p.Confidence != nil:
		sets = append(sets, "confidence = ?")
		args = append(args, *p.Confidence)
	case staleResult:
		sets = append(sets, "confidence = NULL")
	}

	args = append(args, notebookID, cellID)
	if _, err := tx.ExecContext(ctx,
		`UPDATE notebook_cells SET `+strings.Join(sets, ", ")+
			` WHERE notebook_id = ? AND id = ?`, args...); err != nil {
		return nil, fmt.Errorf("update cell %s: %w", cellID, err)
	}
	if err := r.touch(ctx, tx, notebookID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit update cell: %w", err)
	}
	return r.GetCell(ctx, notebookID, cellID)
}

// DeleteCell removes a cell and closes the gap it leaves. Dense seqs matter:
// a reorder writes positions 1..n, and holes would make the two schemes
// disagree about what "position 3" means.
func (r *Notebooks) DeleteCell(ctx context.Context, notebookID, cellID string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete cell: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx,
		`DELETE FROM notebook_cells WHERE notebook_id = ? AND id = ?`, notebookID, cellID)
	if err != nil {
		return fmt.Errorf("delete cell %s: %w", cellID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if err := renumber(ctx, tx, notebookID); err != nil {
		return err
	}
	if err := r.touch(ctx, tx, notebookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete cell: %w", err)
	}
	return nil
}

// renumber rewrites seq as 1..n in current order, closing any gaps.
func renumber(ctx context.Context, tx *sql.Tx, notebookID string) error {
	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM notebook_cells WHERE notebook_id = ? ORDER BY seq`, notebookID)
	if err != nil {
		return fmt.Errorf("read cell order: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan cell id: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read cell order: %w", err)
	}
	for i, id := range ids {
		if _, err := tx.ExecContext(ctx,
			`UPDATE notebook_cells SET seq = ? WHERE id = ?`, i+1, id); err != nil {
			return fmt.Errorf("renumber cell %s: %w", id, err)
		}
	}
	return nil
}

// ErrOrderMismatch reports a reorder whose id list does not describe this
// notebook's cells exactly.
var ErrOrderMismatch = errors.New("cell order does not match this notebook")

// Reorder writes a new full ordering. The list must name every cell of the
// notebook exactly once: a partial list would silently strand the cells it
// omits at whatever seq they happened to hold.
func (r *Notebooks) Reorder(ctx context.Context, notebookID string, cellIDs []string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin reorder: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM notebook_cells WHERE notebook_id = ?`, notebookID)
	if err != nil {
		return fmt.Errorf("read cells: %w", err)
	}
	owned := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan cell id: %w", err)
		}
		owned[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read cells: %w", err)
	}

	if len(cellIDs) != len(owned) {
		return ErrOrderMismatch
	}
	seen := map[string]bool{}
	for _, id := range cellIDs {
		if !owned[id] || seen[id] {
			return ErrOrderMismatch
		}
		seen[id] = true
	}

	for i, id := range cellIDs {
		if _, err := tx.ExecContext(ctx,
			`UPDATE notebook_cells SET seq = ? WHERE id = ?`, i+1, id); err != nil {
			return fmt.Errorf("reorder cell %s: %w", id, err)
		}
	}
	if err := r.touch(ctx, tx, notebookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit reorder: %w", err)
	}
	return nil
}

func (r *Notebooks) SetCellOutput(ctx context.Context, notebookID, cellID string, output any, confidence string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin set cell output: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`UPDATE notebook_cells SET output_json = ?, confidence = ?, updated_at = ? WHERE id = ?`,
		mustJSON(output), confidence, now(), cellID); err != nil {
		return fmt.Errorf("set cell output %s: %w", cellID, err)
	}
	if err := r.touch(ctx, tx, notebookID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit set cell output: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------- watches

type Watches struct{ db *sql.DB }

func NewWatches(d *DB) *Watches { return &Watches{db: d.sql} }

func (r *Watches) Create(ctx context.Context, w *Watch) error {
	w.ID = ID("watch")
	w.CreatedAt = now()
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO watches (id, definition_id, schedule, condition_json, created_at) VALUES (?,?,?,?,?)`,
		w.ID, w.DefinitionID, w.Schedule, mustJSON(w.Condition), w.CreatedAt); err != nil {
		return fmt.Errorf("insert watch: %w", err)
	}
	return nil
}

// watchCols joins in what every watch surface needs: the definition's name
// (the watch's display identity) and the latest firing, from which status is
// derived. One read, one source per datum.
const watchCols = `
	SELECT w.id, w.definition_id, coalesce(d.name,''), w.schedule, w.condition_json, w.created_at,
	       coalesce(w.snoozed_until,''),
	       coalesce((SELECT max(fired_at) FROM watch_events e WHERE e.watch_id = w.id),'')
	FROM watches w LEFT JOIN definitions d ON d.id = w.definition_id`

func scanWatch(s interface{ Scan(...any) error }) (*Watch, error) {
	var w Watch
	var cond string
	if err := s.Scan(&w.ID, &w.DefinitionID, &w.DefinitionName, &w.Schedule, &cond, &w.CreatedAt,
		&w.SnoozedUntil, &w.LastFiredAt); err != nil {
		return nil, err
	}
	if p := fromJSON[Condition](cond); p != nil {
		w.Condition = *p
	}
	w.Status = watchStatus(w.SnoozedUntil, w.LastFiredAt)
	return &w, nil
}

// watchStatus derives the standing of a watch.
//
// `snoozed` outranks `firing` deliberately. A snoozed watch that fired last
// week is not firing now — it is deliberately quiet, and showing it as firing
// would report a state the operator explicitly turned off. The prior firing is
// still on the record as LastFiredAt; only the headline changes.
//
// An expired snooze is not a state: once the instant passes the watch is live
// again, so the derivation compares against the clock rather than trusting the
// column's presence.
func watchStatus(snoozedUntil, lastFiredAt string) string {
	if snoozeActive(snoozedUntil, time.Now().UTC()) {
		return "snoozed"
	}
	if lastFiredAt != "" {
		return "firing"
	}
	return "watching"
}

// snoozeActive reports whether a snooze is still in force at `at`.
// An unparseable value is treated as no snooze: a corrupt timestamp must not
// silence an alert forever.
func snoozeActive(snoozedUntil string, at time.Time) bool {
	if snoozedUntil == "" {
		return false
	}
	until, err := time.Parse(time.RFC3339, snoozedUntil)
	if err != nil {
		return false
	}
	return at.Before(until)
}

func (r *Watches) List(ctx context.Context) ([]Watch, error) {
	rows, err := r.db.QueryContext(ctx, watchCols+` ORDER BY w.created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list watches: %w", err)
	}
	defer rows.Close()
	var out []Watch
	for rows.Next() {
		w, err := scanWatch(rows)
		if err != nil {
			return nil, fmt.Errorf("scan watch: %w", err)
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (r *Watches) Get(ctx context.Context, id string) (*Watch, error) {
	w, err := scanWatch(r.db.QueryRowContext(ctx, watchCols+` WHERE w.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get watch %s: %w", id, err)
	}
	return w, nil
}

// WatchPatch carries the fields a caller wants changed. Nil means "leave it
// alone" — a snooze must not silently reset a threshold somebody tuned, and a
// threshold edit must not wake a snoozed watch.
type WatchPatch struct {
	Condition    *Condition
	Schedule     *string
	SnoozedUntil *string
}

// Update applies a partial change and returns the watch as it now stands.
func (r *Watches) Update(ctx context.Context, id string, p WatchPatch) (*Watch, error) {
	sets := []string{}
	args := []any{}
	if p.Condition != nil {
		sets = append(sets, "condition_json = ?")
		args = append(args, mustJSON(*p.Condition))
	}
	if p.Schedule != nil {
		sets = append(sets, "schedule = ?")
		args = append(args, *p.Schedule)
	}
	if p.SnoozedUntil != nil {
		// An empty string clears the snooze rather than storing "": "wake this
		// watch up" is a real request and needs a representation.
		sets = append(sets, "snoozed_until = ?")
		if *p.SnoozedUntil == "" {
			args = append(args, nil)
		} else {
			args = append(args, *p.SnoozedUntil)
		}
	}
	if len(sets) == 0 {
		// Nothing asked for. Report the current state rather than inventing an
		// error: a no-op PATCH is odd, not wrong.
		return r.Get(ctx, id)
	}
	args = append(args, id)
	res, err := r.db.ExecContext(ctx,
		`UPDATE watches SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("update watch %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("update watch %s: %w", id, err)
	}
	if n == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

func (r *Watches) AddEvent(ctx context.Context, watchID string, e *WatchEvent) error {
	e.ID = ID("wev")
	if e.FiredAt == "" {
		e.FiredAt = now()
	}
	if _, err := r.db.ExecContext(ctx,
		`INSERT INTO watch_events (id, watch_id, fired_at, value, previous, investigation_id) VALUES (?,?,?,?,?,?)`,
		e.ID, watchID, e.FiredAt, e.Value, e.Previous, e.InvestigationID); err != nil {
		return fmt.Errorf("insert watch event: %w", err)
	}
	return nil
}

func (r *Watches) Events(ctx context.Context, watchID string) ([]WatchEvent, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, fired_at, value, previous, coalesce(investigation_id,'')
		 FROM watch_events WHERE watch_id = ? ORDER BY fired_at DESC`, watchID)
	if err != nil {
		return nil, fmt.Errorf("list watch events %s: %w", watchID, err)
	}
	defer rows.Close()
	var out []WatchEvent
	for rows.Next() {
		var e WatchEvent
		if err := rows.Scan(&e.ID, &e.FiredAt, &e.Value, &e.Previous, &e.InvestigationID); err != nil {
			return nil, fmt.Errorf("scan watch event: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------- investigations

type Investigations struct{ db *sql.DB }

func NewInvestigations(d *DB) *Investigations { return &Investigations{db: d.sql} }

func (r *Investigations) Save(ctx context.Context, inv *Investigation) error {
	if inv.ID == "" {
		inv.ID = ID("inv")
	}
	if inv.CreatedAt == "" {
		inv.CreatedAt = now()
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO investigations (id, metric, definition_id, source_id, period, comparison_period,
			stopped_at, payload_json, created_at)
		VALUES (?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET stopped_at = excluded.stopped_at, payload_json = excluded.payload_json`,
		inv.ID, inv.Metric, inv.DefinitionID, inv.SourceID, inv.Period, inv.ComparisonPeriod,
		inv.StoppedAt, mustJSON(inv), inv.CreatedAt)
	if err != nil {
		return fmt.Errorf("save investigation %s: %w", inv.ID, err)
	}
	return nil
}

// List returns stored investigations, newest first.
func (r *Investigations) List(ctx context.Context) ([]Investigation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT payload_json FROM investigations ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		return nil, fmt.Errorf("list investigations: %w", err)
	}
	defer rows.Close()
	var out []Investigation
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, fmt.Errorf("scan investigation: %w", err)
		}
		if inv := fromJSON[Investigation](payload); inv != nil {
			out = append(out, *inv)
		}
	}
	return out, rows.Err()
}

func (r *Investigations) Get(ctx context.Context, id string) (*Investigation, error) {
	var payload string
	err := r.db.QueryRowContext(ctx, `SELECT payload_json FROM investigations WHERE id = ?`, id).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get investigation %s: %w", id, err)
	}
	inv := fromJSON[Investigation](payload)
	if inv == nil {
		return nil, fmt.Errorf("investigation %s payload is unreadable", id)
	}
	return inv, nil
}

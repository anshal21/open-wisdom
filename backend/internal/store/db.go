// Package store is the persistence layer.
//
// One SQLite file holds everything the product remembers: the answer ledger,
// the definitions earned from resolved ambiguities, and the surfaces built on
// top of them. The ledger is the point — an answer is a durable artifact with
// provenance, not a chat message.
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DB is the handle every repository is built on.
type DB struct {
	sql *sql.DB
}

// Open opens (creating if absent) the analyst database and applies the schema.
func Open(path string) (*DB, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create data dir %s: %w", dir, err)
		}
	}
	// Busy timeout matters: the ask pipeline writes an answer while background
	// watch evaluation may be reading.
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite %s: %w", path, err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping sqlite %s: %w", path, err)
	}
	if _, err := db.Exec(schema + schemaTail); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	for _, ddl := range additiveColumns {
		// Best-effort: "duplicate column" is the expected outcome on every
		// start after the first.
		_, _ = db.Exec(ddl)
	}
	for _, stmt := range backfills {
		// Also best-effort, and cheap after the first run: every backfill is
		// scoped to rows that are still NULL.
		_, _ = db.Exec(stmt)
	}
	return &DB{sql: db}, nil
}

func (d *DB) Close() error { return d.sql.Close() }

// SQL exposes the underlying handle for repositories in this package.
func (d *DB) SQL() *sql.DB { return d.sql }

const schema = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  dsn TEXT NOT NULL,
  status TEXT NOT NULL,
  table_count INTEGER NOT NULL DEFAULT 0,
  last_introspected_at TEXT,
  catalog_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  context_json TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_thread ON turns(thread_id, seq);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  source_id TEXT,
  question TEXT NOT NULL,
  restated TEXT,
  assumptions_json TEXT,
  value REAL,
  has_value INTEGER NOT NULL DEFAULT 0,
  unit TEXT,
  format_hint TEXT,
  columns_json TEXT,
  rows_json TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  sql_text TEXT,
  alt_sql TEXT,
  report_json TEXT,
  chart_json TEXT,
  ambiguity_json TEXT,
  narrative TEXT,
  confidence TEXT NOT NULL,
  definition_id TEXT,
  definition_name TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  cost_json TEXT,
  rerun_of TEXT,
  question_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_answers_created ON answers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answers_definition ON answers(definition_id);
CREATE INDEX IF NOT EXISTS idx_answers_key ON answers(question_key);

CREATE TABLE IF NOT EXISTS answer_flags (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flags_answer ON answer_flags(answer_id);
`

// additiveColumns are ALTERs applied best-effort after the base schema: SQLite
// has no ADD COLUMN IF NOT EXISTS, so each is tried and a duplicate-column
// error is expected on every start after the first.
var additiveColumns = []string{
	`ALTER TABLE dashboard_tiles ADD COLUMN x INTEGER NOT NULL DEFAULT -1`,
	`ALTER TABLE dashboard_tiles ADD COLUMN y INTEGER NOT NULL DEFAULT -1`,
	`ALTER TABLE dashboard_tiles ADD COLUMN w INTEGER NOT NULL DEFAULT 3`,
	`ALTER TABLE dashboard_tiles ADD COLUMN h INTEGER NOT NULL DEFAULT 2`,
	`ALTER TABLE dashboard_tiles ADD COLUMN viz_json TEXT`,
	`ALTER TABLE notebooks ADD COLUMN updated_at TEXT`,
	`ALTER TABLE notebook_cells ADD COLUMN updated_at TEXT`,
	`ALTER TABLE watches ADD COLUMN snoozed_until TEXT`,
	`ALTER TABLE definitions ADD COLUMN dismissed_at TEXT`,
}

// backfills run after additiveColumns. A column added to an existing table
// arrives NULL on every pre-existing row, and a notebook whose updated_at is
// NULL renders "last edited —" on a surface whose whole job is to say when it
// last changed. Each statement is idempotent: it only touches rows still NULL.
var backfills = []string{
	`UPDATE notebooks SET updated_at = created_at WHERE updated_at IS NULL`,
	`UPDATE notebook_cells SET updated_at = (
	   SELECT created_at FROM notebooks WHERE notebooks.id = notebook_cells.notebook_id
	 ) WHERE updated_at IS NULL`,
}

const schemaTail = `

CREATE TABLE IF NOT EXISTS definitions (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  name TEXT NOT NULL,
  plain_english TEXT NOT NULL,
  expression TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  ratified_by TEXT,
  ratified_at TEXT,
  source_answer_id TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_definitions_lineage ON definitions(lineage_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_definitions_status ON definitions(status);

CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_tiles (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  answer_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  size TEXT NOT NULL DEFAULT 'medium'
);
CREATE INDEX IF NOT EXISTS idx_tiles_dashboard ON dashboard_tiles(dashboard_id, position);

CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notebook_cells (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  output_json TEXT,
  confidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_cells_notebook ON notebook_cells(notebook_id, seq);

CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL,
  schedule TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_events (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  fired_at TEXT NOT NULL,
  value REAL,
  previous REAL,
  investigation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_watch_events ON watch_events(watch_id, fired_at DESC);

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  definition_id TEXT,
  source_id TEXT,
  period TEXT,
  comparison_period TEXT,
  stopped_at TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
`

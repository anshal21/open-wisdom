// Package warehouse defines the contract every data source must satisfy.
//
// Nothing above this package may assume a specific engine, schema, or table.
// Schema is always discovered at runtime via Introspect.
package warehouse

import (
	"context"
	"time"
)

// Connector is a read-only handle to one data source.
type Connector interface {
	// Introspect returns the full catalog: tables, columns, types, and
	// whatever cheap statistics the engine can supply.
	Introspect(ctx context.Context) (*Catalog, error)

	// Query runs read-only SQL. Implementations must reject writes AND reads
	// that leave the warehouse — see RejectWrites and the conformance suite.
	Query(ctx context.Context, sql string) (*Result, error)

	// Dialect identifies the SQL flavor AND the engine's capabilities, so the
	// planner can constrain what it generates instead of discovering a limit
	// through a syntax error.
	Dialect() Dialect

	Close() error
}

// Catalog is a point-in-time description of a data source.
type Catalog struct {
	Source string `json:"source"`
	// Dialect decodes from either the current object form or the legacy bare
	// string, so catalogs cached before capabilities existed still load.
	Dialect        Dialect   `json:"dialect"`
	Tables         []Table   `json:"tables"`
	IntrospectedAt time.Time `json:"introspected_at"`
}

// Table describes one relation.
type Table struct {
	Schema   string   `json:"schema,omitempty"`
	Name     string   `json:"name"`
	Columns  []Column `json:"columns"`
	RowCount int64    `json:"row_count"`
	// Comment carries engine-level documentation when available.
	Comment string `json:"comment,omitempty"`
	// Relationships are join edges inferred from naming and key columns —
	// heuristic, never engine constraints, and labeled with the measured
	// cardinality so a schema browser can warn about fan-out before a query
	// ever runs.
	Relationships []Relationship `json:"relationships"`
	// SampleRows hold a handful of real rows so a reader can see what the
	// table actually contains, not guess from column names.
	SampleRows [][]any `json:"sample_rows"`
}

// Relationship is one inferred join edge out of a table.
type Relationship struct {
	FromColumn  string `json:"from_column"`
	ToTable     string `json:"to_table"`
	ToColumn    string `json:"to_column"`
	Cardinality string `json:"cardinality"`
}

// FQN returns the qualified name for use in generated SQL.
func (t Table) FQN() string {
	if t.Schema == "" || t.Schema == "main" {
		return quoteIdent(t.Name)
	}
	return quoteIdent(t.Schema) + "." + quoteIdent(t.Name)
}

// Column describes one field, including the profiling data the verification
// engine needs to catch silent wrongness (case mismatches, null semantics,
// key cardinality).
type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Comment  string `json:"comment,omitempty"`
	// Role classifies the column for display and planning: key, date, measure,
	// dimension, or pii. Derived from name, type and profile — a heuristic,
	// recomputed on every introspection, never stored as truth.
	Role string `json:"role"`
	// NullRate is null_count over row_count, the number the profile already
	// holds, served so no client re-derives (and mis-derives) it.
	NullRate float64 `json:"null_rate"`

	// Profile is populated lazily; zero value means "not profiled yet".
	Profile *ColumnProfile `json:"profile,omitempty"`
}

// ColumnProfile holds sampled statistics for a single column.
type ColumnProfile struct {
	DistinctCount int64 `json:"distinct_count"`
	NullCount     int64 `json:"null_count"`
	// DistinctValues is populated only for low-cardinality columns. These are
	// the exact literals a filter must match — the single most common cause of
	// a confidently wrong answer is a generated predicate whose literal casing
	// does not exist in the data.
	DistinctValues []string `json:"distinct_values,omitempty"`
	Min            string   `json:"min,omitempty"`
	Max            string   `json:"max,omitempty"`
	// Aliases group distinct values that denote the same real-world entity
	// ('Germany' and 'Deutschland', 'Spain' and 'España'). Grouping by such a
	// column splits one entity across rows and double-counts it; this is a
	// property of the data, so it is profiled once rather than rediscovered per
	// question. Each group's first element is the canonical spelling.
	Aliases    [][]string `json:"aliases,omitempty"`
	ProfiledAt time.Time  `json:"profiled_at"`
}

// IsLowCardinality reports whether the column looks like an enum.
func (p *ColumnProfile) IsLowCardinality() bool {
	return p != nil && p.DistinctCount > 0 && p.DistinctCount <= lowCardinalityCeiling
}

const lowCardinalityCeiling = 50

// Result is a materialized query result.
type Result struct {
	Columns   []ResultColumn `json:"columns"`
	Rows      [][]any        `json:"rows"`
	Elapsed   time.Duration  `json:"elapsed"`
	Truncated bool           `json:"truncated"`
}

// ResultColumn is one output column of a result set.
type ResultColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Scalar returns the single value of a 1x1 result, or false if the shape
// differs. The verification engine compares scalars across independent
// derivations, so this is a hot path.
func (r *Result) Scalar() (any, bool) {
	if r == nil || len(r.Rows) != 1 || len(r.Rows[0]) != 1 {
		return nil, false
	}
	return r.Rows[0][0], true
}

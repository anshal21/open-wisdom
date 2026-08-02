package warehouse

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Profiler enriches a Catalog with per-column statistics.
//
// This exists to serve verification, not display. A generated predicate like
// status <> 'cancelled' is silently wrong when the stored values are
// 'Cancelled' — the only way to know is to hold the actual distinct values.
type Profiler struct {
	conn        Connector
	concurrency int
}

func NewProfiler(conn Connector) *Profiler {
	return &Profiler{conn: conn, concurrency: 8}
}

// textTypes are the types worth enumerating distinct values for.
func isTextual(typ string) bool {
	t := strings.ToUpper(typ)
	return strings.Contains(t, "CHAR") || strings.Contains(t, "TEXT") ||
		strings.Contains(t, "STRING") || t == "BOOLEAN" || strings.Contains(t, "ENUM")
}

func isTemporal(typ string) bool {
	t := strings.ToUpper(typ)
	return strings.Contains(t, "DATE") || strings.Contains(t, "TIME")
}

// Profile fills in Column.Profile for every column in the catalog.
func (p *Profiler) Profile(ctx context.Context, cat *Catalog) error {
	type job struct{ ti, ci int }
	jobs := make(chan job)

	var wg sync.WaitGroup
	for i := 0; i < p.concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				t := &cat.Tables[j.ti]
				c := &t.Columns[j.ci]
				prof, err := p.profileColumn(ctx, *t, *c)
				if err != nil {
					continue // profiling is best-effort; absence degrades checks, never blocks
				}
				c.Profile = prof
			}
		}()
	}

	for ti := range cat.Tables {
		for ci := range cat.Tables[ti].Columns {
			select {
			case jobs <- job{ti, ci}:
			case <-ctx.Done():
				close(jobs)
				wg.Wait()
				return ctx.Err()
			}
		}
	}
	close(jobs)
	wg.Wait()

	// Enrichment that needs the profiles (roles, null rates) or the whole
	// catalog (relationships) runs after the per-column pass.
	p.enrich(ctx, cat)
	return nil
}

// enrich derives display-and-planning metadata from what profiling measured:
// column roles, null rates, inferred join edges, and a few sample rows. All of
// it is recomputed on every introspection — derived data is never the source
// of anything.
func (p *Profiler) enrich(ctx context.Context, cat *Catalog) {
	for ti := range cat.Tables {
		t := &cat.Tables[ti]
		for ci := range t.Columns {
			c := &t.Columns[ci]
			c.Role = classifyColumn(*c)
			if c.Profile != nil && t.RowCount > 0 {
				c.NullRate = float64(c.Profile.NullCount) / float64(t.RowCount)
			}
		}
		t.Relationships = inferRelationships(*t, cat)
		if rows, err := p.conn.Query(ctx, fmt.Sprintf("SELECT * FROM %s LIMIT 4", t.FQN())); err == nil {
			t.SampleRows = rows.Rows
		}
		if t.Relationships == nil {
			t.Relationships = []Relationship{}
		}
		if t.SampleRows == nil {
			t.SampleRows = [][]any{}
		}
	}
}

// piiNames are column-name fragments that conventionally hold personal data.
var piiNames = []string{"email", "phone", "first_name", "last_name", "full_name", "address", "street", "postal", "zip", "latitude", "longitude", "ip_address", "ssn", "dob", "birth"}

// classifyColumn assigns the display role from name, type and profile — in
// that priority order, because a key named user_id stays a key whatever its
// type says.
func classifyColumn(c Column) string {
	name := strings.ToLower(c.Name)
	switch {
	case name == "id" || strings.HasSuffix(name, "_id"):
		return "key"
	case hasAny(name, piiNames):
		return "pii"
	case isTemporal(c.Type):
		return "date"
	case c.Profile.IsLowCardinality():
		// A low-cardinality numeric (status codes, flags) groups, not sums.
		return "dimension"
	case isNumericType(c.Type):
		return "measure"
	default:
		return "dimension"
	}
}

func hasAny(s string, fragments []string) bool {
	for _, f := range fragments {
		if strings.Contains(s, f) {
			return true
		}
	}
	return false
}

func isNumericType(typ string) bool {
	t := strings.ToUpper(typ)
	for _, n := range []string{"INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC", "REAL"} {
		if strings.Contains(t, n) {
			return true
		}
	}
	return false
}

// inferRelationships proposes join edges by the *_id naming convention: a
// column x_id points at the table whose name is x or a plural of x and which
// has an id column. Cardinality is N:1 from the referencing side — the fan-out
// probes measure the real multiplicity at query time; this is orientation, not
// enforcement.
func inferRelationships(t Table, cat *Catalog) []Relationship {
	var out []Relationship
	for _, c := range t.Columns {
		name := strings.ToLower(c.Name)
		if !strings.HasSuffix(name, "_id") || name == "_id" {
			continue
		}
		base := strings.TrimSuffix(name, "_id")
		for i := range cat.Tables {
			target := &cat.Tables[i]
			if target.Name == t.Name {
				continue
			}
			tn := strings.ToLower(target.Name)
			if tn != base && tn != base+"s" && tn != base+"es" && !(strings.HasSuffix(base, "y") && tn == strings.TrimSuffix(base, "y")+"ies") {
				continue
			}
			// The target's key is either a bare id or the same name the
			// referencing side uses (orders.order_id ← order_items.order_id).
			toCol := ""
			switch {
			case hasColumn(target, "id"):
				toCol = "id"
			case hasColumn(target, c.Name):
				toCol = c.Name
			default:
				continue
			}
			out = append(out, Relationship{FromColumn: c.Name, ToTable: target.Name, ToColumn: toCol, Cardinality: "N:1"})
			break
		}
	}
	return out
}

func hasColumn(t *Table, name string) bool {
	for _, c := range t.Columns {
		if strings.EqualFold(c.Name, name) {
			return true
		}
	}
	return false
}

func (p *Profiler) profileColumn(ctx context.Context, t Table, c Column) (*ColumnProfile, error) {
	col := quoteIdent(c.Name)
	q := fmt.Sprintf(
		`SELECT count(*) FILTER (WHERE %s IS NULL), approx_count_distinct(%s) FROM %s`,
		col, col, t.FQN())

	res, err := p.conn.Query(ctx, q)
	if err != nil || len(res.Rows) != 1 {
		return nil, fmt.Errorf("profile %s.%s: %w", t.Name, c.Name, err)
	}
	prof := &ColumnProfile{
		NullCount:     toInt64(res.Rows[0][0]),
		DistinctCount: toInt64(res.Rows[0][1]),
		ProfiledAt:    time.Now(),
	}

	// Enumerate the actual literals for enum-like text columns. These become
	// the ground truth the filter-literal check compares generated predicates
	// against.
	if isTextual(c.Type) && prof.IsLowCardinality() {
		vq := fmt.Sprintf(
			`SELECT DISTINCT %s FROM %s WHERE %s IS NOT NULL ORDER BY 1 LIMIT %d`,
			col, t.FQN(), col, lowCardinalityCeiling)
		if vres, err := p.conn.Query(ctx, vq); err == nil {
			for _, r := range vres.Rows {
				prof.DistinctValues = append(prof.DistinctValues, fmt.Sprint(r[0]))
			}
		}
	}

	// Range for temporal and numeric columns drives the period-normalization
	// check (a "this month" question against data that ends mid-month is the
	// classic partial-period trap).
	if isTemporal(c.Type) || isNumeric(c.Type) {
		rq := fmt.Sprintf(`SELECT min(%s), max(%s) FROM %s`, col, col, t.FQN())
		if rres, err := p.conn.Query(ctx, rq); err == nil && len(rres.Rows) == 1 {
			prof.Min = fmt.Sprint(rres.Rows[0][0])
			prof.Max = fmt.Sprint(rres.Rows[0][1])
		}
	}
	return prof, nil
}

func isNumeric(typ string) bool {
	t := strings.ToUpper(typ)
	for _, n := range []string{"INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC", "REAL", "HUGEINT"} {
		if strings.Contains(t, n) {
			return true
		}
	}
	return false
}

func toInt64(v any) int64 {
	switch t := v.(type) {
	case int64:
		return t
	case int32:
		return int64(t)
	case int:
		return int64(t)
	case float64:
		return int64(t)
	}
	return 0
}

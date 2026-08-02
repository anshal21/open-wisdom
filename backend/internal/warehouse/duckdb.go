package warehouse

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"strings"
	"time"

	"github.com/marcboeker/go-duckdb/v2"
)

// DuckDB is a Connector backed by a local DuckDB database file.
type DuckDB struct {
	db   *sql.DB
	path string
	opts Options
}

// The connector registers itself. This is the whole integration surface: one
// file, one Register call, and nothing in sources/ or api/ knows DuckDB exists.
func init() {
	Register("duckdb", func(dsn string, opts Options) (Connector, error) {
		d, err := OpenDuckDB(dsn)
		if err != nil {
			return nil, err
		}
		d.opts = opts
		return d, nil
	})
}

// duckDBDialect is what DuckDB actually supports, verified against v1.4.
var duckDBDialect = Dialect{
	Name:            "duckdb",
	CTEs:            true,
	WindowFunctions: true,
	Qualify:         true,
	ApproxQuantiles: true,
	ILike:           true,
	// A local file costs nothing to query, which is why the double execution
	// of cross-derivation is invisible here and expensive on a warehouse.
	Metered: false,
}

// blockedFilesystems is the lockdown applied to every connection.
//
// `access_mode=read_only` stops writes to the DATABASE. It does not stop reads
// of the HOST: `SELECT * FROM read_csv_auto('/etc/passwd')` is a read-only
// statement that returns the file. The SQL reaching this engine is written by
// a model against data we do not control, so that is an arbitrary
// file-disclosure primitive reachable by prompt injection.
//
// Two decisions worth recording, both learned the hard way:
//
//   - `enable_external_access=false` is NOT used. It can only be set while the
//     database is starting, so issuing it from a connection initialiser fails
//     on every connection after the first — and because the initialiser is
//     fail-closed, those connections are then discarded. Profiling is
//     concurrent, so the visible symptom was columns silently losing their
//     profiles and the filter-literal check degrading to "skipped". Moving it
//     into the DSN does not work either: it blocks the ICU autoload that
//     TimeZone=UTC depends on.
//   - `disabled_filesystems` is session-scoped, so it CANNOT ride in the DSN
//     (DuckDB rejects it as a global option) and must be applied per
//     connection — the mirror image of the TimeZone decision below.
//
// The list names filesystems rather than capabilities. Names not currently
// registered are accepted without error, so listing the cloud filesystems now
// closes them ahead of anyone loading those extensions. DuckDB refuses to
// re-enable a disabled filesystem for the life of the process, which is what
// makes this a boundary rather than a suggestion.
var blockedFilesystems = strings.Join([]string{
	"LocalFileSystem",
	"HTTPFileSystem",
	"S3FileSystem",
	"GCSFileSystem",
	"AzureBlobStorageFileSystem",
}, ",")

// OpenDuckDB opens a DuckDB file read-only, with host access shut off.
func OpenDuckDB(path string) (*DuckDB, error) {
	// TimeZone rides in the DSN, not in a SET: database/sql pools connections,
	// and a session setting issued on one connection silently does not exist
	// on its siblings. DATE_TRUNC on TIMESTAMPTZ buckets in the session zone,
	// so without this a host in IST puts "January" at Dec 31 18:30 UTC and
	// every period label downstream is off by the host's offset.
	//
	// The lockdown cannot use the same trick — DuckDB rejects
	// disabled_filesystems as a global config option — so it runs through a
	// connection initialiser, which database/sql invokes for every connection
	// it opens, including ones created later under load.
	connector, err := duckdb.NewConnector(
		path+"?access_mode=read_only&TimeZone=UTC",
		func(ex driver.ExecerContext) error {
			// Fail closed: a connection that could not be locked down must not
			// serve queries.
			stmt := "SET disabled_filesystems='" + blockedFilesystems + "'"
			if _, err := ex.ExecContext(context.Background(), stmt, nil); err != nil {
				return fmt.Errorf("lock down connection: %w", err)
			}
			return nil
		},
	)
	if err != nil {
		return nil, fmt.Errorf("open duckdb %s: %w", path, err)
	}

	db := sql.OpenDB(connector)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping duckdb %s: %w", path, err)
	}
	return &DuckDB{db: db, path: path}, nil
}

func (d *DuckDB) Dialect() Dialect { return duckDBDialect }
func (d *DuckDB) Close() error     { return d.db.Close() }

// rowLimit is the operator ceiling if one was set, else the built-in cap.
func (d *DuckDB) rowLimit() int {
	if d.opts.MaxRows > 0 {
		return d.opts.MaxRows
	}
	return maxRows
}

// Introspect discovers every table and column at runtime. No schema knowledge
// is baked in anywhere.
func (d *DuckDB) Introspect(ctx context.Context) (*Catalog, error) {
	const q = `
		SELECT table_schema, table_name, column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
		ORDER BY table_schema, table_name, ordinal_position`

	rows, err := d.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("introspect columns: %w", err)
	}
	defer rows.Close()

	byTable := map[string]*Table{}
	var order []string
	for rows.Next() {
		var schema, table, col, typ, nullable string
		if err := rows.Scan(&schema, &table, &col, &typ, &nullable); err != nil {
			return nil, fmt.Errorf("scan column: %w", err)
		}
		key := schema + "." + table
		t, ok := byTable[key]
		if !ok {
			t = &Table{Schema: schema, Name: table}
			byTable[key] = t
			order = append(order, key)
		}
		t.Columns = append(t.Columns, Column{
			Name:     col,
			Type:     typ,
			Nullable: strings.EqualFold(nullable, "YES"),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate columns: %w", err)
	}

	cat := &Catalog{
		Source:         d.path,
		Dialect:        d.Dialect(),
		IntrospectedAt: time.Now(),
	}
	for _, key := range order {
		t := byTable[key]
		if n, err := d.rowCount(ctx, *t); err == nil {
			t.RowCount = n
		}
		cat.Tables = append(cat.Tables, *t)
	}
	return cat, nil
}

func (d *DuckDB) rowCount(ctx context.Context, t Table) (int64, error) {
	var n int64
	err := d.db.QueryRowContext(ctx, "SELECT count(*) FROM "+t.FQN()).Scan(&n)
	return n, err
}

// ParseSQL returns the engine's own parse tree as JSON. Verification uses this
// rather than a second SQL grammar of our own.
func (d *DuckDB) ParseSQL(ctx context.Context, query string) (string, error) {
	// json_serialize_sql resolves at bind time and rejects bound parameters, so
	// the statement is inlined as an escaped literal. It is only ever parsed,
	// never executed, by this call.
	var out string
	err := d.db.QueryRowContext(ctx,
		"SELECT json_serialize_sql("+QuoteLiteral(query)+")::VARCHAR").Scan(&out)
	if err != nil {
		return "", fmt.Errorf("serialize sql: %w", err)
	}
	if strings.Contains(out, `"error":true`) {
		return "", fmt.Errorf("sql did not parse: %.200s", out)
	}
	return out, nil
}

// maxRows caps materialization so a runaway query cannot exhaust memory.
const maxRows = 10000

// Query executes read-only SQL.
func (d *DuckDB) Query(ctx context.Context, query string) (*Result, error) {
	if err := RejectWrites(query); err != nil {
		return nil, err
	}
	// An operator timeout bounds a single query independently of the caller's
	// context, so one pathological question cannot hold a connection open for
	// the length of the whole request.
	if d.opts.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, d.opts.Timeout)
		defer cancel()
	}
	start := time.Now()
	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("columns: %w", err)
	}
	types, err := rows.ColumnTypes()
	if err != nil {
		return nil, fmt.Errorf("column types: %w", err)
	}

	res := &Result{Columns: make([]ResultColumn, len(colNames))}
	for i, n := range colNames {
		res.Columns[i] = ResultColumn{Name: n, Type: types[i].DatabaseTypeName()}
	}

	limit := d.rowLimit()
	for rows.Next() {
		if len(res.Rows) >= limit {
			res.Truncated = true
			break
		}
		vals := make([]any, len(colNames))
		ptrs := make([]any, len(colNames))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		res.Rows = append(res.Rows, normalizeRow(vals))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}
	res.Elapsed = time.Since(start)
	return res, nil
}

// normalizeRow converts driver types into JSON-friendly values.
func normalizeRow(vals []any) []any {
	out := make([]any, len(vals))
	for i, v := range vals {
		switch t := v.(type) {
		case []byte:
			out[i] = string(t)
		case time.Time:
			// DuckDB TIMESTAMP is timezone-naive; the driver stamps the local
			// zone onto the wall-clock value. Serializing that as UTC shifts
			// every timestamp by the host's offset — a midnight month bucket
			// becomes the previous day and every period label is wrong. Keep
			// the wall clock, declare it UTC.
			out[i] = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC).Format(time.RFC3339)
		default:
			out[i] = v
		}
	}
	return out
}

package warehouse

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/marcboeker/go-duckdb/v2"
	sf "github.com/snowflakedb/gosnowflake"
)

// Snowflake is a Connector backed by a Snowflake account.
//
// The DSN is gosnowflake's:
//
//	user:password@account/database/schema?warehouse=WH&role=ANALYST_RO
//
// with the password best written as a ${SNOWFLAKE_PASSWORD} reference — the
// registry resolves it at connect time and the stored DSN keeps the reference,
// never the secret (see ResolveDSN).
//
// Two properties of this engine shape everything below:
//
//   - It is METERED. Verification runs every query twice by design, and a
//     third of the pipeline's calls hit the warehouse — so Dialect.Metered is
//     true, Options ceilings are honoured, and a statement timeout is pushed
//     server-side, because a runaway query on a paused-forever warehouse is a
//     bill, not a hang.
//   - Read-only is a ROLE property, not a connection property. There is no
//     access_mode=read_only here; the SQL guard rejects writes before they
//     leave the process, and the engine-specific escapes (stages, EXECUTE
//     IMMEDIATE) are closed in snowflakeGuard. Connect with a read-only role
//     regardless — defence in depth assumes one layer is wrong.
type Snowflake struct {
	db   *sql.DB
	name string // redacted DSN, safe for Catalog.Source and logs
	opts Options

	// parser is an in-memory DuckDB used ONLY to parse SQL for the structural
	// checks — see ParseSQL.
	parser *sql.DB
}

func init() {
	Register("snowflake", func(dsn string, opts Options) (Connector, error) {
		return OpenSnowflake(dsn, opts)
	})
}

// snowflakeDialect is what the engine supports, per current Snowflake SQL.
// QUALIFY, window functions and APPROX_PERCENTILE are native; ILIKE is native.
var snowflakeDialect = Dialect{
	Name:            "snowflake",
	CTEs:            true,
	WindowFunctions: true,
	Qualify:         true,
	ApproxQuantiles: true,
	ILike:           true,
	Metered:         true,
}

// OpenSnowflake opens a connection and verifies it with a ping.
func OpenSnowflake(dsn string, opts Options) (*Snowflake, error) {
	cfg, err := sf.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse snowflake dsn: %w", err)
	}

	// Session parameters the product depends on, applied at the connection
	// level so pooling cannot lose them (the same reasoning as DuckDB's
	// TimeZone-in-DSN: a SET issued on one pooled connection silently does not
	// exist on its siblings).
	if cfg.Params == nil {
		cfg.Params = map[string]*string{}
	}
	// Naive timestamps must mean UTC wall-clock everywhere in this product;
	// period bucketing in the session zone shifts every month boundary by the
	// host's offset.
	setParam(cfg.Params, "timezone", "UTC")
	// A server-side ceiling on any single statement. The caller's context
	// still applies; this one survives a client that went away.
	if opts.Timeout > 0 {
		secs := int(opts.Timeout / time.Second)
		if secs < 1 {
			secs = 1
		}
		setParam(cfg.Params, "statement_timeout_in_seconds", fmt.Sprint(secs))
	}

	connector := sf.NewConnector(sf.SnowflakeDriver{}, *cfg)
	db := sql.OpenDB(connector)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping snowflake: %w", err)
	}

	// The structural-check parser. In-memory, no data, closed with the
	// connector. See ParseSQL for why this is DuckDB.
	parser, err := sql.Open("duckdb", "")
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("open parse helper: %w", err)
	}

	return &Snowflake{
		db:     db,
		name:   RedactDSN(dsn),
		opts:   opts,
		parser: parser,
	}, nil
}

func setParam(params map[string]*string, key, value string) {
	v := value
	params[key] = &v
}

func (s *Snowflake) Dialect() Dialect { return snowflakeDialect }

func (s *Snowflake) Close() error {
	perr := s.parser.Close()
	if err := s.db.Close(); err != nil {
		return err
	}
	return perr
}

func (s *Snowflake) rowLimit() int {
	if s.opts.MaxRows > 0 {
		return s.opts.MaxRows
	}
	return maxRows
}

// Introspect discovers tables, columns and comments from information_schema.
//
// Row counts come from information_schema.tables rather than count(*) per
// table: on a metered engine, introspection must not cost a full scan of
// every relation. The counts Snowflake maintains there are current for normal
// tables, which is what profiling needs them for (choosing sample sizes and
// flagging emptiness), not for answering questions.
func (s *Snowflake) Introspect(ctx context.Context) (*Catalog, error) {
	const q = `
		SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
		       c.is_nullable, COALESCE(c.comment, ''), COALESCE(t.row_count, 0),
		       COALESCE(t.comment, '')
		FROM information_schema.columns c
		JOIN information_schema.tables t
		  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		WHERE c.table_schema <> 'INFORMATION_SCHEMA'
		  AND t.table_type IN ('BASE TABLE', 'VIEW')
		ORDER BY c.table_schema, c.table_name, c.ordinal_position`

	rows, err := s.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("introspect columns: %w", err)
	}
	defer rows.Close()

	byTable := map[string]*Table{}
	var order []string
	for rows.Next() {
		var schema, table, col, typ, nullable, colComment, tblComment string
		var rowCount int64
		if err := rows.Scan(&schema, &table, &col, &typ, &nullable, &colComment, &rowCount, &tblComment); err != nil {
			return nil, fmt.Errorf("scan column: %w", err)
		}
		key := schema + "." + table
		t, ok := byTable[key]
		if !ok {
			t = &Table{Schema: schema, Name: table, RowCount: rowCount, Comment: tblComment}
			byTable[key] = t
			order = append(order, key)
		}
		t.Columns = append(t.Columns, Column{
			Name:     col,
			Type:     typ,
			Nullable: strings.EqualFold(nullable, "YES"),
			Comment:  colComment,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate columns: %w", err)
	}

	cat := &Catalog{
		Source:         s.name,
		Dialect:        s.Dialect(),
		IntrospectedAt: time.Now(),
	}
	for _, key := range order {
		cat.Tables = append(cat.Tables, *byTable[key])
	}
	return cat, nil
}

// ParseSQL parses through an in-memory DuckDB instance.
//
// Snowflake has no local parser to borrow, and shipping a second SQL grammar
// of our own is the thing verify deliberately refuses to do. DuckDB's parser
// accepts the overwhelming share of what the planner emits for Snowflake
// (ANSI + CTEs + window functions + QUALIFY), and the structural summary the
// checks extract — tables, joins, aggregates, predicates — is
// dialect-agnostic.
//
// The honest limit: genuinely Snowflake-only syntax (LATERAL FLATTEN, `:`
// path access) fails to parse here. The caller treats a parse failure as "no
// parse available" and the affected checks skip — visibly, in the report —
// rather than run on a wrong tree. Degrading beats guessing.
func (s *Snowflake) ParseSQL(ctx context.Context, query string) (string, error) {
	var out string
	err := s.parser.QueryRowContext(ctx,
		"SELECT json_serialize_sql("+QuoteLiteral(query)+")::VARCHAR").Scan(&out)
	if err != nil {
		return "", fmt.Errorf("serialize sql: %w", err)
	}
	if strings.Contains(out, `"error":true`) {
		return "", fmt.Errorf("sql did not parse: %.200s", out)
	}
	return out, nil
}

// Query executes read-only SQL with the shared guard plus Snowflake's own
// escape hatches closed.
func (s *Snowflake) Query(ctx context.Context, query string) (*Result, error) {
	if err := RejectWrites(query); err != nil {
		return nil, err
	}
	if err := snowflakeGuard(query); err != nil {
		return nil, err
	}
	if s.opts.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.opts.Timeout)
		defer cancel()
	}
	start := time.Now()
	rows, err := s.db.QueryContext(ctx, query)
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

	limit := s.rowLimit()
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

// ---------------------------------------------------------------------------
// Snowflake-specific guard
// ---------------------------------------------------------------------------

// ErrSnowflakeEscape mirrors ErrExternalRead for this engine's own escapes.
var ErrSnowflakeEscape = fmt.Errorf("%w (snowflake stage or scripting access)", ErrExternalRead)

var (
	// stageRef finds `@stage`, `@~` (user stage) and `@%table` (table stage)
	// used as a table source or function argument. A stage is a file store:
	// `SELECT $1 FROM @~` is this engine's read_csv_auto('/etc/passwd').
	// Matched after masking, so an '@' inside a string literal is data.
	//
	// One character class, not `@[~%]?[A-Za-z_"]` — that shape requires a
	// name character after the marker, and the bare user stage `@~` has none.
	stageRef = regexp.MustCompile(`@[~%A-Za-z_"]`)

	// snowflakeStmtStart names statement kinds that move files or execute
	// dynamic blocks. These cannot ride the global keyword denylist: GET and
	// LIST are ordinary identifiers in column position (`GET(v, 'k')` is the
	// semi-structured accessor), so they are rejected only where a statement
	// begins.
	snowflakeStmtStart = regexp.MustCompile(`(?is)^\s*(put|get|list|remove|execute)\b`)

	// snowflakeFuncs are scalar functions that mint URLs to stage files or
	// re-read other statements' results — data exfiltration primitives shaped
	// like ordinary SELECT items, so they are denied wherever they appear.
	snowflakeFuncs = map[string]bool{
		"get_presigned_url":     true,
		"build_scoped_file_url": true,
		"build_stage_file_url":  true,
		"result_scan":           true,
	}
)

// snowflakeGuard closes the escapes specific to this engine, in the same
// spirit as DuckDB's blockedFilesystems: RejectWrites knows SQL, this knows
// Snowflake.
func snowflakeGuard(query string) error {
	masked, err := maskQuoted(query)
	if err != nil {
		return err
	}

	for _, stmt := range strings.Split(masked, ";") {
		if snowflakeStmtStart.MatchString(stmt) {
			return ErrSnowflakeEscape
		}
	}
	if stageRef.MatchString(masked) {
		return ErrSnowflakeEscape
	}
	for _, m := range anyFunc.FindAllStringSubmatch(masked, -1) {
		if snowflakeFuncs[strings.ToLower(m[1])] {
			return ErrSnowflakeEscape
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// DSN helper for the connect UI
// ---------------------------------------------------------------------------

// BuildSnowflakeDSN assembles a gosnowflake DSN from parts, used by tests and
// documented for the connect dialog. Password may be a ${VAR} reference.
func BuildSnowflakeDSN(user, password, account, database, schema string, params map[string]string) string {
	var b strings.Builder
	b.WriteString(url.QueryEscape(user))
	if password != "" {
		// A ${VAR} reference must survive verbatim for ResolveDSN to see it.
		b.WriteString(":")
		if envRef.MatchString(password) {
			b.WriteString(password)
		} else {
			b.WriteString(url.QueryEscape(password))
		}
	}
	b.WriteString("@" + account)
	if database != "" {
		b.WriteString("/" + database)
		if schema != "" {
			b.WriteString("/" + schema)
		}
	}
	if len(params) > 0 {
		keys := make([]string, 0, len(params))
		for k := range params {
			keys = append(keys, k)
		}
		// deterministic for tests
		for i := 0; i < len(keys); i++ {
			for j := i + 1; j < len(keys); j++ {
				if keys[j] < keys[i] {
					keys[i], keys[j] = keys[j], keys[i]
				}
			}
		}
		sep := "?"
		for _, k := range keys {
			b.WriteString(sep + url.QueryEscape(k) + "=" + url.QueryEscape(params[k]))
			sep = "&"
		}
	}
	return b.String()
}

// Interface conformance, checked at compile time. duckdb.Connector is unused
// otherwise; the blank import keeps the parse helper's driver registered even
// if the DuckDB connector file were ever split out.
var (
	_ Connector = (*Snowflake)(nil)
	_           = duckdb.NewConnector
)

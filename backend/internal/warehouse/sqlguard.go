package warehouse

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// ErrWriteAttempt is returned when generated SQL is not read-only.
//
// The model is never trusted to only produce SELECTs. This is a gate before
// the engine — not THE gate. The engine itself is locked down at connection
// time (see OpenDuckDB); this guard exists so a rejected statement fails with
// an explanation rather than a driver error, and so that a future connector
// with weaker engine settings is still covered.
var ErrWriteAttempt = errors.New("only read-only statements are permitted")

// ErrExternalRead is returned for SQL that reads outside the warehouse.
//
// A SELECT is not automatically safe. DuckDB exposes table functions —
// read_csv, read_parquet, glob and friends — that read the local filesystem or
// the network. `SELECT * FROM read_csv_auto('/etc/passwd')` is read-only by
// every classical definition and is also arbitrary file disclosure. This SQL
// is written by a model against data we do not control, so a prompt injection
// carried in a column value is a plausible route to it.
var ErrExternalRead = errors.New("reading outside the warehouse is not permitted")

// literalMask is what a masked string literal collapses to. The NUL byte keeps
// it distinguishable from anything a real statement can contain.
const literalMask = "'\x00'"

var (
	// forbidden matches statements that mutate state or the catalog. It runs
	// only AFTER string literals and quoted identifiers are masked, so a row
	// whose status is 'create' is data, not DDL.
	//
	// `replace` is deliberately ABSENT. It is an ordinary scalar function —
	// `replace(sku, '-', '')` is routine data cleaning — and listing it refused
	// legitimate read-only queries. Nothing is lost: it reaches the catalog only
	// as `CREATE OR REPLACE` or `INSERT OR REPLACE`, and both are caught by the
	// leading keyword, which is tested below. (`regexp_replace` never matched
	// either way: `_` is a word character, so `\breplace\b` does not fire
	// inside it.)
	forbidden = regexp.MustCompile(`(?is)\b(insert|update|delete|drop|truncate|alter|create|attach|detach|copy|export|import|install|load|pragma|set|reset|call|grant|revoke|vacuum|checkpoint)\b`)

	// tableFunc finds a function-call-shaped table source: an identifier
	// following FROM or JOIN and immediately applied to an argument list.
	tableFunc = regexp.MustCompile(`(?is)\b(?:from|join)\s+([a-z_][a-z0-9_]*)\s*\(`)

	// tableLiteral finds a bare string used as a table source. DuckDB accepts
	// `FROM 'file.csv'` and `FROM 'https://host/x.parquet'` as shorthand for
	// the matching reader — the same escape by another spelling.
	tableLiteral = regexp.MustCompile(`(?is)\b(?:from|join)\s+` + regexp.QuoteMeta(literalMask))

	// anyFunc finds every function call in the statement, wherever it sits.
	// Used only for the configFuncs check below — table sources are handled
	// positionally by tableFunc.
	anyFunc = regexp.MustCompile(`(?is)\b([a-z_][a-z0-9_]*)\s*\(`)
)

// configFuncs are scalar functions that mutate engine configuration.
//
// A denylist is defensible HERE, unlike for readers: this is a closed, rarely
// extended set, and it is belt-and-braces rather than the boundary. DuckDB
// v1.4 has no such function, and the engine independently refuses to change
// `enable_external_access` or re-enable a disabled filesystem once the
// connection is initialised (verified). This exists so that a future engine —
// or a connector whose engine is laxer — cannot quietly undo the lockdown
// through an ordinary SELECT.
var configFuncs = map[string]bool{
	"set_config":  true,
	"pg_settings": true,
}

// allowedTableFuncs are the only function-shaped table sources permitted.
//
// This is an ALLOWLIST by deliberate choice. A denylist of readers must be
// updated every time the engine gains one — the day DuckDB ships `read_avro`,
// a denylist is silently wrong and every deployment is leaking files. These
// three generate rows in memory and perform no I/O; a date spine is a real
// analytical need and none of them can reach outside the process.
var allowedTableFuncs = map[string]bool{
	"generate_series": true,
	"range":           true,
	"unnest":          true,
}

// RejectWrites returns nil only if the statement is a single read-only query
// that reads nothing outside the warehouse.
func RejectWrites(query string) error {
	// Comments and quotes are stripped in ONE pass. Doing comments first is a
	// bug: `WHERE note = 'a -- b'` loses its closing quote and the statement
	// stops parsing. Doing quotes first is also a bug: a quote inside a
	// comment is not a quote. Only a single scanner gets both right.
	//
	// Everything downstream then reasons about SQL structure only, never about
	// the contents of user data — which is what makes `WHERE note = 'drop
	// table'` legal and `WHERE note = 'a;b'` not a stacked statement.
	masked, err := maskQuoted(query)
	if err != nil {
		return err
	}

	masked = strings.TrimSpace(masked)
	if masked == "" {
		return errors.New("empty statement")
	}

	// Reject stacked statements: anything after the first terminating
	// semicolon is a second statement.
	if idx := strings.Index(masked, ";"); idx >= 0 {
		if strings.TrimSpace(masked[idx+1:]) != "" {
			return errors.New("multiple statements are not permitted")
		}
		masked = masked[:idx]
	}

	fields := strings.Fields(masked)
	if len(fields) == 0 {
		return errors.New("empty statement")
	}
	if lead := strings.ToLower(fields[0]); lead != "select" && lead != "with" {
		return ErrWriteAttempt
	}
	if forbidden.MatchString(masked) {
		return ErrWriteAttempt
	}

	// A string literal standing where a table belongs is DuckDB's shorthand
	// for the matching reader: FROM 'x.csv' reads a file, FROM 'https://…'
	// fetches a URL.
	if tableLiteral.MatchString(masked) {
		return fmt.Errorf("%w: a file or URL cannot be used as a table", ErrExternalRead)
	}

	for _, m := range anyFunc.FindAllStringSubmatch(masked, -1) {
		if configFuncs[strings.ToLower(m[1])] {
			return fmt.Errorf("%w: %s() changes engine configuration", ErrWriteAttempt, m[1])
		}
	}

	for _, m := range tableFunc.FindAllStringSubmatch(masked, -1) {
		name := strings.ToLower(m[1])
		if !allowedTableFuncs[name] {
			return fmt.Errorf("%w: table function %s() is not allowed", ErrExternalRead, name)
		}
	}
	return nil
}

// maskQuoted replaces the contents of quoted regions with inert placeholders,
// leaving all other structure intact.
//
// Handles the three quoting forms DuckDB accepts:
//
//	'text'            string literal, '' escapes a quote
//	"ident"           quoted identifier, "" escapes a quote
//	$tag$ text $tag$  dollar-quoted string, no escaping inside
//
// An unterminated quote is an error rather than a silent pass: a statement we
// cannot tokenize is a statement we cannot vouch for.
func maskQuoted(s string) (string, error) {
	var b strings.Builder
	b.Grow(len(s))

	for i := 0; i < len(s); {
		switch c := s[i]; {
		case c == '-' && i+1 < len(s) && s[i+1] == '-':
			// Line comment: runs to end of line.
			j := i + 2
			for j < len(s) && s[j] != '\n' {
				j++
			}
			b.WriteByte(' ')
			i = j

		case c == '/' && i+1 < len(s) && s[i+1] == '*':
			// Block comment. Unterminated is an error: the rest of the
			// statement would otherwise vanish and a stacked write with it.
			k := strings.Index(s[i+2:], "*/")
			if k < 0 {
				return "", errors.New("unterminated block comment")
			}
			b.WriteByte(' ')
			i = i + 2 + k + 2

		case c == '\'':
			j := i + 1
			for j < len(s) {
				if s[j] == '\'' {
					if j+1 < len(s) && s[j+1] == '\'' { // '' escape
						j += 2
						continue
					}
					break
				}
				j++
			}
			if j >= len(s) {
				return "", errors.New("unterminated string literal")
			}
			b.WriteString(literalMask)
			i = j + 1

		case c == '"':
			j := i + 1
			for j < len(s) {
				if s[j] == '"' {
					if j+1 < len(s) && s[j+1] == '"' { // "" escape
						j += 2
						continue
					}
					break
				}
				j++
			}
			if j >= len(s) {
				return "", errors.New("unterminated quoted identifier")
			}
			// A quoted identifier is a NAME. Emit a neutral token so
			// `SELECT "insert"` reads as an identifier, not the keyword.
			b.WriteString("ident")
			i = j + 1

		case c == '$':
			if end, ok := dollarQuote(s, i); ok {
				b.WriteString(literalMask)
				i = end
				continue
			}
			b.WriteByte(c)
			i++

		default:
			b.WriteByte(c)
			i++
		}
	}
	return b.String(), nil
}

// dollarQuote matches $tag$ … $tag$ starting at i, returning the index just
// past the closing delimiter.
func dollarQuote(s string, i int) (int, bool) {
	j := i + 1
	for j < len(s) && (s[j] == '_' || isAlphaNum(s[j])) {
		j++
	}
	if j >= len(s) || s[j] != '$' {
		return 0, false
	}
	delim := s[i : j+1] // includes both $ signs
	rest := s[j+1:]
	k := strings.Index(rest, delim)
	if k < 0 {
		// Unterminated: treat as not-a-quote so the keyword scanner still
		// sees the raw text rather than swallowing the tail of the statement.
		return 0, false
	}
	return j + 1 + k + len(delim), true
}

func isAlphaNum(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

// quoteIdent double-quotes an identifier, escaping embedded quotes.
func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// QuoteLiteral single-quotes a string literal for safe embedding in generated
// probe queries.
func QuoteLiteral(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `''`) + `'`
}

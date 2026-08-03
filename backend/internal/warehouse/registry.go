package warehouse

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Factory opens one connector against a resolved DSN.
//
// The DSN a factory receives has already had ${ENV_VAR} references expanded
// (see ResolveDSN), so a connector never handles interpolation itself and can
// never accidentally persist a resolved secret.
type Factory func(dsn string, opts Options) (Connector, error)

// Options are the operator-set ceilings every connector must honour.
//
// These exist because verification runs every query TWICE by design: the
// primary derivation and an independent cross-derivation. Against a local
// DuckDB file that is free; against a metered warehouse it doubles the bill.
// A connector that ignores these is a connector that surprises someone's
// finance team.
type Options struct {
	// MaxRows caps materialization. Zero means the connector's own default.
	MaxRows int
	// MaxBytes caps bytes scanned where the engine can enforce it. Zero means
	// unlimited — engines that cannot enforce it should say so in their docs
	// rather than pretend.
	MaxBytes int64
	// Timeout bounds a single query. Zero means no connector-level timeout;
	// the caller's context still applies.
	Timeout time.Duration
}

var (
	registryMu sync.RWMutex
	registry   = map[string]Factory{}
)

// Register makes a connector kind available to Open.
//
// Called from a connector's init(). Adding an engine is therefore one new file
// plus one Register call — nothing in sources/, api/ or ask/ needs editing.
// A duplicate registration is a programming error, not a runtime condition.
func Register(kind string, f Factory) {
	registryMu.Lock()
	defer registryMu.Unlock()
	if kind == "" {
		panic("warehouse: Register called with an empty kind")
	}
	if f == nil {
		panic("warehouse: Register called with a nil factory for " + kind)
	}
	if _, dup := registry[kind]; dup {
		panic("warehouse: connector kind registered twice: " + kind)
	}
	registry[kind] = f
}

// Registered lists the connector kinds this build supports, sorted.
func Registered() []string {
	registryMu.RLock()
	defer registryMu.RUnlock()
	kinds := make([]string, 0, len(registry))
	for k := range registry {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	return kinds
}

// Open resolves the DSN and constructs the connector for a kind.
//
// Errors never carry the resolved DSN. A failed Postgres connection would
// otherwise put the password into a log line, an API error body, and the SSE
// stream — three places it must never reach.
func Open(kind, dsn string, opts Options) (Connector, error) {
	registryMu.RLock()
	f, ok := registry[kind]
	registryMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("source kind %q is not supported by this build; registered kinds: %s",
			kind, strings.Join(Registered(), ", "))
	}

	resolved, err := ResolveDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s source: %w", kind, err)
	}

	conn, err := f(resolved, opts)
	if err != nil {
		return nil, fmt.Errorf("open %s source %s: %w", kind, RedactDSN(dsn), err)
	}
	return conn, nil
}

// ---------------------------------------------------------------- DSN secrets

// envRef matches a ${VAR} reference.
var envRef = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// ResolveDSN expands ${ENV_VAR} references at connect time.
//
// The point is what is NOT done: the expanded string is never returned to the
// caller for storage, never logged, and never persisted. The stored DSN keeps
// the literal `${PG_PASSWORD}`, so the SQLite file — which this product will
// happily let you query — holds a reference rather than a credential.
//
// An unset variable is an error rather than an empty expansion. Silently
// connecting with a blank password produces a confusing auth failure several
// layers away from the actual mistake.
func ResolveDSN(dsn string) (string, error) {
	var missing []string
	out := envRef.ReplaceAllStringFunc(dsn, func(m string) string {
		name := envRef.FindStringSubmatch(m)[1]
		v, ok := os.LookupEnv(name)
		if !ok {
			missing = append(missing, name)
			return m
		}
		return v
	})
	if len(missing) > 0 {
		return "", fmt.Errorf("DSN references unset environment %s: %s",
			plural(len(missing), "variable"), strings.Join(missing, ", "))
	}
	return out, nil
}

// RedactDSN renders a DSN safe to log.
//
// Two jobs. Any ${VAR} reference is kept verbatim — it names a secret without
// being one, and seeing it is how an operator debugs a misconfiguration. Any
// literal credential embedded in the DSN is masked, because people paste those
// in despite the guidance.
func RedactDSN(dsn string) string {
	if dsn == "" {
		return ""
	}
	out := dsn

	// scheme://user:password@host -> scheme://user:***@host
	// user:password@host        -> user:***@host        (gosnowflake shape)
	//
	// The scheme-less form matters: Snowflake DSNs carry credentials with no
	// scheme at all, and this function once looked only for "://" — so a
	// literal password in a Snowflake DSN survived redaction into logs and
	// error bodies. Caught by the connector's own tests before it shipped.
	//
	// A ${VAR} in the password position is left alone: it names a secret
	// without being one, and it is the single most useful thing in the string
	// when someone is debugging why a source will not connect.
	credStart := 0
	if i := strings.Index(out, "://"); i >= 0 {
		credStart = i + 3
	}
	rest := out[credStart:]
	if at := strings.LastIndex(rest, "@"); at > 0 {
		cred := rest[:at]
		// Only a plausible credential block: no '/' (a path) and no space.
		if !strings.ContainsAny(cred, "/ ") {
			if c := strings.Index(cred, ":"); c >= 0 && !envRef.MatchString(cred[c+1:]) {
				masked := cred[:c+1] + "***"
				out = out[:credStart] + masked + rest[at:]
			}
		}
	}

	// key=value pairs: password=..., pwd=..., secret=..., token=..., api_key=...
	for _, key := range []string{"password", "passwd", "pwd", "secret", "token", "api_key", "apikey"} {
		out = maskKeyValue(out, key)
	}
	return out
}

// maskKeyValue masks `key=value` wherever it appears, leaving ${VAR}
// references legible because they disclose nothing.
func maskKeyValue(s, key string) string {
	re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(key) + `\s*=\s*([^\s;&]+)`)
	return re.ReplaceAllStringFunc(s, func(m string) string {
		val := re.FindStringSubmatch(m)[1]
		if envRef.MatchString(val) {
			return m
		}
		eq := strings.Index(m, "=")
		return m[:eq+1] + "***"
	})
}

func plural(n int, noun string) string {
	if n == 1 {
		return noun
	}
	return noun + "s"
}

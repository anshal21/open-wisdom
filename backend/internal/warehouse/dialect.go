package warehouse

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Dialect is the SQL flavour a connector speaks AND what the planner may
// safely use when writing for it.
//
// It used to be a bare string. That is enough to say "write Postgres SQL" and
// not enough for anything else: the planner also emits window functions, CTEs
// and quantiles, and a connector for an engine lacking them would produce SQL
// that fails at execution time with a syntax error the model then tries to
// "fix" by guessing. Capabilities are declared so the prompt can constrain
// generation instead of discovering the limit by crashing into it.
//
// A capability set is a promise about the ENGINE, not about the connector's
// effort. Declaring something you do not support produces failing queries at
// answer time; declaring less than you support only costs a little SQL
// elegance. When unsure, declare less.
type Dialect struct {
	// Name is the flavour identifier used in prompts: "duckdb", "postgres".
	Name string `json:"name"`

	// CTEs — WITH ... AS (...). Without this the planner must inline
	// subqueries, which it can do, so this is the cheapest one to say no to.
	CTEs bool `json:"ctes"`

	// WindowFunctions — OVER (PARTITION BY ...). Running totals, rank, lag.
	WindowFunctions bool `json:"window_functions"`

	// Qualify — QUALIFY row_number() OVER (...) = 1. Syntactic sugar that
	// only DuckDB, Snowflake, BigQuery and Teradata have; its absence means
	// the planner wraps in a subquery instead.
	Qualify bool `json:"qualify"`

	// ApproxQuantiles — approx_quantile / percentile_disc and friends.
	ApproxQuantiles bool `json:"approx_quantiles"`

	// ILike — case-insensitive LIKE. Without it the planner must write
	// LOWER(x) LIKE LOWER(y), which defeats an index but is portable.
	ILike bool `json:"ilike"`

	// Metered marks engines that bill per query or per byte scanned.
	//
	// Verification runs every query twice by design, so this is not a cost
	// footnote: it doubles a metered bill. Surfaces may use it to warn before
	// running, and it is why Options carries ceilings.
	Metered bool `json:"metered"`
}

// String satisfies fmt.Stringer so a Dialect can be logged or formatted with
// %s wherever the old bare string was.
func (d Dialect) String() string { return d.Name }

// PromptLine renders the dialect as one line of prompt context.
//
// Only ABSENT capabilities are listed. A planner prompt is finite attention;
// enumerating what an engine can do is noise it already assumes, while
// enumerating what it cannot do is the constraint that changes the output.
func (d Dialect) PromptLine() string {
	var missing []string
	if !d.CTEs {
		missing = append(missing, "no CTEs (WITH) — inline subqueries instead")
	}
	if !d.WindowFunctions {
		missing = append(missing, "no window functions (OVER)")
	}
	if !d.Qualify {
		missing = append(missing, "no QUALIFY — filter window results in an outer query")
	}
	if !d.ApproxQuantiles {
		missing = append(missing, "no approximate quantile functions")
	}
	if !d.ILike {
		missing = append(missing, "no ILIKE — use LOWER() on both sides")
	}

	name := d.Name
	if name == "" {
		name = "unknown"
	}
	if len(missing) == 0 {
		return fmt.Sprintf("Dialect: %s", name)
	}
	return fmt.Sprintf("Dialect: %s\nEngine limits (do not use these): %s",
		name, strings.Join(missing, "; "))
}

// UnmarshalJSON accepts both the current object form and the legacy bare
// string.
//
// Catalogs are cached as JSON in SQLite. Every catalog written before
// capabilities existed holds `"dialect": "duckdb"`, and rejecting those would
// make every source appear un-introspected until someone re-ran introspection
// by hand. A legacy value decodes to the name with all capabilities false,
// which is the safe reading: the planner writes conservative SQL until the
// source is re-introspected and the connector states otherwise.
func (d *Dialect) UnmarshalJSON(b []byte) error {
	var name string
	if err := json.Unmarshal(b, &name); err == nil {
		d.Name = name
		return nil
	}
	type alias Dialect // avoid recursing into this method
	var a alias
	if err := json.Unmarshal(b, &a); err != nil {
		return fmt.Errorf("decode dialect: %w", err)
	}
	*d = Dialect(a)
	return nil
}

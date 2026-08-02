package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Parser is implemented by connectors that can expose the engine's own parse
// tree. Using the engine's parser avoids a second, divergent SQL grammar.
//
// Declared here (at the consumer) rather than in the warehouse package.
type Parser interface {
	ParseSQL(ctx context.Context, sql string) (string, error)
}

// Query is the structural summary of a statement that the checks operate on.
type Query struct {
	Tables    []TableRef      `json:"tables"`
	Predicates []Predicate    `json:"predicates"`
	JoinCount int             `json:"join_count"`
	// Aggregates present tells the grain check whether row multiplication
	// would actually corrupt the result.
	Aggregates []string       `json:"aggregates"`
	HasDistinct bool          `json:"has_distinct"`
	// JoinKeys are column-to-column equalities: the edges the fan-out and
	// join-loss probes walk.
	JoinKeys []JoinKey `json:"join_keys"`
	// AggregatedColumns are the columns passed to aggregate functions.
	AggregatedColumns []ColumnRef `json:"aggregated_columns"`
}

// ColumnRef is a possibly-qualified column mention.
type ColumnRef struct {
	Qualifier string `json:"qualifier,omitempty"`
	Column    string `json:"column"`
}

// JoinKey is an equality between two qualified columns.
type JoinKey struct {
	LeftQualifier  string `json:"left_qualifier"`
	LeftColumn     string `json:"left_column"`
	RightQualifier string `json:"right_qualifier"`
	RightColumn    string `json:"right_column"`
}

// TableRef is one base table referenced by the statement.
type TableRef struct {
	Schema string `json:"schema,omitempty"`
	Name   string `json:"name"`
	Alias  string `json:"alias,omitempty"`
}

// Predicate is a comparison between a column and one or more literal values.
type Predicate struct {
	// Qualifier is the table alias or name when written as a.b; may be empty.
	Qualifier string   `json:"qualifier,omitempty"`
	Column    string   `json:"column"`
	Operator  string   `json:"operator"`
	Literals  []string `json:"literals"`
	// LiteralType is the DuckDB type id of the literals (VARCHAR, DATE, ...).
	LiteralType string `json:"literal_type,omitempty"`
}

// ParseQuery extracts the structural summary using the engine's parser.
func ParseQuery(ctx context.Context, p Parser, sql string) (*Query, error) {
	raw, err := p.ParseSQL(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("parse sql: %w", err)
	}
	var tree any
	if err := json.Unmarshal([]byte(raw), &tree); err != nil {
		return nil, fmt.Errorf("decode parse tree: %w", err)
	}
	q := &Query{}
	walk(tree, q)
	return q, nil
}

// comparisonOps maps DuckDB expression type ids to a readable operator.
var comparisonOps = map[string]string{
	"COMPARE_EQUAL":        "=",
	"COMPARE_NOTEQUAL":     "<>",
	"COMPARE_NOT_EQUAL":    "<>",
	"COMPARE_LESSTHAN":     "<",
	"COMPARE_GREATERTHAN":  ">",
	"COMPARE_LESSTHANOREQUALTO":    "<=",
	"COMPARE_GREATERTHANOREQUALTO": ">=",
	"COMPARE_IN":           "IN",
	"COMPARE_NOT_IN":       "NOT IN",
	"OPERATOR_IN":          "IN",
	"OPERATOR_NOT_IN":      "NOT IN",
}

func walk(n any, q *Query) {
	switch v := n.(type) {
	case map[string]any:
		typ, _ := v["type"].(string)
		switch {
		case typ == "BASE_TABLE":
			q.Tables = append(q.Tables, TableRef{
				Schema: str(v["schema_name"]),
				Name:   str(v["table_name"]),
				Alias:  str(v["alias"]),
			})
		case typ == "JOIN":
			q.JoinCount++
		case typ == "FUNCTION":
			if name := str(v["function_name"]); name != "" {
				if isAggregate(name) {
					q.Aggregates = append(q.Aggregates, name)
					// Record which columns are being aggregated. Fan-out only
					// corrupts a result when the aggregated column lives on the
					// "one" side of a one-to-many join.
					for _, ref := range columnRefsIn(v) {
						q.AggregatedColumns = append(q.AggregatedColumns, ref)
					}
				}
				if d, ok := v["distinct"].(bool); ok && d {
					q.HasDistinct = true
				}
			}
		default:
			if op, ok := comparisonOps[typ]; ok {
				if p, ok := predicateFrom(v, op); ok {
					q.Predicates = append(q.Predicates, p)
				} else if op == "=" {
					if jk, ok := joinKeyFrom(v); ok {
						q.JoinKeys = append(q.JoinKeys, jk)
					}
				}
			}
		}
		for _, child := range v {
			walk(child, q)
		}
	case []any:
		for _, child := range v {
			walk(child, q)
		}
	}
}

// predicateFrom builds a Predicate when the node compares a column reference to
// one or more constants. Comparisons between two columns are not interesting to
// the filter check and are skipped.
func predicateFrom(node map[string]any, op string) (Predicate, bool) {
	children := operands(node)
	if len(children) < 2 {
		return Predicate{}, false
	}
	var p Predicate
	p.Operator = op

	first, _ := children[0].(map[string]any)
	if str(first["type"]) != "COLUMN_REF" {
		return Predicate{}, false
	}
	names := stringSlice(first["column_names"])
	switch len(names) {
	case 0:
		return Predicate{}, false
	case 1:
		p.Column = names[0]
	default:
		p.Qualifier = strings.Join(names[:len(names)-1], ".")
		p.Column = names[len(names)-1]
	}

	for _, c := range children[1:] {
		cm, _ := c.(map[string]any)
		if str(cm["type"]) != "VALUE_CONSTANT" {
			continue
		}
		val, _ := cm["value"].(map[string]any)
		if val == nil {
			continue
		}
		if isNull, ok := val["is_null"].(bool); ok && isNull {
			continue
		}
		if t, ok := val["type"].(map[string]any); ok {
			p.LiteralType = str(t["id"])
		}
		p.Literals = append(p.Literals, fmt.Sprint(val["value"]))
	}
	if len(p.Literals) == 0 {
		return Predicate{}, false
	}
	return p, true
}

// joinKeyFrom recognizes a column-to-column equality, which is a join edge
// rather than a value filter.
func joinKeyFrom(node map[string]any) (JoinKey, bool) {
	children := operands(node)
	if len(children) != 2 {
		return JoinKey{}, false
	}
	l, _ := children[0].(map[string]any)
	r, _ := children[1].(map[string]any)
	if str(l["type"]) != "COLUMN_REF" || str(r["type"]) != "COLUMN_REF" {
		return JoinKey{}, false
	}
	ln, rn := stringSlice(l["column_names"]), stringSlice(r["column_names"])
	if len(ln) < 2 || len(rn) < 2 {
		return JoinKey{}, false // unqualified: cannot attribute to a table
	}
	return JoinKey{
		LeftQualifier:  strings.Join(ln[:len(ln)-1], "."),
		LeftColumn:     ln[len(ln)-1],
		RightQualifier: strings.Join(rn[:len(rn)-1], "."),
		RightColumn:    rn[len(rn)-1],
	}, true
}

// columnRefsIn collects every column reference beneath a node.
func columnRefsIn(node any) []ColumnRef {
	var out []ColumnRef
	var rec func(any)
	rec = func(n any) {
		switch v := n.(type) {
		case map[string]any:
			if str(v["type"]) == "COLUMN_REF" {
				names := stringSlice(v["column_names"])
				switch len(names) {
				case 0:
				case 1:
					out = append(out, ColumnRef{Column: names[0]})
				default:
					out = append(out, ColumnRef{
						Qualifier: strings.Join(names[:len(names)-1], "."),
						Column:    names[len(names)-1],
					})
				}
			}
			for _, c := range v {
				rec(c)
			}
		case []any:
			for _, c := range v {
				rec(c)
			}
		}
	}
	rec(node)
	return out
}

// operands normalizes the two node shapes DuckDB emits: COMPARISON-class nodes
// carry left/right, while OPERATOR-class nodes (IN, NOT IN) carry children.
func operands(node map[string]any) []any {
	if c, ok := node["children"].([]any); ok && len(c) > 0 {
		return c
	}
	l, lok := node["left"]
	r, rok := node["right"]
	if lok && rok {
		return []any{l, r}
	}
	return nil
}

func isAggregate(name string) bool {
	switch strings.ToLower(name) {
	case "sum", "count", "avg", "min", "max", "median", "stddev", "var_pop",
		"count_star", "array_agg", "string_agg", "approx_count_distinct":
		return true
	}
	return false
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func stringSlice(v any) []string {
	arr, _ := v.([]any)
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

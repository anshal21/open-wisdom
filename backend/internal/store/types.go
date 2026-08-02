package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

// ID generates an opaque, prefixed identifier. Callers must never parse these.
func ID(prefix string) string {
	var b [8]byte
	rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// ---------------------------------------------------------------- context

// Context is the editable chip set that scopes a question. It is carried on the
// thread so a follow-up inherits it without restating anything.
type Context struct {
	TimeRange    *TimeRange `json:"time_range,omitempty"`
	Filters      []Filter   `json:"filters,omitempty"`
	Grain        string     `json:"grain,omitempty"`
	DefinitionID string     `json:"definition_id,omitempty"`
}

type TimeRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type Filter struct {
	Column   string `json:"column"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}

// ---------------------------------------------------------------- answers

// ChartSpec tells the client how to render a result. It is derived from the
// result's shape, never guessed by a model.
type ChartSpec struct {
	Type       string            `json:"type"`
	X          *ChartField       `json:"x,omitempty"`
	Y          []ChartField      `json:"y,omitempty"`
	Series     *ChartField       `json:"series"`
	Coverage   *ChartCoverage    `json:"coverage,omitempty"`
	Confidence verify.Confidence `json:"confidence"`
}

type ChartField struct {
	Field string `json:"field"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

type ChartCoverage struct {
	IncludedRows int64  `json:"included_rows"`
	ExcludedRows int64  `json:"excluded_rows"`
	Reason       string `json:"reason"`
}

// ResultColumn is one output column with the semantic type every renderer
// keys on: charts pick axes by it, tables align by it, and a bare column name
// carries neither. This is why answers store typed columns, not name strings.
type ResultColumn struct {
	Name  string `json:"name"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

// Cost is the honest accounting attached to every answer.
type Cost struct {
	LLMCalls  int     `json:"llm_calls"`
	USD       float64 `json:"usd"`
	ElapsedMS int64   `json:"elapsed_ms"`
}

// DefinitionRef is the minimal reference embedded in an interpretation.
type DefinitionRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Candidate is one defensible reading of an ambiguous question, with the value
// it actually produces. The value is measured, never estimated.
type Candidate struct {
	ID                  string  `json:"id"`
	Label               string  `json:"label"`
	Description         string  `json:"description"`
	Value               float64 `json:"value"`
	SQL                 string  `json:"sql"`
	Recommended         bool    `json:"recommended"`
	RecommendationBasis string  `json:"recommendation_basis"`
}

// Spread quantifies how far apart the candidate readings are. This is the
// evidence that justifies refusing rather than guessing.
type Spread struct {
	Ratio     float64 `json:"ratio"`
	Min       float64 `json:"min"`
	Max       float64 `json:"max"`
	LogScaled bool    `json:"log_scaled"`
}

// Ambiguity is the terminal refusal payload.
type Ambiguity struct {
	Question string `json:"question"`
	// Term is the contested word the refusal is about — the name a ratified
	// definition born from this refusal should carry.
	Term       string      `json:"term,omitempty"`
	Reason     string      `json:"reason"`
	Candidates []Candidate `json:"candidates"`
	Spread     Spread      `json:"spread"`
}

// Answer is the ledger record: everything needed to explain, audit, re-run, or
// invalidate a number long after the conversation ended.
type Answer struct {
	ID          string   `json:"id"`
	ThreadID    string   `json:"thread_id,omitempty"`
	SourceID    string   `json:"source_id,omitempty"`
	Question    string   `json:"question"`
	Restated    string   `json:"restated,omitempty"`
	Assumptions []string `json:"assumptions,omitempty"`

	Value      *float64          `json:"value"`
	Unit       string            `json:"unit,omitempty"`
	FormatHint string            `json:"format_hint,omitempty"`
	Columns    []ResultColumn    `json:"columns,omitempty"`
	Rows       [][]any           `json:"rows,omitempty"`
	RowCount   int               `json:"row_count"`
	SQL        string            `json:"sql,omitempty"`
	AltSQL     string            `json:"alt_sql,omitempty"`
	Report     *verify.Report    `json:"report,omitempty"`
	Chart      *ChartSpec        `json:"chart,omitempty"`
	Ambiguity  *Ambiguity        `json:"ambiguity,omitempty"`
	Narrative  string            `json:"narrative,omitempty"`
	Confidence verify.Confidence `json:"confidence"`

	DefinitionUsed *DefinitionRef `json:"definition_used,omitempty"`
	// Flags are human corrections, populated on single-answer reads.
	Flags []Flag `json:"flags,omitempty"`
	CreatedBy      string         `json:"created_by,omitempty"`
	CreatedAt      string         `json:"created_at"`
	Cost           *Cost          `json:"cost,omitempty"`
	RerunOf        string         `json:"rerun_of,omitempty"`
	// QuestionKey groups semantically equivalent questions so the ledger can
	// flag "answered two ways".
	QuestionKey string `json:"question_key,omitempty"`
	// Runs is the re-run lineage this answer belongs to, oldest first.
	// Populated on single-answer reads only — the list projection would pay a
	// recursive walk per row for something no list surface renders.
	Runs []AnswerRun `json:"runs,omitempty"`
}

// AnswerRun is one measurement in a re-run lineage.
//
// Re-running a question does not overwrite the old answer; it writes a new one
// that points back at its predecessor. The lineage is therefore the record of
// how a number moved over time, which is the thing that makes "this figure
// changed" auditable rather than merely surprising.
type AnswerRun struct {
	ID         string            `json:"id"`
	Run        int               `json:"run"`
	Value      *float64          `json:"value"`
	Confidence verify.Confidence `json:"confidence"`
	CreatedAt  string            `json:"created_at"`
	// Current marks the newest run in the lineage — the figure that stands now.
	Current bool `json:"current"`
}

// AnswerSummary is the list projection.
type AnswerSummary struct {
	ID         string            `json:"id"`
	Question   string            `json:"question"`
	Value      *float64          `json:"value"`
	Unit       string            `json:"unit,omitempty"`
	FormatHint string            `json:"format_hint,omitempty"`
	Confidence verify.Confidence `json:"confidence"`
	RowCount   int               `json:"row_count"`
	CreatedBy  string            `json:"created_by,omitempty"`
	CreatedAt  string            `json:"created_at"`
}

// NormalizeQuestion produces the grouping key for equivalent questions. It is
// deliberately crude: lowercase, collapse whitespace, strip terminal
// punctuation. Over-grouping is visible to a user; under-grouping is silent.
func NormalizeQuestion(q string) string {
	s := strings.ToLower(strings.TrimSpace(q))
	s = strings.Trim(s, "?.!")
	return strings.Join(strings.Fields(s), " ")
}

// NormalizeSQL produces the equivalence key for executed statements: lowercase
// with collapsed whitespace and no trailing semicolon. Two questions whose
// statements normalize identically got the same answer from the warehouse by
// definition.
func NormalizeSQL(sql string) string {
	s := strings.ToLower(strings.TrimSpace(sql))
	s = strings.TrimSuffix(s, ";")
	return strings.Join(strings.Fields(s), " ")
}

// ---------------------------------------------------------------- threads

type Thread struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	SourceID    string   `json:"source_id,omitempty"`
	Turns       []Turn   `json:"turns,omitempty"`
	Context     *Context `json:"context,omitempty"`
	UpdatedAt   string   `json:"updated_at"`
	AnswerCount int      `json:"answer_count"`
}

type Turn struct {
	Question  string `json:"question"`
	AnswerID  string `json:"answer_id"`
	CreatedAt string `json:"created_at"`
}

// ---------------------------------------------------------------- definitions

type Definition struct {
	ID             string `json:"id"`
	LineageID      string `json:"-"`
	Name           string `json:"name"`
	PlainEnglish   string `json:"plain_english"`
	Expression     string `json:"expression,omitempty"`
	Version        int    `json:"version"`
	Status         string `json:"status"`
	RatifiedBy     string `json:"ratified_by,omitempty"`
	RatifiedAt     string `json:"ratified_at,omitempty"`
	SourceAnswerID string `json:"source_answer_id,omitempty"`
	UsageCount     int    `json:"usage_count"`
	// Confidence is derived from Status at read time, never stored: one datum,
	// one source. It exists so every surface renders a definition's standing
	// without re-deriving the mapping.
	Confidence string `json:"confidence"`
	UpdatedAt  string `json:"updated_at"`
}

const (
	DefRatified   = "ratified"
	DefProposed   = "proposed"
	DefSuperseded = "superseded"
)

// ---------------------------------------------------------------- dashboards

type Dashboard struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Tiles []Tile `json:"tiles"`
	// TileCount is populated on list reads, where tiles themselves are not.
	TileCount int `json:"tile_count"`
}

type Tile struct {
	// Grid geometry in 12-column units. -1 x/y means "not yet placed by a
	// human" — the client derives a position from the legacy order fields
	// and the first layout save makes it explicit.
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
	// Viz is the user's chart override for this tile, opaque to the backend:
	// a tile is an editorial surface, so the choice survives reload.
	Viz json.RawMessage `json:"viz,omitempty"`
	ID       string `json:"id,omitempty"`
	AnswerID string `json:"answer_id"`
	Position int    `json:"position"`
	Size     string `json:"size"`
}

// ---------------------------------------------------------------- notebooks

type Notebook struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	SourceID string `json:"source_id,omitempty"`
	Cells    []Cell `json:"cells"`
	// CellCount serves the list surface, which needs the size without paying
	// for every cell body. Zero on a Get, where Cells carries the truth.
	CellCount int    `json:"cell_count"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type Cell struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Source string `json:"source"`
	Output any    `json:"output"`
	// Seq is the cell's position in the stack, exposed because ordering is
	// part of a notebook's meaning: the client renders and reorders by it.
	Seq        int               `json:"seq"`
	Confidence verify.Confidence `json:"confidence"`
	UpdatedAt  string            `json:"updated_at"`
}

// ---------------------------------------------------------------- monitoring

type Watch struct {
	ID           string    `json:"id"`
	DefinitionID string    `json:"definition_id"`
	Schedule     string    `json:"schedule"`
	Condition    Condition `json:"condition"`
	CreatedAt    string    `json:"created_at"`
	// SnoozedUntil suppresses firing up to an RFC3339 instant. Empty means the
	// watch is live. Stored rather than derived: a snooze is a decision a
	// person made, not a fact about the data.
	SnoozedUntil string `json:"snoozed_until,omitempty"`
	// Derived at read time from joins — never stored, so they cannot drift.
	DefinitionName string `json:"definition_name,omitempty"`
	LastFiredAt    string `json:"last_fired_at,omitempty"`
	Status         string `json:"status,omitempty"`
}

type Condition struct {
	Kind  string  `json:"kind"`
	Value float64 `json:"value"`
}

type WatchEvent struct {
	ID              string  `json:"id"`
	FiredAt         string  `json:"fired_at"`
	Value           float64 `json:"value"`
	Previous        float64 `json:"previous"`
	InvestigationID string  `json:"investigation_id,omitempty"`
}

// ---------------------------------------------------------------- sources

type Source struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Kind               string `json:"kind"`
	DSN                string `json:"-"`
	Status             string `json:"status"`
	TableCount         int    `json:"table_count"`
	LastIntrospectedAt string `json:"last_introspected_at,omitempty"`
}

// ---------------------------------------------------------------- users

type User struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

// ---------------------------------------------------------------- settings

// Settings are global and singular. Defaults are meaningful: balanced speed and
// standard strictness produce the latency the product promises.
type Settings struct {
	ModelSpeed             string  `json:"model_speed"`
	VerificationStrictness string  `json:"verification_strictness"`
	DefaultSourceID        string  `json:"default_source_id,omitempty"`
	AmbiguitySpreadRatio   float64 `json:"ambiguity_spread_ratio"`
	DemoMode               bool    `json:"demo_mode"`

	WorkspaceName string        `json:"workspace_name"`
	Timezone      string        `json:"timezone"`
	CheckPolicy   []CheckPolicy `json:"check_policy"`
}

// CheckPolicy is one check's standing in this workspace: required checks gate
// the seal, advisory ones inform, off ones are not run.
type CheckPolicy struct {
	ID            string   `json:"id"`
	Label         string   `json:"label"`
	Description   string   `json:"description"`
	Mode          string   `json:"mode"`
	Threshold     *float64 `json:"threshold"`
	ThresholdUnit *string  `json:"threshold_unit"`
}

func DefaultSettings() Settings {
	return Settings{
		ModelSpeed:             "balanced",
		VerificationStrictness: "standard",
		AmbiguitySpreadRatio:   1.15,
		DemoMode:               true,
		WorkspaceName:          "Workspace",
		// The warehouse session is pinned to UTC; the workspace default says so
		// rather than pretending a local zone it does not use.
		Timezone:    "UTC",
		CheckPolicy: DefaultCheckPolicy(),
	}
}

// DefaultCheckPolicy lists every check the engine runs, all required: the
// product's stance is that verification is the default, not an upsell.
func DefaultCheckPolicy() []CheckPolicy {
	mk := func(id, label, desc string) CheckPolicy {
		return CheckPolicy{ID: id, Label: label, Description: desc, Mode: "required"}
	}
	return []CheckPolicy{
		mk("cross_derivation", "Computed a second way", "An independent derivation must agree with the primary figure."),
		mk("join_loss", "No rows lost in joins", "Inner joins must not silently drop a material share of rows."),
		mk("fan_out", "No rows double-counted", "Joins must not multiply rows into an aggregate."),
		mk("period_normalization", "Fair time comparison", "Unequal-length periods report per-day rates alongside raw deltas."),
		mk("filter_sensitivity", "Filters match real values", "String filters must match values that exist in the data."),
		mk("definition_source", "Uses a ratified definition", "Answers say whether a human-ratified definition covered them."),
		mk("grain", "Aggregation is valid at this grain", "Each row is counted once at the level the question implies."),
		mk("coverage", "Data covers the whole question", "The rows behind the answer are accounted for."),
		mk("freshness", "Data is current", "The answer states how recent the underlying data is."),
		mk("precedent", "Consistent with past answers", "Equivalent past answers are compared, and divergence is flagged."),
	}
}

// ---------------------------------------------------------------- investigations

type Investigation struct {
	ID               string         `json:"id"`
	Metric           string         `json:"metric"`
	DefinitionID     string         `json:"definition_id,omitempty"`
	SourceID         string         `json:"source_id,omitempty"`
	Period           string         `json:"period"`
	ComparisonPeriod string         `json:"comparison_period"`
	StoppedAt        string         `json:"stopped_at,omitempty"`
	RuleOuts         []RuleOut      `json:"ruleouts"`
	Drivers          []Driver       `json:"drivers"`
	Waterfall        *Waterfall     `json:"waterfall,omitempty"`
	Narrative        string         `json:"narrative,omitempty"`
	Verdict          *verify.Report `json:"verdict,omitempty"`
	CreatedAt        string         `json:"created_at"`
}

type RuleOut struct {
	Kind    string `json:"kind"`
	Status  string `json:"status"`
	Finding string `json:"finding"`
}

type Driver struct {
	Segment      string  `json:"segment"`
	Contribution float64 `json:"contribution"`
	Kind         string  `json:"kind"`
}

type Waterfall struct {
	Bars        []WaterfallBar `json:"bars"`
	Unexplained float64        `json:"unexplained"`
}

type WaterfallBar struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

// ---------------------------------------------------------------- json helpers

func mustJSON(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

func fromJSON[T any](s string) *T {
	// A stored JSON "null" is an absent value, not a zero struct: decoding it
	// into &out leaves the zero value, and returning that resurrects a phantom
	// object — an answer that was never refused suddenly carries an empty
	// refusal payload.
	if t := strings.TrimSpace(s); t == "" || t == "null" {
		return nil
	}
	var out T
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return &out
}

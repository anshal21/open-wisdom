// Package ask implements the question-to-verified-answer pipeline.
//
// Two things shape every decision here. First, the answer must arrive in under
// twenty seconds, because latency is a competitive axis and a slow verified
// answer loses to a fast wrong one. Second, the number must never be presented
// when the question had materially different defensible readings — the
// signature failure of this product category is confident wrongness, and the
// only cure is to measure each reading and refuse.
//
// Those two pull against each other, and the resolution is concurrency: the
// primary derivation and the independent cross-derivation are issued at the
// same instant, and the result is streamed before verification finishes.
package ask

import "github.com/anshal21/ai-analyst/backend/internal/store"

// Stage names the six steps of the progress rail. They are part of the API
// contract and are rendered directly.
type Stage string

const (
	StageInterpret Stage = "interpret"
	StageResolve   Stage = "resolve"
	StagePlan      Stage = "plan"
	StageQuery     Stage = "query"
	StageVerify    Stage = "verify"
	StageCompose   Stage = "compose"
)

// Event names carried on the SSE stream.
const (
	EventThread         = "thread"
	EventStage          = "stage"
	EventInterpretation = "interpretation"
	EventAmbiguity      = "ambiguity"
	EventResult         = "result"
	EventCheck          = "check"
	EventVerdict        = "verdict"
	EventNarrative      = "narrative"
	EventChart          = "chart"
	EventCost           = "cost"
	EventError          = "error"
)

// Emitter is the sink the pipeline writes progress to. Declared here, at the
// consumer, so the pipeline knows nothing about HTTP.
type Emitter interface {
	Emit(event string, payload any) error
}

// ThreadPayload is the first event on every stream: it tells the client which
// server-side thread and turn this run belongs to, so follow-ups and resolve
// calls can reference them. Without it the client would have to invent ids the
// server has never heard of.
type ThreadPayload struct {
	ThreadID string `json:"thread_id"`
	TurnID   string `json:"turn_id"`
}

type stagePayload struct {
	Stage Stage  `json:"stage"`
	State string `json:"state"`
}

// InterpretationPayload reports what the question was understood to mean.
type InterpretationPayload struct {
	Restated       string   `json:"restated"`
	Assumptions    []string `json:"assumptions"`
	DefinitionUsed *defRef  `json:"definition_used"`
}

type defRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ResultPayload is the number or table, emitted before checks complete.
type ResultPayload struct {
	AnswerID   string               `json:"answer_id"`
	Value      *float64             `json:"value"`
	Unit       string               `json:"unit"`
	FormatHint string               `json:"format_hint"`
	Columns    []store.ResultColumn `json:"columns"`
	Rows       [][]any              `json:"rows"`
	RowCount   int                  `json:"row_count"`
}

// NarrativePayload is the written answer.
type NarrativePayload struct {
	Markdown string `json:"markdown"`
}

// CostPayload is the honest accounting for one question.
type CostPayload struct {
	LLMCalls  int     `json:"llm_calls"`
	USD       float64 `json:"usd"`
	ElapsedMS int64   `json:"elapsed_ms"`
}

// ErrorPayload is terminal.
type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func emitStage(e Emitter, s Stage, state string) {
	_ = e.Emit(EventStage, stagePayload{Stage: s, State: state})
}

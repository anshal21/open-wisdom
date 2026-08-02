package ask

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/sources"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// Pipeline turns a question into a verified, ledgered answer.
type Pipeline struct {
	Sources  *sources.Registry
	LLM      llm.Provider
	Engine   *verify.Engine
	Answers  *store.Answers
	Threads  *store.Threads
	Defs     *store.Definitions
	Settings *store.SettingsRepo
}

// Request is one question.
type Request struct {
	Question string
	ThreadID string
	Context  *store.Context
	SourceID string
	User     string

	// Chosen is set when the user resolved an earlier refusal. It pins the
	// reading, so no ambiguity detection runs and no planning call is needed —
	// the interpretation was already made and is carried on Prior.
	Chosen *store.Candidate
	Prior  *store.Answer
}

// Run executes the pipeline, streaming progress, and returns the stored answer.
//
// The error return is for failures the caller must know about; user-visible
// failures are emitted as an `error` event and also returned.
func (p *Pipeline) Run(ctx context.Context, req Request, emit Emitter) (*store.Answer, error) {
	start := time.Now()
	rec := llm.NewRecorder(p.LLM)

	settings, err := p.Settings.Get(ctx)
	if err != nil {
		return nil, p.fail(emit, "settings_unavailable", err)
	}

	sourceID, conn, cat, err := p.Sources.Resolve(ctx, firstNonEmpty(req.SourceID, settings.DefaultSourceID))
	if err != nil {
		return nil, p.fail(emit, "source_unavailable", err)
	}

	threadID, turnID, mergedCtx, priorTurns, err := p.attachToThread(ctx, &req, sourceID)
	if err != nil {
		return nil, p.fail(emit, "thread_unavailable", err)
	}
	_ = emit.Emit(EventThread, ThreadPayload{ThreadID: threadID, TurnID: turnID})

	defs, err := p.Defs.List(ctx, store.DefRatified)
	if err != nil {
		return nil, p.fail(emit, "definitions_unavailable", err)
	}

	answerID := store.ID("ans")
	digest := sources.Digest(cat)

	// -------------------------------------------------------------- interpret
	emitStage(emit, StageInterpret, "start")

	prompt := buildPrompt(req.Question, digest, defs, mergedCtx, p.describeHistory(ctx, priorTurns))

	// Three model calls are issued at this instant and none can see another's
	// output. The independent derivation completes while the primary result is
	// being produced; the ambiguity enumeration completes while the primary
	// query is being planned. Sequenced, this pipeline would take three times
	// as long and be no more correct.
	altCtx, abandonEnumeration := context.WithCancel(ctx)
	defer abandonEnumeration()

	crossCh := p.deriveIndependently(ctx, rec, prompt, readingOf(req.Chosen), speedOf(settings))
	altCh := p.enumerateReadings(altCtx, rec, req, defs, prompt, speedOf(settings))

	plan, err := p.interpret(ctx, rec, req, prompt, settings)
	if err != nil {
		return nil, p.fail(emit, "planning_failed", err)
	}
	if len(plan.Readings) == 0 {
		return nil, p.fail(emit, "planning_failed", errors.New("the planner returned no query for this question"))
	}

	usedDef := matchDefinition(defs, plan.DefinitionID)
	_ = emit.Emit(EventInterpretation, InterpretationPayload{
		Restated:       plan.Restated,
		Assumptions:    plan.Assumptions,
		DefinitionUsed: refOf(usedDef),
	})
	emitStage(emit, StageInterpret, "done")

	// ---------------------------------------------------------------- resolve
	emitStage(emit, StageResolve, "start")

	// The primary is run first and alone, because its SHAPE decides whether the
	// enumeration is worth waiting for. Refusing means putting two figures side
	// by side and showing how far apart they are — a question answered by a
	// breakdown has no such figure, so no set of alternate readings could ever
	// produce a refusal for it. Waiting on the enumeration there would spend ten
	// seconds of someone's time to compute candidates that cannot be used.
	evals := evaluateReadings(ctx, conn, plan.Readings[:1])
	if evals[0].scalar {
		evals = append(evals, evaluateReadings(ctx, conn, <-altCh)...)
	} else {
		abandonEnumeration()
	}
	plan.Readings = readingsOf(evals)

	if amb := p.checkAmbiguity(ctx, req, plan, evals, usedDef, settings); amb != nil {
		_ = emit.Emit(EventAmbiguity, amb)
		ans, err := p.recordRefusal(ctx, answerID, threadID, turnID, sourceID, req, plan, amb, rec, start)
		if err != nil {
			return nil, p.fail(emit, "answer_not_stored", err)
		}
		p.emitCost(emit, rec, start)
		return ans, nil
	}
	emitStage(emit, StageResolve, "done")

	// ------------------------------------------------------------------- plan
	emitStage(emit, StagePlan, "start")
	primary := evals[0]
	if primary.err != nil {
		return nil, p.fail(emit, "query_failed", fmt.Errorf("the query could not run: %w", primary.err))
	}
	emitStage(emit, StagePlan, "done")

	// ------------------------------------------------------------------ query
	emitStage(emit, StageQuery, "start")
	res := primary.result
	result := ResultPayload{
		AnswerID:   answerID,
		Unit:       plan.Unit,
		FormatHint: plan.FormatHint,
		Columns:    columnsMeta(res),
		Rows:       res.Rows,
		RowCount:   len(res.Rows),
	}
	if primary.scalar {
		v := primary.value
		result.Value = &v
	} else if v, ok := headlineOf(res); ok {
		// A single row with several columns (numerator, denominator, rate)
		// still has one figure the question was about — by convention the
		// rightmost numeric, which is where a computed rate or total lands.
		// Without this, the ledger shows "—" for an answer that has a number.
		result.Value = &v
	}
	_ = emit.Emit(EventResult, result)
	emitStage(emit, StageQuery, "done")

	// Writing begins the moment the number exists, in parallel with the checks
	// that scrutinize it. The caveat is not written by the model — it is
	// appended verbatim from whichever check found something, because a check
	// finding already carries the actual figures and a paraphrase of it can
	// only lose them.
	presentCh := p.present(ctx, rec, req.Question, plan, primary)

	// ----------------------------------------------------------------- verify
	emitStage(emit, StageVerify, "start")
	report, coverage := p.runChecks(ctx, verifyInput{
		Question:   req.Question,
		SQL:        primary.reading.SQL,
		Result:     res,
		Catalog:    cat,
		Conn:       conn,
		Definition: usedDef,
		Value:      result.Value,
		AnswerID:   answerID,
		Cross:      <-crossCh,
	}, emit)
	_ = emit.Emit(EventVerdict, report)
	emitStage(emit, StageVerify, "done")

	// ---------------------------------------------------------------- compose
	emitStage(emit, StageCompose, "start")
	presented := <-presentCh
	chart := buildChart(res, presented.Chart, report.Confidence, coverage)
	narrative := withCaveat(presented.Markdown, report)
	_ = emit.Emit(EventNarrative, NarrativePayload{Markdown: narrative})
	if chart != nil {
		_ = emit.Emit(EventChart, chart)
	}
	emitStage(emit, StageCompose, "done")

	// ------------------------------------------------------------------ store
	calls, cost := rec.Stats()
	ans := &store.Answer{
		ID:          answerID,
		ThreadID:    threadID,
		SourceID:    sourceID,
		Question:    req.Question,
		Restated:    plan.Restated,
		Assumptions: plan.Assumptions,
		Value:       result.Value,
		Unit:        plan.Unit,
		FormatHint:  plan.FormatHint,
		Columns:     result.Columns,
		Rows:        res.Rows,
		RowCount:    len(res.Rows),
		SQL:         primary.reading.SQL,
		AltSQL:      altSQLOf(report),
		Report:      &report,
		Chart:       chart,
		Narrative:   narrative,
		Confidence:  report.Confidence,
		CreatedBy:   req.User,
		Cost:        &store.Cost{LLMCalls: calls, USD: cost, ElapsedMS: time.Since(start).Milliseconds()},
	}
	if usedDef != nil {
		ans.DefinitionUsed = &store.DefinitionRef{ID: usedDef.ID, Name: usedDef.Name}
	}
	if req.Prior != nil {
		ans.RerunOf = req.Prior.ID
	}
	if err := p.Answers.Create(ctx, ans); err != nil {
		return nil, p.fail(emit, "answer_not_stored", err)
	}
	if turnID != "" {
		_ = p.Threads.AttachAnswer(ctx, turnID, ans.ID)
	}
	if usedDef != nil {
		_ = p.Defs.RecordUsage(ctx, usedDef.ID)
	}

	p.emitCost(emit, rec, start)
	return ans, nil
}

// interpret produces the plan. When the user already chose a reading, the
// interpretation was made on the previous turn and is reused verbatim: asking
// the model to re-decide something a human just decided is both slower and a
// chance to decide differently.
func (p *Pipeline) interpret(ctx context.Context, rec llm.Provider, req Request, prompt string, settings store.Settings) (*planReply, error) {
	if req.Chosen != nil {
		prior := req.Prior
		plan := &planReply{
			// A pinned definition (the one this resolution just ratified, or
			// one the asker chose) is the interpretation's source of record.
			DefinitionID: pinnedID(req.Context),
			Readings: []reading{{
				Label:       req.Chosen.Label,
				Description: req.Chosen.Description,
				SQL:         req.Chosen.SQL,
			}}}
		if prior != nil {
			plan.Restated = prior.Restated
			plan.Assumptions = append(prior.Assumptions, "Reading chosen by the asker: "+req.Chosen.Label)
			plan.Unit, plan.FormatHint = prior.Unit, prior.FormatHint
		}
		if plan.Restated == "" {
			plan.Restated = req.Question
		}
		return plan, nil
	}

	res, err := rec.Complete(ctx, llm.Request{
		System: planSystem,
		Prompt: prompt,
		Speed:  speedOf(settings),
		JSON:   true,
	})
	if err != nil {
		return nil, fmt.Errorf("plan question: %w", err)
	}
	var plan planReply
	if err := llm.DecodeJSON(res.Text, &plan); err != nil {
		return nil, fmt.Errorf("decode plan: %w", err)
	}
	if executable(plan.SQL) {
		plan.Readings = []reading{{
			Label:       firstNonEmpty(plan.Label, "As asked"),
			Description: plan.Restated,
			SQL:         plan.SQL,
		}}
	}
	return &plan, nil
}

// enumerateReadings asks, in parallel with planning and without sight of the
// planned query, what else this question could defensibly mean.
//
// It is the long pole of the whole pipeline, because it is the only call whose
// output length grows with the answer: one query per reading. The prompt caps
// it at three readings of minimal SQL for that reason, and the tier is the same
// as the primary plan — measured against this warehouse, the cheaper tier took
// three times as long on this prompt, so there is no latency to buy there.
func (p *Pipeline) enumerateReadings(ctx context.Context, rec llm.Provider, req Request, defs []store.Definition, prompt string, speed llm.Speed) <-chan []reading {
	ch := make(chan []reading, 1)
	go func() {
		defer close(ch)
		// Three ways a question is already settled, none of which need a model
		// to establish: the asker picked a reading, the asker pinned a
		// definition, or a ratified definition names a term in the question.
		// Enumerating alternatives in any of those cases costs the user time to
		// produce candidates that will be discarded.
		if req.Chosen != nil || pinned(req.Context) || coveredByDefinition(defs, req.Question) {
			ch <- nil
			return
		}
		res, err := rec.Complete(ctx, llm.Request{
			System: alternatesSystem,
			Prompt: prompt,
			Speed:  speed,
			JSON:   true,
		})
		if err != nil {
			ch <- nil
			return
		}
		var reply altReply
		if err := llm.DecodeJSON(res.Text, &reply); err != nil {
			ch <- nil
			return
		}
		var kept []reading
		for _, r := range reply.Readings {
			if executable(r.SQL) {
				kept = append(kept, r)
			}
		}
		ch <- kept
	}()
	return ch
}

// deriveIndependently issues the second derivation without sight of the first.
//
// reading, when set, pins it to the reading the user chose, so it re-derives
// the same quantity by a different route instead of drifting to a different
// question and reporting the drift as a disagreement.
func (p *Pipeline) deriveIndependently(ctx context.Context, rec llm.Provider, prompt, reading string, speed llm.Speed) <-chan string {
	ch := make(chan string, 1)
	go func() {
		defer close(ch)
		if reading != "" {
			prompt = "THE READING TO DERIVE (the asker has already settled this; derive exactly this quantity, by a different route): " +
				reading + "\n\n" + prompt
		}
		res, err := rec.Complete(ctx, llm.Request{
			System: crossSystem,
			Prompt: prompt,
			Speed:  speed,
			JSON:   true,
		})
		if err != nil {
			ch <- ""
			return
		}
		var reply crossReply
		if err := llm.DecodeJSON(res.Text, &reply); err != nil || !executable(reply.SQL) {
			ch <- ""
			return
		}
		ch <- reply.SQL
	}()
	return ch
}

// executable is the last gate before the engine. A model is never trusted to
// have produced a read-only statement, however clearly it was told to.
func executable(sql string) bool {
	return strings.TrimSpace(sql) != "" && warehouse.RejectWrites(sql) == nil
}

func pinned(c *store.Context) bool { return c != nil && c.DefinitionID != "" }

// coveredByDefinition reports whether a ratified definition names a term the
// question uses. Word-boundary matching keeps "Revenue" from matching
// "revenues per user" only by accident of substring, and keeps a definition
// called "Order" from claiming every question containing "reorder".
func coveredByDefinition(defs []store.Definition, question string) bool {
	words := map[string]bool{}
	for _, w := range strings.Fields(strings.ToLower(question)) {
		words[strings.Trim(w, ",.?!:;'\"()")] = true
	}
	for _, d := range defs {
		if d.Status != store.DefRatified || d.Name == "" {
			continue
		}
		name := strings.ToLower(d.Name)
		if words[name] || words[strings.TrimSuffix(name, "s")] || words[name+"s"] {
			return true
		}
	}
	return false
}

type verifyInput struct {
	Question   string
	SQL        string
	Result     *warehouse.Result
	Catalog    *warehouse.Catalog
	Conn       warehouse.Connector
	Definition *store.Definition
	Value      *float64
	AnswerID   string
	Cross      string
}

func (p *Pipeline) runChecks(ctx context.Context, in verifyInput, emit Emitter) (verify.Report, *store.ChartCoverage) {
	parsed := &verify.Query{}
	if parser, ok := in.Conn.(verify.Parser); ok {
		if q, err := verify.ParseQuery(ctx, parser, in.SQL); err == nil {
			parsed = q
		}
	}

	subject := &verify.Subject{
		Question: in.Question,
		SQL:      in.SQL,
		Parsed:   parsed,
		Result:   in.Result,
		Catalog:  in.Catalog,
		Conn:     in.Conn,
	}
	if in.Definition != nil {
		subject.DefinitionSource = in.Definition.Name
	}

	cross := verify.CrossDerive(ctx, in.Conn, in.Result, in.Cross)

	// Join loss is needed before coverage can say how many rows were dropped,
	// so it runs here rather than inside the concurrent set.
	joinLoss := verify.JoinLoss(ctx, subject)
	coverage, cov := coverageCheck(parsed, in.Catalog, &joinLoss, in.Result)

	var precedent verify.Check
	prior, err := p.Answers.Precedent(ctx, store.NormalizeQuestion(in.Question), store.NormalizeSQL(in.SQL), in.AnswerID)
	if err != nil {
		prior = nil
	}
	precedent = precedentCheck(in.Value, prior)

	report := p.Engine.RunStream(ctx, subject, func(c verify.Check) {
		_ = emit.Emit(EventCheck, c)
	}, cross, coverage, precedent)
	return report, cov
}

// compose writes the sentence that states the number, concurrently with
// verification.
func (p *Pipeline) present(ctx context.Context, rec llm.Provider, question string, plan *planReply, primary evaluated) <-chan presentReply {
	ch := make(chan presentReply, 1)
	go func() {
		defer close(ch)

		var b strings.Builder
		fmt.Fprintf(&b, "QUESTION: %s\n", question)
		fmt.Fprintf(&b, "INTERPRETED AS: %s\n", plan.Restated)
		if primary.scalar {
			fmt.Fprintf(&b, "RESULT: %s (%s)\n", formatFloat(primary.value), plan.Unit)
		} else {
			fmt.Fprintf(&b, "RESULT: a table of %d rows with columns %s\n",
				len(primary.result.Rows), strings.Join(rawColumnNames(primary.result), ", "))
			if preview := previewRows(primary.result, 5); preview != "" {
				b.WriteString("FIRST ROWS:\n" + preview)
			}
		}
		for _, a := range plan.Assumptions {
			fmt.Fprintf(&b, "ASSUMED: %s\n", a)
		}

		fallback := presentReply{Markdown: fmt.Sprintf("%s: **%s**.", plan.Restated, formatFloat(primary.value))}
		if !primary.scalar {
			fallback.Markdown = fmt.Sprintf("%s: %d rows.", plan.Restated, len(primary.result.Rows))
		}

		// Measured against this warehouse, the cheaper tier is both slower on
		// this prompt and prone to reading it as a request to go query a
		// database rather than to describe a result it was handed. Since the
		// call runs alongside verification it is off the critical path anyway.
		res, err := rec.Complete(ctx, llm.Request{
			System: presentSystem,
			Prompt: b.String(),
			Speed:  llm.SpeedBalanced,
			JSON:   true,
		})
		if err != nil {
			ch <- fallback
			return
		}
		var reply presentReply
		if err := llm.DecodeJSON(res.Text, &reply); err != nil || strings.TrimSpace(reply.Markdown) == "" {
			ch <- fallback
			return
		}
		reply.Markdown = strings.TrimSpace(reply.Markdown)
		ch <- reply
	}()
	return ch
}

// withCaveat appends the finding that most deserves to be read.
//
// Check findings are written as complete sentences carrying their own figures,
// so the caveat is quoted rather than summarized. A model asked to summarize
// "46.29% of events rows have no matching user" will eventually produce
// "some rows were excluded", and the number is the entire value of the sentence.
func withCaveat(narrative string, report verify.Report) string {
	var caveat string
	for _, c := range report.Checks {
		if c.Finding == "" {
			continue
		}
		if c.Status == verify.StatusFail {
			caveat = c.Finding
			break
		}
		if c.Status == verify.StatusWarn && caveat == "" {
			caveat = c.Finding
		}
	}
	if caveat == "" || strings.Contains(narrative, caveat) {
		return narrative
	}
	return strings.TrimRight(narrative, " ") + " " + caveat
}

// checkAmbiguity runs the refusal gate. A pinned reading, a pinned definition,
// or a ratified definition the planner applied all mean the question was
// already settled, and re-asking would be the reflexive clarification the
// product is explicitly not supposed to produce.
func (p *Pipeline) checkAmbiguity(ctx context.Context, req Request, plan *planReply, evals []evaluated, usedDef *store.Definition, settings store.Settings) *store.Ambiguity {
	if req.Chosen != nil || usedDef != nil {
		return nil
	}
	if req.Context != nil && req.Context.DefinitionID != "" {
		return nil
	}
	amb := detectAmbiguity(req.Question, evals, settings.AmbiguitySpreadRatio)
	if amb == nil {
		return nil
	}
	prior, err := p.Answers.Precedent(ctx, store.NormalizeQuestion(req.Question), "", "")
	if err != nil {
		prior = nil
	}
	markRecommendation(amb, usedDef, prior)
	return amb
}

// recordRefusal stores the refusal and proposes the definition that resolving
// it would create. The proposal is the whole point: an ambiguity caught with
// two measured numbers behind it is a far better prompt for a human than any
// request to go document a table.
func (p *Pipeline) recordRefusal(ctx context.Context, answerID, threadID, turnID, sourceID string, req Request, plan *planReply, amb *store.Ambiguity, rec *llm.Recorder, start time.Time) (*store.Answer, error) {
	calls, cost := rec.Stats()
	ans := &store.Answer{
		ID:          answerID,
		ThreadID:    threadID,
		SourceID:    sourceID,
		Question:    req.Question,
		Restated:    plan.Restated,
		Assumptions: plan.Assumptions,
		Unit:        plan.Unit,
		FormatHint:  plan.FormatHint,
		Ambiguity:   amb,
		Confidence:  verify.ConfRefused,
		CreatedBy:   req.User,
		Cost:        &store.Cost{LLMCalls: calls, USD: cost, ElapsedMS: time.Since(start).Milliseconds()},
	}
	if err := p.Answers.Create(ctx, ans); err != nil {
		return nil, err
	}
	if turnID != "" {
		_ = p.Threads.AttachAnswer(ctx, turnID, ans.ID)
	}
	p.proposeDefinition(ctx, amb, ans.ID)
	return ans, nil
}

func (p *Pipeline) proposeDefinition(ctx context.Context, amb *store.Ambiguity, answerID string) {
	name := ambiguousTerm(amb.Question)
	if name == "" {
		return
	}
	name = strings.ToUpper(name[:1]) + name[1:]
	if _, err := p.Defs.FindProposed(ctx, name); err == nil {
		return
	}
	var b strings.Builder
	fmt.Fprintf(&b, "This warehouse gives %d different figures for %q. Choose the one that is meant:", len(amb.Candidates), strings.ToLower(name))
	for _, c := range amb.Candidates {
		fmt.Fprintf(&b, "\n- %s — %s (%s)", c.Label, c.Description, formatFloat(c.Value))
	}
	_ = p.Defs.Create(ctx, &store.Definition{
		Name:           name,
		PlainEnglish:   b.String(),
		Status:         store.DefProposed,
		SourceAnswerID: answerID,
	})
}

func (p *Pipeline) attachToThread(ctx context.Context, req *Request, sourceID string) (threadID, turnID string, merged *store.Context, prior []store.Turn, err error) {
	if req.ThreadID == "" {
		t, err := p.Threads.Create(ctx, req.Question, sourceID, req.Context)
		if err != nil {
			return "", "", nil, nil, err
		}
		turnID, err := p.Threads.AddTurn(ctx, t.ID, req.Question)
		if err != nil {
			return "", "", nil, nil, err
		}
		return t.ID, turnID, req.Context, nil, nil
	}

	t, err := p.Threads.Get(ctx, req.ThreadID)
	if err != nil {
		return "", "", nil, nil, err
	}
	merged = mergeContext(t.Context, req.Context)
	if !sameContext(t.Context, merged) {
		if err := p.Threads.SetContext(ctx, t.ID, merged); err != nil {
			return "", "", nil, nil, err
		}
	}
	turnID, err = p.Threads.AddTurn(ctx, t.ID, req.Question)
	if err != nil {
		return "", "", nil, nil, err
	}
	return t.ID, turnID, merged, t.Turns, nil
}

// describeHistory renders the last few turns so a follow-up like "now for last
// year" can resolve what "now" refers to. The prior answer's restated
// interpretation is used rather than its raw question: the restatement is the
// settled reading — period, grain, breakdown and all — in one sentence.
func (p *Pipeline) describeHistory(ctx context.Context, prior []store.Turn) string {
	const keep = 3
	if len(prior) > keep {
		prior = prior[len(prior)-keep:]
	}
	var b strings.Builder
	for i, t := range prior {
		label := "earlier"
		if i == len(prior)-1 {
			label = "CURRENT READING"
		}
		fmt.Fprintf(&b, "  [%s] Q: %s\n", label, t.Question)
		if t.AnswerID != "" {
			if ans, err := p.Answers.Get(ctx, t.AnswerID); err == nil && ans.Restated != "" {
				fmt.Fprintf(&b, "      understood as: %s\n", ans.Restated)
			}
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return "CONVERSATION SO FAR — the new question is a follow-up that MODIFIES THE CURRENT READING (the most recent turn below). It inherits the current reading's metric, breakdown/grouping, filters and shape wholesale, changing ONLY what it explicitly names: \"now for last year\" after a by-category breakdown is that same by-category breakdown for the earlier year. Relative words like \"last year\" are relative to the period under discussion, not to today.\n" + b.String()
}

// mergeContext lets a turn override the thread's chips field by field. A turn
// that says nothing about grain inherits the thread's grain; that inheritance
// is what makes "now break it down by category" work without restating the
// metric, filters, or period.
func mergeContext(base, over *store.Context) *store.Context {
	if over == nil {
		return base
	}
	if base == nil {
		return over
	}
	out := *base
	if over.TimeRange != nil {
		out.TimeRange = over.TimeRange
	}
	if len(over.Filters) > 0 {
		out.Filters = over.Filters
	}
	if over.Grain != "" {
		out.Grain = over.Grain
	}
	if over.DefinitionID != "" {
		out.DefinitionID = over.DefinitionID
	}
	return &out
}

// sameContext compares by serialized form. Comparing the structs directly would
// compare the addresses of their nested pointers, which are never equal, and a
// context would appear to change on every turn.
func sameContext(a, b *store.Context) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func (p *Pipeline) emitCost(emit Emitter, rec *llm.Recorder, start time.Time) {
	calls, cost := rec.Stats()
	_ = emit.Emit(EventCost, CostPayload{
		LLMCalls:  calls,
		USD:       cost,
		ElapsedMS: time.Since(start).Milliseconds(),
	})
}

func (p *Pipeline) fail(emit Emitter, code string, err error) error {
	_ = emit.Emit(EventError, ErrorPayload{Code: code, Message: err.Error()})
	return err
}

// ------------------------------------------------------------------ helpers

func speedOf(s store.Settings) llm.Speed {
	switch s.ModelSpeed {
	case "fast":
		return llm.SpeedFast
	case "deep":
		return llm.SpeedDeep
	default:
		return llm.SpeedBalanced
	}
}

func matchDefinition(defs []store.Definition, id string) *store.Definition {
	if id == "" {
		return nil
	}
	for i := range defs {
		if defs[i].ID == id {
			return &defs[i]
		}
	}
	return nil
}

func refOf(d *store.Definition) *defRef {
	if d == nil {
		return nil
	}
	return &defRef{ID: d.ID, Name: d.Name}
}

func readingOf(c *store.Candidate) string {
	if c == nil {
		return ""
	}
	return c.Label + " — " + c.Description
}

func readingsOf(evals []evaluated) []reading {
	out := make([]reading, len(evals))
	for i, e := range evals {
		out[i] = e.reading
	}
	return out
}

// headlineOf extracts the figure a single-row, multi-column result is about:
// the rightmost numeric cell. Multi-row results have no single headline.
func headlineOf(res *warehouse.Result) (float64, bool) {
	if res == nil || len(res.Rows) != 1 {
		return 0, false
	}
	row := res.Rows[0]
	for i := len(row) - 1; i >= 0; i-- {
		switch v := row[i].(type) {
		case float64:
			return v, true
		case float32:
			return float64(v), true
		case int64:
			return float64(v), true
		case int32:
			return float64(v), true
		case int:
			return float64(v), true
		}
	}
	return 0, false
}

func rawColumnNames(res *warehouse.Result) []string {
	out := make([]string, len(res.Columns))
	for i, c := range res.Columns {
		out[i] = c.Name
	}
	return out
}

// columnsMeta carries each column's name, display label, and semantic type.
// The type decides which column becomes an axis and how a cell aligns —
// serving bare names here is why every chart used to render wrong.
func columnsMeta(res *warehouse.Result) []store.ResultColumn {
	out := make([]store.ResultColumn, len(res.Columns))
	for i, c := range res.Columns {
		out[i] = store.ResultColumn{Name: c.Name, Label: humanLabel(c.Name), Type: FieldType(c.Type)}
	}
	return out
}

func previewRows(res *warehouse.Result, n int) string {
	var b strings.Builder
	for i, row := range res.Rows {
		if i >= n {
			break
		}
		cells := make([]string, len(row))
		for j, v := range row {
			cells[j] = fmt.Sprint(v)
		}
		b.WriteString("  " + strings.Join(cells, " | ") + "\n")
	}
	return b.String()
}

// altSQLOf recovers the independent derivation from the report so the ledger
// records both paths, not just the one that produced the number.
func altSQLOf(r verify.Report) string {
	for _, c := range r.Checks {
		if c.ID != verify.CheckCrossDerivation || c.Detail == nil {
			continue
		}
		if s, ok := c.Detail["alternate_sql"].(string); ok {
			return s
		}
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

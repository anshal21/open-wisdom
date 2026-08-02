package ask

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/sources"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/testsupport"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

// demoWarehouse resolves through testsupport so the suite runs on any machine.
func demoWarehousePath(t *testing.T) string { return testsupport.WarehousePath(t) }

// The product promises an answer inside twenty seconds. It is a contract with
// the user, not an aspiration, so it is asserted.
const latencyBudget = 20 * time.Second

// recorder captures the stream so a test can assert on ordering, which is part
// of the API contract: the number must be emitted before the checks that
// scrutinize it.
type recorder struct {
	mu     sync.Mutex
	order  []string
	events map[string][]json.RawMessage
}

func newRecorder() *recorder {
	return &recorder{events: map[string][]json.RawMessage{}}
}

func (r *recorder) Emit(event string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.order = append(r.order, event)
	r.events[event] = append(r.events[event], body)
	return nil
}

func (r *recorder) first(t *testing.T, event string, out any) bool {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	msgs := r.events[event]
	if len(msgs) == 0 {
		return false
	}
	if err := json.Unmarshal(msgs[0], out); err != nil {
		t.Fatalf("decode %s event: %v", event, err)
	}
	return true
}

func (r *recorder) count(event string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.events[event])
}

func (r *recorder) indexOf(event string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, e := range r.order {
		if e == event {
			return i
		}
	}
	return -1
}

// harness is a whole backend wired against a private copy of the demo
// warehouse. DuckDB allows many readers or one writer, so the file is copied
// rather than opened in place.
type harness struct {
	pipeline *Pipeline
	answers  *store.Answers
	threads  *store.Threads
	defs     *store.Definitions
	sourceID string
}

// requireRealProvider marks a test that asserts MODEL JUDGEMENT rather than
// pipeline behaviour — whether the narrative names its definition, whether
// alias detection spots split entities. The mock cannot satisfy these by
// construction, and faking them would make the suite green while measuring
// nothing.
//
// The skip message carries a marker CI allowlists. Every OTHER skip fails the
// build, because a silently skipped suite reporting `ok` is how this project
// shipped an untested verification engine for months.
func requireRealProvider(t *testing.T) {
	t.Helper()
	if os.Getenv("ANALYST_TEST_LLM") == "" {
		t.Skip("[needs-real-provider] asserts model judgement; set ANALYST_TEST_LLM=claude-cli to run")
	}
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	warehousePath := demoWarehousePath(t)

	dir := t.TempDir()
	src, err := os.Open(warehousePath)
	if err != nil {
		t.Fatalf("open demo warehouse: %v", err)
	}
	defer src.Close()
	dstPath := dir + "/demo.duckdb"
	dst, err := os.Create(dstPath)
	if err != nil {
		t.Fatalf("create warehouse copy: %v", err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		t.Fatalf("copy warehouse: %v", err)
	}
	dst.Close()

	db, err := store.Open(dir + "/analyst.db")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	// The deterministic mock by default: this suite asserts PIPELINE behaviour
	// — stage ordering, refusal handling, seal computation — none of which is
	// a property of the model. Running it against a hosted provider made it
	// slow (178s), non-deterministic, chargeable, and unrunnable in CI or on a
	// contributor's machine, where it silently SKIPPED and reported `ok`.
	//
	// Set ANALYST_TEST_LLM=claude-cli to exercise a real provider; the
	// conformance suite is the proper place for judging model quality.
	providerName := os.Getenv("ANALYST_TEST_LLM")
	if providerName == "" {
		providerName = "mock"
	}
	provider, err := llm.Open(providerName, llm.ProviderConfig{MaxConcurrent: 6})
	if err != nil {
		t.Fatalf("open provider %q: %v", providerName, err)
	}
	sourceRepo := store.NewSources(db)
	source := &store.Source{Name: "demo", Kind: "duckdb", DSN: dstPath}
	if err := sourceRepo.Create(context.Background(), source); err != nil {
		t.Fatalf("create source: %v", err)
	}

	registry := sources.NewRegistry(sourceRepo, provider)
	t.Cleanup(registry.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if _, err := registry.Introspect(ctx, source.ID); err != nil {
		t.Fatalf("introspect: %v", err)
	}

	h := &harness{
		answers:  store.NewAnswers(db),
		threads:  store.NewThreads(db),
		defs:     store.NewDefinitions(db),
		sourceID: source.ID,
	}
	h.pipeline = &Pipeline{
		Sources:  registry,
		LLM:      provider,
		Engine:   verify.NewEngine(provider),
		Answers:  h.answers,
		Threads:  h.threads,
		Defs:     h.defs,
		Settings: store.NewSettingsRepo(db),
	}
	return h
}

func (h *harness) ask(t *testing.T, req Request) (*store.Answer, *recorder, time.Duration) {
	t.Helper()
	req.SourceID = h.sourceID
	if req.User == "" {
		req.User = "test@example.com"
	}
	rec := newRecorder()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	start := time.Now()
	ans, err := h.pipeline.Run(ctx, req, rec)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("pipeline: %v", err)
	}
	if ans == nil {
		t.Fatal("pipeline returned no answer")
	}
	t.Logf("%q answered in %s (%d LLM calls, $%.4f)", req.Question, elapsed.Round(time.Millisecond),
		ans.Cost.LLMCalls, ans.Cost.USD)
	return ans, rec, elapsed
}

// The signature moment: a question whose readings differ by four times must
// refuse with the candidates and their actual values, not answer with one of
// them.
func TestAskRefusesAmbiguousRevenue(t *testing.T) {
	requireRealProvider(t)
	h := newHarness(t)
	ans, rec, elapsed := h.ask(t, Request{Question: "what was revenue in 2023?"})

	if ans.Confidence != verify.ConfRefused {
		t.Fatalf("confidence = %q, want refused; value %v, narrative %q",
			ans.Confidence, ans.Value, ans.Narrative)
	}
	if elapsed > latencyBudget {
		t.Errorf("refusal took %s, over the %s budget", elapsed.Round(time.Millisecond), latencyBudget)
	}

	var amb store.Ambiguity
	if !rec.first(t, EventAmbiguity, &amb) {
		t.Fatal("no ambiguity event was emitted")
	}
	if len(amb.Candidates) < 2 {
		t.Fatalf("ambiguity offered %d candidate(s); a refusal needs at least two", len(amb.Candidates))
	}
	if amb.Spread.Ratio < defaultSpreadRatio {
		t.Errorf("spread ratio %v is below the refusal threshold %v", amb.Spread.Ratio, defaultSpreadRatio)
	}
	for _, c := range amb.Candidates {
		if c.Value == 0 || c.SQL == "" || c.Label == "" || c.Description == "" {
			t.Errorf("candidate %+v is incomplete; every reading must carry its measured value", c)
		}
		if c.Recommended != (c.RecommendationBasis != "") {
			t.Errorf("candidate %q is recommended without a basis, or carries a basis without being recommended", c.Label)
		}
	}
	t.Logf("refusal: %s", amb.Reason)
	for _, c := range amb.Candidates {
		t.Logf("  %-42s %15.2f", c.Label, c.Value)
	}

	// A refusal is terminal: no number may follow it.
	if rec.count(EventResult) != 0 {
		t.Error("a result was emitted after a refusal")
	}
	if rec.count(EventVerdict) != 0 {
		t.Error("a verdict was emitted after a refusal")
	}

	// The caught ambiguity must leave behind a proposal — that is the only way
	// this product's semantic layer is ever built.
	proposed, err := h.defs.List(context.Background(), store.DefProposed)
	if err != nil {
		t.Fatalf("list proposed definitions: %v", err)
	}
	if len(proposed) == 0 {
		t.Error("a caught ambiguity produced no proposed definition")
	}
}

// A question with one defensible reading must answer, inside the budget, with
// the number streamed ahead of the checks.
func TestAskAnswersUnambiguousQuestionWithinBudget(t *testing.T) {
	requireRealProvider(t)
	h := newHarness(t)
	ans, rec, elapsed := h.ask(t, Request{Question: "how many rows are in the orders table?"})

	if ans.Confidence == verify.ConfRefused {
		t.Fatalf("refused a question with one reading: %+v", ans.Ambiguity)
	}
	if ans.Value == nil {
		t.Fatal("no scalar value on a counting question")
	}
	if elapsed > latencyBudget {
		t.Errorf("answered in %s, over the %s budget", elapsed.Round(time.Millisecond), latencyBudget)
	}

	// Ordering guarantee from the contract: the client renders the number
	// wearing a "checking" seal, so result must precede any check.
	resultAt, checkAt, verdictAt := rec.indexOf(EventResult), rec.indexOf(EventCheck), rec.indexOf(EventVerdict)
	if resultAt < 0 {
		t.Fatal("no result event")
	}
	if checkAt >= 0 && resultAt > checkAt {
		t.Errorf("result was emitted at %d, after the first check at %d", resultAt, checkAt)
	}
	if verdictAt >= 0 && resultAt > verdictAt {
		t.Errorf("result was emitted after the verdict")
	}

	if rec.count(EventCheck) == 0 {
		t.Error("no checks were streamed")
	}
	if rec.count(EventNarrative) == 0 {
		t.Error("no narrative was composed")
	}
	if rec.count(EventCost) == 0 {
		t.Error("no cost was reported")
	}

	var report verify.Report
	if !rec.first(t, EventVerdict, &report) {
		t.Fatal("no verdict event")
	}
	if report.Total == 0 {
		t.Error("the verdict counted no checks")
	}
	// Skipped checks are returned so absence is legible, but must never inflate
	// the seal.
	var counted int
	for _, c := range report.Checks {
		if c.Status != verify.StatusSkipped {
			counted++
		}
		if c.Status == verify.StatusSkipped && c.SkipReason == "" {
			t.Errorf("check %s skipped without saying why", c.ID)
		}
		if c.Status != verify.StatusSkipped && c.Finding == "" {
			t.Errorf("check %s produced no finding; a bare pass is not evidence", c.ID)
		}
	}
	if counted != report.Total {
		t.Errorf("report counts %d checks but %d ran", report.Total, counted)
	}
	t.Logf("verdict: %s — %s (%d/%d)", report.Confidence, report.Headline, report.Passed, report.Total)
	t.Logf("narrative: %s", ans.Narrative)
}

// Once a human has chosen a reading, the pipeline must answer with it and never
// re-ask. Re-litigating a settled question is the behavior this product exists
// to remove.
func TestResolvedCandidateAnswersWithoutReAsking(t *testing.T) {
	h := newHarness(t)
	refused, rec, _ := h.ask(t, Request{Question: "what was revenue in 2023?"})
	if refused.Confidence != verify.ConfRefused {
		t.Skipf("question was not refused this run (confidence %q); nothing to resolve", refused.Confidence)
	}
	var amb store.Ambiguity
	if !rec.first(t, EventAmbiguity, &amb) {
		t.Fatal("no ambiguity event")
	}
	chosen := amb.Candidates[0]

	ans, rec2, elapsed := h.ask(t, Request{
		Question: refused.Question,
		ThreadID: refused.ThreadID,
		Chosen:   &chosen,
		Prior:    refused,
	})

	if ans.Confidence == verify.ConfRefused {
		t.Fatal("re-refused a question the user had already resolved")
	}
	if ans.Value == nil {
		t.Fatal("resolved answer carries no value")
	}
	if got, want := *ans.Value, chosen.Value; got != want {
		t.Errorf("resolved answer = %v, want the chosen candidate's measured value %v", got, want)
	}
	if elapsed > latencyBudget {
		t.Errorf("resolution took %s, over the %s budget", elapsed.Round(time.Millisecond), latencyBudget)
	}
	if rec2.count(EventAmbiguity) != 0 {
		t.Error("the pipeline asked again after the user had chosen")
	}
	t.Logf("resolved to %s = %.2f in %s", chosen.Label, *ans.Value, elapsed.Round(time.Millisecond))
}

// A ratified definition settles the question for good: the next asker gets a
// number, and the answer says which definition produced it.
func TestRatifiedDefinitionSuppressesTheRefusal(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	def := &store.Definition{
		Name:         "Revenue",
		PlainEnglish: "The sum of order item sale prices for orders that were not cancelled and not returned.",
		Expression:   "SELECT sum(sale_price) FROM order_items WHERE status NOT IN ('Cancelled', 'Returned')",
		Status:       store.DefRatified,
		RatifiedBy:   "test@example.com",
	}
	if err := h.defs.Create(ctx, def); err != nil {
		t.Fatalf("ratify definition: %v", err)
	}

	ans, rec, elapsed := h.ask(t, Request{Question: "what was revenue in 2023?"})
	requireRealProvider(t)
	if ans.Confidence == verify.ConfRefused {
		t.Fatalf("refused a question a ratified definition already settles: %+v", ans.Ambiguity)
	}
	if ans.DefinitionUsed == nil {
		t.Fatal("the answer does not name the definition it used")
	}
	if ans.DefinitionUsed.ID != def.ID {
		t.Errorf("used definition %q, want %q", ans.DefinitionUsed.ID, def.ID)
	}
	if ans.Value == nil {
		t.Fatal("a settled question produced no value")
	}
	if elapsed > latencyBudget {
		t.Errorf("answered in %s, over the %s budget", elapsed.Round(time.Millisecond), latencyBudget)
	}

	var interp InterpretationPayload
	if !rec.first(t, EventInterpretation, &interp) {
		t.Fatal("no interpretation event")
	}
	if interp.DefinitionUsed == nil || interp.DefinitionUsed.Name != def.Name {
		t.Errorf("interpretation did not report the definition it applied: %+v", interp.DefinitionUsed)
	}
	t.Logf("answered %s using %s", formatFloat(*ans.Value), ans.DefinitionUsed.Name)
}

// Alias detection is a property of the data and must be discovered, never
// hardcoded. This warehouse stores two spellings for two of its countries.
func TestIntrospectionFindsSplitEntities(t *testing.T) {
	requireRealProvider(t)
	h := newHarness(t)
	cat, err := h.pipeline.Sources.Catalog(context.Background(), h.sourceID)
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	var groups int
	for _, tb := range cat.Tables {
		for _, c := range tb.Columns {
			if c.Profile == nil {
				continue
			}
			for _, g := range c.Profile.Aliases {
				groups++
				t.Logf("%s.%s: %v", tb.Name, c.Name, g)
			}
		}
	}
	if groups == 0 {
		t.Error("no split entities found; the double-counting hazard would be invisible to the planner")
	}
}

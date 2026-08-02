package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/investigate"
	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/pyrun"
	"github.com/anshal21/ai-analyst/backend/internal/sources"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/testsupport"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

// The API test harness.
//
// Everything here is in-process: an httptest server over the real mux, a temp
// SQLite store, the deterministic `mock` model provider, and the generated
// fixture warehouse. No network, no `claude` binary, no downloaded dataset, no
// assumption about whose machine this is — which is the point. Three suites in
// this repository used to hardcode an absolute path and t.Skipf, so
// `go test ./...` printed `ok` while executing almost nothing. CI now fails on
// any skip, so nothing below may skip.

// sampleWarehouse resolves the warehouse these tests query.
//
// This used to reach for a committed 6 MB slice of a third-party dataset,
// bypassing internal/testsupport because that helper defaulted to a ~1 GB
// download and skipped without it. Both fixtures are gone: testsupport now
// serves a warehouse generated from data in this repository, so there is one
// path and no reason for this package to have its own.
func sampleWarehouse(t *testing.T) string {
	t.Helper()
	return testsupport.WarehousePath(t)
}

// fixture is one fully wired server plus the handles a test needs to seed rows
// directly, so a test can arrange state without driving ten HTTP calls first.
type fixture struct {
	t          *testing.T
	srv        *httptest.Server
	db         *store.DB
	Answers    *store.Answers
	Threads    *store.Threads
	Defs       *store.Definitions
	Dashboards *store.Dashboards
	Notebooks  *store.Notebooks
	Watches    *store.Watches
	Sources    *store.Sources
	Users      *store.Users
	Settings   *store.SettingsRepo
	SourceID   string
}

// newFixture assembles the same object graph cmd/server/main.go builds.
func newFixture(t *testing.T) *fixture {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	provider, err := llm.Open("mock", llm.ProviderConfig{MaxConcurrent: 4})
	if err != nil {
		t.Fatalf("open mock provider: %v", err)
	}

	sourceRepo := store.NewSources(db)
	src := &store.Source{Name: "sample", Kind: "duckdb", DSN: sampleWarehouse(t)}
	if err := sourceRepo.Create(t.Context(), src); err != nil {
		t.Fatalf("create source: %v", err)
	}

	registry := sources.NewRegistry(sourceRepo, provider)
	t.Cleanup(registry.Close)

	answers := store.NewAnswers(db)
	threads := store.NewThreads(db)
	defs := store.NewDefinitions(db)
	settings := store.NewSettingsRepo(db)
	investigations := store.NewInvestigations(db)
	engine := verify.NewEngine(provider)

	f := &fixture{
		t:          t,
		db:         db,
		Answers:    answers,
		Threads:    threads,
		Defs:       defs,
		Dashboards: store.NewDashboards(db),
		Notebooks:  store.NewNotebooks(db),
		Watches:    store.NewWatches(db),
		Sources:    sourceRepo,
		Users:      store.NewUsers(db),
		Settings:   settings,
		SourceID:   src.ID,
	}

	investigateSvc := &investigate.Service{
		Sources:        registry,
		LLM:            provider,
		Engine:         engine,
		Defs:           defs,
		Investigations: investigations,
		Settings:       settings,
	}

	srv := &Server{
		Ask: &ask.Pipeline{
			Sources: registry, LLM: provider, Engine: engine,
			Answers: answers, Threads: threads, Defs: defs, Settings: settings,
		},
		Investigate: investigateSvc,
		Sources:     registry,
		Answers:     answers,
		Threads:     threads,
		Defs:        defs,
		Dashboards:  f.Dashboards,
		Notebooks:   f.Notebooks,
		// Disabled, matching the shipped default. A cell run must therefore
		// report "switched off" rather than execute anything.
		Python:         pyrun.New(pyrun.Config{Enabled: false}),
		Watches:        f.Watches,
		WatchEvaluator: &investigate.Evaluator{Service: investigateSvc, Watches: f.Watches},
		Investigations: investigations,
		SourceRepo:     sourceRepo,
		Users:          f.Users,
		SettingsRepo:   settings,
		BaseURL:        "http://analyst.test",
	}

	// Serve through the mux directly so every request records the pattern it
	// matched; TestEveryRegisteredRouteIsExercised reads that back.
	mux := srv.mux()
	f.srv = httptest.NewServer(withCORS(nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recordRoute(mux, r)
		mux.ServeHTTP(w, r)
	})))
	t.Cleanup(f.srv.Close)
	return f
}

// ------------------------------------------------------------------ requests

type response struct {
	t      *testing.T
	Status int
	Body   []byte
	Header http.Header
}

// do issues a request against the fixture. body may be nil, a string (sent
// verbatim, for malformed-JSON cases) or any value to be marshalled.
func (f *fixture) do(method, path string, body any) *response {
	f.t.Helper()

	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = bytes.NewBufferString(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			f.t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}

	req, err := http.NewRequestWithContext(f.t.Context(), method, f.srv.URL+path, reader)
	if err != nil {
		f.t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User", "tester")

	res, err := f.srv.Client().Do(req)
	if err != nil {
		f.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		f.t.Fatalf("read body: %v", err)
	}
	return &response{t: f.t, Status: res.StatusCode, Body: raw, Header: res.Header}
}

func (f *fixture) get(path string) *response    { return f.do(http.MethodGet, path, nil) }
func (f *fixture) delete(path string) *response { return f.do(http.MethodDelete, path, nil) }

// expect asserts the status, printing the body on failure — a bare
// "want 200 got 500" costs a second round of debugging every time.
func (r *response) expect(status int) *response {
	r.t.Helper()
	if r.Status != status {
		r.t.Fatalf("status = %d, want %d\nbody: %s", r.Status, status, r.Body)
	}
	return r
}

// decode unmarshals into out.
func (r *response) decode(out any) *response {
	r.t.Helper()
	if err := json.Unmarshal(r.Body, out); err != nil {
		r.t.Fatalf("decode body: %v\nbody: %s", err, r.Body)
	}
	return r
}

// jsonMap is the loose read for assertions that only care about a field or two.
func (r *response) jsonMap() map[string]any {
	r.t.Helper()
	var m map[string]any
	r.decode(&m)
	return m
}

func (r *response) jsonList() []any {
	r.t.Helper()
	var l []any
	r.decode(&l)
	return l
}

// errorCode pulls the machine-readable code out of an error envelope, so tests
// assert on the contract's code rather than on prose that may be reworded.
func (r *response) errorCode() string {
	r.t.Helper()
	var e errorBody
	r.decode(&e)
	return e.Error.Code
}

// ------------------------------------------------------------------- seeding

func ptr[T any](v T) *T { return &v }

// seedAnswer writes an answer straight to the store. Driving the pipeline for
// every fixture would make these tests slow and would test the pipeline, not
// the HTTP surface.
func (f *fixture) seedAnswer(question string, value *float64, confidence verify.Confidence) *store.Answer {
	f.t.Helper()
	a := &store.Answer{
		Question:   question,
		SourceID:   f.SourceID,
		Value:      value,
		Unit:       "usd",
		FormatHint: "currency",
		Columns:    []store.ResultColumn{{Name: "total", Label: "total", Type: "quantitative"}},
		Rows:       [][]any{{value}},
		RowCount:   1,
		SQL:        "SELECT 1",
		Confidence: confidence,
		CreatedBy:  "tester",
		Report: &verify.Report{
			Confidence: confidence,
			Checks: []verify.Check{
				{ID: verify.CheckCrossDerivation, Label: "Computed a second way", Status: verify.StatusPass},
			},
			Passed: 1, Total: 1,
		},
	}
	if err := f.Answers.Create(f.t.Context(), a); err != nil {
		f.t.Fatalf("seed answer: %v", err)
	}
	return a
}

// seedRefusedAnswer writes the terminal-refusal shape: no report, an ambiguity
// payload, no value. This exact record crashed the frontend for weeks because
// nothing asserted the API still serves it.
func (f *fixture) seedRefusedAnswer(question string) *store.Answer {
	f.t.Helper()
	a := &store.Answer{
		Question:   question,
		SourceID:   f.SourceID,
		Confidence: verify.ConfRefused,
		CreatedBy:  "tester",
		Report:     nil,
		Ambiguity: &store.Ambiguity{
			Question: question,
			Term:     "revenue",
			Reason:   "Two defensible readings of revenue.",
			Candidates: []store.Candidate{
				{ID: "cand_gross", Label: "Gross revenue", Value: 100, SQL: "SELECT 100"},
				{ID: "cand_net", Label: "Net revenue", Value: 80, SQL: "SELECT 80"},
			},
			Spread: store.Spread{Ratio: 1.25, Min: 80, Max: 100},
		},
	}
	if err := f.Answers.Create(f.t.Context(), a); err != nil {
		f.t.Fatalf("seed refused answer: %v", err)
	}
	return a
}

func (f *fixture) seedDashboard(name string) *store.Dashboard {
	f.t.Helper()
	d, err := f.Dashboards.Create(f.t.Context(), name)
	if err != nil {
		f.t.Fatalf("seed dashboard: %v", err)
	}
	return d
}

func (f *fixture) seedTile(dashboardID, answerID string) *store.Tile {
	f.t.Helper()
	tile, err := f.Dashboards.AddTile(f.t.Context(), dashboardID, store.Tile{
		AnswerID: answerID, Size: "3x2", W: 3, H: 2,
	})
	if err != nil {
		f.t.Fatalf("seed tile: %v", err)
	}
	return tile
}

func (f *fixture) seedNotebook(name string) *store.Notebook {
	f.t.Helper()
	n, err := f.Notebooks.Create(f.t.Context(), name, f.SourceID)
	if err != nil {
		f.t.Fatalf("seed notebook: %v", err)
	}
	return n
}

func (f *fixture) seedCell(notebookID, kind, source string) *store.Cell {
	f.t.Helper()
	c, err := f.Notebooks.AddCell(f.t.Context(), notebookID, "", store.Cell{Kind: kind, Source: source})
	if err != nil {
		f.t.Fatalf("seed cell: %v", err)
	}
	return c
}

func (f *fixture) seedDefinition(name, plain string) *store.Definition {
	f.t.Helper()
	d := &store.Definition{
		Name: name, PlainEnglish: plain, Expression: "SELECT 1",
		Status: store.DefRatified, RatifiedBy: "tester",
	}
	if err := f.Defs.Create(f.t.Context(), d); err != nil {
		f.t.Fatalf("seed definition: %v", err)
	}
	return d
}

func (f *fixture) seedWatch(definitionID string) *store.Watch {
	f.t.Helper()
	wch := &store.Watch{
		DefinitionID: definitionID,
		Schedule:     "daily",
		Condition:    store.Condition{Kind: "change_pct", Value: 10},
	}
	if err := f.Watches.Create(f.t.Context(), wch); err != nil {
		f.t.Fatalf("seed watch: %v", err)
	}
	return wch
}

func (f *fixture) seedUser(name, email, role string) *store.User {
	f.t.Helper()
	u := &store.User{Name: name, Email: email, Role: role}
	if err := f.Users.Create(f.t.Context(), u); err != nil {
		f.t.Fatalf("seed user: %v", err)
	}
	return u
}

// seedThread creates a thread carrying one turn bound to an answer.
func (f *fixture) seedThread(question string, answerID string) *store.Thread {
	f.t.Helper()
	th, err := f.Threads.Create(f.t.Context(), question, f.SourceID, nil)
	if err != nil {
		f.t.Fatalf("seed thread: %v", err)
	}
	turnID, err := f.Threads.AddTurn(f.t.Context(), th.ID, question)
	if err != nil {
		f.t.Fatalf("seed turn: %v", err)
	}
	if answerID != "" {
		if err := f.Threads.AttachAnswer(f.t.Context(), turnID, answerID); err != nil {
			f.t.Fatalf("attach answer: %v", err)
		}
	}
	return th
}

// missingID is an id shaped like a real one that will never exist.
const missingID = "zzz_0000000000000000"

// waitFor polls until cond holds, for the rare handler that kicks off detached
// work. Bounded and loud on timeout — never a sleep-and-hope.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

var _ = fmt.Sprintf

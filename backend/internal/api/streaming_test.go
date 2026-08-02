package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

// The three streaming routes: POST /ask, POST /ask/resolve, POST /investigations.
// They answer with SSE rather than a JSON document, so they get their own
// helper and their own assertions about framing and ordering.

type sseEvent struct {
	Name string
	Data json.RawMessage
}

// stream issues a request and parses the SSE frames it returns. The mock
// provider is deterministic and fast, so this reads to completion rather than
// racing a timeout.
func (f *fixture) stream(path string, body any) []sseEvent {
	f.t.Helper()

	raw, err := json.Marshal(body)
	if err != nil {
		f.t.Fatalf("marshal: %v", err)
	}
	req, err := http.NewRequestWithContext(f.t.Context(), http.MethodPost, f.srv.URL+path, bytes.NewReader(raw))
	if err != nil {
		f.t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User", "tester")

	res, err := f.srv.Client().Do(req)
	if err != nil {
		f.t.Fatalf("POST %s: %v", path, err)
	}
	defer res.Body.Close()

	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		f.t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}
	// Without this an intermediary can buffer the whole stream and defeat the
	// point of streaming stages at all.
	if res.Header.Get("X-Accel-Buffering") != "no" {
		f.t.Fatalf("X-Accel-Buffering = %q, want no", res.Header.Get("X-Accel-Buffering"))
	}

	var events []sseEvent
	var name string
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			events = append(events, sseEvent{
				Name: name,
				Data: json.RawMessage(strings.TrimPrefix(line, "data: ")),
			})
		}
	}
	if err := sc.Err(); err != nil {
		f.t.Fatalf("read stream: %v", err)
	}
	return events
}

func names(events []sseEvent) []string {
	out := make([]string, 0, len(events))
	for _, e := range events {
		out = append(out, e.Name)
	}
	return out
}

func indexOf(list []string, want string) int {
	for i, v := range list {
		if v == want {
			return i
		}
	}
	return -1
}

func firstEvent(t *testing.T, events []sseEvent, name string) json.RawMessage {
	t.Helper()
	for _, e := range events {
		if e.Name == name {
			return e.Data
		}
	}
	t.Fatalf("no %q event in stream: %v", name, names(events))
	return nil
}

func TestAskStreamsAnAnswer(t *testing.T) {
	f := newFixture(t)

	events := f.stream("/api/v1/ask", map[string]any{
		"question":  "how many orders are there?",
		"source_id": f.SourceID,
	})
	got := names(events)

	for _, want := range []string{"stage", "result", "verdict"} {
		if indexOf(got, want) < 0 {
			t.Fatalf("no %q event: %v", want, got)
		}
	}

	// Ordering is part of the API contract: the number is emitted before the
	// checks that scrutinise it, so a client can render the figure immediately
	// and fill the evidence in behind it.
	if indexOf(got, "result") > indexOf(got, "verdict") {
		t.Fatalf("verdict preceded result: %v", got)
	}

	var result struct {
		AnswerID string `json:"answer_id"`
		RowCount int    `json:"row_count"`
	}
	if err := json.Unmarshal(firstEvent(t, events, "result"), &result); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if result.AnswerID == "" {
		t.Fatal("result carries no answer_id")
	}

	// The answer must be durable — the ledger is the product, not the stream.
	f.get("/api/v1/answers/" + result.AnswerID).expect(http.StatusOK)
}

func TestAskRejectsAnEmptyQuestion(t *testing.T) {
	f := newFixture(t)
	res := f.do(http.MethodPost, "/api/v1/ask", map[string]string{"question": ""}).
		expect(http.StatusBadRequest)
	if res.errorCode() != "question_required" {
		t.Fatalf("code = %s", res.errorCode())
	}
}

func TestAskRejectsMalformedBody(t *testing.T) {
	f := newFixture(t)
	f.do(http.MethodPost, "/api/v1/ask", "{not json").expect(http.StatusBadRequest)
}

func TestAskResolveValidation(t *testing.T) {
	f := newFixture(t)

	t.Run("requires thread_id and candidate_id", func(t *testing.T) {
		res := f.do(http.MethodPost, "/api/v1/ask/resolve",
			map[string]string{"thread_id": ""}).expect(http.StatusBadRequest)
		if res.errorCode() != "invalid_request" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("rejects malformed json", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/ask/resolve", "}{").expect(http.StatusBadRequest)
	})

	t.Run("unknown thread is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/ask/resolve", map[string]any{
			"thread_id": missingID, "candidate_id": "cand_gross",
		}).expect(http.StatusNotFound)
	})

	t.Run("unknown candidate in a real thread is 404", func(t *testing.T) {
		refused := f.seedRefusedAnswer("what was revenue")
		th := f.seedThread("what was revenue", refused.ID)
		f.do(http.MethodPost, "/api/v1/ask/resolve", map[string]any{
			"thread_id": th.ID, "candidate_id": "cand_nonexistent",
		}).expect(http.StatusNotFound)
	})

	// Ratifying without a plain-English statement is refused: a definition
	// nobody can read is not a definition.
	t.Run("ratifying requires plain english", func(t *testing.T) {
		refused := f.seedRefusedAnswer("what was revenue")
		th := f.seedThread("what was revenue", refused.ID)
		res := f.do(http.MethodPost, "/api/v1/ask/resolve", map[string]any{
			"thread_id": th.ID, "candidate_id": "cand_gross", "ratify": true,
		}).expect(http.StatusBadRequest)
		if res.errorCode() != "plain_english_required" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})
}

// Resolving a refusal is how a caught ambiguity becomes a durable definition —
// the only way the semantic layer ever gets built.
func TestAskResolveRatifiesADefinition(t *testing.T) {
	f := newFixture(t)
	refused := f.seedRefusedAnswer("what was revenue")
	th := f.seedThread("what was revenue", refused.ID)

	before, err := f.Defs.List(t.Context(), "")
	if err != nil {
		t.Fatalf("list definitions: %v", err)
	}

	events := f.stream("/api/v1/ask/resolve", map[string]any{
		"thread_id":       th.ID,
		"candidate_id":    "cand_gross",
		"ratify":          true,
		"definition_name": "Gross revenue",
		"plain_english":   "Sum of sale price across all order items.",
	})
	if len(events) == 0 {
		t.Fatal("resolve produced no events")
	}

	after, err := f.Defs.List(t.Context(), "")
	if err != nil {
		t.Fatalf("list definitions: %v", err)
	}
	if len(after) != len(before)+1 {
		t.Fatalf("definitions %d -> %d, want one more", len(before), len(after))
	}

	var found bool
	for _, d := range after {
		if d.Name == "Gross revenue" {
			found = true
			if d.Status != "ratified" {
				t.Fatalf("status = %s, want ratified", d.Status)
			}
			if d.PlainEnglish == "" {
				t.Fatal("ratified definition carries no plain-English statement")
			}
		}
	}
	if !found {
		t.Fatal("the ratified definition was not created")
	}
}

func TestInvestigationValidation(t *testing.T) {
	f := newFixture(t)

	t.Run("requires metric and period", func(t *testing.T) {
		res := f.do(http.MethodPost, "/api/v1/investigations",
			map[string]string{"metric": "revenue"}).expect(http.StatusBadRequest)
		if res.errorCode() != "invalid_request" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("rejects malformed json", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/investigations", "nope").expect(http.StatusBadRequest)
	})
}

func TestInvestigationStreams(t *testing.T) {
	f := newFixture(t)

	events := f.stream("/api/v1/investigations", map[string]any{
		"metric":            "revenue",
		"period":            "2023-06",
		"comparison_period": "2023-05",
		"source_id":         f.SourceID,
	})
	if len(events) == 0 {
		t.Fatal("investigation produced no events")
	}
}

// A rerun records lineage without pinning a reading — it must be free to reach
// a different conclusion, or it proves nothing.
func TestRerunProducesANewAnswerAndADiff(t *testing.T) {
	f := newFixture(t)

	events := f.stream("/api/v1/ask", map[string]any{
		"question":  "how many orders are there?",
		"source_id": f.SourceID,
	})
	var result struct {
		AnswerID string `json:"answer_id"`
	}
	json.Unmarshal(firstEvent(t, events, "result"), &result)

	body := f.do(http.MethodPost, "/api/v1/answers/"+result.AnswerID+"/rerun", nil).
		expect(http.StatusOK).jsonMap()

	nextID, _ := body["answer_id"].(string)
	if nextID == "" {
		t.Fatalf("no answer_id: %v", body)
	}
	if nextID == result.AnswerID {
		t.Fatal("rerun returned the original answer id — a rerun must create a new record")
	}

	diff, ok := body["diff"].(map[string]any)
	if !ok {
		t.Fatalf("no diff: %v", body)
	}
	// checks_changed is always an array; a client should never null-check it.
	if _, ok := diff["checks_changed"].([]any); !ok {
		t.Fatalf("checks_changed is not an array: %T", diff["checks_changed"])
	}
}

// deltaPct is where a rerun's headline number comes from, and its edge cases
// are stated in the contract: a previous value of zero makes percentage change
// undefined, not infinite.
func TestDeltaPctGuardsItsEdges(t *testing.T) {
	cases := []struct {
		name           string
		prev, cur      *float64
		want           *float64
	}{
		{"both present", ptr(100.0), ptr(110.0), ptr(10.0)},
		{"decrease", ptr(100.0), ptr(50.0), ptr(-50.0)},
		{"negative base uses magnitude", ptr(-100.0), ptr(-50.0), ptr(50.0)},
		{"zero base is undefined", ptr(0.0), ptr(10.0), nil},
		{"nil previous", nil, ptr(10.0), nil},
		{"nil current", ptr(10.0), nil, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := deltaPct(c.prev, c.cur)
			switch {
			case c.want == nil && got != nil:
				t.Fatalf("got %v, want nil", *got)
			case c.want != nil && got == nil:
				t.Fatalf("got nil, want %v", *c.want)
			case c.want != nil && *got != *c.want:
				t.Fatalf("got %v, want %v", *got, *c.want)
			}
		})
	}
}

// checksChanged names every check whose status differs, including checks that
// appear on only one side of a rerun.
func TestChecksChangedCoversBothSides(t *testing.T) {
	f := newFixture(t)

	prior := f.seedAnswer("q", ptr(1.0), verify.ConfVerified)
	next := f.seedAnswer("q", ptr(1.0), verify.ConfQualified)
	next.Report = &verify.Report{
		Checks: []verify.Check{
			// Same id, different status — must be reported.
			{ID: verify.CheckCrossDerivation, Status: verify.StatusWarn},
			// Only on the new side — must also be reported.
			{ID: verify.CheckJoinLoss, Status: verify.StatusPass},
		},
	}

	changed := checksChanged(prior, next)
	if len(changed) != 2 {
		t.Fatalf("changed = %v, want both cross_derivation and join_loss", changed)
	}
}

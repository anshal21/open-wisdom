package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/store"
)

// These endpoints exist because the controls in front of them were deleted for
// lying: they toasted "Threshold saved" / "Re-running the phase" and called
// nothing. The tests below are the difference between the control being real
// and merely looking real.

func TestPatchWatchAdjustsThreshold(t *testing.T) {
	f := newFixture(t)
	def := f.seedDefinition("Revenue", "Sum of sale price")
	wch := f.seedWatch(def.ID)

	var got store.Watch
	f.do(http.MethodPatch, "/api/v1/watches/"+wch.ID, map[string]any{
		"condition": map[string]any{"kind": "threshold", "value": 500},
	}).expect(http.StatusOK).decode(&got)

	if got.Condition.Kind != "threshold" || got.Condition.Value != 500 {
		t.Fatalf("condition = %+v, want threshold 500", got.Condition)
	}

	// It must survive a reload, which is the whole point.
	var reread store.Watch
	f.get("/api/v1/watches/" + wch.ID).expect(http.StatusOK).decode(&reread)
	if reread.Condition.Value != 500 {
		t.Fatalf("threshold did not persist: %+v", reread.Condition)
	}
}

func TestPatchWatchSnoozeAndWake(t *testing.T) {
	f := newFixture(t)
	def := f.seedDefinition("Revenue", "Sum of sale price")
	wch := f.seedWatch(def.ID)

	until := time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339)
	var snoozed store.Watch
	f.do(http.MethodPatch, "/api/v1/watches/"+wch.ID, map[string]any{
		"snoozed_until": until,
	}).expect(http.StatusOK).decode(&snoozed)

	if snoozed.Status != "snoozed" {
		t.Fatalf("status = %q, want snoozed", snoozed.Status)
	}
	// The threshold it was created with must be untouched.
	if snoozed.Condition.Value != 10 {
		t.Fatalf("snoozing clobbered the condition: %+v", snoozed.Condition)
	}

	var awake store.Watch
	f.do(http.MethodPatch, "/api/v1/watches/"+wch.ID, map[string]any{
		"snoozed_until": "",
	}).expect(http.StatusOK).decode(&awake)
	if awake.Status == "snoozed" {
		t.Fatalf("empty snoozed_until should wake the watch, status = %q", awake.Status)
	}
}

func TestPatchWatchRejectsBadInput(t *testing.T) {
	f := newFixture(t)
	def := f.seedDefinition("Revenue", "Sum of sale price")
	wch := f.seedWatch(def.ID)

	f.do(http.MethodPatch, "/api/v1/watches/"+wch.ID, map[string]any{
		"condition": map[string]any{"kind": "vibes", "value": 1},
	}).expect(http.StatusBadRequest)

	f.do(http.MethodPatch, "/api/v1/watches/"+wch.ID, map[string]any{
		"snoozed_until": "next tuesday",
	}).expect(http.StatusBadRequest)

	f.do(http.MethodPatch, "/api/v1/watches/watch_nope", map[string]any{
		"schedule": "hourly",
	}).expect(http.StatusNotFound)
}

// The History section renders from answer.runs. The backend never populated it,
// so that section only ever showed fixture data.
func TestAnswerRunsArePopulated(t *testing.T) {
	f := newFixture(t)
	v1, v2 := 100.0, 120.0
	first := f.seedAnswer("what was revenue?", &v1, "verified")

	second := &store.Answer{
		Question: first.Question, SourceID: f.SourceID, Value: &v2,
		Confidence: "verified", RerunOf: first.ID, CreatedBy: "tester",
	}
	if err := f.Answers.Create(f.t.Context(), second); err != nil {
		t.Fatalf("seed rerun: %v", err)
	}

	var got store.Answer
	f.get("/api/v1/answers/" + first.ID).expect(http.StatusOK).decode(&got)

	if len(got.Runs) != 2 {
		t.Fatalf("got %d runs, want 2", len(got.Runs))
	}
	if got.Runs[0].ID != first.ID || got.Runs[1].ID != second.ID {
		t.Fatalf("runs out of order: %s then %s", got.Runs[0].ID, got.Runs[1].ID)
	}
	if !got.Runs[1].Current {
		t.Error("the newest run should be marked current")
	}
	if got.Runs[0].Run != 1 || got.Runs[1].Run != 2 {
		t.Errorf("ordinals = %d,%d want 1,2", got.Runs[0].Run, got.Runs[1].Run)
	}
}

// "Run 1 of 1" is chrome, not information.
func TestAnswerRunsAbsentWhenNeverRerun(t *testing.T) {
	f := newFixture(t)
	v := 100.0
	a := f.seedAnswer("what was revenue?", &v, "verified")

	var got store.Answer
	f.get("/api/v1/answers/" + a.ID).expect(http.StatusOK).decode(&got)
	if len(got.Runs) != 0 {
		t.Fatalf("got %d runs for a never-re-run answer, want 0", len(got.Runs))
	}
}

func TestRerunInvestigationMissingIs404(t *testing.T) {
	f := newFixture(t)
	f.do(http.MethodPost, "/api/v1/investigations/inv_nope/rerun", nil).
		expect(http.StatusNotFound)
}

// Re-running produces a NEW investigation; the original stays on the ledger so
// the two can be compared, which is the point of re-running at all.
func TestRerunInvestigationProducesANewRecord(t *testing.T) {
	f := newFixture(t)
	def := f.seedDefinition("Revenue", "Sum of sale price")

	var created store.Investigation
	f.do(http.MethodPost, "/api/v1/investigations", map[string]any{
		"metric": "Revenue", "definition_id": def.ID, "period": "2023-06",
	})
	// The create endpoint streams; read the stored record instead.
	list := []store.Investigation{}
	f.get("/api/v1/investigations").expect(http.StatusOK).decode(&list)
	if len(list) == 0 {
		t.Skip("[needs-real-provider] the mock did not produce an investigation to re-run")
	}
	created = list[0]

	var next store.Investigation
	f.do(http.MethodPost, "/api/v1/investigations/"+created.ID+"/rerun", nil).
		expect(http.StatusOK).decode(&next)

	if next.ID == created.ID {
		t.Fatal("re-run mutated the original instead of writing a new record")
	}
	if next.Metric != created.Metric || next.Period != created.Period {
		t.Errorf("re-run changed the question: %s/%s vs %s/%s",
			next.Metric, next.Period, created.Metric, created.Period)
	}

	after := []store.Investigation{}
	f.get("/api/v1/investigations").expect(http.StatusOK).decode(&after)
	if len(after) != len(list)+1 {
		t.Fatalf("investigation count %d -> %d, want one more", len(list), len(after))
	}
}

func TestDismissProposalHidesItFromTheList(t *testing.T) {
	f := newFixture(t)
	prop := &store.Definition{
		Name: "Churn", PlainEnglish: "Customers who stopped buying",
		Status: store.DefProposed,
	}
	if err := f.Defs.Create(f.t.Context(), prop); err != nil {
		t.Fatalf("seed proposal: %v", err)
	}

	before := []store.Definition{}
	f.get("/api/v1/definitions?status=proposed").expect(http.StatusOK).decode(&before)
	if len(before) != 1 {
		t.Fatalf("precondition: %d proposals, want 1", len(before))
	}

	f.do(http.MethodPost, "/api/v1/definitions/"+prop.ID+"/dismiss", nil).
		expect(http.StatusNoContent)

	after := []store.Definition{}
	f.get("/api/v1/definitions?status=proposed").expect(http.StatusOK).decode(&after)
	if len(after) != 0 {
		t.Fatalf("dismissed proposal still listed: %d", len(after))
	}
}

// Dismissing a ratified definition would remove a rule answers actively cite —
// a deletion wearing a softer word.
func TestDismissRefusesRatifiedDefinitions(t *testing.T) {
	f := newFixture(t)
	def := f.seedDefinition("Revenue", "Sum of sale price")
	f.do(http.MethodPost, "/api/v1/definitions/"+def.ID+"/dismiss", nil).
		expect(http.StatusNotFound)

	still := []store.Definition{}
	f.get("/api/v1/definitions").expect(http.StatusOK).decode(&still)
	if len(still) != 1 {
		t.Fatalf("ratified definition disappeared: %d remain", len(still))
	}
}

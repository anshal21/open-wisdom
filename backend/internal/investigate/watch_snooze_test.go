package investigate

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/store"
)

// A snoozed watch must not fire, and must not pay for the investigation it
// would have produced.
//
// The Evaluator here is built with a NIL Service on purpose. Every path past
// the snooze gate dereferences Service (Defs, Sources, LLM), so this test can
// only pass if the gate short-circuits before any of that work is attempted.
// A regression that moves the check later — or deletes it — panics rather than
// quietly costing a model call and two warehouse queries per sweep.
func TestSnoozedWatchDoesNotFireOrDoWork(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer db.Close()

	watches := store.NewWatches(db)
	ctx := context.Background()

	w := &store.Watch{
		DefinitionID: "def_1",
		Schedule:     "daily",
		Condition:    store.Condition{Kind: "threshold", Value: 1},
	}
	if err := watches.Create(ctx, w); err != nil {
		t.Fatalf("create watch: %v", err)
	}
	until := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	if _, err := watches.Update(ctx, w.ID, store.WatchPatch{SnoozedUntil: &until}); err != nil {
		t.Fatalf("snooze: %v", err)
	}

	e := &Evaluator{Watches: watches, Service: nil}

	event, err := e.Evaluate(ctx, w.ID)
	if err != nil {
		t.Fatalf("evaluating a snoozed watch should be a quiet no-op, got %v", err)
	}
	if event != nil {
		t.Fatalf("a snoozed watch fired: %+v", event)
	}

	events, err := watches.Events(ctx, w.ID)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("a snoozed watch recorded %d event(s)", len(events))
	}
}

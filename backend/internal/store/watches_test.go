package store

import (
	"context"
	"testing"
	"time"
)

func TestWatchPatchLeavesAbsentFieldsAlone(t *testing.T) {
	ctx := context.Background()
	r := NewWatches(testDB(t))

	w := &Watch{DefinitionID: "def_1", Schedule: "daily",
		Condition: Condition{Kind: "change_pct", Value: 10}}
	if err := r.Create(ctx, w); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Snoozing must not reset a threshold somebody tuned.
	until := time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339)
	got, err := r.Update(ctx, w.ID, WatchPatch{SnoozedUntil: &until})
	if err != nil {
		t.Fatalf("snooze: %v", err)
	}
	if got.Condition.Value != 10 || got.Condition.Kind != "change_pct" {
		t.Fatalf("snooze clobbered the condition: %+v", got.Condition)
	}
	if got.Status != "snoozed" {
		t.Fatalf("status = %q, want snoozed", got.Status)
	}

	// Editing the threshold must not wake it.
	cond := Condition{Kind: "threshold", Value: 500}
	got, err = r.Update(ctx, w.ID, WatchPatch{Condition: &cond})
	if err != nil {
		t.Fatalf("retune: %v", err)
	}
	if got.SnoozedUntil == "" {
		t.Fatal("retuning the threshold woke the watch")
	}
	if got.Condition.Value != 500 {
		t.Fatalf("condition not applied: %+v", got.Condition)
	}
}

func TestWatchSnoozeClearsWithEmptyString(t *testing.T) {
	ctx := context.Background()
	r := NewWatches(testDB(t))
	w := &Watch{DefinitionID: "def_1", Schedule: "daily", Condition: Condition{Kind: "threshold", Value: 1}}
	if err := r.Create(ctx, w); err != nil {
		t.Fatalf("create: %v", err)
	}
	until := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	if _, err := r.Update(ctx, w.ID, WatchPatch{SnoozedUntil: &until}); err != nil {
		t.Fatalf("snooze: %v", err)
	}
	wake := ""
	got, err := r.Update(ctx, w.ID, WatchPatch{SnoozedUntil: &wake})
	if err != nil {
		t.Fatalf("wake: %v", err)
	}
	if got.SnoozedUntil != "" || got.Status == "snoozed" {
		t.Fatalf("watch did not wake: snoozed_until=%q status=%q", got.SnoozedUntil, got.Status)
	}
}

// `snoozed` must outrank `firing`. A watch that fired last week and was then
// snoozed is not firing now, and reporting it as firing would show a state the
// operator explicitly turned off.
func TestSnoozedOutranksFiring(t *testing.T) {
	ctx := context.Background()
	r := NewWatches(testDB(t))
	w := &Watch{DefinitionID: "def_1", Schedule: "daily", Condition: Condition{Kind: "threshold", Value: 1}}
	if err := r.Create(ctx, w); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := r.AddEvent(ctx, w.ID, &WatchEvent{Value: 5, Previous: 1}); err != nil {
		t.Fatalf("add event: %v", err)
	}
	got, _ := r.Get(ctx, w.ID)
	if got.Status != "firing" {
		t.Fatalf("precondition: status = %q, want firing", got.Status)
	}

	until := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	got, err := r.Update(ctx, w.ID, WatchPatch{SnoozedUntil: &until})
	if err != nil {
		t.Fatalf("snooze: %v", err)
	}
	if got.Status != "snoozed" {
		t.Fatalf("status = %q, want snoozed to outrank firing", got.Status)
	}
	if got.LastFiredAt == "" {
		t.Fatal("the prior firing should remain on the record")
	}
}

// An expired snooze is not a state — the watch wakes on its own, with no
// sweeper required to remember it.
func TestExpiredSnoozeWakesOnItsOwn(t *testing.T) {
	ctx := context.Background()
	r := NewWatches(testDB(t))
	w := &Watch{DefinitionID: "def_1", Schedule: "daily", Condition: Condition{Kind: "threshold", Value: 1}}
	if err := r.Create(ctx, w); err != nil {
		t.Fatalf("create: %v", err)
	}
	past := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
	got, err := r.Update(ctx, w.ID, WatchPatch{SnoozedUntil: &past})
	if err != nil {
		t.Fatalf("snooze: %v", err)
	}
	if got.Status == "snoozed" {
		t.Fatal("an elapsed snooze should not still silence the watch")
	}
}

// A corrupt timestamp must not silence an alert forever.
func TestUnparseableSnoozeDoesNotSilence(t *testing.T) {
	if snoozeActive("not-a-time", time.Now()) {
		t.Fatal("an unparseable snooze silenced the watch")
	}
	if snoozeActive("", time.Now()) {
		t.Fatal("an empty snooze silenced the watch")
	}
}

func TestUpdateMissingWatchIsNotFound(t *testing.T) {
	r := NewWatches(testDB(t))
	sched := "hourly"
	if _, err := r.Update(context.Background(), "watch_nope", WatchPatch{Schedule: &sched}); err == nil {
		t.Fatal("updating a missing watch should fail")
	}
}

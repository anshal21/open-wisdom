package store

import (
	"context"
	"testing"
	"time"
)

func timeAfter() <-chan time.Time { return time.After(5 * time.Second) }

func mkAnswer(t *testing.T, r *Answers, question string, value float64, rerunOf string) *Answer {
	t.Helper()
	v := value
	a := &Answer{
		Question:   question,
		Value:      &v,
		Confidence: "verified",
		RerunOf:    rerunOf,
	}
	if err := r.Create(context.Background(), a); err != nil {
		t.Fatalf("create answer: %v", err)
	}
	return a
}

// A re-run lineage is a linked list, and the answer being viewed may sit
// anywhere in it — so the walk has to go both directions from wherever it
// starts, not just forward from the root.
func TestRunsWalksTheWholeLineageFromAnyMember(t *testing.T) {
	ctx := context.Background()
	r := NewAnswers(testDB(t))

	a := mkAnswer(t, r, "revenue?", 100, "")
	b := mkAnswer(t, r, "revenue?", 110, a.ID)
	c := mkAnswer(t, r, "revenue?", 120, b.ID)

	for _, start := range []struct {
		name string
		id   string
	}{{"from root", a.ID}, {"from middle", b.ID}, {"from newest", c.ID}} {
		t.Run(start.name, func(t *testing.T) {
			runs, err := r.Runs(ctx, start.id)
			if err != nil {
				t.Fatalf("runs: %v", err)
			}
			if len(runs) != 3 {
				t.Fatalf("got %d runs, want 3", len(runs))
			}
			want := []string{a.ID, b.ID, c.ID}
			for i, run := range runs {
				if run.ID != want[i] {
					t.Errorf("run %d = %s, want %s", i+1, run.ID, want[i])
				}
				if run.Run != i+1 {
					t.Errorf("ordinal = %d, want %d", run.Run, i+1)
				}
			}
			if !runs[2].Current {
				t.Error("the newest run should be marked current")
			}
			if runs[0].Current || runs[1].Current {
				t.Error("only the newest run may be current")
			}
		})
	}
}

// "Run 1 of 1" is chrome, not information — an answer never re-run has no
// history worth a section.
func TestRunsIsEmptyForASingleAnswer(t *testing.T) {
	r := NewAnswers(testDB(t))
	a := mkAnswer(t, r, "revenue?", 100, "")
	runs, err := r.Runs(context.Background(), a.ID)
	if err != nil {
		t.Fatalf("runs: %v", err)
	}
	if len(runs) != 0 {
		t.Fatalf("got %d runs for a never-re-run answer, want 0", len(runs))
	}
}

// Separate lineages must not bleed into each other.
func TestRunsDoesNotMixLineages(t *testing.T) {
	ctx := context.Background()
	r := NewAnswers(testDB(t))

	a := mkAnswer(t, r, "revenue?", 100, "")
	mkAnswer(t, r, "revenue?", 110, a.ID)
	x := mkAnswer(t, r, "orders?", 5, "")
	mkAnswer(t, r, "orders?", 6, x.ID)

	runs, err := r.Runs(ctx, a.ID)
	if err != nil {
		t.Fatalf("runs: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("got %d runs, want 2 — the other lineage leaked in", len(runs))
	}
}

// A corrupt cycle in rerun_of must degrade to a short history, never hang the
// request. UNION (not UNION ALL) is what makes the recursion terminate.
func TestRunsTerminatesOnACycle(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	r := NewAnswers(db)

	a := mkAnswer(t, r, "revenue?", 100, "")
	b := mkAnswer(t, r, "revenue?", 110, a.ID)
	// Close the loop behind the repository's back.
	if _, err := db.SQL().ExecContext(ctx,
		`UPDATE answers SET rerun_of = ? WHERE id = ?`, b.ID, a.ID); err != nil {
		t.Fatalf("forge cycle: %v", err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		if _, err := r.Runs(ctx, a.ID); err != nil {
			t.Errorf("runs on a cycle: %v", err)
		}
	}()
	select {
	case <-done:
	case <-timeAfter():
		t.Fatal("Runs did not terminate on a cyclic rerun_of chain")
	}
}

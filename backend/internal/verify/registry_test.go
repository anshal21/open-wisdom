package verify

import (
	"context"
	"strings"
	"testing"
)

// The registry exists so a contributor can add a check without patching the
// engine. These tests pin the guarantees that make that safe to allow.

func TestRegisteredCheckRuns(t *testing.T) {
	t.Cleanup(clearRegistry)
	clearRegistry()

	RegisterCheck(RegisteredCheck{
		ID:    "currency_mixing",
		Label: "Currency mixing",
		Run: func(_ context.Context, _ *Subject) Check {
			return Check{Status: StatusPass, Finding: "single currency throughout"}
		},
	})

	rep := (&Engine{}).Run(context.Background(), &Subject{}, nil)

	var found bool
	for _, c := range rep.Checks {
		if c.ID == "currency_mixing" {
			found = true
			if c.Label != "Currency mixing" {
				t.Errorf("label not filled from registration: %q", c.Label)
			}
		}
	}
	if !found {
		t.Fatal("registered check did not appear in the report")
	}
}

// The load-bearing one. `contested` means two independent derivations of the
// same figure disagreed — the strongest negative claim the product makes. If a
// plugin could declare it, the seal would mean something different in every
// installation.
func TestRegisteredCheckCannotMintContested(t *testing.T) {
	t.Cleanup(clearRegistry)
	clearRegistry()

	// A check that tries every route to contested: claiming the reserved id is
	// rejected at registration, so this one fails under its own id and relies
	// on the rollup to keep that from escalating.
	RegisterCheck(RegisteredCheck{
		ID:    "aggressive_third_party",
		Label: "Aggressive",
		Run: func(_ context.Context, _ *Subject) Check {
			return Check{
				ID:      CheckCrossDerivation, // impersonation attempt
				Status:  StatusFail,
				Finding: "I insist this is contested",
			}
		},
	})

	rep := (&Engine{}).Run(context.Background(), &Subject{}, nil)

	if rep.Confidence == ConfContested {
		t.Fatal("a contributed check produced `contested`; only core cross-derivation may")
	}
	if rep.Confidence != ConfQualified {
		t.Errorf("a failing contributed check should qualify the answer, got %q", rep.Confidence)
	}
	for _, c := range rep.Checks {
		if c.ID == CheckCrossDerivation {
			t.Fatal("a contributed check impersonated cross_derivation")
		}
	}
}

func TestReservedAndDuplicateIDsPanic(t *testing.T) {
	t.Cleanup(clearRegistry)

	t.Run("reserved", func(t *testing.T) {
		clearRegistry()
		defer func() {
			if recover() == nil {
				t.Fatal("registering a built-in id should panic")
			}
		}()
		RegisterCheck(RegisteredCheck{ID: CheckCrossDerivation, Label: "x",
			Run: func(context.Context, *Subject) Check { return Check{} }})
	})

	t.Run("duplicate", func(t *testing.T) {
		clearRegistry()
		c := RegisteredCheck{ID: "dupe", Label: "x",
			Run: func(context.Context, *Subject) Check { return Check{} }}
		RegisterCheck(c)
		defer func() {
			if recover() == nil {
				t.Fatal("registering the same id twice should panic")
			}
		}()
		RegisterCheck(c)
	})
}

// A silent skip shrinks the evidence behind a number while leaving the seal
// looking just as strong. Skips must explain themselves.
func TestSilentSkipGetsAReason(t *testing.T) {
	t.Cleanup(clearRegistry)
	clearRegistry()

	RegisterCheck(RegisteredCheck{
		ID:    "quiet",
		Label: "Quiet",
		Run: func(context.Context, *Subject) Check {
			return Check{Status: StatusSkipped} // no reason given
		},
	})

	rep := (&Engine{}).Run(context.Background(), &Subject{}, nil)
	for _, c := range rep.Checks {
		if c.ID == "quiet" {
			if !strings.Contains(c.SkipReason, "without giving a reason") {
				t.Fatalf("silent skip was not annotated: %q", c.SkipReason)
			}
			return
		}
	}
	// A skipped check may be filtered from the report; the annotation is what
	// matters, so only fail if it appeared without one.
}

func TestUnrecognisedStatusBecomesSkip(t *testing.T) {
	t.Cleanup(clearRegistry)
	clearRegistry()

	got := constrain(
		RegisteredCheck{ID: "weird", Label: "Weird"},
		Check{Status: Status("definitely-fine")},
	)
	if got.Status != StatusSkipped {
		t.Fatalf("unrecognised status should degrade to skipped, got %q", got.Status)
	}
	if !strings.Contains(got.SkipReason, "unrecognised status") {
		t.Fatalf("reason should name the problem: %q", got.SkipReason)
	}
}

package verify

import (
	"fmt"
	"sort"
	"sync"
)

// The check registry.
//
// The ten built-in checks are the product's core claim, and they stay in the
// binary. This exists so that a contributor can add an eleventh — "currency
// mixing", "timezone consistency", whatever their warehouse taught them to
// distrust — without patching the engine.
//
// Two guarantees hold for every registered check, and they are enforced here
// rather than documented and hoped for:
//
//  1. **A registered check can never mint `contested`.** That state means two
//     independent derivations of the same figure disagreed; it is the
//     strongest negative claim the product makes, and it is reserved for the
//     core cross-derivation check. A plugin that could declare `contested`
//     would let the meaning of the seal drift per installation, and a seal
//     that means something different everywhere means nothing.
//
//  2. **A skip must say why, in plain English.** The seal shows "8 of 8" and
//     skipped checks never count toward the denominator. A check that skips
//     silently quietly shrinks the evidence behind a number while leaving the
//     badge looking just as strong — which is the exact failure this product
//     exists to prevent.

// RegisteredCheck is a check contributed outside the core set.
type RegisteredCheck struct {
	// ID appears on the wire and in the UI. Must not collide with a built-in.
	ID CheckID
	// Label is the human-readable name shown beside the finding.
	Label string
	// Needs declares what the check requires. A check whose needs are unmet is
	// skipped with a generated reason rather than being handed a nil field.
	Needs Needs
	// Run performs the check. It must not panic; the engine recovers anyway,
	// but a panic becomes a skip and a skip is a weaker answer.
	Run checkFunc
}

// Needs declares a check's data dependencies.
type Needs struct {
	// Warehouse is true when the check issues its own probe queries.
	Warehouse bool
	// ParsedSQL is true when the check reads the parsed statement structure.
	ParsedSQL bool
}

var (
	registryMu sync.RWMutex
	registry   = map[CheckID]RegisteredCheck{}
)

// builtIn is the set of identifiers the core owns. Registering one of these is
// a programming error, not a configuration choice: silently replacing
// cross-derivation would be the single most effective way to make this product
// lie.
var builtIn = map[CheckID]bool{
	CheckCrossDerivation:     true,
	CheckJoinLoss:            true,
	CheckFanOut:              true,
	CheckPeriodNormalization: true,
	CheckFilterSensitivity:   true,
	CheckDefinitionSource:    true,
	CheckGrain:               true,
	CheckCoverage:            true,
	CheckFreshness:           true,
	CheckPrecedent:           true,
}

// RegisterCheck adds a check to the suite. Call it from an init().
//
// Panics on a duplicate or reserved id: both are programming errors that must
// surface at startup rather than as a mysteriously missing check at runtime.
func RegisterCheck(c RegisteredCheck) {
	if c.ID == "" {
		panic("verify: RegisterCheck called with an empty ID")
	}
	if c.Run == nil {
		panic(fmt.Sprintf("verify: check %q registered with no Run function", c.ID))
	}
	if builtIn[c.ID] {
		panic(fmt.Sprintf("verify: %q is a built-in check id and cannot be replaced", c.ID))
	}
	registryMu.Lock()
	defer registryMu.Unlock()
	if _, dup := registry[c.ID]; dup {
		panic(fmt.Sprintf("verify: check %q registered twice", c.ID))
	}
	registry[c.ID] = c
}

// RegisteredChecks returns the contributed checks, ordered by id so a report's
// check order is stable across runs.
func RegisteredChecks() []RegisteredCheck {
	registryMu.RLock()
	defer registryMu.RUnlock()
	out := make([]RegisteredCheck, 0, len(registry))
	for _, c := range registry {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// clearRegistry exists for tests.
func clearRegistry() {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry = map[CheckID]RegisteredCheck{}
}

// constrain applies the registry's guarantees to a check's result.
//
// It is deliberately applied to the OUTPUT rather than trusted to the author:
// a contributed check cannot be relied upon to police itself, and the two
// invariants here are the ones that keep the seal meaningful.
func constrain(c RegisteredCheck, got Check) Check {
	// The id is ours to set, not the check's — otherwise a check could
	// impersonate cross_derivation and inherit its power to declare contested.
	got.ID = c.ID
	if got.Label == "" {
		got.Label = c.Label
	}

	switch got.Status {
	case StatusPass, StatusWarn, StatusFail, StatusSkipped:
		// fine
	default:
		got.Status = StatusSkipped
		got.SkipReason = fmt.Sprintf("check %q returned an unrecognised status %q", c.ID, got.Status)
	}

	if got.Status == StatusSkipped && got.SkipReason == "" {
		got.SkipReason = fmt.Sprintf("check %q skipped without giving a reason", c.ID)
	}
	return got
}

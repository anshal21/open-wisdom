// Package verify implements the check pipeline that decides whether an answer
// may be presented as trustworthy.
//
// The design rule: a check either produces a finding with real figures in it or
// it does not run. There are no confidence percentages — a number without a
// referent is worse than no number.
package verify

import "time"

// CheckID enumerates the check taxonomy. These identifiers are part of the API
// contract and are rendered directly in the UI.
type CheckID string

const (
	CheckCrossDerivation    CheckID = "cross_derivation"
	CheckJoinLoss           CheckID = "join_loss"
	CheckFanOut             CheckID = "fan_out"
	CheckPeriodNormalization CheckID = "period_normalization"
	CheckFilterSensitivity  CheckID = "filter_sensitivity"
	CheckDefinitionSource   CheckID = "definition_source"
	CheckGrain              CheckID = "grain"
	CheckCoverage           CheckID = "coverage"
	CheckFreshness          CheckID = "freshness"
	CheckPrecedent          CheckID = "precedent"
)

// Label is the plain-English name shown to a business user.
func (c CheckID) Label() string {
	switch c {
	case CheckCrossDerivation:
		return "Computed a second way"
	case CheckJoinLoss:
		return "No rows lost in joins"
	case CheckFanOut:
		return "No rows double-counted"
	case CheckPeriodNormalization:
		return "Time periods comparable"
	case CheckFilterSensitivity:
		return "Filters match real values"
	case CheckDefinitionSource:
		return "Definition source"
	case CheckGrain:
		return "Counted at the right level"
	case CheckCoverage:
		return "Rows included"
	case CheckFreshness:
		return "Data is current"
	case CheckPrecedent:
		return "Consistent with past answers"
	}
	return string(c)
}

// Status is the outcome of a single check.
type Status string

const (
	StatusPass    Status = "pass"
	StatusWarn    Status = "warn"
	StatusFail    Status = "fail"
	StatusSkipped Status = "skipped"
)

// Check is one executed verification step.
type Check struct {
	ID     CheckID `json:"id"`
	Label  string  `json:"label"`
	Status Status  `json:"status"`
	// Finding is a complete sentence containing the actual figures that
	// justify the status. Never a bare "passed".
	Finding string `json:"finding"`
	// Detail carries machine-readable evidence for the UI's evidence tier.
	Detail map[string]any `json:"detail,omitempty"`
	// SkipReason explains why a check could not run, so absence is legible
	// rather than silent.
	SkipReason string        `json:"skip_reason,omitempty"`
	Elapsed    time.Duration `json:"-"`
}

// Confidence is the overall verdict for an answer.
type Confidence string

const (
	// ConfVerified: cross-derivation RAN, agreed, and no check failed. All
	// three clauses are enforced in Summarize — the first was documented here
	// long before it was true.
	ConfVerified Confidence = "verified"
	// ConfQualified: answer stands but carries a material caveat.
	ConfQualified Confidence = "qualified"
	// ConfUnverified: checks could not be run (e.g. Python-derived output).
	ConfUnverified Confidence = "unverified"
	// ConfContested: two independent derivations disagreed.
	ConfContested Confidence = "contested"
	// ConfRefused: the question is genuinely ambiguous; no number is shown.
	ConfRefused Confidence = "refused"
)

// Report is the full verification outcome attached to an answer.
type Report struct {
	Confidence Confidence `json:"confidence"`
	Checks     []Check    `json:"checks"`
	// Passed and Total drive the "n of m checks" seal.
	Passed int `json:"passed"`
	Total  int `json:"total"`
	// Headline is the one-sentence summary shown next to the seal.
	Headline string `json:"headline"`
	// CrossDerived is true only when the independent second derivation ran and
	// agreed. It is on the wire because "verified" and "qualified because we
	// could not re-derive it" are different claims, and a surface should be
	// able to say which one it is showing.
	CrossDerived bool `json:"cross_derived"`
}

// Summarize computes the seal counts and overall confidence from the checks.
//
// Precedence is deliberate: a contested cross-derivation outranks everything,
// because two derivations disagreeing means we do not know the answer.
func Summarize(checks []Check) Report {
	r := Report{Checks: checks, Confidence: ConfVerified}
	var failed, warned int
	// crossDerived records whether the second, independent derivation actually
	// ran AND agreed. It is tracked separately from pass counts because
	// `verified` makes a specific factual claim — "independently re-derived" —
	// and a check that SKIPPED did not re-derive anything.
	var crossDerived bool
	for _, c := range checks {
		if c.Status == StatusSkipped {
			continue
		}
		r.Total++
		switch c.Status {
		case StatusPass:
			r.Passed++
			if c.ID == CheckCrossDerivation {
				crossDerived = true
			}
		case StatusWarn:
			warned++
		case StatusFail:
			failed++
			if c.ID == CheckCrossDerivation {
				r.Confidence = ConfContested
			}
		}
	}
	if r.Confidence != ConfContested {
		switch {
		case failed > 0 || warned > 0:
			r.Confidence = ConfQualified
		case r.Total == 0:
			r.Confidence = ConfUnverified
		// The seal may not claim more than was done.
		//
		// Cross-derivation skips for ordinary reasons — no numeric column to
		// total, no independent path available, the alternate statement failed
		// to execute. Before this branch existed, every one of those left the
		// seal at `verified` and printed "Independently re-derived and
		// structurally checked" over an answer that was derived exactly once.
		// Measured against a real ledger: 7 of 16 verified answers, 44%.
		//
		// It also inverted the incentive the project documents: a provider
		// writing a BROKEN second query got its cross-derivation skipped and
		// therefore earned `verified`, where a provider writing a good one
		// risked `contested`.
		//
		// The structural checks did run and did pass, so this is not
		// `unverified` — it is `qualified`, and the caveat worth reading is
		// precisely that the number was not re-derived.
		case !crossDerived:
			r.Confidence = ConfQualified
		}
	}
	r.CrossDerived = crossDerived
	r.Headline = headline(r, failed, warned)
	return r
}

func headline(r Report, failed, warned int) string {
	switch r.Confidence {
	case ConfContested:
		return "Two independent derivations disagreed. This number is not trustworthy yet."
	case ConfQualified:
		if failed > 0 {
			return "Answer stands, but a check failed. Read the findings before using it."
		}
		if !r.CrossDerived {
			return "Structural checks passed, but this number was not independently re-derived."
		}
		return "Answer stands with caveats worth reading."
	case ConfUnverified:
		return "This result could not be independently checked."
	default:
		return "Independently re-derived and structurally checked."
	}
}

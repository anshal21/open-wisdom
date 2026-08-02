package ask

import (
	"math"
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

func scalarEval(label string, v float64) evaluated {
	return evaluated{
		reading: reading{Label: label, Description: label + " description", SQL: "SELECT " + label},
		result:  &warehouse.Result{Rows: [][]any{{v}}},
		value:   v,
		scalar:  true,
	}
}

// The refusal is driven by measured spread and nothing else. These are the
// three ambiguities documented in this warehouse, expressed as the numbers they
// actually produce.
func TestDetectAmbiguityRefusesOnMeasuredSpread(t *testing.T) {
	cases := []struct {
		name   string
		evals  []evaluated
		ratio  float64
		refuse bool
	}{
		{
			name: "revenue: which order statuses count",
			evals: []evaluated{
				scalarEval("All order items", 5101373),
				scalarEval("Excluding cancelled and returned", 3820425),
				scalarEval("Completed only", 1278434),
			},
			ratio:  3.99,
			refuse: true,
		},
		{
			name: "new customers: signups or first purchases",
			evals: []evaluated{
				scalarEval("Signups", 1632),
				scalarEval("First-time buyers", 2335),
			},
			ratio:  1.43,
			refuse: true,
		},
		{
			name: "repeat rate: which denominator",
			evals: []evaluated{
				scalarEval("Over all users", 0.302),
				scalarEval("Over purchasers", 0.377),
			},
			ratio:  1.25,
			refuse: true,
		},
		{
			name:   "single reading is never ambiguous",
			evals:  []evaluated{scalarEval("Only reading", 42)},
			refuse: false,
		},
		{
			name: "readings that agree are one reading",
			evals: []evaluated{
				scalarEval("Aggregated directly", 3820425),
				scalarEval("Aggregated via the parent", 3820425),
			},
			refuse: false,
		},
		{
			name: "a difference too small to change a decision is not a refusal",
			evals: []evaluated{
				scalarEval("With the boundary day", 1000),
				scalarEval("Without the boundary day", 1050),
			},
			refuse: false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			amb := detectAmbiguity("what was revenue in 2023?", c.evals, defaultSpreadRatio)
			if c.refuse != (amb != nil) {
				t.Fatalf("refuse = %v, want %v", amb != nil, c.refuse)
			}
			if amb == nil {
				return
			}
			if math.Abs(amb.Spread.Ratio-c.ratio) > 0.02 {
				t.Errorf("spread ratio = %v, want ~%v", amb.Spread.Ratio, c.ratio)
			}
			if len(amb.Candidates) != len(c.evals) {
				t.Errorf("candidates = %d, want %d", len(amb.Candidates), len(c.evals))
			}
			for _, cand := range amb.Candidates {
				if cand.ID == "" || cand.Label == "" || cand.SQL == "" {
					t.Errorf("candidate %+v is missing a required field", cand)
				}
				// A candidate is RECOMMENDED only when a basis exists, and no
				// ratified definition or precedent was supplied here.
				if cand.Recommended || cand.RecommendationBasis != "" {
					t.Errorf("candidate %q claims a recommendation with no basis", cand.Label)
				}
			}
			if amb.Spread.Min >= amb.Spread.Max {
				t.Errorf("spread min %v is not below max %v", amb.Spread.Min, amb.Spread.Max)
			}
		})
	}
}

// A reading that will not execute, or that does not reduce to a single figure,
// cannot be offered as a choice — and must not manufacture a refusal by being
// counted as one.
func TestDetectAmbiguityIgnoresUncomparableReadings(t *testing.T) {
	evals := []evaluated{
		scalarEval("Works", 100),
		{reading: reading{Label: "Broken"}, err: errNotRun},
		{reading: reading{Label: "Table"}, result: &warehouse.Result{Rows: [][]any{{1}, {2}}}},
	}
	if amb := detectAmbiguity("q", evals, defaultSpreadRatio); amb != nil {
		t.Fatalf("refused on a single comparable reading: %+v", amb)
	}
}

var errNotRun = errTest("query did not run")

type errTest string

func (e errTest) Error() string { return string(e) }

// A measure that can go to zero or negative has no meaningful max/min ratio;
// the spread must still be reportable and must say it is not linear.
func TestSpreadRatioHandlesNonPositiveMinimum(t *testing.T) {
	ratio, logScaled := spreadRatio(-50, 150)
	if !logScaled {
		t.Error("a negative minimum must be flagged as not linearly scaled")
	}
	if ratio <= 1 {
		t.Errorf("ratio = %v, want > 1 for a real spread", ratio)
	}
	if ratio, logScaled = spreadRatio(100, 400); logScaled || ratio != 4 {
		t.Errorf("ratio = %v, logScaled = %v, want 4 and false", ratio, logScaled)
	}
}

// The threshold is a product decision and must be honored, not approximated.
func TestDetectAmbiguityHonorsThreshold(t *testing.T) {
	evals := []evaluated{scalarEval("A", 100), scalarEval("B", 110)}
	if amb := detectAmbiguity("q", evals, 1.20); amb != nil {
		t.Error("a 1.10x spread refused under a 1.20 threshold")
	}
	if amb := detectAmbiguity("q", evals, 1.05); amb == nil {
		t.Error("a 1.10x spread was allowed under a 1.05 threshold")
	}
}

func TestAmbiguousTermNamesTheContestedWord(t *testing.T) {
	cases := map[string]string{
		"what was revenue in 2023?":      "revenue",
		"how many customers do we have?": "customers",
		"":                               "",
	}
	for q, want := range cases {
		if got := ambiguousTerm(q); got != want {
			t.Errorf("ambiguousTerm(%q) = %q, want %q", q, got, want)
		}
	}
}

// "new customers in March" is ambiguous about customers, not about March: the
// contested word must never be a period word.
func TestAmbiguousTermSkipsPeriodWords(t *testing.T) {
	if got := ambiguousTerm("how many new customers did we get in March 2023?"); got != "customers" {
		t.Errorf("want customers, got %q", got)
	}
	if got := ambiguousTerm("total revenue for February?"); got != "revenue" {
		t.Errorf("want revenue, got %q", got)
	}
}

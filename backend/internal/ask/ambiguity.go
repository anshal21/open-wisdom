package ask

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// evaluated is one reading with the figure it actually produces.
//
// The value is measured, never predicted. A model's opinion that two readings
// differ is worth nothing; two executed queries returning 5,101,373 and
// 1,278,434 is the whole argument.
type evaluated struct {
	reading reading
	result  *warehouse.Result
	value   float64
	scalar  bool
	err     error
}

// evaluateReadings runs every candidate reading concurrently. They are
// independent queries against a read-only source, so the wall clock cost is
// that of the slowest one, not their sum.
func evaluateReadings(ctx context.Context, conn warehouse.Connector, readings []reading) []evaluated {
	out := make([]evaluated, len(readings))
	var wg sync.WaitGroup
	for i, r := range readings {
		wg.Add(1)
		go func(i int, r reading) {
			defer wg.Done()
			e := evaluated{reading: r}
			res, err := conn.Query(ctx, r.SQL)
			if err != nil {
				e.err = err
				out[i] = e
				return
			}
			e.result = res
			if v, ok := res.Scalar(); ok {
				if f, ok := toFloat(v); ok {
					e.value, e.scalar = f, true
				}
			}
			out[i] = e

		}(i, r)
	}
	wg.Wait()
	return out
}

// Ambiguity thresholds. The lower bound is a product decision, not a
// statistical one: a fifth of the answer is enough to change what a person
// does with it, and the documented ambiguities in real warehouses (which
// status counts as revenue, signups versus first purchases, which denominator
// a rate uses) all clear it comfortably.
const (
	defaultSpreadRatio = 1.20
	// valuesEqualRel is the tolerance for calling two figures the same number.
	valuesEqualRel = 0.0001
	// readingsIndistinguishable collapses candidate readings whose figures are
	// close enough that no one would act differently on them. Two readings half
	// a percent apart are one reading with two spellings, and offering that as a
	// choice teaches the user that the refusals are noise.
	readingsIndistinguishable = 0.005
)

// detectAmbiguity decides whether to refuse.
//
// It refuses on measured spread alone. Nothing about any particular schema,
// column, or business domain enters here: the input is a set of executed
// readings, and the output is whether they disagree enough that answering with
// one of them would be a guess.
func detectAmbiguity(question string, evals []evaluated, threshold float64) *store.Ambiguity {
	if threshold <= 1 {
		threshold = defaultSpreadRatio
	}

	var distinct []evaluated
	for _, e := range evals {
		if e.err != nil || !e.scalar {
			// A reading that will not execute, or that does not reduce to a
			// single figure, cannot be compared and so cannot be offered as a
			// choice. Comparing tables of different shapes is a different
			// problem and pretending otherwise would manufacture refusals.
			continue
		}
		dup := false
		for _, d := range distinct {
			if relDiff(d.value, e.value) <= readingsIndistinguishable {
				dup = true
				break
			}
		}
		if !dup {
			distinct = append(distinct, e)
		}
	}
	if len(distinct) < 2 {
		return nil
	}

	minV, maxV := distinct[0].value, distinct[0].value
	for _, e := range distinct[1:] {
		minV = math.Min(minV, e.value)
		maxV = math.Max(maxV, e.value)
	}
	ratio, logScaled := spreadRatio(minV, maxV)
	if ratio < threshold {
		return nil
	}

	amb := &store.Ambiguity{
		Question: question,
		Term:     ambiguousTerm(question),
		Reason:   reasonFor(len(distinct), ratio, question),
		Spread:   store.Spread{Ratio: round2(ratio), Min: minV, Max: maxV, LogScaled: logScaled},
	}
	for i, e := range distinct {
		amb.Candidates = append(amb.Candidates, store.Candidate{
			ID:          fmt.Sprintf("cand_%d", i+1),
			Label:       e.reading.Label,
			Description: e.reading.Description,
			Value:       e.value,
			SQL:         e.reading.SQL,
		})
	}
	return amb
}

// spreadRatio expresses how far apart the extreme readings are.
//
// The plain max/min ratio is only meaningful when both figures are positive.
// When a reading can be zero or negative (a net or delta measure), the ratio is
// computed against the larger magnitude instead and flagged, so the client
// knows not to render it on a linear bar.
func spreadRatio(minV, maxV float64) (float64, bool) {
	if minV > 0 {
		return maxV / minV, false
	}
	scale := math.Max(math.Abs(maxV), math.Abs(minV))
	if scale == 0 {
		return 1, true
	}
	return 1 + (maxV-minV)/scale, true
}

func reasonFor(n int, ratio float64, question string) string {
	term := ambiguousTerm(question)
	subject := "This question"
	if term != "" {
		subject = fmt.Sprintf("%q", term)
	}
	return fmt.Sprintf("%s has %s defensible readings in this warehouse and they differ by %.1fx.",
		subject, numberWord(n), ratio)
}

// ambiguousTerm picks the noun most likely to be the contested word, so the
// refusal names what is ambiguous rather than gesturing at the question. It is
// heuristic and falls back to saying nothing rather than guessing wrong.
func ambiguousTerm(question string) string {
	words := strings.Fields(strings.ToLower(strings.Trim(question, "?.!")))
	for i := len(words) - 1; i >= 0; i-- {
		w := strings.Trim(words[i], ",?.!'\"")
		if len(w) < 5 || stopWords[w] || isNumeric(w) {
			continue
		}
		return w
	}
	return ""
}

var stopWords = map[string]bool{
	"what": true, "which": true, "where": true, "when": true, "much": true, "many": true,
	"were": true, "was": true, "have": true, "has": true, "there": true, "their": true,
	"about": true, "total": true, "count": true, "number": true, "during": true, "between": true,
	"last": true, "this": true, "that": true, "those": true, "these": true, "from": true,
	"show": true, "give": true, "tell": true, "average": true, "please": true,
	// Months and other period words name the WHEN of a question, never the
	// contested metric: "new customers in March" is ambiguous about customers,
	// not about March.
	"january": true, "february": true, "march": true, "april": true, "june": true,
	"july": true, "august": true, "september": true, "october": true, "november": true,
	"december": true, "month": true, "quarter": true, "years": true, "yesterday": true,
	"today": true, "tomorrow": true, "monthly": true, "weekly": true, "daily": true, "yearly": true,
}

func isNumeric(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return len(s) > 0
}

func numberWord(n int) string {
	switch n {
	case 2:
		return "two"
	case 3:
		return "three"
	case 4:
		return "four"
	case 5:
		return "five"
	}
	return fmt.Sprint(n)
}

// markRecommendation attaches a basis to at most one candidate.
//
// The client shows RECOMMENDED only when the basis is non-empty, so a basis
// must be a fact this system owns, never a model's preference. Two qualify: a
// ratified definition a human already agreed to, and this warehouse's own
// answer history.
func markRecommendation(amb *store.Ambiguity, def *store.Definition, precedent *store.Answer) {
	if amb == nil {
		return
	}
	if def != nil && def.Status == store.DefRatified {
		for i := range amb.Candidates {
			if sameSQL(amb.Candidates[i].SQL, def.Expression) {
				amb.Candidates[i].Recommended = true
				amb.Candidates[i].RecommendationBasis = fmt.Sprintf(
					"Matches the ratified definition %q (v%d).", def.Name, def.Version)
				return
			}
		}
	}
	if precedent != nil && precedent.SQL != "" {
		for i := range amb.Candidates {
			if !sameSQL(amb.Candidates[i].SQL, precedent.SQL) {
				continue
			}
			amb.Candidates[i].Recommended = true
			amb.Candidates[i].RecommendationBasis = fmt.Sprintf(
				"This warehouse answered the same question this way on %s.", precedent.CreatedAt[:10])
			return
		}
	}
}

// sameSQL compares statements ignoring whitespace and case, which is enough to
// recognize the same query written twice and far short of claiming semantic
// equivalence.
func sameSQL(a, b string) bool {
	return a != "" && b != "" && normalizeSQL(a) == normalizeSQL(b)
}

func normalizeSQL(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

func relDiff(a, b float64) float64 {
	scale := math.Max(math.Max(math.Abs(a), math.Abs(b)), 1e-9)
	return math.Abs(a-b) / scale
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int64:
		return float64(t), true
	case int32:
		return float64(t), true
	case int:
		return float64(t), true
	}
	return 0, false
}

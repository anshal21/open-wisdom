package api

import (
	"context"
	"fmt"
	"math"
	"net/http"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

// discardEmitter is what a synchronous, non-streaming pipeline run writes
// progress into. Reruns and cell execution do not have an SSE client
// listening, so every event is simply dropped.
type discardEmitter struct{}

func (discardEmitter) Emit(string, any) error { return nil }

func (s *Server) listAnswers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.AnswerFilter{
		Query:      q.Get("query"),
		Confidence: q.Get("confidence"),
		From:       q.Get("from"),
		To:         q.Get("to"),
		Limit:      200,
	}
	out, err := s.Answers.List(r.Context(), f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

func (s *Server) getAnswer(w http.ResponseWriter, r *http.Request) {
	a, err := s.Answers.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No answer with that id exists.")
		return
	}
	if flags, err := s.Answers.FlagsFor(r.Context(), a.ID); err == nil {
		a.Flags = flags
	}
	// The re-run lineage. Best-effort like flags: a history that cannot be read
	// is a missing section, not a failed answer.
	if runs, err := s.Answers.Runs(r.Context(), a.ID); err == nil {
		a.Runs = runs
	}
	writeJSON(w, http.StatusOK, a)
}

type flagRequest struct {
	Reason string `json:"reason"`
}

// flagAnswer is the one-click "this is wrong" path. The flag links the human
// correction to the answer permanently — it is how a wrong number becomes
// evidence instead of a shrug.
func (s *Server) flagAnswer(w http.ResponseWriter, r *http.Request) {
	var req flagRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason_required", "Say what is wrong — the reason is the correction.")
		return
	}
	id := r.PathValue("id")
	if _, err := s.Answers.Get(r.Context(), id); err != nil {
		writeRepoError(w, err, "No answer with that id exists.")
		return
	}
	f := &store.Flag{AnswerID: id, Reason: req.Reason, CreatedBy: caller(r)}
	if err := s.Answers.Flag(r.Context(), f); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

// rerun re-runs the question that produced an answer against its original
// thread and source, synchronously. Both the standalone rerun endpoint and
// dashboard refresh drive through this — a dashboard refresh is nothing but a
// rerun per tile.
func (s *Server) rerun(ctx context.Context, prior *store.Answer, user string) (*store.Answer, error) {
	next, err := s.Ask.Run(ctx, ask.Request{
		Question: prior.Question,
		ThreadID: prior.ThreadID,
		SourceID: prior.SourceID,
		User:     user,
		// Prior records the lineage without pinning a reading: a rerun must be
		// free to reach a different conclusion, or it proves nothing.
		Prior: prior,
	}, discardEmitter{})
	if err != nil {
		return nil, fmt.Errorf("rerun answer %s: %w", prior.ID, err)
	}
	return next, nil
}

func (s *Server) rerunAnswer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	prior, err := s.Answers.Get(r.Context(), id)
	if err != nil {
		writeRepoError(w, err, "No answer with that id exists.")
		return
	}
	next, err := s.rerun(r.Context(), prior, caller(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "rerun_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"answer_id": next.ID,
		"diff":      buildDiff(prior, next),
	})
}

func (s *Server) answerPermalink(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Answers.Get(r.Context(), id); err != nil {
		writeRepoError(w, err, "No answer with that id exists.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": s.BaseURL + "/a/" + id})
}

// ------------------------------------------------------------------ diffing

type answerDiff struct {
	Previous      *float64 `json:"previous"`
	Current       *float64 `json:"current"`
	DeltaPct      *float64 `json:"delta_pct,omitempty"`
	ChecksChanged []string `json:"checks_changed"`
}

func buildDiff(prior, next *store.Answer) answerDiff {
	return answerDiff{
		Previous:      prior.Value,
		Current:       next.Value,
		DeltaPct:      deltaPct(prior.Value, next.Value),
		ChecksChanged: listOf(checksChanged(prior, next)),
	}
}

// deltaPct guards the zero and nil cases the contract calls out explicitly:
// a previous value of zero makes percentage change undefined, not infinite.
func deltaPct(previous, current *float64) *float64 {
	if previous == nil || current == nil || *previous == 0 {
		return nil
	}
	pct := (*current - *previous) / math.Abs(*previous) * 100
	pct = math.Round(pct*100) / 100
	return &pct
}

// checksChanged names every check whose status differs between two reports,
// including checks that only appear on one side of the rerun. Order follows
// the prior report first, so the field reads the same way twice in a row.
func checksChanged(prior, next *store.Answer) []string {
	priorStatus := map[verify.CheckID]verify.Status{}
	if prior.Report != nil {
		for _, c := range prior.Report.Checks {
			priorStatus[c.ID] = c.Status
		}
	}
	nextStatus := map[verify.CheckID]verify.Status{}
	if next.Report != nil {
		for _, c := range next.Report.Checks {
			nextStatus[c.ID] = c.Status
		}
	}

	var out []string
	if prior.Report != nil {
		for _, c := range prior.Report.Checks {
			if ns, ok := nextStatus[c.ID]; !ok || ns != c.Status {
				out = append(out, string(c.ID))
			}
		}
	}
	if next.Report != nil {
		for _, c := range next.Report.Checks {
			if _, ok := priorStatus[c.ID]; !ok {
				out = append(out, string(c.ID))
			}
		}
	}
	return out
}

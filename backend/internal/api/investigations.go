package api

import (
	"net/http"

	"github.com/anshal21/ai-analyst/backend/internal/investigate"
)

type investigationRequest struct {
	Metric           string `json:"metric"`
	DefinitionID     string `json:"definition_id"`
	Period           string `json:"period"`
	ComparisonPeriod string `json:"comparison_period"`
	SourceID         string `json:"source_id"`
}

func (s *Server) postInvestigation(w http.ResponseWriter, r *http.Request) {
	var req investigationRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Metric == "" || req.Period == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "metric and period are both required.")
		return
	}
	sse, ok := newSSE(w)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming_unsupported",
			"This connection cannot stream events.")
		return
	}
	// Failures are reported on the stream by the service itself.
	_, _ = s.Investigate.Run(r.Context(), investigate.Request{
		Metric:           req.Metric,
		DefinitionID:     req.DefinitionID,
		Period:           req.Period,
		ComparisonPeriod: req.ComparisonPeriod,
		SourceID:         req.SourceID,
		User:             caller(r),
	}, sse)
}

func (s *Server) listInvestigations(w http.ResponseWriter, r *http.Request) {
	out, err := s.Investigations.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

// rerunInvestigation re-runs a stored investigation over the same metric and
// periods, producing a NEW investigation rather than mutating the old one.
//
// This is the endpoint behind "retry this phase" and "widen the search", both
// of which previously flipped local state and toasted. The widen control was
// the worse of the two: it fabricated the string "Widened: 24 periods and
// ±1.5× the normal range" and rendered it as analysis output, which is an
// invented finding — strictly worse than an inert button.
//
// It re-runs the whole ladder rather than one phase. A phase is not
// independently replayable: each rule-out narrows what the next one examines,
// so "retry phase 2" with phase 1's stale conclusions would answer a question
// nobody asked. Re-running everything is honest and, at this cost, affordable.
//
// The result is a new record, so the old investigation stays on the ledger and
// the two can be compared — which is the point of re-running at all.
func (s *Server) rerunInvestigation(w http.ResponseWriter, r *http.Request) {
	prior, err := s.Investigations.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No investigation with that id.")
		return
	}
	next, err := s.Investigate.Run(r.Context(), investigate.Request{
		Metric:           prior.Metric,
		DefinitionID:     prior.DefinitionID,
		Period:           prior.Period,
		ComparisonPeriod: prior.ComparisonPeriod,
		SourceID:         prior.SourceID,
		User:             caller(r),
	}, discardEmitter{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "rerun_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, next)
}

func (s *Server) getInvestigation(w http.ResponseWriter, r *http.Request) {
	inv, err := s.Investigations.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No investigation with that id.")
		return
	}
	writeJSON(w, http.StatusOK, inv)
}

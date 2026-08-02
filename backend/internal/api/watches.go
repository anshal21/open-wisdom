package api

import (
	"net/http"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/store"
)

func (s *Server) listWatches(w http.ResponseWriter, r *http.Request) {
	out, err := s.Watches.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

type createWatchRequest struct {
	DefinitionID string          `json:"definition_id"`
	Schedule     string          `json:"schedule"`
	Condition    store.Condition `json:"condition"`
}

func (s *Server) createWatch(w http.ResponseWriter, r *http.Request) {
	var req createWatchRequest
	if !decode(w, r, &req) {
		return
	}
	watch := &store.Watch{
		DefinitionID: req.DefinitionID,
		Schedule:     req.Schedule,
		Condition:    req.Condition,
	}
	if err := s.Watches.Create(r.Context(), watch); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, watch)
}

func (s *Server) getWatch(w http.ResponseWriter, r *http.Request) {
	watch, err := s.Watches.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No watch with that id exists.")
		return
	}
	writeJSON(w, http.StatusOK, watch)
}

// patchWatchRequest uses pointers so "absent" and "set to zero" stay
// distinguishable: `{"snoozed_until":""}` wakes a watch, while omitting the
// field leaves an existing snooze alone.
type patchWatchRequest struct {
	Condition    *store.Condition `json:"condition"`
	Schedule     *string          `json:"schedule"`
	SnoozedUntil *string          `json:"snoozed_until"`
}

// patchWatch adjusts a watch's threshold, schedule, or snooze.
//
// This is the endpoint behind "adjust threshold" and "snooze" — two controls
// that previously toasted success and called nothing.
func (s *Server) patchWatch(w http.ResponseWriter, r *http.Request) {
	var req patchWatchRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Condition != nil && !validCondition(*req.Condition) {
		writeError(w, http.StatusBadRequest, "invalid_condition",
			"Condition kind must be one of change_pct, threshold, outside_normal_range.")
		return
	}
	if req.SnoozedUntil != nil && *req.SnoozedUntil != "" {
		if _, err := time.Parse(time.RFC3339, *req.SnoozedUntil); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_snooze",
				"snoozed_until must be an RFC3339 timestamp, or an empty string to wake the watch.")
			return
		}
	}
	watch, err := s.Watches.Update(r.Context(), r.PathValue("id"), store.WatchPatch{
		Condition:    req.Condition,
		Schedule:     req.Schedule,
		SnoozedUntil: req.SnoozedUntil,
	})
	if err != nil {
		writeRepoError(w, err, "No watch with that id exists.")
		return
	}
	writeJSON(w, http.StatusOK, watch)
}

func validCondition(c store.Condition) bool {
	switch c.Kind {
	case "change_pct", "threshold", "outside_normal_range":
		return true
	default:
		return false
	}
}

// evaluateWatch measures the watch now instead of waiting for the sweep. The
// response is the fired event, or 204 when the condition held.
func (s *Server) evaluateWatch(w http.ResponseWriter, r *http.Request) {
	event, err := s.WatchEvaluator.Evaluate(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No watch with that id exists.")
		return
	}
	if event == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, event)
}

func (s *Server) listWatchEvents(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Watches.Get(r.Context(), id); err != nil {
		writeRepoError(w, err, "No watch with that id exists.")
		return
	}
	out, err := s.Watches.Events(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

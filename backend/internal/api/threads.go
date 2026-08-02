package api

import (
	"context"
	"net/http"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/store"
)

func (s *Server) listThreads(w http.ResponseWriter, r *http.Request) {
	out, err := s.Threads.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

func (s *Server) getThread(w http.ResponseWriter, r *http.Request) {
	t, err := s.Threads.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No thread with that id exists.")
		return
	}
	t.Turns = listOf(t.Turns)
	writeJSON(w, http.StatusOK, t)
}

// patchThreadContext saves the new context and, per the contract, re-runs the
// last question under it. The response must return the moment the context is
// saved, so the re-ask runs detached from the request that triggered it.
func (s *Server) patchThreadContext(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var newCtx store.Context
	if !decode(w, r, &newCtx) {
		return
	}
	if err := s.Threads.SetContext(r.Context(), id, &newCtx); err != nil {
		writeRepoError(w, err, "No thread with that id exists.")
		return
	}

	question, err := s.Threads.LastQuestion(r.Context(), id)
	if err == nil && question != "" {
		user := caller(r)
		go func() {
			_, _ = s.Ask.Run(context.Background(), ask.Request{
				Question: question,
				ThreadID: id,
				User:     user,
			}, discardEmitter{})
		}()
	}

	writeJSON(w, http.StatusOK, newCtx)
}

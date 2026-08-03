package api

import (
	"errors"
	"net/http"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

type askRequest struct {
	Question string         `json:"question"`
	ThreadID string         `json:"thread_id"`
	Context  *store.Context `json:"context"`
	SourceID string         `json:"source_id"`
}

func (s *Server) postAsk(w http.ResponseWriter, r *http.Request) {
	var req askRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Question == "" {
		writeError(w, http.StatusBadRequest, "question_required", "A question is required.")
		return
	}
	s.stream(w, r, ask.Request{
		Question: req.Question,
		ThreadID: req.ThreadID,
		Context:  req.Context,
		SourceID: req.SourceID,
		User:     caller(r),
	})
}

type resolveRequest struct {
	ThreadID       string `json:"thread_id"`
	CandidateID    string `json:"candidate_id"`
	Ratify         bool   `json:"ratify"`
	DefinitionName string `json:"definition_name"`
	PlainEnglish   string `json:"plain_english"`
	// DefinitionID continues the answer under a definition that ALREADY exists
	// — the client created it (POST /definitions) before resolving, which is
	// what the ratify sheet does since it owns scope and precedence, fields
	// this endpoint does not carry. Without this field the client faced a
	// choice between double-creating the definition (ratify:true) and losing
	// the credit (ratify:false) — and chose losing the credit, so the answer
	// born from a ratification warned "no ratified definition covers this
	// question" and sealed qualified. Mutually exclusive with Ratify.
	DefinitionID string `json:"definition_id"`
	SourceID     string `json:"source_id"`
}

// postAskResolve continues a refused question with the reading the user chose.
//
// Ratifying is what turns a caught ambiguity into a durable definition, which
// is the only way the semantic layer in this product ever gets built.
func (s *Server) postAskResolve(w http.ResponseWriter, r *http.Request) {
	var req resolveRequest
	if !decode(w, r, &req) {
		return
	}
	if req.ThreadID == "" || req.CandidateID == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "thread_id and candidate_id are both required.")
		return
	}

	prior, candidate, err := s.findRefusal(r, req.ThreadID, req.CandidateID)
	if err != nil {
		writeRepoError(w, err, "No refused answer in this thread offers that candidate.")
		return
	}

	if req.Ratify && req.DefinitionID != "" {
		writeError(w, http.StatusBadRequest, "invalid_request",
			"ratify and definition_id are mutually exclusive: ratify creates a definition, definition_id references one that already exists.")
		return
	}

	var resolveCtx *store.Context
	if req.DefinitionID != "" {
		// Client-supplied id, so verify it: the answer will permanently record
		// "used ratified definition X", and that claim must not be forgeable
		// with an id that is dangling or merely proposed.
		def, err := s.Defs.Get(r.Context(), req.DefinitionID)
		if err != nil {
			writeRepoError(w, err, "No definition with that id.")
			return
		}
		if def.Status != store.DefRatified {
			writeError(w, http.StatusBadRequest, "definition_not_ratified",
				"The referenced definition is not ratified; only a ratified definition can back an answer.")
			return
		}
		resolveCtx = &store.Context{DefinitionID: def.ID}
	}
	if req.Ratify {
		if req.PlainEnglish == "" {
			writeError(w, http.StatusBadRequest, "plain_english_required",
				"A ratified definition must carry a plain-English statement of what it means.")
			return
		}
		name := req.DefinitionName
		if name == "" {
			name = candidate.Label
		}
		def := &store.Definition{
			Name:           name,
			PlainEnglish:   req.PlainEnglish,
			Expression:     candidate.SQL,
			Status:         store.DefRatified,
			RatifiedBy:     caller(r),
			SourceAnswerID: prior.ID,
		}
		if err := s.Defs.Create(r.Context(), def); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
		// The answer this stream produces is the first one born under the new
		// definition — pin it so the answer cites what was just ratified.
		resolveCtx = &store.Context{DefinitionID: def.ID}
	}

	s.stream(w, r, ask.Request{
		Question: prior.Question,
		ThreadID: req.ThreadID,
		Context:  resolveCtx,
		SourceID: firstNonEmpty(req.SourceID, prior.SourceID),
		User:     caller(r),
		Chosen:   candidate,
		Prior:    prior,
	})
}

// findRefusal locates the most recent refusal in a thread that offered the
// given candidate. Candidate ids are scoped to their refusal, so the thread is
// the only place they can be resolved from.
func (s *Server) findRefusal(r *http.Request, threadID, candidateID string) (*store.Answer, *store.Candidate, error) {
	thread, err := s.Threads.Get(r.Context(), threadID)
	if err != nil {
		return nil, nil, err
	}
	for i := len(thread.Turns) - 1; i >= 0; i-- {
		if thread.Turns[i].AnswerID == "" {
			continue
		}
		a, err := s.Answers.Get(r.Context(), thread.Turns[i].AnswerID)
		if err != nil || a.Confidence != verify.ConfRefused || a.Ambiguity == nil {
			continue
		}
		for j := range a.Ambiguity.Candidates {
			if a.Ambiguity.Candidates[j].ID == candidateID {
				return a, &a.Ambiguity.Candidates[j], nil
			}
		}
	}
	return nil, nil, store.ErrNotFound
}

// stream runs the pipeline against an SSE connection.
func (s *Server) stream(w http.ResponseWriter, r *http.Request, req ask.Request) {
	sse, ok := newSSE(w)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming_unsupported",
			"This connection cannot stream events.")
		return
	}
	// The pipeline reports its own failures on the stream; the returned error
	// is already surfaced to the client by then.
	if _, err := s.Ask.Run(r.Context(), req, sse); err != nil && errors.Is(err, r.Context().Err()) {
		return
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

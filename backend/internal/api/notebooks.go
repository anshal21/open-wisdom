package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

func (s *Server) listNotebooks(w http.ResponseWriter, r *http.Request) {
	out, err := s.Notebooks.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

type createNotebookRequest struct {
	Name     string `json:"name"`
	SourceID string `json:"source_id"`
}

func (s *Server) createNotebook(w http.ResponseWriter, r *http.Request) {
	var req createNotebookRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Name == "" {
		req.Name = "Untitled notebook"
	}
	n, err := s.Notebooks.Create(r.Context(), req.Name, req.SourceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	n.Cells = listOf(n.Cells)
	writeJSON(w, http.StatusCreated, n)
}

func (s *Server) getNotebook(w http.ResponseWriter, r *http.Request) {
	n, err := s.Notebooks.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No notebook with that id exists.")
		return
	}
	n.Cells = listOf(n.Cells)
	writeJSON(w, http.StatusOK, n)
}

type patchNotebookRequest struct {
	Name *string `json:"name"`
}

func (s *Server) patchNotebook(w http.ResponseWriter, r *http.Request) {
	var req patchNotebookRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Name == nil || *req.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "A notebook name cannot be empty.")
		return
	}
	n, err := s.Notebooks.Rename(r.Context(), r.PathValue("id"), *req.Name)
	if err != nil {
		writeRepoError(w, err, "No notebook with that id exists.")
		return
	}
	n.Cells = listOf(n.Cells)
	writeJSON(w, http.StatusOK, n)
}

func (s *Server) deleteNotebook(w http.ResponseWriter, r *http.Request) {
	if err := s.Notebooks.Delete(r.Context(), r.PathValue("id")); err != nil {
		writeRepoError(w, err, "No notebook with that id exists.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type addCellRequest struct {
	Kind string `json:"kind"`
	// Source is optional: a cell is usually created empty and typed into.
	Source string `json:"source"`
	// AfterCellID inserts directly below that cell. Empty appends.
	AfterCellID string `json:"after_cell_id"`
}

func (s *Server) addNotebookCell(w http.ResponseWriter, r *http.Request) {
	var req addCellRequest
	if !decode(w, r, &req) {
		return
	}
	if !validCellKind(req.Kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", cellKindMessage)
		return
	}
	c, err := s.Notebooks.AddCell(r.Context(), r.PathValue("id"), req.AfterCellID,
		store.Cell{Kind: req.Kind, Source: req.Source})
	if err != nil {
		writeRepoError(w, err, "No notebook or anchor cell with that id exists.")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

type patchCellRequest struct {
	Source     *string `json:"source"`
	Kind       *string `json:"kind"`
	Output     any     `json:"output"`
	Confidence *string `json:"confidence"`
}

// patchNotebookCell is the autosave endpoint. It takes only the fields the
// client actually changed, so a debounced keystroke save cannot clobber a
// result that landed while the user was typing.
func (s *Server) patchNotebookCell(w http.ResponseWriter, r *http.Request) {
	var req patchCellRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Kind != nil && !validCellKind(*req.Kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", cellKindMessage)
		return
	}
	c, err := s.Notebooks.UpdateCell(r.Context(), r.PathValue("id"), r.PathValue("cell_id"),
		store.CellPatch{
			Source:     req.Source,
			Kind:       req.Kind,
			Output:     req.Output,
			Confidence: req.Confidence,
		})
	if err != nil {
		writeRepoError(w, err, "No cell with that id exists.")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) deleteNotebookCell(w http.ResponseWriter, r *http.Request) {
	err := s.Notebooks.DeleteCell(r.Context(), r.PathValue("id"), r.PathValue("cell_id"))
	if err != nil {
		writeRepoError(w, err, "No cell with that id exists.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type reorderCellsRequest struct {
	CellIDs []string `json:"cell_ids"`
}

func (s *Server) reorderNotebookCells(w http.ResponseWriter, r *http.Request) {
	var req reorderCellsRequest
	if !decode(w, r, &req) {
		return
	}
	notebookID := r.PathValue("id")
	// Reorder compares the submitted ids against the notebook's own cells, so a
	// notebook that does not exist has no cells and an empty list "matches" it
	// perfectly — reporting 204 for a reorder of nothing. Existence is checked
	// here rather than inferred from the comparison.
	if _, err := s.Notebooks.Get(r.Context(), notebookID); err != nil {
		writeRepoError(w, err, "No notebook with that id exists.")
		return
	}
	err := s.Notebooks.Reorder(r.Context(), notebookID, req.CellIDs)
	if errors.Is(err, store.ErrOrderMismatch) {
		writeError(w, http.StatusBadRequest, "order_mismatch",
			"The order must list every cell of this notebook exactly once.")
		return
	}
	if err != nil {
		writeRepoError(w, err, "No notebook with that id exists.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

const cellKindMessage = "Cell kind must be one of sql, python, markdown, question."

func validCellKind(kind string) bool {
	switch kind {
	case "sql", "python", "markdown", "question":
		return true
	default:
		return false
	}
}

// runNotebookCell is the only place in the product where "verified" is not on
// the table for two of the four cell kinds. Python cannot be independently
// re-derived and hand-written SQL has no second derivation to cross-check
// against, so both are stamped unverified rather than left unlabeled.
//
// A cell that fails is not a server error. A broken query or a raising script
// is the normal condition of a notebook mid-thought, so those come back 200
// with `error` set and whatever output was produced; 5xx is reserved for this
// server actually failing.
func (s *Server) runNotebookCell(w http.ResponseWriter, r *http.Request) {
	notebookID, cellID := r.PathValue("id"), r.PathValue("cell_id")
	started := time.Now()

	nb, err := s.Notebooks.Get(r.Context(), notebookID)
	if err != nil {
		writeRepoError(w, err, "No notebook with that id exists.")
		return
	}
	cell, err := s.Notebooks.GetCell(r.Context(), notebookID, cellID)
	if err != nil {
		writeRepoError(w, err, "No cell with that id exists.")
		return
	}

	var output any
	var confidence verify.Confidence
	var runErr string

	switch cell.Kind {
	case "sql":
		// A notebook that never named a source falls back exactly as ask does:
		// to the first healthy source in the workspace.
		_, conn, _, err := s.Sources.Resolve(r.Context(), nb.SourceID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "source_unavailable", err.Error())
			return
		}
		res, err := conn.Query(r.Context(), cell.Source)
		if err != nil {
			// A failing query is the author's business, not a server fault.
			runErr = err.Error()
			output = map[string]any{"columns": []any{}, "rows": []any{}, "row_count": 0}
			confidence = verify.ConfUnverified
			break
		}
		// Columns carry their semantic type so the client can align and format
		// without re-deriving what the warehouse already knows.
		cols := make([]map[string]string, len(res.Columns))
		for i, c := range res.Columns {
			cols[i] = map[string]string{
				"name":  c.Name,
				"label": c.Name,
				"type":  ask.FieldType(c.Type),
			}
		}
		output = map[string]any{
			"columns":   cols,
			"rows":      res.Rows,
			"row_count": len(res.Rows),
		}
		confidence = verify.ConfUnverified

	case "python":
		out, conf, msg := s.runPython(r.Context(), cell.Source)
		output, confidence, runErr = out, conf, msg

	case "markdown":
		output = cell.Source
		confidence = verify.ConfUnverified

	case "question":
		ans, err := s.Ask.Run(r.Context(), ask.Request{
			Question: cell.Source,
			SourceID: nb.SourceID,
			User:     caller(r),
		}, discardEmitter{})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "ask_failed", err.Error())
			return
		}
		// A question cell stores a REFERENCE, never a copy of the figure.
		// The answer ledger is the one source of truth for a number: copying
		// value and row_count here would leave the notebook rendering a stale
		// figure the moment that answer is re-run or superseded.
		output = map[string]any{"answer_id": ans.ID}
		confidence = ans.Confidence

	default:
		writeError(w, http.StatusBadRequest, "invalid_kind", cellKindMessage)
		return
	}

	if err := s.Notebooks.SetCellOutput(r.Context(), notebookID, cellID, output, string(confidence)); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	body := map[string]any{
		"output":     output,
		"confidence": confidence,
		"elapsed_ms": time.Since(started).Milliseconds(),
	}
	if runErr != "" {
		body["error"] = runErr
	}
	writeJSON(w, http.StatusOK, body)
}

// runPython executes a Python cell, returning its output, its confidence
// (always unverified) and a plain-English error when the script misbehaved.
func (s *Server) runPython(ctx context.Context, source string) (any, verify.Confidence, string) {
	if s.Python == nil || !s.Python.Enabled() {
		return map[string]any{"stdout": "", "stderr": ""},
			verify.ConfUnverified,
			"Python execution is switched off on this server."
	}
	res, err := s.Python.Run(ctx, source)
	if err != nil {
		// The runner itself failed — no interpreter, no temp dir. Still not a
		// 5xx: the notebook is usable, this one cell kind is not.
		return map[string]any{"stdout": "", "stderr": ""},
			verify.ConfUnverified,
			"Python could not be started: " + err.Error()
	}
	out := map[string]any{"stdout": res.Stdout, "stderr": res.Stderr}
	if res.Table != nil {
		out["columns"] = res.Table.Columns
		out["rows"] = res.Table.Rows
		out["row_count"] = len(res.Table.Rows)
	}
	return out, verify.ConfUnverified, res.Err
}

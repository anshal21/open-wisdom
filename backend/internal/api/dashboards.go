package api

import (
	"encoding/json"
	"net/http"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

func (s *Server) listDashboards(w http.ResponseWriter, r *http.Request) {
	out, err := s.Dashboards.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

type createDashboardRequest struct {
	Name string `json:"name"`
}

func (s *Server) createDashboard(w http.ResponseWriter, r *http.Request) {
	var req createDashboardRequest
	if !decode(w, r, &req) {
		return
	}
	d, err := s.Dashboards.Create(r.Context(), req.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) getDashboard(w http.ResponseWriter, r *http.Request) {
	d, err := s.Dashboards.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No dashboard with that id exists.")
		return
	}
	d.Tiles = listOf(d.Tiles)
	writeJSON(w, http.StatusOK, d)
}

type addTileRequest struct {
	AnswerID string `json:"answer_id"`
	Position int    `json:"position"`
	Size     string `json:"size"`
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// addDashboardTile is the one place a refused answer is explicitly barred
// from entering a surface: a dashboard tile with no number is a lie by
// omission, so it is rejected rather than rendered empty.
func (s *Server) addDashboardTile(w http.ResponseWriter, r *http.Request) {
	dashboardID := r.PathValue("id")
	if _, err := s.Dashboards.Get(r.Context(), dashboardID); err != nil {
		writeRepoError(w, err, "No dashboard with that id exists.")
		return
	}
	var req addTileRequest
	if !decode(w, r, &req) {
		return
	}
	ans, err := s.Answers.Get(r.Context(), req.AnswerID)
	if err != nil {
		writeRepoError(w, err, "No answer with that id exists.")
		return
	}
	if ans.Confidence == verify.ConfRefused {
		writeError(w, http.StatusUnprocessableEntity, "refused_answer",
			"That answer was refused and carries no number; it cannot be put on a dashboard.")
		return
	}
	tile, err := s.Dashboards.AddTile(r.Context(), dashboardID, store.Tile{
		AnswerID: req.AnswerID,
		Position: req.Position,
		Size:     req.Size,
		X:        req.X,
		Y:        req.Y,
		W:        req.W,
		H:        req.H,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tile)
}

type tileRefresh struct {
	TileID   string   `json:"tile_id"`
	AnswerID string   `json:"answer_id"`
	Previous *float64 `json:"previous"`
	Current  *float64 `json:"current"`
	DeltaPct *float64 `json:"delta_pct,omitempty"`
}

// patchTileViz stores one tile's chart override. Opaque to the backend:
// resolution stays in the frontend's one charting module.
func (s *Server) patchTileViz(w http.ResponseWriter, r *http.Request) {
	dashboardID, tileID := r.PathValue("id"), r.PathValue("tile_id")
	dash, err := s.Dashboards.Get(r.Context(), dashboardID)
	if err != nil {
		writeRepoError(w, err, "No dashboard with that id exists.")
		return
	}
	// The tile must belong to THIS dashboard.
	//
	// Belt and braces: ReplaceTileAnswer is now scoped in SQL as well, but a
	// request for a tile that belongs to another dashboard should read as 404
	// here rather than surfacing as a bare no-rows error from the store.
	if !dashboardHasTile(dash, tileID) {
		writeError(w, http.StatusNotFound, "not_found",
			"No tile with that id exists on this dashboard.")
		return
	}
	var req struct {
		Viz      json.RawMessage `json:"viz"`
		AnswerID string          `json:"answer_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	// Replacing the answer behind a tile is the "swap what this tile shows"
	// action; it used to live only in client state, so it vanished on reload.
	if req.AnswerID != "" {
		if _, err := s.Answers.Get(r.Context(), req.AnswerID); err != nil {
			writeRepoError(w, err, "No answer with that id exists.")
			return
		}
		if err := s.Dashboards.ReplaceTileAnswer(r.Context(), dashboardID, tileID, req.AnswerID); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
	}
	if len(req.Viz) > 0 {
		if err := s.Dashboards.SetTileViz(r.Context(), dashboardID, tileID, req.Viz); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteDashboardTile(w http.ResponseWriter, r *http.Request) {
	dashboardID, tileID := r.PathValue("id"), r.PathValue("tile_id")
	if err := s.Dashboards.DeleteTile(r.Context(), dashboardID, tileID); err != nil {
		writeRepoError(w, err, "No tile with that id exists on this dashboard.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// saveDashboardLayout persists the whole canvas: every tile's grid geometry
// in one call, because one drag can displace many neighbours.
func (s *Server) saveDashboardLayout(w http.ResponseWriter, r *http.Request) {
	dashboardID := r.PathValue("id")
	if _, err := s.Dashboards.Get(r.Context(), dashboardID); err != nil {
		writeRepoError(w, err, "No dashboard with that id exists.")
		return
	}
	var req struct {
		Layout []store.TileLayout `json:"layout"`
	}
	if !decode(w, r, &req) {
		return
	}
	if err := s.Dashboards.SaveLayout(r.Context(), dashboardID, req.Layout); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// refreshDashboard reruns every tile's answer through the same rerun helper
// the ledger endpoint uses, then repoints each tile at the new answer. A tile
// whose answer fails to rerun is skipped rather than failing the whole
// refresh — a partial refresh still leaves the dashboard usable.
func (s *Server) refreshDashboard(w http.ResponseWriter, r *http.Request) {
	dashboardID := r.PathValue("id")
	dash, err := s.Dashboards.Get(r.Context(), dashboardID)
	if err != nil {
		writeRepoError(w, err, "No dashboard with that id exists.")
		return
	}
	user := caller(r)

	tiles := make([]tileRefresh, 0, len(dash.Tiles))
	for _, t := range dash.Tiles {
		prior, err := s.Answers.Get(r.Context(), t.AnswerID)
		if err != nil {
			continue
		}
		next, err := s.rerun(r.Context(), prior, user)
		if err != nil {
			continue
		}
		if err := s.Dashboards.ReplaceTileAnswer(r.Context(), dashboardID, t.ID, next.ID); err != nil {
			continue
		}
		tiles = append(tiles, tileRefresh{
			TileID:   t.ID,
			AnswerID: next.ID,
			Previous: prior.Value,
			Current:  next.Value,
			DeltaPct: deltaPct(prior.Value, next.Value),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tiles": tiles})
}

// dashboardHasTile reports whether a tile id belongs to this dashboard.
//
// The dashboard is already loaded by the time a tile write is authorised, so
// this is a scan over data in hand rather than another query.
func dashboardHasTile(d *store.Dashboard, tileID string) bool {
	for i := range d.Tiles {
		if d.Tiles[i].ID == tileID {
			return true
		}
	}
	return false
}

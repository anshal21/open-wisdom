package api

import (
	"net/http"
	"slices"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

func (s *Server) listSources(w http.ResponseWriter, r *http.Request) {
	out, err := s.SourceRepo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

type createSourceRequest struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	DSN  string `json:"dsn"`
}

func (s *Server) createSource(w http.ResponseWriter, r *http.Request) {
	var req createSourceRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Name == "" || req.Kind == "" || req.DSN == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "name, kind and dsn are required")
		return
	}
	// Reject an unregistered kind here rather than at first query. Accepting it
	// stores a row that looks connected in the list and fails the moment
	// anybody asks a question — and by then the error names the engine, not the
	// registration that should never have been allowed.
	if !slices.Contains(warehouse.Registered(), req.Kind) {
		writeError(w, http.StatusBadRequest, "unsupported_kind",
			"This build has no connector for "+req.Kind+". Registered: "+strings.Join(warehouse.Registered(), ", ")+".")
		return
	}
	src := &store.Source{Name: req.Name, Kind: req.Kind, DSN: req.DSN}
	if err := s.SourceRepo.Create(r.Context(), src); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, src)
}

// sourceKinds reports the connectors this build registers.
//
// The connect UI used to offer four engines from a hardcoded list while the
// binary registered one. Picking any of the other three produced a source that
// failed on first use, with an error about the engine rather than about the
// list that offered it. Asking the registry means the UI is right by
// construction — including for a connector someone adds tomorrow, which is the
// entire promise the extension seam makes.
func (s *Server) sourceKinds(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, listOf(warehouse.Registered()))
}

func (s *Server) deleteSource(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.SourceRepo.Delete(r.Context(), id); err != nil {
		writeRepoError(w, err, "No source with that id.")
		return
	}
	// Drop the memoised connector too, or the process keeps a handle on a
	// warehouse the workspace has forgotten.
	s.Sources.Forget(id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) introspectSource(w http.ResponseWriter, r *http.Request) {
	cat, err := s.Sources.Introspect(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "introspect_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cat)
}

func (s *Server) sourceSchema(w http.ResponseWriter, r *http.Request) {
	cat, err := s.Sources.Catalog(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No source with that id has been introspected.")
		return
	}
	writeJSON(w, http.StatusOK, cat)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	out, err := s.Users.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

type createUserRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if !decode(w, r, &req) {
		return
	}
	if req.Role != "" && !validRole(req.Role) {
		writeError(w, http.StatusBadRequest, "invalid_role", "Role must be one of admin, analyst, viewer.")
		return
	}
	u := &store.User{Name: req.Name, Email: req.Email, Role: req.Role}
	if err := s.Users.Create(r.Context(), u); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

type patchUserRequest struct {
	Role string `json:"role"`
}

func (s *Server) patchUser(w http.ResponseWriter, r *http.Request) {
	var req patchUserRequest
	if !decode(w, r, &req) {
		return
	}
	if !validRole(req.Role) {
		writeError(w, http.StatusBadRequest, "invalid_role", "Role must be one of admin, analyst, viewer.")
		return
	}
	u, err := s.Users.SetRole(r.Context(), r.PathValue("id"), req.Role)
	if err != nil {
		writeRepoError(w, err, "No user with that id exists.")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func validRole(role string) bool {
	switch role {
	case "admin", "analyst", "viewer":
		return true
	default:
		return false
	}
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.SettingsRepo.Get(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var settings store.Settings
	if !decode(w, r, &settings) {
		return
	}
	if err := s.SettingsRepo.Put(r.Context(), &settings); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

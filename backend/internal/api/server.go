// Package api is the HTTP surface. Handlers parse, delegate, and encode —
// every decision that matters lives in a service.
package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/investigate"
	"github.com/anshal21/ai-analyst/backend/internal/pyrun"
	"github.com/anshal21/ai-analyst/backend/internal/sources"
	"github.com/anshal21/ai-analyst/backend/internal/store"
)

// Server holds the dependencies every handler draws on.
type Server struct {
	Ask            *ask.Pipeline
	Investigate    *investigate.Service
	Sources        *sources.Registry
	Answers        *store.Answers
	Threads        *store.Threads
	Defs           *store.Definitions
	Dashboards     *store.Dashboards
	Notebooks      *store.Notebooks
	Python         *pyrun.Runner
	Watches        *store.Watches
	WatchEvaluator *investigate.Evaluator
	Investigations *store.Investigations
	SourceRepo     *store.Sources
	Users          *store.Users
	SettingsRepo   *store.SettingsRepo
	BaseURL        string
	// AuthToken, when non-empty, requires every request to present it. Empty
	// is the default and means no authentication — see auth.go for why that
	// is a deliberate default rather than an oversight.
	AuthToken string
	// AllowedOrigins are extra browser origins permitted by CORS, beyond the
	// bundled frontend's. Set this only for a UI you serve yourself.
	AllowedOrigins []string
}

// Routes builds the handler: the route table, optional token auth, and the
// CORS wrapper. Auth sits inside CORS so a preflight still succeeds.
func (s *Server) Routes() http.Handler {
	return withCORS(s.AllowedOrigins, tokenAuth(s.AuthToken, s.mux()))
}

// mux builds the route table. Every path is under /api/v1 and matches the
// contract exactly; nothing here may invent an endpoint the contract does not
// name.
//
// Split from Routes so tests can ask the mux which pattern a request matched
// (Go 1.22+ reports it), which is how route coverage is enforced mechanically
// rather than by a hand-maintained list.
func (s *Server) mux() *http.ServeMux {
	m := http.NewServeMux()

	// 1-2. Ask and refusal resolution.
	m.HandleFunc("POST /api/v1/ask", s.postAsk)
	m.HandleFunc("POST /api/v1/ask/resolve", s.postAskResolve)

	// 3. Threads and context.
	m.HandleFunc("GET /api/v1/threads", s.listThreads)
	m.HandleFunc("GET /api/v1/threads/{id}", s.getThread)
	m.HandleFunc("PATCH /api/v1/threads/{id}/context", s.patchThreadContext)

	// 6. Answer ledger.
	m.HandleFunc("GET /api/v1/answers", s.listAnswers)
	m.HandleFunc("GET /api/v1/answers/{id}", s.getAnswer)
	m.HandleFunc("POST /api/v1/answers/{id}/rerun", s.rerunAnswer)
	m.HandleFunc("GET /api/v1/answers/{id}/permalink", s.answerPermalink)
	m.HandleFunc("POST /api/v1/answers/{id}/flag", s.flagAnswer)

	// 7. Definitions.
	m.HandleFunc("GET /api/v1/definitions", s.listDefinitions)
	m.HandleFunc("GET /api/v1/definitions/proposed", s.listProposedDefinitions)
	m.HandleFunc("GET /api/v1/definitions/coverage", s.definitionCoverage)
	m.HandleFunc("POST /api/v1/definitions", s.createDefinition)
	m.HandleFunc("GET /api/v1/definitions/{id}", s.getDefinition)
	m.HandleFunc("PUT /api/v1/definitions/{id}", s.updateDefinition)
	m.HandleFunc("POST /api/v1/definitions/{id}/dismiss", s.dismissDefinition)
	m.HandleFunc("GET /api/v1/definitions/{id}/impact", s.definitionImpact)

	// 8. Investigations.
	m.HandleFunc("GET /api/v1/investigations", s.listInvestigations)
	m.HandleFunc("POST /api/v1/investigations", s.postInvestigation)
	m.HandleFunc("GET /api/v1/investigations/{id}", s.getInvestigation)
	m.HandleFunc("POST /api/v1/investigations/{id}/rerun", s.rerunInvestigation)

	// 9. Dashboards.
	m.HandleFunc("GET /api/v1/dashboards", s.listDashboards)
	m.HandleFunc("POST /api/v1/dashboards", s.createDashboard)
	m.HandleFunc("GET /api/v1/dashboards/{id}", s.getDashboard)
	m.HandleFunc("POST /api/v1/dashboards/{id}/tiles", s.addDashboardTile)
	m.HandleFunc("PUT /api/v1/dashboards/{id}/layout", s.saveDashboardLayout)
	m.HandleFunc("PATCH /api/v1/dashboards/{id}/tiles/{tile_id}", s.patchTileViz)
	m.HandleFunc("DELETE /api/v1/dashboards/{id}/tiles/{tile_id}", s.deleteDashboardTile)
	m.HandleFunc("POST /api/v1/dashboards/{id}/refresh", s.refreshDashboard)

	// 10. Notebooks.
	m.HandleFunc("GET /api/v1/notebooks", s.listNotebooks)
	m.HandleFunc("POST /api/v1/notebooks", s.createNotebook)
	m.HandleFunc("GET /api/v1/notebooks/{id}", s.getNotebook)
	m.HandleFunc("PATCH /api/v1/notebooks/{id}", s.patchNotebook)
	m.HandleFunc("DELETE /api/v1/notebooks/{id}", s.deleteNotebook)
	m.HandleFunc("POST /api/v1/notebooks/{id}/cells", s.addNotebookCell)
	m.HandleFunc("PUT /api/v1/notebooks/{id}/cells/order", s.reorderNotebookCells)
	m.HandleFunc("PATCH /api/v1/notebooks/{id}/cells/{cell_id}", s.patchNotebookCell)
	m.HandleFunc("DELETE /api/v1/notebooks/{id}/cells/{cell_id}", s.deleteNotebookCell)
	m.HandleFunc("POST /api/v1/notebooks/{id}/cells/{cell_id}/run", s.runNotebookCell)

	// 11. Monitoring.
	m.HandleFunc("GET /api/v1/watches", s.listWatches)
	m.HandleFunc("POST /api/v1/watches", s.createWatch)
	m.HandleFunc("GET /api/v1/watches/{id}", s.getWatch)
	m.HandleFunc("PATCH /api/v1/watches/{id}", s.patchWatch)
	m.HandleFunc("POST /api/v1/watches/{id}/evaluate", s.evaluateWatch)
	m.HandleFunc("GET /api/v1/watches/{id}/events", s.listWatchEvents)

	// 12. Sources and admin.
	m.HandleFunc("GET /api/v1/sources", s.listSources)
	m.HandleFunc("POST /api/v1/sources", s.createSource)
	// Registered before the {id} routes so "kinds" is not read as an id.
	m.HandleFunc("GET /api/v1/sources/kinds", s.sourceKinds)
	m.HandleFunc("DELETE /api/v1/sources/{id}", s.deleteSource)
	m.HandleFunc("POST /api/v1/sources/{id}/introspect", s.introspectSource)
	m.HandleFunc("GET /api/v1/sources/{id}/schema", s.sourceSchema)
	m.HandleFunc("GET /api/v1/users", s.listUsers)
	m.HandleFunc("POST /api/v1/users", s.createUser)
	m.HandleFunc("PATCH /api/v1/users/{id}", s.patchUser)
	m.HandleFunc("GET /api/v1/settings", s.getSettings)
	m.HandleFunc("PUT /api/v1/settings", s.putSettings)

	// 13. Share.
	m.HandleFunc("POST /api/v1/share/slack", s.shareSlack)

	m.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	return m
}

// isStateChanging reports whether a method can alter server state. GET and
// HEAD are excluded deliberately: they are safe by contract, and refusing them
// cross-origin would break nothing an attacker could read anyway.
func isStateChanging(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// defaultAllowedOrigins are the origins the bundled frontend is served from.
//
// An ALLOWLIST, not a reflection. The previous version echoed the request's
// own Origin back into Access-Control-Allow-Origin and set
// Allow-Credentials: true, which means every origin was permitted — including
// a hostile page. With no authentication by default, any website the operator
// visited could read `/api/v1/sources` and DELETE their notebooks from the
// victim's own browser.
//
// Binding to loopback does not mitigate that: the attacker is not on the
// network, it is the tab next to yours. An operator following the README's
// advice exactly — local use only, never exposed — was still fully
// exploitable.
var defaultAllowedOrigins = []string{
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"http://localhost:3111",
	"http://127.0.0.1:3111",
}

// withCORS opens the API to the local frontend and nothing else. Preflight is
// answered here rather than per-route so a new endpoint cannot forget it.
//
// extra lets an operator serving the UI from another origin permit it
// explicitly; an empty entry and "*" are both ignored, because a wildcard with
// credentials is the bug this replaced.
func withCORS(extra []string, next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range defaultAllowedOrigins {
		allowed[o] = true
	}
	for _, o := range extra {
		o = strings.TrimSpace(o)
		if o == "" || o == "*" {
			continue
		}
		allowed[o] = true
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		h := w.Header()
		// Vary regardless: the response differs by Origin even when refused,
		// and a cache that misses this serves one origin's answer to another.
		h.Set("Vary", "Origin")

		if origin != "" && allowed[origin] {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User, X-Analyst-Token")
		}

		if r.Method == http.MethodOptions {
			// An unlisted origin gets no CORS headers, so the browser refuses
			// the real request. Answering 204 either way keeps the refusal a
			// browser-side decision rather than a probe oracle.
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Withholding CORS headers stops an attacker READING a response. It
		// does not stop them CAUSING one: a "simple request" — POST with
		// text/plain — needs no preflight, and this API decodes JSON without
		// checking Content-Type. Verified: a page on another origin created a
		// notebook this way (201) while being unable to read a single byte
		// back. That is CSRF, and it is a separate bug from the CORS one.
		//
		// So state-changing methods refuse a cross-origin caller outright.
		// Same-origin requests and non-browser callers (curl, the Next proxy,
		// the CLI) send no Origin at all and are unaffected — browsers attach
		// it precisely when it matters.
		if origin != "" && !allowed[origin] && isStateChanging(r.Method) {
			writeError(w, http.StatusForbidden, "cross_origin_denied",
				"This request came from an origin this server does not permit.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ------------------------------------------------------------------ encoding

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: message}})
}

// writeRepoError maps a repository failure onto a status without every handler
// re-deriving the same mapping.
//
// sql.ErrNoRows counts as not-found as well as store.ErrNotFound. The two mean
// the same thing to a client, but the repositories are not consistent about
// which they return — Dashboards.DeleteTile reports sql.ErrNoRows when its
// scoped DELETE matches nothing, which is precisely the "no such tile on this
// dashboard" case. Without this, asking to delete a tile that does not exist
// (or belongs to somebody else's dashboard) answered 500, telling the caller
// the server had broken when in fact the request was simply wrong.
func writeRepoError(w http.ResponseWriter, err error, notFoundMessage string) {
	if errors.Is(err, store.ErrNotFound) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", notFoundMessage)
		return
	}
	writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
}

// decode reads a JSON body, reporting a malformed one as a client error.
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	if err := json.NewDecoder(r.Body).Decode(out); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Request body is not valid JSON: "+err.Error())
		return false
	}
	return true
}

// caller identifies who is asking. There is no auth in this build; the header
// is recorded so provenance is still attributable.
func caller(r *http.Request) string {
	if u := strings.TrimSpace(r.Header.Get("X-User")); u != "" {
		return u
	}
	return "anonymous"
}

// listOf guarantees a JSON array rather than null for an empty result, because
// a client that has to null-check every list is a client that will forget once.
func listOf[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

package api

import (
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/store"
)

func (s *Server) listDefinitions(w http.ResponseWriter, r *http.Request) {
	out, err := s.Defs.List(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, listOf(out))
}

// proposalResponse is the shape the Definitions surface renders: the term, the
// readings the refusal measured, and the spread that justified refusing. It is
// reconstructed from the source answer's stored ambiguity — the refusal is the
// single source of this evidence, so the proposal never drifts from it.
type proposalResponse struct {
	ID           string            `json:"id"`
	Term         string            `json:"term"`
	ProposedAt   string            `json:"proposed_at"`
	AskedCount   int               `json:"asked_count"`
	AnsweredWays int               `json:"answered_ways"`
	Evidence     string            `json:"evidence"`
	Readings     []proposalReading `json:"readings"`
	SpreadLabel  string            `json:"spread_label"`
}

type proposalReading struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	Expression  string  `json:"expression"`
	Value       float64 `json:"value"`
	Unit        string  `json:"unit"`
	FormatHint  string  `json:"format_hint"`
	PeriodLabel string  `json:"period_label"`
	UsedCount   int     `json:"used_count"`
}

func (s *Server) getDefinition(w http.ResponseWriter, r *http.Request) {
	d, err := s.Defs.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeRepoError(w, err, "No definition with that id exists.")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) listProposedDefinitions(w http.ResponseWriter, r *http.Request) {
	defs, err := s.Defs.List(r.Context(), store.DefProposed)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	out := make([]proposalResponse, 0, len(defs))
	for _, d := range defs {
		p := proposalResponse{
			ID:         d.ID,
			Term:       d.Name,
			ProposedAt: d.RatifiedAt,
			AskedCount: 1,
			Evidence:   d.PlainEnglish,
			Readings:   []proposalReading{},
		}
		// The source answer's ambiguity carries the measured readings. A
		// proposal whose answer has been pruned still lists, just without them.
		if ans, err := s.Answers.Get(r.Context(), d.SourceAnswerID); err == nil && ans.Ambiguity != nil {
			amb := ans.Ambiguity
			p.ProposedAt = ans.CreatedAt
			p.Evidence = amb.Reason
			p.AnsweredWays = len(amb.Candidates)
			if amb.Spread.Ratio > 1 {
				p.SpreadLabel = fmt.Sprintf("%.2gx apart", amb.Spread.Ratio)
			}
			for _, c := range amb.Candidates {
				p.Readings = append(p.Readings, proposalReading{
					ID:         c.ID,
					Label:      c.Label,
					Expression: c.SQL,
					Value:      c.Value,
					Unit:       ans.Unit,
					FormatHint: ans.FormatHint,
				})
			}
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
}

type coverageResponse struct {
	Period               string                `json:"period"`
	AnsweredFromRatified int                   `json:"answered_from_ratified"`
	Total                int                   `json:"total"`
	Pct                  float64               `json:"pct"`
	PreviousPct          float64               `json:"previous_pct"`
	History              []store.CoveragePoint `json:"history"`
	Ratified             int                   `json:"ratified"`
	Proposed             int                   `json:"proposed"`
	Contested            int                   `json:"contested"`
	ClarificationRatePct float64               `json:"clarification_rate_pct"`
	ClarificationTarget  float64               `json:"clarification_target_pct"`
}

// clarificationTargetPct is the ceiling we hold ourselves to: above this share
// of refusals, the system is interrogating people instead of answering them.
const clarificationTargetPct = 15

func pctOf(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return math.Round(float64(part)/float64(whole)*1000) / 10
}

// definitionCoverage defaults to the current month; a caller may name an
// earlier one with ?period=2026-06 to look back.
func (s *Server) definitionCoverage(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	if period == "" {
		period = time.Now().UTC().Format("2006-01")
	}
	fromRatified, total, err := s.Answers.CoverageStats(r.Context(), period)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	res := coverageResponse{
		Period:               period,
		AnsweredFromRatified: fromRatified,
		Total:                total,
		Pct:                  pctOf(fromRatified, total),
		History:              []store.CoveragePoint{},
		ClarificationTarget:  clarificationTargetPct,
	}

	// The trend and counts are context, not the datum: their failure degrades
	// the header, it must not turn the coverage number into a 500.
	if t, err := time.Parse("2006-01", period); err == nil {
		if prevRatified, prevTotal, err := s.Answers.CoverageStats(r.Context(), t.AddDate(0, -1, 0).Format("2006-01")); err == nil {
			res.PreviousPct = pctOf(prevRatified, prevTotal)
		}
	}
	if hist, err := s.Answers.CoverageHistory(r.Context(), 12); err == nil && hist != nil {
		res.History = hist
	}
	if refused, asks, err := s.Answers.ClarificationRate(r.Context(), period); err == nil {
		res.ClarificationRatePct = pctOf(refused, asks)
	}
	if defs, err := s.Defs.List(r.Context(), ""); err == nil {
		names := map[string]int{}
		for _, d := range defs {
			switch d.Status {
			case store.DefRatified:
				res.Ratified++
				names[d.Name]++
			case store.DefProposed:
				res.Proposed++
			}
		}
		// Contested: one word ratified to mean two different things.
		for _, n := range names {
			if n > 1 {
				res.Contested++
			}
		}
	}
	writeJSON(w, http.StatusOK, res)
}

type createDefinitionRequest struct {
	Name           string `json:"name"`
	PlainEnglish   string `json:"plain_english"`
	Expression     string `json:"expression"`
	SourceAnswerID string `json:"source_answer_id"`
}

// createDefinition ratifies a definition directly. Unlike the ambiguity-driven
// ratification in postAskResolve, this path exists for a human to formalize a
// reading the system never flagged as contested.
func (s *Server) createDefinition(w http.ResponseWriter, r *http.Request) {
	var req createDefinitionRequest
	if !decode(w, r, &req) {
		return
	}
	if req.PlainEnglish == "" {
		writeError(w, http.StatusBadRequest, "plain_english_required",
			"A ratified definition must carry a plain-English statement of what it means.")
		return
	}
	def := &store.Definition{
		Name:           req.Name,
		PlainEnglish:   req.PlainEnglish,
		Expression:     req.Expression,
		Status:         store.DefRatified,
		RatifiedBy:     caller(r),
		SourceAnswerID: req.SourceAnswerID,
	}
	if err := s.Defs.Create(r.Context(), def); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, def)
}

type updateDefinitionRequest struct {
	Name           string `json:"name"`
	PlainEnglish   string `json:"plain_english"`
	Expression     string `json:"expression"`
	SourceAnswerID string `json:"source_answer_id"`
}

func (s *Server) updateDefinition(w http.ResponseWriter, r *http.Request) {
	var req updateDefinitionRequest
	if !decode(w, r, &req) {
		return
	}
	next := &store.Definition{
		Name:           req.Name,
		PlainEnglish:   req.PlainEnglish,
		Expression:     req.Expression,
		RatifiedBy:     caller(r),
		SourceAnswerID: req.SourceAnswerID,
	}
	updated, err := s.Defs.NewVersion(r.Context(), r.PathValue("id"), next)
	if err != nil {
		writeRepoError(w, err, "No definition with that id exists.")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) definitionImpact(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ids, err := s.Defs.LineageIDs(r.Context(), id)
	if err != nil {
		writeRepoError(w, err, "No definition with that id exists.")
		return
	}
	sample, total, err := s.Answers.ByDefinition(r.Context(), ids, 10)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"affected_answers": total,
		"sample":           listOf(sample),
		"would_change":     total > 0,
	})
}

// dismissDefinition hides a proposal the user does not want settled.
//
// Scoped to proposals in the store: dismissing a ratified definition would
// remove a rule that answers actively cite, which is a deletion wearing a
// softer word. A missing or already-ratified id therefore reads as 404.
func (s *Server) dismissDefinition(w http.ResponseWriter, r *http.Request) {
	if err := s.Defs.Dismiss(r.Context(), r.PathValue("id")); err != nil {
		writeRepoError(w, err, "No open proposal with that id exists.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

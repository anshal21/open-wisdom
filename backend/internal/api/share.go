package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

type shareSlackRequest struct {
	AnswerID string `json:"answer_id"`
	Channel  string `json:"channel"`
}

// shareSlack builds the same Block Kit card that would be posted, but never
// posts it — this build runs in demo mode, and the contract is explicit that
// demo mode returns the rendered payload instead.
func (s *Server) shareSlack(w http.ResponseWriter, r *http.Request) {
	var req shareSlackRequest
	if !decode(w, r, &req) {
		return
	}
	ans, err := s.Answers.Get(r.Context(), req.AnswerID)
	if err != nil {
		writeRepoError(w, err, "No answer with that id exists.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"posted":  false,
		"channel": req.Channel,
		"payload": slackPayload(ans, s.BaseURL),
	})
}

// slackPayload bakes the seal directly into the value section so the card
// still carries the confidence signal even as a bare screenshot.
func slackPayload(a *store.Answer, baseURL string) map[string]any {
	blocks := []map[string]any{
		{
			"type": "header",
			"text": map[string]any{"type": "plain_text", "text": a.Question},
		},
	}

	if a.Confidence == verify.ConfRefused && a.Ambiguity != nil {
		var lines []string
		for _, c := range a.Ambiguity.Candidates {
			lines = append(lines, fmt.Sprintf("*%s*: %s", c.Label, formatValue(c.Value, "")))
		}
		blocks = append(blocks, map[string]any{
			"type": "section",
			"text": map[string]any{
				"type": "mrkdwn",
				"text": "This question was ambiguous and was not answered:\n" + strings.Join(lines, "\n"),
			},
		})
	} else {
		blocks = append(blocks, map[string]any{
			"type": "section",
			"text": map[string]any{
				"type": "mrkdwn",
				"text": fmt.Sprintf("*%s*\n%s", valueText(a), sealText(a)),
			},
		})
	}

	if a.Narrative != "" {
		blocks = append(blocks, map[string]any{
			"type": "section",
			"text": map[string]any{"type": "mrkdwn", "text": a.Narrative},
		})
	}

	if a.Report != nil {
		var findings []string
		for _, c := range a.Report.Checks {
			if c.Status == verify.StatusFail || c.Status == verify.StatusWarn {
				findings = append(findings, fmt.Sprintf("[%s] %s", c.Status, c.Finding))
			}
		}
		if len(findings) > 0 {
			blocks = append(blocks, map[string]any{
				"type":     "context",
				"elements": []map[string]any{{"type": "mrkdwn", "text": strings.Join(findings, "\n")}},
			})
		}
	}

	blocks = append(blocks, map[string]any{
		"type":     "context",
		"elements": []map[string]any{{"type": "mrkdwn", "text": baseURL + "/a/" + a.ID}},
	})

	return map[string]any{"blocks": blocks}
}

func sealText(a *store.Answer) string {
	if a.Report == nil {
		return string(a.Confidence)
	}
	return fmt.Sprintf("%s — %d of %d checks", a.Confidence, a.Report.Passed, a.Report.Total)
}

func valueText(a *store.Answer) string {
	if a.Value != nil {
		return formatValue(*a.Value, a.Unit)
	}
	return fmt.Sprintf("%d rows", a.RowCount)
}

func formatValue(v float64, unit string) string {
	if unit != "" {
		return fmt.Sprintf("%.2f %s", v, unit)
	}
	return fmt.Sprintf("%.2f", v)
}

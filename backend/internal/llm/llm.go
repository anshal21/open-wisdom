// Package llm defines the model interface used by every service.
//
// The interface is deliberately narrow: one call, structured out. Providers are
// swappable and the mock provider must be sufficient to run the entire product
// offline.
package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Provider is a single-shot completion source.
type Provider interface {
	// Complete sends a request and returns the raw text response.
	Complete(ctx context.Context, req Request) (*Response, error)
	Name() string
}

// Speed selects the latency/quality tradeoff for a call. Verification runs many
// small structured calls; those take Fast. Planning takes Balanced.
type Speed string

const (
	SpeedFast     Speed = "fast"
	SpeedBalanced Speed = "balanced"
	SpeedDeep     Speed = "deep"
)

// Request is one model invocation.
type Request struct {
	System string
	Prompt string
	Speed  Speed
	// JSON asks the provider to constrain output to a single JSON object.
	JSON bool
}

// Response carries the model output plus accounting.
type Response struct {
	Text      string  `json:"text"`
	CostUSD   float64 `json:"cost_usd"`
	Model     string  `json:"model"`
	ElapsedMS int64   `json:"elapsed_ms"`
}

// DecodeJSON extracts a JSON object from a model response, tolerating the
// markdown fences models add despite instructions.
func DecodeJSON(text string, out any) error {
	s := strings.TrimSpace(text)
	if i := strings.Index(s, "```"); i >= 0 {
		s = s[i+3:]
		if j := strings.IndexByte(s, '\n'); j >= 0 {
			s = s[j+1:]
		}
		if k := strings.LastIndex(s, "```"); k >= 0 {
			s = s[:k]
		}
		s = strings.TrimSpace(s)
	}
	// Fall back to the outermost brace pair when prose leaks in.
	if !strings.HasPrefix(s, "{") {
		start := strings.IndexByte(s, '{')
		end := strings.LastIndexByte(s, '}')
		if start < 0 || end <= start {
			return fmt.Errorf("no JSON object in response: %.120q", text)
		}
		s = s[start : end+1]
	}
	if err := json.Unmarshal([]byte(s), out); err != nil {
		return fmt.Errorf("decode json: %w (payload %.200q)", err, s)
	}
	return nil
}

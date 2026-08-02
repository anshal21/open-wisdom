package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"
)

// The Anthropic API provider.
//
// The CLI provider reuses an operator's existing Claude Code auth, which is
// convenient for the author and a wall for everyone else: it requires the
// `claude` binary installed and logged in. This one needs an env var, which is
// what a container, a CI job, or a contributor actually has.
//
// The key is read from the environment and never stored, never logged, and
// never placed in an error message — see redact().
func init() {
	Register("anthropic", func(cfg ProviderConfig) (Provider, error) {
		key := cfg.Opt("api_key", os.Getenv("ANTHROPIC_API_KEY"))
		if strings.TrimSpace(key) == "" {
			return nil, errors.New(
				"ANTHROPIC_API_KEY is not set (use -llm=mock to run without a model)")
		}
		timeout := cfg.Timeout
		if timeout <= 0 {
			timeout = 5 * time.Minute
		}
		return &Anthropic{
			key:      key,
			baseURL:  strings.TrimRight(cfg.Opt("base_url", "https://api.anthropic.com"), "/"),
			sem:      make(chan struct{}, maxConcurrent(cfg)),
			override: cfg.ModelOverride,
			http:     &http.Client{Timeout: timeout},
			maxTries: 4,
		}, nil
	})
}

type Anthropic struct {
	key      string
	baseURL  string
	sem      chan struct{}
	override map[Speed]string
	http     *http.Client
	maxTries int
}

func (a *Anthropic) Name() string { return "anthropic" }

// Native JSON output is not requested here — the prompts already instruct the
// model to emit a bare object, and DecodeJSON salvages a fenced one. Claiming
// NativeJSON would let a caller skip that salvage on the strength of a promise
// this provider does not actually make.
func (a *Anthropic) Capabilities() Capabilities {
	return Capabilities{NativeJSON: false, ReportsCost: true}
}

// The Fast/Balanced/Deep mapping. Overridable per speed by the operator: the
// verification pass makes many small structured calls where a cheaper model is
// usually the right trade, and planning is where the quality matters.
var anthropicModels = ModelMap{
	Fast:     "claude-haiku-4-5",
	Balanced: "claude-sonnet-5",
	Deep:     "claude-opus-5",
}

// Per-million-token pricing, first-party API rates.
//
// Without this the cost ledger — which the answer page and the inspector both
// render — silently reads $0.00 for every answer produced through this
// provider. A confidently wrong zero is worse than an honest gap, so an
// unpriced model yields 0 and says so via ReportsCost rather than guessing.
var anthropicPrices = map[string]Price{
	"claude-opus-5":     {InputPerMTok: 5, OutputPerMTok: 25},
	"claude-sonnet-5":   {InputPerMTok: 3, OutputPerMTok: 15},
	"claude-haiku-4-5":  {InputPerMTok: 1, OutputPerMTok: 5},
	"claude-opus-4-8":   {InputPerMTok: 5, OutputPerMTok: 25},
	"claude-sonnet-4-6": {InputPerMTok: 3, OutputPerMTok: 15},
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicResponse struct {
	Model      string `json:"model"`
	StopReason string `json:"stop_reason"`
	Content    []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

func (a *Anthropic) Complete(ctx context.Context, req Request) (*Response, error) {
	select {
	case a.sem <- struct{}{}:
		defer func() { <-a.sem }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	model := anthropicModels.For(req.Speed, a.override)
	system := req.System
	if req.JSON {
		system += "\n\nRespond with a single JSON object and nothing else. No prose, no markdown fences."
	}

	payload, err := json.Marshal(anthropicRequest{
		Model:     model,
		MaxTokens: 16000,
		System:    system,
		Messages:  []anthropicMessage{{Role: "user", Content: req.Prompt}},
	})
	if err != nil {
		return nil, fmt.Errorf("encode request: %w", err)
	}

	start := time.Now()
	var lastErr error

	for attempt := 0; attempt < a.maxTries; attempt++ {
		if attempt > 0 {
			// Exponential backoff with jitter. Verification fans out several
			// calls at once, so a rate limit tends to hit all of them
			// together — without jitter they would retry in lockstep and
			// rate-limit each other again.
			delay := time.Duration(1<<attempt) * time.Second
			delay += time.Duration(rand.Int63n(int64(500 * time.Millisecond)))
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}

		res, retryable, err := a.once(ctx, payload)
		if err == nil {
			price := anthropicPrices[res.Model]
			return &Response{
				Text:      textOf(res),
				CostUSD:   price.Cost(res.Usage.InputTokens, res.Usage.OutputTokens),
				Model:     res.Model,
				ElapsedMS: time.Since(start).Milliseconds(),
			}, nil
		}
		lastErr = err
		if !retryable {
			break
		}
	}
	return nil, lastErr
}

// once performs a single attempt. The bool reports whether a retry could help:
// 429 and 5xx yes, 4xx no — retrying a malformed request just burns time.
func (a *Anthropic) once(ctx context.Context, payload []byte) (*anthropicResponse, bool, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		a.baseURL+"/v1/messages", bytes.NewReader(payload))
	if err != nil {
		return nil, false, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("content-type", "application/json")
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("x-api-key", a.key)

	resp, err := a.http.Do(httpReq)
	if err != nil {
		// A transport error can carry the request URL but never the key,
		// which rides in a header — still, redact defensively.
		return nil, true, fmt.Errorf("anthropic api: %s", a.redact(err.Error()))
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, true, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		retryable := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
		var parsed anthropicResponse
		msg := strings.TrimSpace(string(body))
		if json.Unmarshal(body, &parsed) == nil && parsed.Error != nil {
			msg = parsed.Error.Message
		}
		return nil, retryable, fmt.Errorf(
			"anthropic api %d: %s", resp.StatusCode, a.redact(truncate(msg, 300)))
	}

	var parsed anthropicResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, false, fmt.Errorf("decode response: %w", err)
	}
	// A safety decline is a successful HTTP call with no usable content. It is
	// not retryable and must not be reported as a transport failure.
	if parsed.StopReason == "refusal" {
		return nil, false, errors.New("anthropic api: the model declined this request")
	}
	return &parsed, false, nil
}

func textOf(r *anthropicResponse) string {
	var b strings.Builder
	for _, c := range r.Content {
		if c.Type == "text" {
			b.WriteString(c.Text)
		}
	}
	return b.String()
}

// redact removes the API key from any string bound for a log or an error.
// Errors from this package reach the SSE stream and the server log; a key that
// leaks into either is a key that has to be rotated.
func (a *Anthropic) redact(s string) string {
	if a.key == "" {
		return s
	}
	return strings.ReplaceAll(s, a.key, "[redacted]")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

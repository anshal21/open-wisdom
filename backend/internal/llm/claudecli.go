package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sync"
	"time"
)

func init() {
	Register("claude-cli", func(cfg ProviderConfig) (Provider, error) {
		return &ClaudeCLI{
			bin:      cfg.Opt("bin", "claude"),
			sem:      make(chan struct{}, maxConcurrent(cfg)),
			timeout:  cfg.Timeout,
			override: cfg.ModelOverride,
		}, nil
	})
}

func maxConcurrent(cfg ProviderConfig) int {
	if cfg.MaxConcurrent > 0 {
		return cfg.MaxConcurrent
	}
	return 6
}

// ClaudeCLI drives the local `claude` binary in headless mode.
//
// This avoids a separate API key: the operator's existing Claude Code auth is
// reused. The tradeoff is process-per-call overhead, so callers should batch
// independent work concurrently rather than serially.
type ClaudeCLI struct {
	bin string
	// sem bounds concurrent subprocesses; each one is a full CLI boot.
	sem      chan struct{}
	timeout  time.Duration
	override map[Speed]string
}

// cliModels is this provider's own Fast/Balanced/Deep mapping. It used to be a
// hardcoded switch, which meant an operator could not run a cheaper model for
// the many small structured calls without editing this file.
var cliModels = ModelMap{
	Fast:     "haiku",
	Balanced: "sonnet",
	Deep:     "opus",
}

// The CLI reports total_cost_usd per call, so the cost ledger is real here.
// It does not constrain output to JSON — hence the prompt suffix below and
// DecodeJSON's fence salvage.
func (c *ClaudeCLI) Capabilities() Capabilities {
	return Capabilities{NativeJSON: false, ReportsCost: true}
}

func NewClaudeCLI(bin string, maxConcurrent int) *ClaudeCLI {
	if bin == "" {
		bin = "claude"
	}
	if maxConcurrent <= 0 {
		maxConcurrent = 6
	}
	return &ClaudeCLI{bin: bin, sem: make(chan struct{}, maxConcurrent)}
}

func (c *ClaudeCLI) Name() string { return "claude-cli" }

// disabledTools keeps the CLI from doing anything but answering. The model must
// never touch the filesystem or network on our behalf.
const disabledTools = "Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Task,TodoWrite,NotebookEdit,MultiEdit"

type cliResult struct {
	IsError    bool    `json:"is_error"`
	Result     string  `json:"result"`
	TotalCost  float64 `json:"total_cost_usd"`
	DurationMS int64   `json:"duration_api_ms"`
	Subtype    string  `json:"subtype"`
}

func (c *ClaudeCLI) Complete(ctx context.Context, req Request) (*Response, error) {
	select {
	case c.sem <- struct{}{}:
		defer func() { <-c.sem }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	system := req.System
	if req.JSON {
		system += "\n\nRespond with a single JSON object and nothing else. No prose, no markdown fences."
	}

	model := cliModels.For(req.Speed, c.override)

	if c.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}

	args := []string{
		"-p", req.Prompt,
		"--model", model,
		"--output-format", "json",
		"--disallowed-tools", disabledTools,
	}
	if system != "" {
		args = append(args, "--append-system-prompt", system)
	}

	start := time.Now()
	cmd := exec.CommandContext(ctx, c.bin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("claude cli: %w (stderr: %.300s)", err, stderr.String())
	}

	var res cliResult
	if err := json.Unmarshal(stdout.Bytes(), &res); err != nil {
		return nil, fmt.Errorf("parse cli output: %w (raw: %.300s)", err, stdout.String())
	}
	if res.IsError {
		return nil, fmt.Errorf("claude cli returned error: %.300s", res.Result)
	}

	return &Response{
		Text:      res.Result,
		CostUSD:   res.TotalCost,
		Model:     model,
		ElapsedMS: time.Since(start).Milliseconds(),
	}, nil
}

// Recorder wraps a Provider and accumulates cost and call counts for a request
// scope, so an answer can honestly report what it cost to produce.
type Recorder struct {
	inner Provider
	mu    sync.Mutex
	calls int
	cost  float64
}

func NewRecorder(p Provider) *Recorder { return &Recorder{inner: p} }

func (r *Recorder) Name() string { return r.inner.Name() }

func (r *Recorder) Complete(ctx context.Context, req Request) (*Response, error) {
	res, err := r.inner.Complete(ctx, req)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.calls++
	r.cost += res.CostUSD
	r.mu.Unlock()
	return res, nil
}

func (r *Recorder) Stats() (calls int, costUSD float64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls, r.cost
}

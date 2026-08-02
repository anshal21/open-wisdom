package llm

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// The provider registry.
//
// Adding a provider is one new file plus one Register call from its init(). No
// edits to main.go, ask, or verify — which is the whole point: the moment a
// contributor has to patch the pipeline to add a model backend, the seam has
// failed.

// ProviderConfig is what an operator can say about a provider without knowing
// which one it is. Provider-specific knobs ride in Options.
type ProviderConfig struct {
	// MaxConcurrent bounds in-flight calls. Every provider must honour it:
	// the pipeline fans out cross-derivation and presentation concurrently,
	// and an unbounded provider will happily open a socket (or boot a CLI)
	// per call.
	MaxConcurrent int

	// Timeout bounds a single call. Zero means the provider's own default.
	Timeout time.Duration

	// ModelOverride replaces a provider's own Fast/Balanced/Deep mapping for
	// the given speed. Empty entries fall through to the provider default.
	// This is why the map is not a hardcoded switch: an operator running a
	// local model for the cheap structured calls and a hosted model for
	// planning needs to say so without recompiling.
	ModelOverride map[Speed]string

	// Options carries provider-specific settings (binary path, base URL,
	// pricing table) that mean nothing to the other providers.
	Options map[string]string
}

// Opt reads a provider-specific option with a fallback.
func (c ProviderConfig) Opt(key, fallback string) string {
	if v, ok := c.Options[key]; ok && strings.TrimSpace(v) != "" {
		return v
	}
	return fallback
}

// Factory constructs a provider. It returns an error rather than panicking so
// a misconfigured provider fails at startup with a readable message instead of
// on the first question someone asks.
type Factory func(cfg ProviderConfig) (Provider, error)

var (
	mu        sync.RWMutex
	factories = map[string]Factory{}
)

// Register makes a provider available by name. Called from each provider's
// init(); duplicate names are a programming error, not a runtime condition.
func Register(name string, f Factory) {
	mu.Lock()
	defer mu.Unlock()
	if _, dup := factories[name]; dup {
		panic("llm: provider registered twice: " + name)
	}
	factories[name] = f
}

// Registered lists provider names in stable order, for error messages and for
// `--help`.
func Registered() []string {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]string, 0, len(factories))
	for name := range factories {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// Open constructs the named provider.
//
// An unknown name lists the valid ones: the failure mode this replaces was a
// typo in a flag silently falling through to the only implementation.
func Open(name string, cfg ProviderConfig) (Provider, error) {
	mu.RLock()
	f, ok := factories[name]
	mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf(
			"unknown model provider %q; built with: %s",
			name, strings.Join(Registered(), ", "))
	}
	p, err := f(cfg)
	if err != nil {
		return nil, fmt.Errorf("open provider %s: %w", name, err)
	}
	return p, nil
}

/* --------------------------------------------------------------------------
   Capabilities

   Declared rather than assumed. The pipeline salvages JSON out of fenced
   markdown because most providers need it; one that supports constrained
   output should be able to say so and skip the salvage path.
-------------------------------------------------------------------------- */

// Capabilities describes what a provider can do beyond the base interface.
// Providers that don't implement Capable are treated as the conservative
// default: no native JSON, no usage accounting.
type Capabilities struct {
	// NativeJSON means the provider constrains output to a single JSON
	// object itself, so DecodeJSON's fence-stripping is belt and braces
	// rather than load-bearing.
	NativeJSON bool

	// ReportsCost means Response.CostUSD is real. When false the cost ledger
	// shows zero for this provider and the UI should say so rather than
	// implying the answer was free.
	ReportsCost bool
}

// Capable is implemented by providers that declare capabilities.
type Capable interface {
	Capabilities() Capabilities
}

// CapabilitiesOf reads a provider's capabilities, defaulting conservatively.
func CapabilitiesOf(p Provider) Capabilities {
	if c, ok := p.(Capable); ok {
		return c.Capabilities()
	}
	return Capabilities{}
}

/* --------------------------------------------------------------------------
   Model mapping
-------------------------------------------------------------------------- */

// ModelMap is a provider's Fast/Balanced/Deep mapping, overridable per speed.
type ModelMap struct {
	Fast     string
	Balanced string
	Deep     string
}

// For resolves a speed to a model id, honouring operator overrides.
func (m ModelMap) For(s Speed, override map[Speed]string) string {
	if v, ok := override[s]; ok && strings.TrimSpace(v) != "" {
		return v
	}
	switch s {
	case SpeedFast:
		return m.Fast
	case SpeedDeep:
		return m.Deep
	default:
		return m.Balanced
	}
}

/* --------------------------------------------------------------------------
   Pricing

   ClaudeCLI is handed a dollar figure by the CLI. Every API provider gets
   tokens and has to price them itself. Without this hook the cost ledger —
   a shipped, user-facing feature — silently reads $0.00 for every provider
   that isn't the CLI, which is worse than showing nothing.
-------------------------------------------------------------------------- */

// Price is per-million-token pricing for one model.
type Price struct {
	InputPerMTok  float64
	OutputPerMTok float64
}

// Cost prices a call. Returns 0 for an unknown model rather than guessing —
// a wrong number in a cost ledger is worse than a missing one.
func (p Price) Cost(inputTokens, outputTokens int) float64 {
	return float64(inputTokens)/1e6*p.InputPerMTok +
		float64(outputTokens)/1e6*p.OutputPerMTok
}

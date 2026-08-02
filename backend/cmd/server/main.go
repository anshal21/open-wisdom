// Command server runs the AI analyst backend.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/anshal21/ai-analyst/backend/internal/api"
	"github.com/anshal21/ai-analyst/backend/internal/ask"
	"github.com/anshal21/ai-analyst/backend/internal/investigate"
	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/pyrun"
	"github.com/anshal21/ai-analyst/backend/internal/sources"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

func main() {
	var (
		// Loopback by default. The product has no authentication of any kind
		// — caller() trusts the X-User header verbatim — so a default of
		// ":8080" binds an unauthenticated surface to every interface the
		// moment someone runs it on a box with a public IP. Widening is a
		// deliberate act, and it warns.
		addr          = flag.String("addr", "127.0.0.1:8080", "listen address (binding beyond loopback exposes an unauthenticated API)")
		dbPath        = flag.String("db", "./data/analyst.db", "sqlite database path")
		warehousePath = flag.String("warehouse", "", "path to a DuckDB file to register as the first source")
		claudeBin     = flag.String("claude", "claude", "path to the claude CLI binary (provider: claude-cli)")
		concurrency   = flag.Int("llm-concurrency", 6, "maximum concurrent model calls")
		llmProvider   = flag.String("llm", "claude-cli", "model provider: "+strings.Join(llm.Registered(), ", "))
		llmTimeout    = flag.Duration("llm-timeout", 5*time.Minute, "wall-clock limit for one model call")
		modelFast     = flag.String("model-fast", "", "override the provider's Fast model")
		modelBalanced = flag.String("model-balanced", "", "override the provider's Balanced model")
		modelDeep     = flag.String("model-deep", "", "override the provider's Deep model")
		baseURL       = flag.String("base-url", "http://localhost:3000", "public base URL used to build permalinks")
		authToken     = flag.String("auth-token", "", "require this shared token on every request (default: no authentication)")
		allowOrigins  = flag.String("allow-origin", "", "comma-separated extra browser origins permitted by CORS (the bundled UI is already allowed)")

		// Python notebook cells. The caps are resource isolation, NOT a
		// security boundary: a cell can still open sockets and read this
		// machine's filesystem as the server's user. Safe for a single-tenant
		// local install where the author already has a shell here; multi-tenant
		// hosting needs a container per run. See internal/pyrun.
		// Off by default. The isolation is resource isolation, not a security
		// boundary: an enabled Python cell is arbitrary code execution for
		// anyone who can reach the port. Safe for a single-tenant local
		// install where the operator already has a shell on the box; opting
		// in should be a decision, not an inheritance.
		pyEnabled = flag.Bool("python-cells", false, "allow notebook python cells to execute (arbitrary code execution — single-tenant local use only)")
		pyBin     = flag.String("python-bin", "python3", "interpreter used for notebook python cells")
		pyTimeout = flag.Duration("python-timeout", 10*time.Second, "wall-clock limit for one python cell")
		pyMemMB   = flag.Int("python-memory-mb", 512, "address-space limit for one python cell, in MiB")
	)
	flag.Parse()

	db, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer db.Close()

	provider, err := llm.Open(*llmProvider, llm.ProviderConfig{
		MaxConcurrent: *concurrency,
		Timeout:       *llmTimeout,
		ModelOverride: map[llm.Speed]string{
			llm.SpeedFast:     *modelFast,
			llm.SpeedBalanced: *modelBalanced,
			llm.SpeedDeep:     *modelDeep,
		},
		Options: map[string]string{"bin": *claudeBin},
	})
	if err != nil {
		log.Fatalf("model provider: %v", err)
	}
	announce(*addr, *llmProvider, provider, *pyEnabled, *authToken != "")
	sourceRepo := store.NewSources(db)
	registry := sources.NewRegistry(sourceRepo, provider)
	defer registry.Close()

	if *warehousePath != "" {
		if err := ensureSource(context.Background(), sourceRepo, *warehousePath); err != nil {
			log.Fatalf("register warehouse: %v", err)
		}
	}
	// Profiling a warehouse takes seconds and its output is a property of the
	// data, not of any question. Left to the first request it would be charged
	// to whoever asks first, which is exactly the person forming an impression
	// of how fast this is.
	go warmCatalogs(context.Background(), sourceRepo, registry)

	answers := store.NewAnswers(db)
	threads := store.NewThreads(db)
	defs := store.NewDefinitions(db)
	settings := store.NewSettingsRepo(db)
	engine := verify.NewEngine(provider)

	srv := &api.Server{
		Ask: &ask.Pipeline{
			Sources:  registry,
			LLM:      provider,
			Engine:   engine,
			Answers:  answers,
			Threads:  threads,
			Defs:     defs,
			Settings: settings,
		},
		Investigate: &investigate.Service{
			Sources:        registry,
			LLM:            provider,
			Engine:         engine,
			Defs:           defs,
			Investigations: store.NewInvestigations(db),
			Settings:       settings,
		},
		Sources:    registry,
		Answers:    answers,
		Threads:    threads,
		Defs:       defs,
		Dashboards: store.NewDashboards(db),
		Notebooks:  store.NewNotebooks(db),
		Python: pyrun.New(pyrun.Config{
			Enabled:     *pyEnabled,
			Interpreter: *pyBin,
			Timeout:     *pyTimeout,
			MemoryBytes: uint64(*pyMemMB) << 20,
		}),
		Watches:        store.NewWatches(db),
		Investigations: store.NewInvestigations(db),
		SourceRepo:     sourceRepo,
		Users:          store.NewUsers(db),
		SettingsRepo:   settings,
		BaseURL:        *baseURL,
		AuthToken:      *authToken,
		AllowedOrigins: splitAndTrim(*allowOrigins),
	}

	httpSrv := &http.Server{
		Addr:    *addr,
		Handler: srv.Routes(),
		// Reads are bounded; writes are not, because an SSE answer stream stays
		// open for the length of the pipeline.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Watches sweep hourly. The manual evaluate endpoint exists for demos and
	// for "check now"; the ticker is what makes a watch a watch.
	evaluator := &investigate.Evaluator{Service: srv.Investigate, Watches: srv.Watches}
	srv.WatchEvaluator = evaluator
	sweepCtx, stopSweep := context.WithCancel(context.Background())
	defer stopSweep()
	go evaluator.RunSchedule(sweepCtx, time.Hour)

	go func() {
		log.Printf("listening on %s (store %s)", *addr, *dbPath)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

// announce states the security posture at startup.
//
// Every one of these is a property an operator needs to know before pointing
// anything real at this process, and none of them are discoverable from the
// UI. Printing them where the process starts is the cheapest honest place.
func announce(addr, providerName string, p llm.Provider, python bool, authed bool) {
	log.Printf("model provider: %s (cost reporting: %v)",
		providerName, llm.CapabilitiesOf(p).ReportsCost)
	if authed {
		log.Printf("security: shared-token authentication is ON — every request must present the token")
		log.Printf("security: the token authorises FULL access; there are no per-user permissions, and X-User remains self-asserted attribution")
	} else {
		log.Printf("security: no authentication — every request is trusted, and the X-User header is taken at face value")
	}
	log.Printf("security: SQL is model-generated and executed read-only against the source")
	if python {
		log.Printf("security: python notebook cells are ENABLED — this is arbitrary code execution for anyone who can reach %s", addr)
	} else {
		log.Printf("security: python notebook cells are disabled (enable with -python-cells)")
	}
	if !isLoopback(addr) {
		log.Printf("WARNING: listening on %s, which is beyond loopback. This API has no authentication; anyone who can reach this address can read every answer and every source connection string.", addr)
	}
}

// isLoopback reports whether the listen address is confined to this machine.
// An empty host ("":8080" / ":8080") binds every interface — the case worth
// warning about.
func isLoopback(addr string) bool {
	host := addr
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		host = addr[:i]
	}
	host = strings.Trim(host, "[]")
	switch host {
	case "127.0.0.1", "::1", "localhost":
		return true
	}
	return strings.HasPrefix(host, "127.")
}

// warmCatalogs introspects and profiles every registered source in the
// background. Failure is logged and not fatal: a source that cannot be reached
// at boot may be reachable by the time someone asks about it.
func warmCatalogs(ctx context.Context, repo *store.Sources, registry *sources.Registry) {
	all, err := repo.List(ctx)
	if err != nil {
		log.Printf("warm catalogs: %v", err)
		return
	}
	for _, s := range all {
		start := time.Now()
		cat, err := registry.Catalog(ctx, s.ID)
		if err != nil {
			log.Printf("warm catalog %s: %v", s.Name, err)
			continue
		}
		log.Printf("catalog %s ready: %d tables in %s", s.Name, len(cat.Tables), time.Since(start).Round(time.Millisecond))
	}
}

// ensureSource registers a warehouse file on first boot so the product is
// usable without a setup call.
//
// A path that is not a readable file is refused rather than registered.
// Registering it would "succeed", and then every question against that source
// would fail — leaving the user with a source that exists and does not work,
// which is strictly worse than the no-source state the UI already handles well.
// The flag is an explicit instruction, so a typo in it is fatal: silently
// ignoring what someone asked for is its own kind of lie.
func ensureSource(ctx context.Context, repo *store.Sources, path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("read warehouse %s: %w", path, err)
	}
	if info.IsDir() {
		// Overwhelmingly this is Docker having created a missing bind-mount
		// source as a directory. Say so, because the error DuckDB gives does
		// not.
		return fmt.Errorf("warehouse %s is a directory, not a DuckDB file", path)
	}

	existing, err := repo.List(ctx)
	if err != nil {
		return err
	}
	for _, s := range existing {
		if s.DSN == path {
			return nil
		}
	}
	return repo.Create(ctx, &store.Source{
		Name: "warehouse",
		Kind: "duckdb",
		DSN:  path,
	})
}

// splitAndTrim turns a comma-separated flag into a slice, dropping empties.
func splitAndTrim(v string) []string {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

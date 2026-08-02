// Package sources owns live connections to data sources and the catalog cache
// that every other service reads schema from.
//
// The catalog is introspected and profiled once per source, not per question:
// profiling is the expensive part and its output (distinct values, ranges,
// alias groups) is a property of the data, not of the question being asked.
package sources

import (
	"context"
	"fmt"
	"sync"

	"github.com/anshal21/ai-analyst/backend/internal/llm"
	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// Registry hands out connectors and catalogs by source id.
type Registry struct {
	repo *store.Sources
	llm  llm.Provider
	// opts are the operator ceilings handed to every connector this registry
	// opens. They matter because verification runs each query twice.
	opts warehouse.Options

	mu    sync.Mutex
	conns map[string]warehouse.Connector
	cats  map[string]*warehouse.Catalog
}

func NewRegistry(repo *store.Sources, p llm.Provider) *Registry {
	return &Registry{
		repo:  repo,
		llm:   p,
		conns: map[string]warehouse.Connector{},
		cats:  map[string]*warehouse.Catalog{},
	}
}

// WithOptions sets the per-query ceilings applied to connectors opened after
// this call. Returns the registry so it can be chained at wiring time.
func (r *Registry) WithOptions(opts warehouse.Options) *Registry {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.opts = opts
	return r
}

// Connector opens (once) and returns the read-only handle for a source.
func (r *Registry) Connector(ctx context.Context, sourceID string) (warehouse.Connector, error) {
	r.mu.Lock()
	if c, ok := r.conns[sourceID]; ok {
		r.mu.Unlock()
		return c, nil
	}
	r.mu.Unlock()

	src, err := r.repo.Get(ctx, sourceID)
	if err != nil {
		return nil, fmt.Errorf("resolve source %s: %w", sourceID, err)
	}
	r.mu.Lock()
	opts := r.opts
	r.mu.Unlock()
	conn, err := open(src, opts)
	if err != nil {
		_ = r.repo.SetStatus(ctx, sourceID, "error")
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	// Another goroutine may have won the race; keep the first handle so a
	// source is never represented by two open connections.
	if existing, ok := r.conns[sourceID]; ok {
		conn.Close()
		return existing, nil
	}
	r.conns[sourceID] = conn
	return conn, nil
}

// open constructs the connector for a stored source.
//
// The engine-specific switch that used to live here is gone: connectors
// register themselves (warehouse.Register), so adding Postgres is one new file
// in the warehouse package and nothing in this one changes.
func open(src *store.Source, opts warehouse.Options) (warehouse.Connector, error) {
	conn, err := warehouse.Open(src.Kind, src.DSN, opts)
	if err != nil {
		// warehouse.Open has already redacted the DSN; naming the source makes
		// the message actionable without re-introducing the secret.
		return nil, fmt.Errorf("source %s: %w", src.Name, err)
	}
	return conn, nil
}

// Catalog returns the profiled catalog, introspecting on first use.
func (r *Registry) Catalog(ctx context.Context, sourceID string) (*warehouse.Catalog, error) {
	r.mu.Lock()
	if c, ok := r.cats[sourceID]; ok {
		r.mu.Unlock()
		return c, nil
	}
	r.mu.Unlock()

	if cat, err := r.repo.Catalog(ctx, sourceID); err == nil && len(cat.Tables) > 0 {
		r.mu.Lock()
		r.cats[sourceID] = cat
		r.mu.Unlock()
		return cat, nil
	}
	return r.Introspect(ctx, sourceID)
}

// Introspect re-reads the schema, re-profiles every column, and re-detects
// alias groups. This is the expensive path and is only taken on demand.
func (r *Registry) Introspect(ctx context.Context, sourceID string) (*warehouse.Catalog, error) {
	conn, err := r.Connector(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	cat, err := conn.Introspect(ctx)
	if err != nil {
		return nil, fmt.Errorf("introspect %s: %w", sourceID, err)
	}
	if err := warehouse.NewProfiler(conn).Profile(ctx, cat); err != nil {
		return nil, fmt.Errorf("profile %s: %w", sourceID, err)
	}
	// Alias detection is best-effort: without it the catalog is still correct,
	// only less able to warn about double counting.
	DetectAliases(ctx, r.llm, cat)

	if err := r.repo.SaveCatalog(ctx, sourceID, cat); err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.cats[sourceID] = cat
	r.mu.Unlock()
	return cat, nil
}

// Resolve picks the source for a request, falling back to the only configured
// source when the caller did not name one.
func (r *Registry) Resolve(ctx context.Context, sourceID string) (string, warehouse.Connector, *warehouse.Catalog, error) {
	if sourceID == "" {
		src, err := r.repo.First(ctx)
		if err != nil {
			return "", nil, nil, fmt.Errorf("no data source is configured: %w", err)
		}
		sourceID = src.ID
	}
	conn, err := r.Connector(ctx, sourceID)
	if err != nil {
		return "", nil, nil, err
	}
	cat, err := r.Catalog(ctx, sourceID)
	if err != nil {
		return "", nil, nil, err
	}
	return sourceID, conn, cat, nil
}

// Forget closes and drops the cached connector for one source.
//
// The registry memoises connectors by source id, so deleting a source without
// this would leave a live handle on a file the workspace no longer knows about
// — and, if the id were ever reused, would serve the OLD connection under the
// new registration. Deletion has to reach the cache, not just the table.
func (r *Registry) Forget(sourceID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.conns[sourceID]; ok {
		c.Close()
		delete(r.conns, sourceID)
	}
}

// Close releases every open connector.
func (r *Registry) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, c := range r.conns {
		c.Close()
		delete(r.conns, id)
	}
}

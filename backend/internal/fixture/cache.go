package fixture

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// Cached returns a path to the fixture warehouse, building it at most once per
// machine per content.
//
// Building takes about 70 ms. That is nothing once and quite a lot across the
// hundreds of calls a full `go test ./...` makes, so the result is cached under
// the system temp directory at a path derived from the fixture's own content.
// Content addressing is what makes the cache safe: regenerate the CSVs or edit
// the schema and the path changes, so a stale database can never be served for
// new data — the failure mode that makes most build caches worse than none.
//
// The caller must treat the returned file as READ-ONLY and shared. Tests that
// need to write should copy it, or call Build with their own t.TempDir().
func Cached() (string, error) {
	cacheOnce.Do(func() {
		cachePath, cacheErr = buildCached()
	})
	return cachePath, cacheErr
}

var (
	cacheOnce sync.Once
	cachePath string
	cacheErr  error
)

func buildCached() (string, error) {
	sum, err := contentHash()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(os.TempDir(), "analyst-fixture-"+sum[:16])
	final := filepath.Join(dir, Name)

	if st, err := os.Stat(final); err == nil && st.Size() > 0 {
		return final, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("fixture: mkdir cache %s: %w", dir, err)
	}

	// Build somewhere private, then rename into place. Two `go test` packages
	// running in parallel will both build; whichever finishes last wins, and
	// neither ever observes a half-written database, because the final path
	// only ever comes into existence complete.
	staging, err := os.MkdirTemp(dir, "staging-")
	if err != nil {
		return "", fmt.Errorf("fixture: staging dir: %w", err)
	}
	defer os.RemoveAll(staging)

	built, err := Build(staging)
	if err != nil {
		return "", err
	}
	if err := os.Rename(built, final); err != nil {
		// Losing the race is not an error as long as the winner left a usable
		// file — and on Windows, rename over an existing file fails outright.
		if st, statErr := os.Stat(final); statErr == nil && st.Size() > 0 {
			return final, nil
		}
		return "", fmt.Errorf("fixture: publish cache entry: %w", err)
	}
	return final, nil
}

// contentHash covers both the data and the schema, because either changes what
// the built database contains.
func contentHash() (string, error) {
	h := sha256.New()
	entries, err := files.ReadDir("testdata")
	if err != nil {
		return "", fmt.Errorf("fixture: read embedded testdata: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names) // embed.FS is already sorted; do not depend on that.
	for _, n := range names {
		b, err := files.ReadFile("testdata/" + n)
		if err != nil {
			return "", fmt.Errorf("fixture: read embedded %s: %w", n, err)
		}
		fmt.Fprintf(h, "%s:%d:", n, len(b))
		h.Write(b)
	}
	h.Write([]byte(schema))
	return hex.EncodeToString(h.Sum(nil)), nil
}

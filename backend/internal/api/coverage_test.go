package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
)

// Route coverage, enforced rather than asserted by hand.
//
// "Every registered route has at least one test" is only true on the day
// somebody checks. This makes it structural: the expected set is parsed from
// server.go's own HandleFunc calls, and every request the fixture serves
// records the pattern the mux matched. The check runs in TestMain, after the
// suite — a normal test would run in file order and see nothing.
//
// Adding a route without a test therefore fails the build.

var (
	hitMu sync.Mutex
	hits  = map[string]bool{}
)

// recordRoute notes the pattern the mux matched for this request. Go 1.22's
// ServeMux reports it, so this needs no bookkeeping of our own.
func recordRoute(mux *http.ServeMux, r *http.Request) {
	_, pattern := mux.Handler(r)
	if pattern == "" {
		return
	}
	hitMu.Lock()
	hits[pattern] = true
	hitMu.Unlock()
}

// registeredRoutes reads server.go and returns every pattern it registers.
// Parsing the source keeps this honest: a route added tomorrow is required
// tomorrow, with nobody having to remember to update a list.
func registeredRoutes() ([]string, error) {
	src, err := os.ReadFile(filepath.Clean("server.go"))
	if err != nil {
		return nil, fmt.Errorf("read server.go: %w", err)
	}
	re := regexp.MustCompile(`m\.HandleFunc\("([^"]+)"`)
	var out []string
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		out = append(out, m[1])
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("parsed no routes from server.go — the matcher is stale")
	}
	sort.Strings(out)
	return out, nil
}

func TestMain(m *testing.M) {
	code := m.Run()
	// Only meaningful when the whole suite ran. A filtered run (-run) is a
	// developer iterating; failing them for partial coverage would be noise.
	if code == 0 && !filtered() {
		if err := checkRouteCoverage(); err != nil {
			fmt.Fprintf(os.Stderr, "\nroute coverage: %v\n", err)
			code = 1
		}
	}
	os.Exit(code)
}

// filtered reports whether this process was started with a -run filter.
func filtered() bool {
	for _, arg := range os.Args {
		if strings.HasPrefix(arg, "-test.run=") && arg != "-test.run=" {
			return true
		}
	}
	return false
}

func checkRouteCoverage() error {
	routes, err := registeredRoutes()
	if err != nil {
		return err
	}

	hitMu.Lock()
	defer hitMu.Unlock()

	var missing []string
	for _, r := range routes {
		if !hits[r] {
			missing = append(missing, r)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("%d of %d registered routes have no test:\n  %s",
			len(missing), len(routes), strings.Join(missing, "\n  "))
	}
	fmt.Printf("route coverage: all %d registered routes exercised\n", len(routes))
	return nil
}

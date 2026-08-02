// Package testsupport holds helpers shared by tests across packages.
//
// It exists because of two successive failures of the same kind, both of which
// produced a green board that proved nothing.
//
// First, three suites hardcoded an absolute path under the original author's
// home directory and `t.Skipf` when the file was missing. On any other machine
// `go test ./...` printed `ok` for the verification engine while executing
// almost none of it.
//
// The fix at the time — make the location configurable, make the skip loud —
// treated the symptom. The disease was that the fixture was a large binary we
// did not own and could not ship: a ~1 GB third-party dataset for some suites,
// a 6 MB redistributed slice of it for others, and no established licence for
// either. A test that runs only if you first download something is a test that
// mostly does not run.
//
// The fixture is now generated from data in this repository (internal/fixture),
// so it is always present and always identical, and there is nothing left to
// skip for. WarehousePath can neither skip nor fail for want of a download.
package testsupport

import (
	"os"
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/fixture"
)

// WarehouseEnv points the suites at a different warehouse.
//
// This is an escape hatch for running the checks against a warehouse of your
// own, not a prerequisite: leave it unset and everything works. Whatever it
// names must present the fixture's schema, since the assertions are written
// against those tables.
const WarehouseEnv = "ANALYST_TEST_WAREHOUSE"

// WarehousePath returns the DuckDB fixture to test against.
//
// The returned file is shared across the whole test run and must be treated as
// read-only. Callers that need to write should copy it first — internal/verify's
// `subject` helper does exactly that, which is why the checks can run against a
// mutable database without any suite disturbing another.
func WarehousePath(t *testing.T) string {
	t.Helper()
	if p := os.Getenv(WarehouseEnv); p != "" {
		if _, err := os.Stat(p); err != nil {
			// An explicitly configured fixture that is absent is a failure, not
			// a skip — someone meant for this to run.
			t.Fatalf("%s=%s but the file is not readable: %v", WarehouseEnv, p, err)
		}
		return p
	}
	p, err := fixture.Cached()
	if err != nil {
		// Not a skip either. The data is embedded in the binary running this
		// test; if it cannot be built, the build is broken.
		t.Fatalf("build the embedded fixture warehouse: %v", err)
	}
	return p
}

// Command gensample generates Analyst's synthetic sample warehouse.
//
// Two jobs, one generator:
//
//	# regenerate the committed test fixture (must produce no git diff)
//	go run ./cmd/gensample -scale tiny -csv internal/fixture/testdata
//
//	# build a larger warehouse to explore the product with
//	go run ./cmd/gensample -scale demo -duckdb ../sample/analyst-sample.duckdb
//
// The data is invented and licensed with this repository. Nothing is downloaded
// and nothing is derived from a third-party dataset — see internal/fixture/gen
// for why that mattered enough to write a generator.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/anshal21/ai-analyst/backend/internal/fixture"
	"github.com/anshal21/ai-analyst/backend/internal/fixture/gen"
)

func main() {
	var (
		scaleName = flag.String("scale", "demo", "dataset size: tiny (the committed test fixture) or demo")
		csvDir    = flag.String("csv", "", "write the CSVs to this directory")
		duckPath  = flag.String("duckdb", "", "build a DuckDB database at this path")
	)
	flag.Parse()

	if *csvDir == "" && *duckPath == "" {
		fmt.Fprintln(os.Stderr, "gensample: nothing to do — pass -csv, -duckdb, or both")
		flag.Usage()
		os.Exit(2)
	}

	scale, err := gen.ScaleByName(*scaleName)
	if err != nil {
		fail(err)
	}

	// When only a database is wanted the CSVs are still produced, because Load
	// reads CSVs; they just go somewhere temporary and are cleaned up.
	out := *csvDir
	if out == "" {
		tmp, err := os.MkdirTemp("", "gensample-")
		if err != nil {
			fail(fmt.Errorf("temp dir: %w", err))
		}
		defer os.RemoveAll(tmp)
		out = tmp
	}

	if err := gen.Generate(scale, out); err != nil {
		fail(err)
	}
	if *csvDir != "" {
		fmt.Printf("wrote %s-scale CSVs to %s\n", scale.Name, *csvDir)
	}

	if *duckPath != "" {
		abs, err := filepath.Abs(*duckPath)
		if err != nil {
			fail(err)
		}
		if err := fixture.Load(out, abs); err != nil {
			fail(err)
		}
		info, err := os.Stat(abs)
		if err != nil {
			fail(err)
		}
		fmt.Printf("built %s (%.1f MB) from the %s-scale dataset\n",
			abs, float64(info.Size())/(1<<20), scale.Name)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "gensample:", err)
	os.Exit(1)
}

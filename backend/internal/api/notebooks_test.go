package api

import (
	"net/http"
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

func TestNotebookRoutes(t *testing.T) {
	f := newFixture(t)

	var nbID string
	t.Run("create", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/notebooks",
			map[string]string{"name": "Revenue exploration"}).
			expect(http.StatusCreated).jsonMap()
		nbID, _ = body["id"].(string)
		if nbID == "" {
			t.Fatalf("no id: %v", body)
		}
		if _, ok := body["cells"].([]any); !ok {
			t.Fatalf("cells is not an array: %T", body["cells"])
		}
	})

	t.Run("create defaults the name", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/notebooks", map[string]string{}).
			expect(http.StatusCreated).jsonMap()
		if body["name"] != "Untitled notebook" {
			t.Fatalf("name = %v", body["name"])
		}
	})

	t.Run("create rejects malformed json", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/notebooks", "[[[").expect(http.StatusBadRequest)
	})

	t.Run("get", func(t *testing.T) {
		body := f.get("/api/v1/notebooks/" + nbID).expect(http.StatusOK).jsonMap()
		if body["name"] != "Revenue exploration" {
			t.Fatalf("name = %v", body["name"])
		}
	})

	t.Run("get missing is 404", func(t *testing.T) {
		f.get("/api/v1/notebooks/" + missingID).expect(http.StatusNotFound)
	})

	t.Run("rename", func(t *testing.T) {
		body := f.do(http.MethodPatch, "/api/v1/notebooks/"+nbID,
			map[string]string{"name": "Q3 investigation"}).
			expect(http.StatusOK).jsonMap()
		if body["name"] != "Q3 investigation" {
			t.Fatalf("name = %v", body["name"])
		}
	})

	t.Run("rename rejects an empty name", func(t *testing.T) {
		res := f.do(http.MethodPatch, "/api/v1/notebooks/"+nbID,
			map[string]string{"name": ""}).expect(http.StatusBadRequest)
		if res.errorCode() != "invalid_name" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("rename missing is 404", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/notebooks/"+missingID,
			map[string]string{"name": "x"}).expect(http.StatusNotFound)
	})

	t.Run("delete", func(t *testing.T) {
		doomed := f.seedNotebook("scratch")
		f.delete("/api/v1/notebooks/" + doomed.ID).expect(http.StatusNoContent)
		f.get("/api/v1/notebooks/" + doomed.ID).expect(http.StatusNotFound)
	})

	t.Run("delete missing is 404", func(t *testing.T) {
		f.delete("/api/v1/notebooks/" + missingID).expect(http.StatusNotFound)
	})
}

// cell_count was `omitempty`, so an empty notebook omitted the field entirely
// and the list surface rendered a blank count.
func TestNotebookListAlwaysCarriesCellCount(t *testing.T) {
	f := newFixture(t)
	empty := f.seedNotebook("Empty scratchpad")
	full := f.seedNotebook("Revenue exploration")
	f.seedCell(full.ID, "sql", "SELECT 1")
	f.seedCell(full.ID, "question", "what was revenue?")

	list := f.get("/api/v1/notebooks").expect(http.StatusOK).jsonList()

	counts := map[string]any{}
	for _, item := range list {
		nb := item.(map[string]any)
		id, _ := nb["id"].(string)
		count, present := nb["cell_count"]
		if !present {
			t.Fatalf("cell_count missing for notebook %s — an empty count must serialise as 0", id)
		}
		counts[id] = count
	}

	if counts[empty.ID] != float64(0) {
		t.Fatalf("empty notebook cell_count = %v, want 0", counts[empty.ID])
	}
	if counts[full.ID] != float64(2) {
		t.Fatalf("full notebook cell_count = %v, want 2", counts[full.ID])
	}
}

func TestNotebookCellRoutes(t *testing.T) {
	f := newFixture(t)
	nb := f.seedNotebook("Revenue exploration")

	var cellID string
	t.Run("add cell", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells",
			map[string]string{"kind": "sql", "source": "SELECT 1"}).
			expect(http.StatusCreated).jsonMap()
		cellID, _ = body["id"].(string)
		if cellID == "" {
			t.Fatalf("no cell id: %v", body)
		}
		// Ordering is part of a notebook's meaning, so seq is on the wire.
		if body["seq"] == nil {
			t.Fatalf("seq missing: %v", body)
		}
	})

	t.Run("add cell rejects an unknown kind", func(t *testing.T) {
		res := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells",
			map[string]string{"kind": "brainstorm"}).expect(http.StatusBadRequest)
		if res.errorCode() != "invalid_kind" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("add cell to missing notebook is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/notebooks/"+missingID+"/cells",
			map[string]string{"kind": "sql"}).expect(http.StatusNotFound)
	})

	t.Run("add cell after an unknown anchor is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells",
			map[string]string{"kind": "sql", "after_cell_id": missingID}).
			expect(http.StatusNotFound)
	})

	t.Run("patch cell source", func(t *testing.T) {
		body := f.do(http.MethodPatch, "/api/v1/notebooks/"+nb.ID+"/cells/"+cellID,
			map[string]any{"source": "SELECT 2"}).expect(http.StatusOK).jsonMap()
		if body["source"] != "SELECT 2" {
			t.Fatalf("source = %v", body["source"])
		}
	})

	t.Run("patch cell rejects an unknown kind", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/notebooks/"+nb.ID+"/cells/"+cellID,
			map[string]any{"kind": "brainstorm"}).expect(http.StatusBadRequest)
	})

	t.Run("patch missing cell is 404", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/notebooks/"+nb.ID+"/cells/"+missingID,
			map[string]any{"source": "SELECT 3"}).expect(http.StatusNotFound)
	})

	t.Run("delete cell", func(t *testing.T) {
		doomed := f.seedCell(nb.ID, "markdown", "notes")
		f.delete("/api/v1/notebooks/" + nb.ID + "/cells/" + doomed.ID).
			expect(http.StatusNoContent)
	})

	t.Run("delete missing cell is 404", func(t *testing.T) {
		f.delete("/api/v1/notebooks/" + nb.ID + "/cells/" + missingID).
			expect(http.StatusNotFound)
	})
}

// A cell whose source changed is no longer described by its old result.
// Keeping the seal would leave a verified stamp above a figure nothing
// produced — the notebook's version of a superseded answer.
func TestPatchingCellSourceClearsTheStaleResult(t *testing.T) {
	f := newFixture(t)
	nb := f.seedNotebook("Revenue exploration")
	cell := f.seedCell(nb.ID, "sql", "SELECT count(*) FROM orders")

	// Give it a result, as a run would.
	f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID+"/run", nil).
		expect(http.StatusOK)

	before, err := f.Notebooks.GetCell(t.Context(), nb.ID, cell.ID)
	if err != nil {
		t.Fatalf("read cell: %v", err)
	}
	if before.Output == nil {
		t.Fatal("precondition failed: the run stored no output")
	}

	t.Run("an identical source keeps the result", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID,
			map[string]any{"source": "SELECT count(*) FROM orders"}).
			expect(http.StatusOK)

		got, _ := f.Notebooks.GetCell(t.Context(), nb.ID, cell.ID)
		if got.Output == nil {
			t.Fatal("re-sending the same source discarded a valid result")
		}
	})

	t.Run("a changed source clears the result and the seal", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID,
			map[string]any{"source": "SELECT count(*) FROM products"}).
			expect(http.StatusOK)

		got, _ := f.Notebooks.GetCell(t.Context(), nb.ID, cell.ID)
		if got.Output != nil {
			t.Fatalf("stale output survived a source change: %v", got.Output)
		}
		if got.Confidence != "" {
			t.Fatalf("stale confidence survived a source change: %q", got.Confidence)
		}
	})

	t.Run("a changed kind clears the result too", func(t *testing.T) {
		c := f.seedCell(nb.ID, "sql", "SELECT 1")
		f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+c.ID+"/run", nil).
			expect(http.StatusOK)

		f.do(http.MethodPatch, "/api/v1/notebooks/"+nb.ID+"/cells/"+c.ID,
			map[string]any{"kind": "markdown"}).expect(http.StatusOK)

		got, _ := f.Notebooks.GetCell(t.Context(), nb.ID, c.ID)
		if got.Output != nil {
			t.Fatalf("stale output survived a kind change: %v", got.Output)
		}
	})
}

// A reorder must name every cell exactly once. A partial list would silently
// strand the cells it omits.
func TestReorderRejectsAnythingButACompletePermutation(t *testing.T) {
	f := newFixture(t)
	nb := f.seedNotebook("Revenue exploration")
	c1 := f.seedCell(nb.ID, "sql", "SELECT 1")
	c2 := f.seedCell(nb.ID, "sql", "SELECT 2")
	c3 := f.seedCell(nb.ID, "sql", "SELECT 3")

	other := f.seedNotebook("Another notebook")
	foreign := f.seedCell(other.ID, "sql", "SELECT 99")

	cases := []struct {
		name string
		ids  []string
	}{
		{"partial list", []string{c1.ID, c2.ID}},
		{"duplicated id", []string{c1.ID, c1.ID, c2.ID}},
		{"foreign cell id", []string{c1.ID, c2.ID, foreign.ID}},
		{"empty list", []string{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := f.do(http.MethodPut, "/api/v1/notebooks/"+nb.ID+"/cells/order",
				map[string]any{"cell_ids": c.ids}).expect(http.StatusBadRequest)
			if res.errorCode() != "order_mismatch" {
				t.Fatalf("code = %s, want order_mismatch", res.errorCode())
			}
		})
	}

	t.Run("a complete permutation succeeds and takes effect", func(t *testing.T) {
		f.do(http.MethodPut, "/api/v1/notebooks/"+nb.ID+"/cells/order",
			map[string]any{"cell_ids": []string{c3.ID, c1.ID, c2.ID}}).
			expect(http.StatusNoContent)

		got, err := f.Notebooks.Get(t.Context(), nb.ID)
		if err != nil {
			t.Fatalf("reread: %v", err)
		}
		want := []string{c3.ID, c1.ID, c2.ID}
		for i, id := range want {
			if got.Cells[i].ID != id {
				t.Fatalf("cell %d = %s, want %s", i, got.Cells[i].ID, id)
			}
		}
	})

	t.Run("reorder on a missing notebook is 404", func(t *testing.T) {
		f.do(http.MethodPut, "/api/v1/notebooks/"+missingID+"/cells/order",
			map[string]any{"cell_ids": []string{}}).expect(http.StatusNotFound)
	})
}

// A cell id belonging to notebook A must not be reachable through notebook B.
func TestCellOperationsAreScopedToTheirNotebook(t *testing.T) {
	f := newFixture(t)
	nbA := f.seedNotebook("Notebook A")
	nbB := f.seedNotebook("Notebook B")
	cellA := f.seedCell(nbA.ID, "sql", "SELECT 1")

	t.Run("patch through the wrong notebook is 404", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/notebooks/"+nbB.ID+"/cells/"+cellA.ID,
			map[string]any{"source": "SELECT 666"}).expect(http.StatusNotFound)

		got, _ := f.Notebooks.GetCell(t.Context(), nbA.ID, cellA.ID)
		if got.Source != "SELECT 1" {
			t.Fatalf("cell A was edited through notebook B: %q", got.Source)
		}
	})

	t.Run("delete through the wrong notebook is 404", func(t *testing.T) {
		f.delete("/api/v1/notebooks/" + nbB.ID + "/cells/" + cellA.ID).
			expect(http.StatusNotFound)

		if _, err := f.Notebooks.GetCell(t.Context(), nbA.ID, cellA.ID); err != nil {
			t.Fatalf("cell A was deleted through notebook B: %v", err)
		}
	})

	t.Run("run through the wrong notebook is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/notebooks/"+nbB.ID+"/cells/"+cellA.ID+"/run", nil).
			expect(http.StatusNotFound)
	})
}

// A broken query is the normal condition of a notebook mid-thought. 5xx is
// reserved for the server actually failing.
func TestFailingCellsReturn200WithAnError(t *testing.T) {
	f := newFixture(t)
	nb := f.seedNotebook("Revenue exploration")

	t.Run("a valid sql cell runs", func(t *testing.T) {
		cell := f.seedCell(nb.ID, "sql", "SELECT count(*) AS n FROM orders")
		body := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID+"/run", nil).
			expect(http.StatusOK).jsonMap()

		if _, failed := body["error"]; failed {
			t.Fatalf("a valid query reported an error: %v", body["error"])
		}
		if body["confidence"] != string(verify.ConfUnverified) {
			t.Fatalf("confidence = %v, want unverified — hand-written SQL has no second derivation", body["confidence"])
		}
		out := body["output"].(map[string]any)
		if out["row_count"] != float64(1) {
			t.Fatalf("row_count = %v", out["row_count"])
		}
	})

	t.Run("a broken sql cell is 200 with an error", func(t *testing.T) {
		cell := f.seedCell(nb.ID, "sql", "SELECT * FROM table_that_does_not_exist")
		body := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID+"/run", nil).
			expect(http.StatusOK).jsonMap()

		msg, ok := body["error"].(string)
		if !ok || msg == "" {
			t.Fatalf("a failing query must report an error, got %v", body)
		}
	})

	t.Run("a write attempt is refused, not executed", func(t *testing.T) {
		cell := f.seedCell(nb.ID, "sql", "DROP TABLE orders")
		body := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID+"/run", nil).
			expect(http.StatusOK).jsonMap()
		if body["error"] == nil {
			t.Fatal("a DROP must be refused")
		}
	})

	t.Run("reading the host filesystem is refused", func(t *testing.T) {
		// The guard allowlists table functions precisely so this cannot reach
		// the disk. Asserted here as well as in the warehouse package because
		// this is the path a user actually has.
		cell := f.seedCell(nb.ID, "sql", "SELECT * FROM read_csv_auto('/etc/hosts')")
		body := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID+"/run", nil).
			expect(http.StatusOK).jsonMap()
		if body["error"] == nil {
			t.Fatal("reading the host filesystem must be refused")
		}
	})

	t.Run("markdown echoes its source", func(t *testing.T) {
		cell := f.seedCell(nb.ID, "markdown", "## Findings")
		body := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID+"/run", nil).
			expect(http.StatusOK).jsonMap()
		if body["output"] != "## Findings" {
			t.Fatalf("output = %v", body["output"])
		}
	})

	t.Run("python reports being switched off", func(t *testing.T) {
		// Python ships disabled. The message must say so specifically rather
		// than failing as a generic server error.
		cell := f.seedCell(nb.ID, "python", "print('hi')")
		body := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID+"/run", nil).
			expect(http.StatusOK).jsonMap()

		msg, _ := body["error"].(string)
		if msg == "" {
			t.Fatal("a disabled python cell must explain itself")
		}
		if body["confidence"] != string(verify.ConfUnverified) {
			t.Fatalf("confidence = %v", body["confidence"])
		}
	})

	t.Run("run on a missing notebook is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/notebooks/"+missingID+"/cells/"+missingID+"/run", nil).
			expect(http.StatusNotFound)
	})

	t.Run("run on a missing cell is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+missingID+"/run", nil).
			expect(http.StatusNotFound)
	})
}

// A question cell stores a REFERENCE, never a copy of the figure. Copying the
// value would leave the notebook rendering a stale number the moment that
// answer is re-run or superseded.
func TestQuestionCellStoresOnlyAnAnswerReference(t *testing.T) {
	f := newFixture(t)
	nb := f.seedNotebook("Revenue exploration")
	cell := f.seedCell(nb.ID, "question", "how many orders are there?")

	body := f.do(http.MethodPost, "/api/v1/notebooks/"+nb.ID+"/cells/"+cell.ID+"/run", nil).
		expect(http.StatusOK).jsonMap()

	out, ok := body["output"].(map[string]any)
	if !ok {
		t.Fatalf("output missing: %v", body)
	}
	answerID, _ := out["answer_id"].(string)
	if answerID == "" {
		t.Fatalf("no answer_id in output: %v", out)
	}
	// The reference and nothing else — no value, no rows, no row_count.
	if len(out) != 1 {
		t.Fatalf("question cell stored more than a reference: %v", out)
	}
	// And the reference must resolve.
	f.get("/api/v1/answers/" + answerID).expect(http.StatusOK)
}

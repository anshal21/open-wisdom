package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

func TestDashboardRoutes(t *testing.T) {
	f := newFixture(t)
	ans := f.seedAnswer("revenue in 2023", ptr(4351367.0), verify.ConfVerified)

	var dashID string
	t.Run("create", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/dashboards",
			map[string]string{"name": "Exec weekly"}).expect(http.StatusCreated).jsonMap()
		dashID, _ = body["id"].(string)
		if dashID == "" {
			t.Fatalf("no id: %v", body)
		}
	})

	t.Run("create rejects malformed json", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/dashboards", "{oops").expect(http.StatusBadRequest)
	})

	t.Run("list", func(t *testing.T) {
		if len(f.get("/api/v1/dashboards").expect(http.StatusOK).jsonList()) == 0 {
			t.Fatal("expected dashboards")
		}
	})

	t.Run("get", func(t *testing.T) {
		body := f.get("/api/v1/dashboards/" + dashID).expect(http.StatusOK).jsonMap()
		if _, ok := body["tiles"].([]any); !ok {
			t.Fatalf("tiles is not an array: %T", body["tiles"])
		}
	})

	t.Run("get missing is 404", func(t *testing.T) {
		f.get("/api/v1/dashboards/" + missingID).expect(http.StatusNotFound)
	})

	var tileID string
	t.Run("add tile", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/dashboards/"+dashID+"/tiles", map[string]any{
			"answer_id": ans.ID, "size": "3x2", "x": 0, "y": 0, "w": 3, "h": 2,
		}).expect(http.StatusCreated).jsonMap()
		tileID, _ = body["id"].(string)
		if tileID == "" {
			t.Fatalf("no tile id: %v", body)
		}
	})

	t.Run("add tile to missing dashboard is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/dashboards/"+missingID+"/tiles",
			map[string]any{"answer_id": ans.ID}).expect(http.StatusNotFound)
	})

	t.Run("add tile with missing answer is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/dashboards/"+dashID+"/tiles",
			map[string]any{"answer_id": missingID}).expect(http.StatusNotFound)
	})

	t.Run("save layout", func(t *testing.T) {
		f.do(http.MethodPut, "/api/v1/dashboards/"+dashID+"/layout", map[string]any{
			"layout": []map[string]any{{"tile_id": tileID, "x": 3, "y": 1, "w": 6, "h": 2}},
		}).expect(http.StatusNoContent)

		d, err := f.Dashboards.Get(t.Context(), dashID)
		if err != nil {
			t.Fatalf("reread: %v", err)
		}
		if len(d.Tiles) != 1 || d.Tiles[0].X != 3 || d.Tiles[0].W != 6 {
			t.Fatalf("layout not persisted: %+v", d.Tiles)
		}
	})

	t.Run("save layout on missing dashboard is 404", func(t *testing.T) {
		f.do(http.MethodPut, "/api/v1/dashboards/"+missingID+"/layout",
			map[string]any{"layout": []any{}}).expect(http.StatusNotFound)
	})

	t.Run("patch tile viz", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/dashboards/"+dashID+"/tiles/"+tileID,
			map[string]any{"viz": map[string]string{"type": "bar"}}).
			expect(http.StatusNoContent)

		d, _ := f.Dashboards.Get(t.Context(), dashID)
		var viz map[string]string
		if err := json.Unmarshal(d.Tiles[0].Viz, &viz); err != nil {
			t.Fatalf("viz not stored: %v (raw %q)", err, d.Tiles[0].Viz)
		}
		if viz["type"] != "bar" {
			t.Fatalf("viz = %v", viz)
		}
	})

	t.Run("patch tile on missing dashboard is 404", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/dashboards/"+missingID+"/tiles/"+tileID,
			map[string]any{"viz": map[string]string{"type": "bar"}}).
			expect(http.StatusNotFound)
	})

	t.Run("refresh", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/dashboards/"+dashID+"/refresh", nil).
			expect(http.StatusOK).jsonMap()
		if _, ok := body["tiles"].([]any); !ok {
			t.Fatalf("tiles is not an array: %T", body["tiles"])
		}
	})

	t.Run("refresh missing dashboard is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/dashboards/"+missingID+"/refresh", nil).
			expect(http.StatusNotFound)
	})

	t.Run("delete tile", func(t *testing.T) {
		f.delete("/api/v1/dashboards/" + dashID + "/tiles/" + tileID).
			expect(http.StatusNoContent)
		d, _ := f.Dashboards.Get(t.Context(), dashID)
		if len(d.Tiles) != 0 {
			t.Fatalf("tile survived deletion: %+v", d.Tiles)
		}
	})
}

// A refused answer carries no number. Putting it on a dashboard would render a
// blank tile that looks like data — the one place a refusal is explicitly
// barred from a surface.
func TestRefusedAnswerCannotBecomeATile(t *testing.T) {
	f := newFixture(t)
	dash := f.seedDashboard("Exec weekly")
	refused := f.seedRefusedAnswer("what was revenue")

	res := f.do(http.MethodPost, "/api/v1/dashboards/"+dash.ID+"/tiles",
		map[string]any{"answer_id": refused.ID}).
		expect(http.StatusUnprocessableEntity)
	if res.errorCode() != "refused_answer" {
		t.Fatalf("code = %s", res.errorCode())
	}
}

// Cross-resource scoping: a tile id belonging to dashboard A must not be
// reachable through dashboard B. The DELETE path is scoped in SQL
// (`WHERE id = ? AND dashboard_id = ?`); this proves it and pins it.
func TestTileOperationsAreScopedToTheirDashboard(t *testing.T) {
	f := newFixture(t)
	ans := f.seedAnswer("revenue", ptr(100.0), verify.ConfVerified)

	dashA := f.seedDashboard("Board A")
	dashB := f.seedDashboard("Board B")
	tileA := f.seedTile(dashA.ID, ans.ID)

	t.Run("delete through the wrong dashboard does not delete", func(t *testing.T) {
		f.delete("/api/v1/dashboards/" + dashB.ID + "/tiles/" + tileA.ID).
			expect(http.StatusNotFound)

		d, err := f.Dashboards.Get(t.Context(), dashA.ID)
		if err != nil {
			t.Fatalf("reread dashboard A: %v", err)
		}
		if len(d.Tiles) != 1 {
			t.Fatalf("tile A was deleted through dashboard B: %+v", d.Tiles)
		}
	})

	t.Run("viz through the wrong dashboard does not write", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/dashboards/"+dashB.ID+"/tiles/"+tileA.ID,
			map[string]any{"viz": map[string]string{"type": "pie"}})

		d, _ := f.Dashboards.Get(t.Context(), dashA.ID)
		if len(d.Tiles[0].Viz) != 0 {
			t.Fatalf("tile A's viz was written through dashboard B: %q", d.Tiles[0].Viz)
		}
	})

	// Repointing a tile at a different answer is the "swap what this shows"
	// action. Scoped like every other tile write, or dashboard B can silently
	// rewrite what dashboard A displays.
	t.Run("answer swap through the wrong dashboard does not repoint", func(t *testing.T) {
		other := f.seedAnswer("something else entirely", ptr(999.0), verify.ConfVerified)

		f.do(http.MethodPatch, "/api/v1/dashboards/"+dashB.ID+"/tiles/"+tileA.ID,
			map[string]any{"answer_id": other.ID})

		d, _ := f.Dashboards.Get(t.Context(), dashA.ID)
		if d.Tiles[0].AnswerID != ans.ID {
			t.Fatalf("tile A was repointed through dashboard B: answer_id = %s, want %s",
				d.Tiles[0].AnswerID, ans.ID)
		}
	})
}

// Deleting a tile that does not exist is a client error, not a server fault.
func TestDeletingAMissingTileIs404(t *testing.T) {
	f := newFixture(t)
	dash := f.seedDashboard("Exec weekly")

	res := f.delete("/api/v1/dashboards/" + dash.ID + "/tiles/" + missingID).
		expect(http.StatusNotFound)
	if res.errorCode() != "not_found" {
		t.Fatalf("code = %s, want not_found", res.errorCode())
	}
}

// Layout is saved for the whole canvas in one call, because one drag can
// displace many neighbours. A partial list must not strand the omitted tiles.
func TestSaveLayoutMovesEveryNamedTile(t *testing.T) {
	f := newFixture(t)
	ans := f.seedAnswer("revenue", ptr(1.0), verify.ConfVerified)
	dash := f.seedDashboard("Exec weekly")
	t1 := f.seedTile(dash.ID, ans.ID)
	t2 := f.seedTile(dash.ID, ans.ID)

	f.do(http.MethodPut, "/api/v1/dashboards/"+dash.ID+"/layout", map[string]any{
		"layout": []store.TileLayout{
			{TileID: t1.ID, X: 0, Y: 0, W: 6, H: 2},
			{TileID: t2.ID, X: 6, Y: 0, W: 6, H: 2},
		},
	}).expect(http.StatusNoContent)

	d, _ := f.Dashboards.Get(t.Context(), dash.ID)
	if len(d.Tiles) != 2 {
		t.Fatalf("expected 2 tiles, got %d", len(d.Tiles))
	}
	for _, tile := range d.Tiles {
		if tile.W != 6 {
			t.Fatalf("tile %s not moved: %+v", tile.ID, tile)
		}
	}
}

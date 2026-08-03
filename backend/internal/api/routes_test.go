package api

import (
	"net/http"
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/store"
	"github.com/anshal21/ai-analyst/backend/internal/verify"
)

// Route coverage: every path registered in Routes() gets its happy path and the
// failure the handler actually implements. Streaming routes (POST /ask,
// /ask/resolve, POST /investigations) are covered in streaming_test.go, where
// the SSE framing can be asserted properly.

// ---------------------------------------------------------------- health/CORS

func TestHealth(t *testing.T) {
	f := newFixture(t)
	body := f.get("/api/v1/health").expect(http.StatusOK).jsonMap()
	if body["status"] != "ok" {
		t.Fatalf("status = %v, want ok", body["status"])
	}
}

// Preflight is answered by the wrapper rather than per-route, so a new endpoint
// cannot forget it. Asserting it here is what keeps that true.
//
// This test used to send preflight with NO Origin and expect a CORS grant.
// That only passed because the wrapper reflected whatever it was given — the
// critical finding this suite now guards against. A request without an Origin
// is not a browser CORS request and correctly receives no grant; what must
// hold is that preflight is ANSWERED (204) on every route, and that a
// permitted origin is granted.
func TestCORSPreflightIsAnsweredForEveryRoute(t *testing.T) {
	f := newFixture(t)
	for _, path := range []string{"/api/v1/health", "/api/v1/answers", "/api/v1/notebooks"} {
		res := f.do(http.MethodOptions, path, nil)
		if res.Status != http.StatusNoContent {
			t.Fatalf("OPTIONS %s = %d, want 204", path, res.Status)
		}
	}

	// A permitted origin still gets the grant it needs.
	req, err := http.NewRequest(http.MethodOptions, f.srv.URL+"/api/v1/answers", nil)
	if err != nil {
		t.Fatalf("build preflight: %v", err)
	}
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "GET")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	defer res.Body.Close()
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("bundled frontend origin was not granted: %q", got)
	}
}

// ------------------------------------------------------------------- threads

func TestThreadRoutes(t *testing.T) {
	f := newFixture(t)
	ans := f.seedAnswer("what was revenue", ptr(100.0), verify.ConfVerified)
	th := f.seedThread("what was revenue", ans.ID)

	t.Run("list", func(t *testing.T) {
		if len(f.get("/api/v1/threads").expect(http.StatusOK).jsonList()) == 0 {
			t.Fatal("expected at least one thread")
		}
	})

	t.Run("get", func(t *testing.T) {
		body := f.get("/api/v1/threads/" + th.ID).expect(http.StatusOK).jsonMap()
		if body["id"] != th.ID {
			t.Fatalf("id = %v, want %s", body["id"], th.ID)
		}
		// listOf: an empty turn list must be [] rather than null, because a
		// client that has to null-check every list will forget once.
		if _, ok := body["turns"].([]any); !ok {
			t.Fatalf("turns is not an array: %T", body["turns"])
		}
	})

	t.Run("get missing is 404", func(t *testing.T) {
		res := f.get("/api/v1/threads/" + missingID).expect(http.StatusNotFound)
		if res.errorCode() != "not_found" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("patch context", func(t *testing.T) {
		ctx := store.Context{Grain: "month", TimeRange: &store.TimeRange{From: "2023-01-01", To: "2023-12-31"}}
		body := f.do(http.MethodPatch, "/api/v1/threads/"+th.ID+"/context", ctx).
			expect(http.StatusOK).jsonMap()
		if body["grain"] != "month" {
			t.Fatalf("grain = %v", body["grain"])
		}
		// The context must be durable, not merely echoed.
		got, err := f.Threads.Get(t.Context(), th.ID)
		if err != nil {
			t.Fatalf("reread thread: %v", err)
		}
		if got.Context == nil || got.Context.Grain != "month" {
			t.Fatalf("context not persisted: %+v", got.Context)
		}
	})

	t.Run("patch context on missing thread is 404", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/threads/"+missingID+"/context", store.Context{Grain: "day"}).
			expect(http.StatusNotFound)
	})

	t.Run("patch context rejects malformed json", func(t *testing.T) {
		res := f.do(http.MethodPatch, "/api/v1/threads/"+th.ID+"/context", "{not json").
			expect(http.StatusBadRequest)
		if res.errorCode() != "invalid_body" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})
}

// ------------------------------------------------------------------- answers

func TestAnswerRoutes(t *testing.T) {
	f := newFixture(t)
	ans := f.seedAnswer("what was revenue in 2023", ptr(4351367.0), verify.ConfVerified)

	t.Run("list", func(t *testing.T) {
		if len(f.get("/api/v1/answers").expect(http.StatusOK).jsonList()) != 1 {
			t.Fatal("expected exactly one answer")
		}
	})

	t.Run("list filters by confidence", func(t *testing.T) {
		got := f.get("/api/v1/answers?confidence=refused").expect(http.StatusOK).jsonList()
		if len(got) != 0 {
			t.Fatalf("expected no refused answers, got %d", len(got))
		}
	})

	t.Run("get", func(t *testing.T) {
		body := f.get("/api/v1/answers/" + ans.ID).expect(http.StatusOK).jsonMap()
		if body["question"] != "what was revenue in 2023" {
			t.Fatalf("question = %v", body["question"])
		}
	})

	t.Run("get missing is 404", func(t *testing.T) {
		f.get("/api/v1/answers/" + missingID).expect(http.StatusNotFound)
	})

	t.Run("permalink", func(t *testing.T) {
		body := f.get("/api/v1/answers/" + ans.ID + "/permalink").expect(http.StatusOK).jsonMap()
		want := "http://analyst.test/a/" + ans.ID
		if body["url"] != want {
			t.Fatalf("url = %v, want %s", body["url"], want)
		}
	})

	t.Run("permalink for missing answer is 404", func(t *testing.T) {
		f.get("/api/v1/answers/" + missingID + "/permalink").expect(http.StatusNotFound)
	})

	t.Run("flag", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/answers/"+ans.ID+"/flag",
			map[string]string{"reason": "double counts returns"}).
			expect(http.StatusCreated).jsonMap()
		if body["reason"] != "double counts returns" {
			t.Fatalf("reason = %v", body["reason"])
		}
		// A correction the server does not actually keep is the product lying
		// in its own voice — assert it is readable back.
		got := f.get("/api/v1/answers/" + ans.ID).expect(http.StatusOK).jsonMap()
		flags, ok := got["flags"].([]any)
		if !ok || len(flags) != 1 {
			t.Fatalf("flags not returned on the answer: %v", got["flags"])
		}
	})

	t.Run("flag requires a reason", func(t *testing.T) {
		res := f.do(http.MethodPost, "/api/v1/answers/"+ans.ID+"/flag",
			map[string]string{"reason": ""}).expect(http.StatusBadRequest)
		if res.errorCode() != "reason_required" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("flag on missing answer is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/answers/"+missingID+"/flag",
			map[string]string{"reason": "x"}).expect(http.StatusNotFound)
	})

	t.Run("rerun missing answer is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/answers/"+missingID+"/rerun", nil).
			expect(http.StatusNotFound)
	})
}

// A refused answer carries report == null. The API must still serve it: this
// exact record crashed every frontend surface that assumed a report existed.
func TestRefusedAnswerIsServedWithNullReport(t *testing.T) {
	f := newFixture(t)
	refused := f.seedRefusedAnswer("what was revenue")

	body := f.get("/api/v1/answers/" + refused.ID).expect(http.StatusOK).jsonMap()

	if report, present := body["report"]; present && report != nil {
		t.Fatalf("refused answer must carry a null report, got %v", report)
	}
	if body["confidence"] != string(verify.ConfRefused) {
		t.Fatalf("confidence = %v", body["confidence"])
	}
	amb, ok := body["ambiguity"].(map[string]any)
	if !ok {
		t.Fatalf("ambiguity missing: %v", body["ambiguity"])
	}
	if cands, ok := amb["candidates"].([]any); !ok || len(cands) != 2 {
		t.Fatalf("candidates = %v", amb["candidates"])
	}

	// And it must appear in the ledger listing rather than being filtered out.
	if len(f.get("/api/v1/answers?confidence=refused").expect(http.StatusOK).jsonList()) != 1 {
		t.Fatal("refused answer missing from the filtered ledger")
	}
}

// --------------------------------------------------------------- definitions

func TestDefinitionRoutes(t *testing.T) {
	f := newFixture(t)

	t.Run("create", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/definitions", map[string]string{
			"name":          "Revenue",
			"plain_english": "Sum of sale price on non-cancelled order items.",
			"expression":    "SELECT sum(sale_price) FROM order_items",
		}).expect(http.StatusCreated).jsonMap()
		if body["name"] != "Revenue" {
			t.Fatalf("name = %v", body["name"])
		}
		if body["status"] != store.DefRatified {
			t.Fatalf("status = %v, want ratified", body["status"])
		}
	})

	t.Run("create without plain english is 400", func(t *testing.T) {
		res := f.do(http.MethodPost, "/api/v1/definitions", map[string]string{"name": "X"}).
			expect(http.StatusBadRequest)
		if res.errorCode() != "plain_english_required" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("create rejects malformed json", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/definitions", "{").expect(http.StatusBadRequest)
	})

	def := f.seedDefinition("AOV", "Average order value.")

	t.Run("list", func(t *testing.T) {
		if len(f.get("/api/v1/definitions").expect(http.StatusOK).jsonList()) == 0 {
			t.Fatal("expected definitions")
		}
	})

	t.Run("get", func(t *testing.T) {
		body := f.get("/api/v1/definitions/" + def.ID).expect(http.StatusOK).jsonMap()
		if body["name"] != "AOV" {
			t.Fatalf("name = %v", body["name"])
		}
	})

	t.Run("get missing is 404", func(t *testing.T) {
		f.get("/api/v1/definitions/" + missingID).expect(http.StatusNotFound)
	})

	t.Run("update creates a new version", func(t *testing.T) {
		body := f.do(http.MethodPut, "/api/v1/definitions/"+def.ID, map[string]string{
			"name":          "AOV",
			"plain_english": "Average order value, excluding cancellations.",
			"expression":    "SELECT 2",
		}).expect(http.StatusOK).jsonMap()
		if body["plain_english"] != "Average order value, excluding cancellations." {
			t.Fatalf("plain_english = %v", body["plain_english"])
		}
	})

	t.Run("update missing is 404", func(t *testing.T) {
		f.do(http.MethodPut, "/api/v1/definitions/"+missingID, map[string]string{
			"name": "X", "plain_english": "y",
		}).expect(http.StatusNotFound)
	})

	t.Run("proposed", func(t *testing.T) {
		// Always an array, even with nothing proposed.
		f.get("/api/v1/definitions/proposed").expect(http.StatusOK).jsonList()
	})

	t.Run("coverage", func(t *testing.T) {
		body := f.get("/api/v1/definitions/coverage").expect(http.StatusOK).jsonMap()
		if body["period"] == "" || body["period"] == nil {
			t.Fatalf("period missing: %v", body)
		}
		if _, ok := body["history"].([]any); !ok {
			t.Fatalf("history is not an array: %T", body["history"])
		}
		// The target is the ceiling the product holds itself to; it must reach
		// the client or the header renders a bare number with no bar.
		if body["clarification_target_pct"] != float64(clarificationTargetPct) {
			t.Fatalf("target = %v", body["clarification_target_pct"])
		}
	})

	t.Run("coverage accepts an explicit period", func(t *testing.T) {
		body := f.get("/api/v1/definitions/coverage?period=2026-06").expect(http.StatusOK).jsonMap()
		if body["period"] != "2026-06" {
			t.Fatalf("period = %v", body["period"])
		}
	})

	t.Run("impact", func(t *testing.T) {
		body := f.get("/api/v1/definitions/" + def.ID + "/impact").expect(http.StatusOK).jsonMap()
		if _, ok := body["sample"].([]any); !ok {
			t.Fatalf("sample is not an array: %T", body["sample"])
		}
		if _, ok := body["affected_answers"]; !ok {
			t.Fatal("affected_answers missing")
		}
	})

	t.Run("impact for missing definition is 404", func(t *testing.T) {
		f.get("/api/v1/definitions/" + missingID + "/impact").expect(http.StatusNotFound)
	})
}

// ------------------------------------------------------------ investigations

func TestInvestigationReadRoutes(t *testing.T) {
	f := newFixture(t)

	t.Run("list is an array", func(t *testing.T) {
		f.get("/api/v1/investigations").expect(http.StatusOK).jsonList()
	})

	t.Run("get missing is 404", func(t *testing.T) {
		f.get("/api/v1/investigations/" + missingID).expect(http.StatusNotFound)
	})
}

// ---------------------------------------------------------------- monitoring

func TestWatchRoutes(t *testing.T) {
	f := newFixture(t)
	def := f.seedDefinition("Revenue", "Sum of sale price.")

	var watchID string
	t.Run("create", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/watches", map[string]any{
			"definition_id": def.ID,
			"schedule":      "daily",
			"condition":     map[string]any{"kind": "change_pct", "value": 10},
		}).expect(http.StatusCreated).jsonMap()
		watchID, _ = body["id"].(string)
		if watchID == "" {
			t.Fatalf("no id in response: %v", body)
		}
	})

	t.Run("create rejects malformed json", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/watches", "nope").expect(http.StatusBadRequest)
	})

	t.Run("list", func(t *testing.T) {
		if len(f.get("/api/v1/watches").expect(http.StatusOK).jsonList()) == 0 {
			t.Fatal("expected watches")
		}
	})

	t.Run("get", func(t *testing.T) {
		body := f.get("/api/v1/watches/" + watchID).expect(http.StatusOK).jsonMap()
		if body["definition_id"] != def.ID {
			t.Fatalf("definition_id = %v", body["definition_id"])
		}
	})

	t.Run("get missing is 404", func(t *testing.T) {
		f.get("/api/v1/watches/" + missingID).expect(http.StatusNotFound)
	})

	t.Run("events", func(t *testing.T) {
		f.get("/api/v1/watches/" + watchID + "/events").expect(http.StatusOK).jsonList()
	})

	t.Run("events for missing watch is 404", func(t *testing.T) {
		f.get("/api/v1/watches/" + missingID + "/events").expect(http.StatusNotFound)
	})

	t.Run("evaluate missing watch is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/watches/"+missingID+"/evaluate", nil).
			expect(http.StatusNotFound)
	})
}

// ----------------------------------------------------------- sources & admin

func TestSourceRoutes(t *testing.T) {
	f := newFixture(t)

	t.Run("list", func(t *testing.T) {
		list := f.get("/api/v1/sources").expect(http.StatusOK).jsonList()
		if len(list) != 1 {
			t.Fatalf("expected the seeded source, got %d", len(list))
		}
		// The DSN is json:"-" precisely so a connection string never leaves the
		// process. That is a security property, not a formatting choice.
		if src, ok := list[0].(map[string]any); ok {
			if _, leaked := src["dsn"]; leaked {
				t.Fatal("source DSN leaked in the API response")
			}
		}
	})

	t.Run("create", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/sources", map[string]string{
			"name": "second", "kind": "duckdb", "dsn": sampleWarehouse(t),
		}).expect(http.StatusCreated).jsonMap()
		if body["name"] != "second" {
			t.Fatalf("name = %v", body["name"])
		}
	})

	t.Run("create requires name, kind and dsn", func(t *testing.T) {
		res := f.do(http.MethodPost, "/api/v1/sources", map[string]string{"name": "x"}).
			expect(http.StatusBadRequest)
		if res.errorCode() != "invalid_request" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("schema", func(t *testing.T) {
		body := f.get("/api/v1/sources/" + f.SourceID + "/schema").expect(http.StatusOK).jsonMap()
		tables, ok := body["tables"].([]any)
		if !ok || len(tables) == 0 {
			t.Fatalf("no tables in catalog: %v", body)
		}
	})

	t.Run("introspect", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/sources/"+f.SourceID+"/introspect", nil).
			expect(http.StatusOK).jsonMap()
		if tables, ok := body["tables"].([]any); !ok || len(tables) == 0 {
			t.Fatalf("introspect returned no tables: %v", body)
		}
	})

	t.Run("introspect of an unknown source fails", func(t *testing.T) {
		res := f.do(http.MethodPost, "/api/v1/sources/"+missingID+"/introspect", nil)
		if res.Status == http.StatusOK {
			t.Fatal("introspecting a nonexistent source must not succeed")
		}
	})

	// The connect UI used to offer four engines from a hardcoded list while
	// this build registered one, so three of the four produced a source that
	// failed on first use. The list now comes from the registry.
	t.Run("kinds come from the connector registry", func(t *testing.T) {
		list := f.get("/api/v1/sources/kinds").expect(http.StatusOK).jsonList()
		if len(list) == 0 {
			t.Fatal("no connector kinds reported; the UI would have nothing to offer")
		}
		var found bool
		for _, k := range list {
			if k == "duckdb" {
				found = true
			}
		}
		if !found {
			t.Fatalf("duckdb is registered by this build but absent from %v", list)
		}
	})

	// "kinds" must route to the collection handler, not be swallowed as an id
	// by GET /sources/{id}/schema. Route ordering is easy to get right once and
	// break silently later.
	t.Run("kinds is not parsed as a source id", func(t *testing.T) {
		list := f.get("/api/v1/sources/kinds").expect(http.StatusOK).jsonList()
		if _, isObject := any(list).(map[string]any); isObject {
			t.Fatal("kinds returned an object; it was routed as an id")
		}
	})

	t.Run("an unregistered kind is refused at creation", func(t *testing.T) {
		// The example kind must be one that will NEVER register. This test
		// used "snowflake" as its stand-in for an unknown engine — and then
		// the Snowflake connector shipped, quietly changing this from "refuse
		// the unknown" to "refuse a real engine" and failing. A fictional
		// kind cannot be promoted out from under the assertion.
		res := f.do(http.MethodPost, "/api/v1/sources", map[string]string{
			"name": "warehouse-in-the-sky", "kind": "not-a-real-engine", "dsn": "account.region",
		}).expect(http.StatusBadRequest)
		if res.errorCode() != "unsupported_kind" {
			t.Fatalf("code = %s; an engine this build cannot open must not be storable", res.errorCode())
		}
	})

	// Without delete, a mistyped path is permanent. That was survivable while
	// the only source came from a boot flag; it is not once connecting is
	// something you do in the UI.
	t.Run("delete", func(t *testing.T) {
		created := f.do(http.MethodPost, "/api/v1/sources", map[string]string{
			"name": "temporary", "kind": "duckdb", "dsn": sampleWarehouse(t),
		}).expect(http.StatusCreated).jsonMap()
		id, _ := created["id"].(string)
		if id == "" {
			t.Fatalf("no id in %v", created)
		}

		f.delete("/api/v1/sources/" + id).expect(http.StatusNoContent)

		for _, raw := range f.get("/api/v1/sources").expect(http.StatusOK).jsonList() {
			if src, ok := raw.(map[string]any); ok && src["id"] == id {
				t.Fatal("the deleted source is still listed")
			}
		}
		// Answers are deliberately untouched: an answer records the source it
		// was computed against, and deleting the connection does not un-compute
		// it.
	})

	t.Run("delete of an unknown source is a 404", func(t *testing.T) {
		f.delete("/api/v1/sources/" + missingID).expect(http.StatusNotFound)
	})
}

func TestUserRoutes(t *testing.T) {
	f := newFixture(t)

	var userID string
	t.Run("create", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/users", map[string]string{
			"name": "Dana Okafor", "email": "dana@example.com", "role": "analyst",
		}).expect(http.StatusCreated).jsonMap()
		userID, _ = body["id"].(string)
		if userID == "" {
			t.Fatalf("no id: %v", body)
		}
	})

	t.Run("create rejects an unknown role", func(t *testing.T) {
		res := f.do(http.MethodPost, "/api/v1/users", map[string]string{
			"name": "X", "email": "x@example.com", "role": "wizard",
		}).expect(http.StatusBadRequest)
		if res.errorCode() != "invalid_role" {
			t.Fatalf("code = %s", res.errorCode())
		}
	})

	t.Run("list", func(t *testing.T) {
		if len(f.get("/api/v1/users").expect(http.StatusOK).jsonList()) == 0 {
			t.Fatal("expected users")
		}
	})

	t.Run("patch role", func(t *testing.T) {
		body := f.do(http.MethodPatch, "/api/v1/users/"+userID,
			map[string]string{"role": "admin"}).expect(http.StatusOK).jsonMap()
		if body["role"] != "admin" {
			t.Fatalf("role = %v", body["role"])
		}
	})

	t.Run("patch rejects an unknown role", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/users/"+userID,
			map[string]string{"role": "wizard"}).expect(http.StatusBadRequest)
	})

	t.Run("patch missing user is 404", func(t *testing.T) {
		f.do(http.MethodPatch, "/api/v1/users/"+missingID,
			map[string]string{"role": "admin"}).expect(http.StatusNotFound)
	})
}

func TestSettingsRoutes(t *testing.T) {
	f := newFixture(t)

	t.Run("get returns defaults", func(t *testing.T) {
		f.get("/api/v1/settings").expect(http.StatusOK).jsonMap()
	})

	t.Run("put round-trips", func(t *testing.T) {
		var current store.Settings
		f.get("/api/v1/settings").expect(http.StatusOK).decode(&current)
		current.WorkspaceName = "Acme Analytics"

		var saved store.Settings
		f.do(http.MethodPut, "/api/v1/settings", current).expect(http.StatusOK).decode(&saved)
		if saved.WorkspaceName != "Acme Analytics" {
			t.Fatalf("workspace = %q", saved.WorkspaceName)
		}

		var reread store.Settings
		f.get("/api/v1/settings").expect(http.StatusOK).decode(&reread)
		if reread.WorkspaceName != "Acme Analytics" {
			t.Fatalf("settings not persisted: %q", reread.WorkspaceName)
		}
	})

	t.Run("put rejects malformed json", func(t *testing.T) {
		f.do(http.MethodPut, "/api/v1/settings", "{{").expect(http.StatusBadRequest)
	})
}

// --------------------------------------------------------------------- share

func TestShareSlack(t *testing.T) {
	f := newFixture(t)
	ans := f.seedAnswer("revenue in 2023", ptr(4351367.0), verify.ConfVerified)

	t.Run("renders a payload without posting", func(t *testing.T) {
		body := f.do(http.MethodPost, "/api/v1/share/slack", map[string]string{
			"answer_id": ans.ID, "channel": "#analytics",
		}).expect(http.StatusOK).jsonMap()

		// The contract is explicit: demo mode returns the card, never posts it.
		if body["posted"] != false {
			t.Fatalf("posted = %v, want false", body["posted"])
		}
		payload, ok := body["payload"].(map[string]any)
		if !ok {
			t.Fatalf("payload missing: %v", body)
		}
		blocks, ok := payload["blocks"].([]any)
		if !ok || len(blocks) == 0 {
			t.Fatalf("no blocks: %v", payload)
		}
	})

	t.Run("refused answer renders its readings instead of a number", func(t *testing.T) {
		refused := f.seedRefusedAnswer("what was revenue")
		body := f.do(http.MethodPost, "/api/v1/share/slack", map[string]string{
			"answer_id": refused.ID, "channel": "#analytics",
		}).expect(http.StatusOK).jsonMap()
		payload := body["payload"].(map[string]any)
		if len(payload["blocks"].([]any)) < 2 {
			t.Fatalf("refusal card is missing its readings: %v", payload)
		}
	})

	t.Run("missing answer is 404", func(t *testing.T) {
		f.do(http.MethodPost, "/api/v1/share/slack", map[string]string{
			"answer_id": missingID,
		}).expect(http.StatusNotFound)
	})
}

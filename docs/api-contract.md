# API Contract — v1

Base: `http://localhost:8080/api/v1`. JSON in, JSON out. This document is the
coordination point between backend and frontend; neither side may invent a
field that is not here.

## Conventions

- Errors: HTTP status + `{"error": {"code": "...", "message": "human sentence"}}`.
- IDs are opaque strings. Never assume format.
- Timestamps are RFC3339 UTC.
- Money/measures are raw numbers; formatting is the client's job.
- Nothing in the payloads is specific to any warehouse, schema, or table.

---

## 1. Ask — the core loop

### `POST /ask` (Server-Sent Events)

Request:
```json
{
  "question": "what was revenue in 2023?",
  "thread_id": "th_123",            // optional; omit to start a new thread
  "context": {                       // optional; the editable chips
    "time_range": {"from": "2023-01-01", "to": "2023-12-31"},
    "filters": [{"column": "channel", "operator": "=", "value": "web"}],
    "grain": "month",
    "definition_id": "def_9"         // pin a ratified definition
  },
  "source_id": "src_1"
}
```

Response: `text/event-stream`. Event names map 1:1 to the six-stage progress
rail in the design spec.

| event | payload | meaning |
|---|---|---|
| `stage` | `{"stage":"interpret\|resolve\|plan\|query\|verify\|compose","state":"start\|done"}` | drives the progress rail |
| `interpretation` | `{"restated": "...", "assumptions": ["..."], "definition_used": {"id":"","name":""}}` | what it understood |
| `ambiguity` | `AmbiguityPayload` (§2) | **terminal** — refusal; no number follows |
| `result` | `{"answer_id":"ans_1","value": 3820425.33, "unit":"currency", "format_hint":"currency", "columns":[...], "rows":[[...]], "row_count": 12}` | the number/table, emitted before checks finish |
| `check` | `Check` (§4) | streamed one at a time as each completes |
| `verdict` | `Report` (§4) | final seal |
| `narrative` | `{"markdown": "..."}` | the written answer |
| `chart` | `ChartSpec` (§5) | how to render |
| `cost` | `{"llm_calls": 3, "usd": 0.09, "elapsed_ms": 14200}` | honest accounting |
| `error` | `{"code":"","message":""}` | terminal |

Ordering guarantee: `result` always precedes `check`/`verdict`; the client
renders the number immediately wearing the `checking` seal.

---

## 2. Ambiguity / refusal

`AmbiguityPayload`:
```json
{
  "question": "what was revenue in 2023?",
  "term": "revenue",
  "reason": "Three defensible readings of \"revenue\" exist in this warehouse and they differ by 4.0x.",
  "candidates": [
    {
      "id": "cand_1",
      "label": "Completed order items only",
      "description": "Sum of order_items.sale_price where status = 'Complete'",
      "value": 1274808.44,
      "sql": "SELECT ...",
      "recommended": false,
      "recommendation_basis": ""      // non-empty ONLY when a real basis exists
    }
  ],
  "spread": {"ratio": 4.02, "min": 1274808.44, "max": 5101372.66, "log_scaled": false}
}
```

Client rules: a candidate is marked RECOMMENDED only when
`recommendation_basis` is non-empty. Actions are `Use once` and `Use & ratify`.

### `POST /ask/resolve`
```json
{"thread_id":"th_1","candidate_id":"cand_1","ratify": true, "definition_name":"Revenue", "plain_english":"..."}
```
Returns the same SSE stream as `/ask`, continuing with the chosen reading.

---

## 3. Threads and context

- `GET /threads` → `[{id, title, updated_at, answer_count}]`
- `GET /threads/{id}` → `{id, title, turns: [{question, answer_id, created_at}], context: Context}`
- `PATCH /threads/{id}/context` → body `Context`; returns the updated context.
  Editing context re-runs the last question.

---

## 4. Verification types

`Check`:
```json
{
  "id": "filter_sensitivity",
  "label": "Filters match real values",
  "status": "pass|warn|fail|skipped",
  "finding": "Filter status NOT IN 'cancelled' matches nothing — the stored value is 'Cancelled'.",
  "detail": {},
  "skip_reason": ""
}
```

Check ids (fixed set): `cross_derivation`, `join_loss`, `fan_out`,
`period_normalization`, `filter_sensitivity`, `definition_source`, `grain`,
`coverage`, `freshness`, `precedent`.

`Report`:
```json
{"confidence":"verified|qualified|unverified|contested|refused",
 "checks":[Check], "passed": 5, "total": 6,
 "cross_derived": true,
 "headline":"Independently re-derived and structurally checked."}
```

Skipped checks never count toward `passed`/`total`, but are returned so the UI
can show what could not be run.

**`verified` requires `cross_derived: true`.** The seal makes a specific factual
claim — that a second, independent derivation ran and agreed — and it is only
issued when that happened. Cross-derivation skips for ordinary reasons (no
numeric column to total, no independent path available, the alternate statement
failed to execute); any of those caps the answer at `qualified`, with the
headline naming the reason. `cross_derived` is on the wire so a client can
distinguish "qualified because a check failed" from "qualified because we could
not re-derive it" — different claims that deserve different words.

---

## 5. Charts

`ChartSpec`:
```json
{"type":"line|bar|area|pie|table|scalar|scatter",
 "x":{"field":"month","label":"Month","type":"temporal"},
 "y":[{"field":"revenue","label":"Revenue","type":"quantitative"}],
 "series":null,
 "coverage":{"included_rows": 181759, "excluded_rows": 4210, "reason":"rows with null user_id"},
 "confidence":"verified"}
```
Unverified series render hatched; refused answers carry no chart.

---

## 6. Answer ledger

- `GET /answers?query=&confidence=&from=&to=` → `[AnswerSummary]`
- `GET /answers/{id}` → full `Answer` (question, value, sql, report, chart,
  narrative, definition_used, created_by, created_at, source_id, cost)
  - `runs: [{id, run, value, confidence, created_at, current}]` — the re-run
    lineage, oldest first, populated on single-answer reads only. `rerun_of` is
    a linked list and the answer being read may sit anywhere in it, so the walk
    goes both directions from wherever it starts.
    **Ordering follows the links, not `created_at`**: two re-runs inside the
    same second tie on the timestamp, and a history that claims to show
    sequence cannot be sorted by a key that ties.
    Absent for an answer never re-run — "run 1 of 1" is chrome, not
    information. `current` marks the newest run, the figure that stands now.
- `POST /answers/{id}/rerun` → new answer id; response includes `diff`:
  `{"previous": 3820425.33, "current": 3901112.10, "delta_pct": 2.11, "checks_changed": [...]}`
- `GET /answers/{id}/permalink` → `{"url": "..."}`
- `POST /answers/{id}/flag` `{reason}` → the one-click "this is wrong" path.
  Returns `{id, answer_id, reason, created_by, created_at}`. Flags are
  returned on the full `Answer` as `flags: [...]` and never deleted — a
  correction is part of the answer's history.

---

## 7. Definitions (the earned semantic layer)

- `GET /definitions` → `[{id, name, plain_english, expression, version, status:"ratified|proposed|superseded", ratified_by, ratified_at, source_answer_id, usage_count}]`
- `GET /definitions/proposed` → definitions proposed by caught ambiguities
- `GET /definitions/{id}` → one definition.
- `POST /definitions` → ratify. Body: `{name, plain_english (required), expression, source_answer_id}`
- `PUT /definitions/{id}` → new version; supersedes the old
- `GET /definitions/{id}/impact` → **required before any edit lands**:
  `{"affected_answers": 47, "sample": [AnswerSummary], "would_change": true}`
- `POST /definitions/{id}/dismiss` → 204. Hides a **proposal** the user does not
  want settled. The row survives — a declined suggestion is itself a signal —
  but it stops being offered. Only proposals are dismissible; dismissing a
  ratified definition would remove a rule answers actively cite, so that is a
  404. If the same ambiguity recurs the pipeline raises a **new** proposal, so
  no surface may promise the term will never be raised again.
- `GET /definitions/coverage` → `{"period":"2026-07","answered_from_ratified": 68, "total": 100, "pct": 68.0}`

---

## 8. Investigations ("why did X drop?")

- `POST /investigations` → `{metric, definition_id, period, comparison_period}`
  SSE stream with events:
  `stage`, `ruleout` (`{"kind":"data_quality|instrumentation|period|mix","status":"cleared|implicated","finding":"..."}`),
  `driver` (`{"segment":"...","contribution": -0.043,"kind":"mix|rate"}`),
  `waterfall` (`{"bars":[{"label":"","value":0}],"unexplained": 0.012}`),
  `narrative`, `verdict`.
- Rule-out ladder must run before drivers. If it stops, the response marks
  `stopped_at`.
- `GET /investigations` → stored investigations, newest first.
- `GET /investigations/{id}` → stored investigation.
- `POST /investigations/{id}/rerun` → re-runs the same metric over the same
  periods and returns a **new** investigation. The original is untouched, so
  the two can be compared — which is the point of re-running.
  The whole ladder re-runs, not a single phase: each rule-out narrows what the
  next examines, so replaying one phase against stale conclusions would answer
  a question nobody asked.

**Not implemented:** thread branching. The UI affordance was removed rather
than faked; branching is a product concept, not a missing route.

---

## 9. Dashboards

- `GET /dashboards`, `POST /dashboards` `{name}`
- `GET /dashboards/{id}` → `{id, name, tiles: [{id, answer_id, position, size, x, y, w, h}]}`
  — `x/y/w/h` are canvas geometry in 12-column grid units; `x = -1` marks a
  tile placed before the canvas existed (client derives a position).
- `POST /dashboards/{id}/tiles` `{answer_id, position, size, x, y, w, h}` — **only answers
  with confidence != refused may be added; 422 otherwise**
- `PUT /dashboards/{id}/layout` `{layout: [{tile_id, x, y, w, h}]}` → 204.
- `PATCH /dashboards/{id}/tiles/{tile_id}` `{viz?, answer_id?}` → 204. `viz`
  stores the tile's chart override (opaque to the backend); `answer_id`
  repoints the tile at a different answer — the "replace what this shows"
  action, which previously lived only in client state.
- `DELETE /dashboards/{id}/tiles/{tile_id}` → 204. Scoped by dashboard as well
  as tile, so a stale client cannot delete another board's tile.

**Every tile mutation persists on the action, not on "Done".** Add, remove,
replace, re-order and resize are each written as they happen; the client
reconciles its next state against what the server last confirmed, so undo —
which restores a previously deleted tile — re-creates it (with a new id; the
original row is gone). A dashboard that only looked edited until reload was
the single most disorienting bug in this product.
- `POST /dashboards/{id}/refresh` → re-runs every tile, returns diffs

## 10. Notebooks

### Shapes

- `Notebook` → `{id, name, source_id, cells, created_at, updated_at}`
- `NotebookSummary` (list) → `{id, name, cell_count, created_at, updated_at}`.
  `cell_count` is **always present**, including `0` — it was `omitempty`, which
  made an empty notebook omit the field and the list render a blank count.
- `Cell` → `{id, kind:"sql|python|markdown|question", source, output, confidence, seq, updated_at}`

`seq` is 1-based and dense — the server renumbers after every delete, so a
client may treat position and `seq` as the same thing. `confidence` is the
empty string for a cell that has **not been run**; that is distinct from
`"unverified"`, which means it ran and could not be independently re-derived.
A seal is never shown for a result that does not exist.

### Notebook

- `GET /notebooks` → `NotebookSummary[]`, most recently edited first
- `POST /notebooks` `{name?, source_id?}` → `Notebook` (201). An absent name
  becomes "Untitled notebook".
- `GET /notebooks/{id}` → `Notebook`
- `PATCH /notebooks/{id}` `{name}` → `Notebook`. 400 on an empty name.
- `DELETE /notebooks/{id}` → 204. Cells cascade.

### Cells

- `POST /notebooks/{id}/cells` `{kind, source?, after_cell_id?}` → `Cell` (201).
  `after_cell_id` inserts directly below that cell and shifts the rest down;
  absent appends.
- `PATCH /notebooks/{id}/cells/{cell_id}` `{source?, kind?, output?, confidence?}` → `Cell`.
  The autosave endpoint. Only the fields present are written, so a debounced
  keystroke save cannot clobber a result that landed mid-typing.
  **Changing `source` or `kind` clears the stored `output` and `confidence`** —
  a cell whose source changed is no longer described by its old result, and
  leaving the seal would put a verified stamp above a figure nothing produced.
  Re-sending an identical source is not a change and keeps the result.
- `DELETE /notebooks/{id}/cells/{cell_id}` → 204
- `PUT /notebooks/{id}/cells/order` `{cell_ids: [...]}` → 204. The list must
  name every cell of the notebook exactly once; 400 `order_mismatch` otherwise,
  because a partial list would silently strand the cells it omits.

Every mutation above bumps the notebook's `updated_at`.

### Running a cell

`POST /notebooks/{id}/cells/{cell_id}/run` → `{output, confidence, elapsed_ms, error?}`

`error` is a plain-English description of a cell that failed. **A failing cell
is a 200**: a broken query or a raising script is the normal condition of a
notebook mid-thought, and 5xx is reserved for this server actually failing.

Output by kind:

| kind | `output` |
|---|---|
| `sql` | `{columns:[{name,label,type}], rows, row_count}` |
| `python` | `{stdout, stderr, columns?, rows?, row_count?}` |
| `markdown` | the source string |
| `question` | `{answer_id}` |

A **question cell stores only `answer_id`** — a reference, never a copy of the
figure. The answer ledger is the one source of truth for a number; copying
`value` here would leave the notebook rendering a stale figure the moment that
answer is re-run or superseded. Clients rehydrate through `GET /answers/{id}`.

`sql` and `python` are always `unverified` — hand-written SQL has no second
derivation to cross-check against and Python cannot be re-derived at all. This
is stamped, not hidden, and neither can be promoted to a dashboard tile.

### Python cells: what the isolation does and does not do

A Python cell is the one place in this product where a figure can appear that
the verification engine never saw. The isolation is **resource isolation, not a
security boundary**, and deployments must read this rather than infer safety
from the word "sandbox".

Always enforced: a wall-clock timeout that kills the whole process group (Unix);
a fresh temp working directory per run; a stripped environment, so the parent's
model API keys never reach the cell; and truncated stdout/stderr capture.

Enforced only where the OS allows: address space (`RLIMIT_AS`), CPU seconds and
process count, applied by the child to itself with soft *and* hard limits so a
script cannot raise them back. **macOS does not implement `RLIMIT_AS`** — so on
a Mac there is no memory cap and a cell can allocate until the machine swaps.
Linux enforces it. The runner reports which caps the kernel actually accepted
rather than assuming its own configuration took effect.

Not enforced anywhere: network access, filesystem reads outside the working
directory (including this product's SQLite store), or any process/user
isolation. Appropriate for a single-tenant local install where the author
already has a shell on the box; **not** sufficient for multi-tenant hosting,
which needs a container or VM per run.

Server flags: `-python-cells` (default on), `-python-bin`, `-python-timeout`
(10s), `-python-memory-mb` (512).

A script may return a table by writing `output.json` in its working directory
containing `{"columns":[{"name","label"?,"type"?}], "rows":[[...]]}`; it is
rendered beside stdout. A malformed file is simply not a table, never an error.

## 11. Monitoring

- `GET /watches`, `POST /watches` `{definition_id, schedule, condition:{kind:"change_pct|threshold","value":10}}`
- `GET /watches/{id}/events` → `[{id, fired_at, value, previous, investigation_id}]`
- `PATCH /watches/{id}` `{condition?, schedule?, snoozed_until?}` → the updated
  watch. Only the fields present are written, so snoozing cannot clobber a
  threshold somebody tuned and retuning cannot wake a snoozed watch.
  `snoozed_until` is an RFC3339 instant; **`""` wakes the watch** — the empty
  string is the wake instruction, not a missing value.
- `status` is derived, never stored, and **`snoozed` outranks `firing`**: a
  watch deliberately silenced is not firing now, even if it fired before the
  snooze was set. The prior firing stays on the record as `last_fired_at`; only
  the headline changes. An elapsed snooze needs no sweeper — status is computed
  against the clock, so the watch wakes on its own.
- A snoozed watch is skipped by the evaluator **before** any warehouse or model
  work: silence that still costs a model call and two queries is half a feature.
- `POST /watches/{id}/evaluate` → measure now instead of waiting for the hourly
  sweep. Returns the fired event, or 204 when the condition held. Watches
  compare the last complete calendar month against the one before it — a
  partial month is never compared.
- Alerts link to an investigation, never to a bare number.

## 12. Sources and admin

- `GET /sources` → `[{id, name, kind:"duckdb|postgres|clickhouse", status, table_count, last_introspected_at}]`
- `POST /sources` `{name, kind, dsn}`; `POST /sources/{id}/introspect`
- `GET /sources/{id}/schema` → `Catalog` (tables, columns, types, profiles)
- `GET /users`, `POST /users`, `PATCH /users/{id}` `{role:"admin|analyst|viewer"}`
- `GET /settings`, `PUT /settings` `{model_speed, verification_strictness, ...}`

## 13. Share

- `POST /share/slack` `{answer_id, channel}` → renders the answer card with the
  seal baked in. In demo mode this returns the rendered payload without
  posting.

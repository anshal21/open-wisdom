# Agent Layer — module design

Status: ADOPTED 2026-07-30. The pipeline is four modules with distinct
expertise, distinct inputs, and one-way data flow. No module reaches into
another's craft.

```
┌──────────────┐   readings    ┌──────────┐   results   ┌──────────┐  report  ┌───────────┐
│  UNDERSTAND  │ ─────────────▶│   DIG    │────────────▶│  VERIFY  │─────────▶│  PRESENT  │
│  the ask     │               │ answers  │             │          │          │           │
└──────────────┘               └──────────┘             └──────────┘          └───────────┘
 interpret,                     execute primary,         deterministic         narrative +
 enumerate readings,            cross-derive             check suite +         chart hint +
 ambiguity gate                 independently            precedent/coverage    headline
 (model: semantics)             (SQL, no model)          (no model)            (model: communication)
```

## Module contracts

**1. Understand** — `interpret() + enumerateReadings() + checkAmbiguity()`
- In: question, thread history, context chips, ratified definitions, schema digest.
- Out: `readings[]` (label, description, SQL), `restated`, `assumptions`,
  or a terminal `Ambiguity`.
- Expertise: semantics of the question against this warehouse's vocabulary.
- Explicitly NOT its job: how the answer will look. (The chart hint used to
  live in this prompt — a planner guessing a chart for data it has not seen.
  Removed.)

**2. Dig** — `evaluateReadings() + deriveIndependently()`
- In: readings. Out: results + the independent derivation.
- No model calls; pure execution against the warehouse, concurrent.

**3. Verify** — `verify.Engine` + pipeline-supplied checks (cross-derivation,
coverage, precedent).
- In: result, SQL, catalog, definitions. Out: `Report`.
- Already its own package; the only module allowed to bless or damn a number.

**4. Present** — `present()` (was: `compose()` + planner's chart hint)
- In: question, restated, assumptions, the ACTUAL result (columns, sample
  rows, shape).
- Out: `{ markdown, chart: {type, x, y, series} }` — one model call, issued
  the moment the result exists, concurrent with Verify. Costs nothing extra:
  it is the same call that wrote the narrative; it now also does the job it
  was always positioned to do, with the data in front of it.
- Downstream, the hint remains a SUGGESTION: `buildChart` (shape arbitration)
  and the frontend `resolve()` (user > hint > defaults) still have the last
  words. Expertise layering: presenter proposes, shape disposes, user decides.

## Rules that keep it modular

- One-way flow; a later module never mutates an earlier module's output.
- Each module's model usage is its own prompt with its own system message —
  no prompt serves two crafts.
- Anything deterministic stays deterministic (Dig, Verify, chart shape
  arbitration). Model calls are reserved for semantics (Understand) and
  communication (Present).
- The resolve path (a human chose the reading) skips Understand entirely and
  still gets full Dig → Verify → Present.

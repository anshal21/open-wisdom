# Charting Module — design

Status: IMPLEMENTED 2026-07-30; **registry refactor 2026-07-31** (forms are
plugins — see "The renderer registry"). D1=8, D2=ephemeral, D3=closed
(stacking is a bar option). Tile overrides persist via `tiles.viz_json`;
notebook overrides remain session-state until that surface grows a full chart
editor. Owner surfaces: Ask, permalink, dashboards, notebooks, Slack card
(static), any future surface.

## The contract, in one sentence

**A chart takes a table and returns a visualization; the table is always
available.** Everything else — which chart, which columns on which encoding —
is an *opinion* layered on top of that contract, and opinions have a strict
precedence order.

```
Table            = { columns: ResultColumn[], rows: Cell[][] }        // the one universal shape
ChartHint        = { type?, x?, y?[], series? }                        // opinions, all optional
ResolvedSpec     = { type, xIdx, yIdxs[], seriesIdx?, why }            // complete, indexes not names
render(Table, ResolvedSpec) -> visualization                           // pure
```

`ResultColumn{name, label, type: temporal|quantitative|nominal}` is already
the product-wide table shape (answers, notebook outputs, catalog samples). The
chart module accepts nothing else and demands nothing more.

## Who decides what — precedence

Three voices, strongest last-word first:

1. **User selection (UI)** — a chart-type switcher on the chart frame, and an
   encoding popover (x / y / series pickers listing the table's columns by
   label). The user is never wrong: any pick renders, even an ugly one; the
   module only *degrades* it when it is impossible (line chart over zero
   temporal or ordered columns → rendered as bar, with the reason shown).
2. **Agent hint** — emitted by the PRESENT module (agents.md §4) in the same
   call that writes the narrative, with the actual result in view. It
   names *columns*; the resolver maps names → indexes and discards names that
   do not exist in the table. The agent is a suggester, never a mandate.
3. **Shape defaults** — a pure function of column types and row counts.
   Deterministic, unit-tested, no model. This is the floor that makes every
   table render sensibly with zero hints.

`resolve(table, hint?, userOverride?) -> ResolvedSpec` merges the three:
user fields win where set, hint fills what the user left open, defaults fill
the rest. `why` records which voice decided each field — surfaced in the
encoding popover ("series: product (suggested)"), so the system explains
itself the same way answers do.

## Shape defaults — one row per form, not an if-ladder

Each form declares how strongly a shape volunteers it (`affinity`) and whether
it can carry that shape at all (`legality`). The resolver takes the argmax of
the legal forms. The table below is now *data* — it lives one row per plugin
file, and adding a form cannot require editing the resolver.

| Form | Affinity | Legality (hard constraint) |
|---|---|---|
| `scalar` | **100** when 1×1 quantitative | one row, one measure |
| `line` | **90** temporal x · 60 ordinal · 40 nominal · **0** past the point cap | a dimension and a measure |
| `bar` | **80** nominal or ordinal x | a dimension and a measure |
| `scatter` | **70** when x is quantitative, no series, >60 rows | a dimension and a measure |
| `area` | **0** — never volunteered (`data-viz.md:23` is single-series, emphasis-on-volume) | a dimension and a measure |
| `pie` | **0** — never volunteered (`data-viz.md` "Donut constraints") | a category and one **non-negative** measure |
| `bignum` | **0** — the switcher's pick, not the shape's | an ordered period, one measure, no series split |
| `table` | **1** — the universal floor | always legal |

The floor is why there is always an answer: every chart form can decline and
the table still stands. The two zeros are deliberate — `area` and `pie` are
honoured when a human names them and never suggested by shape, which is what
resolves the old wording conflict between this file and `data-viz.md`.

Because affinity is a number rather than a branch, the same function ranks the
alternates for a "try it as…" rail without any new code.

### Cardinality guards (charts must not lie by omission — they say what they dropped)

- **Series cap**: more than 8 distinct series values → keep the top **8** by
  total |contribution|, sum the remainder into "Other (n)", and print
  "top 8 of 214 · rest grouped as Other" in the frame. `Other` is a grey
  residual, not a ninth hue, so it never consumes a categorical slot.
  Spaghetti is not a visualization.
- **Point cap**: beyond ~120 x-buckets on a line → the line's affinity drops to
  0 and the table wins the default; the chart stays available in the switcher.
- **Scatter series cap**: 3, not 8 — with every pair potentially adjacent the
  palette only validates its first three slots (`data-viz.md` §3).
- **Honesty guards**: a *legal* form can still lie. A pie whose largest slice
  exceeds 90% of the whole, or a bar whose values span more than 1000×, is
  refused with its reason and the table is shown instead. An explicit user
  pick overrides the guard — the user outranks it and can see what they asked
  for.
- Every guard annotates the frame; nothing is silently dropped.

## The renderer registry

A form is a plugin. Adding one means adding its files — not editing the
resolver, `Viz`, or the switcher.

```ts
interface VizPluginMeta {          // pure — lib/viz/plugins/<id>.ts
  id; label; order;                // order = switcher position
  channels;                        // {id, label, accepts, required, multiple}
                                   //   → generates the encoding popover's rows
  legality(table, enc);            // hard: {ok} | {ok:false, reason}
  affinity(table, enc);            // soft: 0 = never a default
  options;                         // schema → generates the options controls
  capabilities?;                   // gates interaction UI: brush/drill/…
  frameless?;                      // the figure IS the headline (scalar)
}

interface VizRenderer {            // React — components/viz/plugins/<id>.tsx
  icon; render(props); legend?(props);
}
```

Three consequences worth stating plainly:

- **Orientation left the spec.** `horizontal` was computed in the resolver and
  discarded by the renderer; it is now the bar plugin's `orientation` option,
  which the bar plugin also renders. That class of bug cannot recur.
- **`Viz` has one path**: resolve → pivot → `renderer.render(...)`, wrapped in
  `ChartFrame` or bare inside a tile. No form is special-cased there — pie owns
  its own legend, the table is a form like any other, and the `seriesIdx: -1`
  mutation Viz used to perform before pivoting a pie is gone (pie simply
  declares no series channel).
- **Precedence covers options.** `why` records a voice for every option key as
  well as for x/y/series, so "stacking: grouped (default)" is as inspectable as
  the encodings. `explain()` turns the whole record into a sentence — a chart
  explains its shape the way an answer explains its number.

**Stacking is a bar option, not a planner decision.** That closes the old open
decision D3: "share of revenue by department by month" needs no new signal from
the planner, only `stacking: stacked | 100%` on a form that already exists.

**Pie** is supported as a constrained donut (decision: 2026-07-30 — see
"Donut constraints" in `data-viz.md` for the rationale):
≤8 slices with the remainder folded into "Other", the total in the hole, and
direct % labels only on slices ≥8% *that physically fit the band* — measured,
not assumed, because a label wider than its band clips and a clipped "53%"
reads as "3%".

## One home, four consumers

```
src/lib/viz/registry.ts        — the plugin contract + store           (pure)
src/lib/viz/plugins/<id>.ts    — one form's channels/legality/affinity (pure)
src/lib/viz/resolve.ts         — resolve(): merges the three voices    (pure, tested)
src/lib/viz/series.ts          — pivot, temporal sort, top-N fold,
                                 stacking math                        (pure, tested)
src/lib/viz/explain.ts         — why this chart looks like this        (pure, tested)
src/components/viz/plugins/    — the renderers, one per form
src/components/viz/viz.tsx     — <Viz table hint override onOverride>
                                 resolve → pivot → renderer, in ChartFrame
src/components/viz/type-switcher.tsx   — radiogroup over the registry
src/components/viz/encoding-popover.tsx — rows generated from channels + options
```

The metadata is deliberately React-free: `resolve()` runs on a dashboard tile,
in a unit test, or anywhere else without loading a single renderer.

- **Ask / permalink**: `<Viz table hint override={turnState.viz}>` — override
  lives in view state (ephemeral on Ask, not persisted on permalink v1).
- **Dashboard tile**: override persists — `tiles.viz_json` column; a tile is a
  deliberate editorial choice and must survive reload. `tile-model.ts`'s
  private `seriesIndices` is deleted; tiles call the same `resolve()`.
- **Notebook cell**: override stored on the cell row (`viz_json`), since a
  notebook is a document.
- **Slack card**: no interactive chart; uses `resolve()` only to decide what
  the static line says ("26 groups, top: Outerwear $467k").

## Backend changes (small, contract-level)

- `store.ChartSpec` stays the *hint carrier* on the wire; `series` becomes a
  proper `ChartField` in the frontend type (fixing the string|null mismatch).
- `buildChart` gains the missing default: temporal x + unclaimed nominal
  column → that nominal is the series suggestion. (The backend stays a
  suggester; final resolution is the frontend module, because the user's
  override lives there and precedence must be applied in one place.)
- Everything else the backend already does (planner hint, shape arbitration,
  coverage, confidence) is unchanged.

## What this deletes

- `tile-model.seriesIndices` (private duplicate resolution)
- AnswerChart's inline xIdx/yIdx lookup (moves into `resolve()`)
- The notion that a chart type is decided anywhere but one function.
- The shape-defaults if-ladder, the legality switch, and the hardcoded
  switcher list — all three grew by one branch per form and are now one row
  per plugin instead.
- `Viz`'s two render ladders, its pie special case (`seriesIdx: -1` before
  pivoting), and its scalar `return null`.

## Acceptance (from the reported failure)

1. "Show me the trend of sales for each item" (product × month × revenue)
   renders a multi-series line, one line per product, capped at top 8 +
   "Other", frame says "showing 8 of N series". No hint required.
2. The switcher can turn it into grouped bars or a table; the encoding
   popover can move `product_name` off series and onto x (bars per product).
3. The same table pinned as a dashboard tile renders identically, and the
   tile remembers a user's override after reload.
4. A notebook SQL cell with the same shape gets the same default.
5. Every voice's decision is inspectable in the popover (user / suggested /
   default).

## Open decisions (need a call)

- **D1 — series cap value**: 8 (proposed) vs 12. Above ~8 the legend stops
  being readable at tile size.
- **D2 — permalink override persistence**: v1 proposes ephemeral (view-only
  surface). Persisting would need a `PATCH /answers/{id}/viz` and makes a
  "shared truth" page mutable — my instinct says no, the permalink shows the
  default; only dashboards/notebooks (editorial surfaces) persist choices.
- **D3 — stacked vs grouped** default for bar+series: **CLOSED 2026-07-31.**
  Grouped stays the default, and stacking is a user-selectable option on the
  bar form (`none | stacked | 100%`) rather than a planner decision. The old
  blocker — "needs the planner to say composition" — dissolved once options
  became part of the resolved spec: nothing has to infer intent, because the
  reader picks the view. `100%` normalises each bucket to its own whole, which
  is the pair `data-viz.md:27` asks for.

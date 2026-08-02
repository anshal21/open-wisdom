# Data Visualization

**Companion docs:** [`design-system.md`](./design-system.md) · [`screens.md`](./screens.md)

Every chart in this product is evidence attached to a claim. It is never decoration and never the primary carrier of the answer — the number is. A chart's job here is to show *shape*: is this a trend, an outlier, a mix shift, a distribution.

Two rules sit above everything else in this document:

1. **A chart must never render an unverified figure the way it renders a verified one.** If a business user cannot tell from the picture that something wasn't checked, the picture is lying by omission. See §6.
2. **Color comes last.** Pick the form, assign color by the job it does, validate the palette with the script, then style marks. Most bad charts pick colors first.

---

## 1. Choosing a form

Start by asking what the data's job is. Sometimes the answer is *not a chart*.

| The data's job | Form |
|---|---|
| One figure, no comparison | **No chart.** Hero number + seal. |
| One figure with recent history | Hero number + **sparkline** (no axes, no grid, 48×20px) |
| Change over time, 1–4 series | **Line** |
| Change over time, one series, emphasis on volume | **Area** (single series only; never stacked areas — the reader cannot judge the upper bands) |
| Comparing magnitude across ≤ 12 nominal categories | **Horizontal bar**, sorted by value descending |
| Comparing magnitude across an ordered dimension (time buckets, tiers) | **Vertical column**, in the dimension's natural order |
| Part-to-whole, ≤ 5 parts, one point in time | **Stacked bar, single horizontal bar** preferred; **donut** permitted under §"Donut constraints" below |
| Part-to-whole over time | **Stacked column** with an absolute axis, plus a companion 100% view behind a toggle |
| Contribution to a change (investigations §8.4) | **Waterfall**, ordered by contribution magnitude, with a mandatory `Unexplained` bar |
| Two measures, looking for relationship | **Scatter** (max 3 series — see §3 series cap) |
| Distribution | **Histogram**, or a box row when comparing distributions across ≤ 8 groups |
| Density across two dimensions | **Heatmap**, sequential ramp |
| Rank change between two periods | **Slope chart**, max 10 rows |

**Banned forms, unconditionally:**

- **Dual-axis charts** (two y-scales). Two measures of different scale become two charts, small multiples, or an index to a common base. This is the single most common charting mistake and it manufactures false correlations — precisely the failure mode this product exists to prevent.
- 3D anything.
- Stacked areas with more than one series.
- Radar/spider charts.
- Any chart with a truncated zero baseline on a **bar or column**. Bars encode magnitude by length; truncating the baseline makes the length lie. Lines may use a non-zero baseline, and must annotate the axis when they do.

**Overflow is the renderer's problem, not the container's.** The host reserves a box and gives the form its height; the form fits inside it. `overflow: hidden` on the tile is a backstop, not a strategy — content that merely gets clipped has still lied, because the reader cannot tell something was withheld. Where a form cannot fit its content it must SAY so: a legend past its row budget shows `+N more` carrying the hidden share, a series list past the cap says `top 8 of 26 · rest grouped as Other`. Never a scroll region inside a small tile — a row that requires scrolling in a 100px box is a row nobody will find.

**A residual is never named the same thing as real data.** The fold is labelled `Other (n)` unless a real category already claims that word — a question like "top 10 by revenue, rest in others" produces exactly that collision — in which case the residual becomes `All remaining (n)`. Two rows reading "Other" tell the reader that two unrelated things share an identity.

**Tile-scale rules.** A form rendered inside a dashboard tile must know it is small. A direct label is drawn only when it physically fits — for a donut, the text width must clear BOTH the ring band (the tightest crossing, at 3 and 9 o'clock) and the mid-band arc; below that floor labels are suppressed and identity moves to a legend beside the ring, never to colour alone. The hole's total scales with the ring and drops its "total" caption when the inner radius cannot carry it. Interactive controls get a reserved lane in the tile, never an overlay on the plot — an overlaid control covers the first row, which for a table view is the column header. Charts are authored on the full 12-column grid only; narrower viewports render a projection of that layout and do not persist geometry.

**Formatting is one rule, one place.** The answer-level `format_hint` describes the HEADLINE figure, not every column. A share-of-whole question carries `percent` while the measure it sliced is raw revenue — applying the hint blindly prints an axis reading `2000000%` and a cell reading `2297175.1%`. Every renderer (axis, tick, tooltip, table cell, donut hole, tile) resolves the hint through the shared `effectiveHint(hint, values)`; no renderer re-derives its own threshold.

**Donut constraints.** Pie/donut was originally banned outright. That was reversed on 2026-07-30 for a reason worth recording: a reader who asks for a pie and is silently given a bar has been overruled by the tool, and a product that refuses a legible request loses more trust than a slightly weaker form costs. So: asking for a pie must produce one, and switching to pie must be possible. The compromise is a constrained donut, never a plain pie: legal only for one nominal dimension + one non-negative measure (the resolver enforces legality); slices sorted descending, ≤ 8 with the remainder folded into `Other`; 2px surface gaps; the total stated in the hole; direct % labels only on slices ≥ 8%; table toggle always available. It is never the *suggested* form for part-to-whole — stacked/horizontal bar remains the default; donut appears when the asker names it or picks it in the switcher.

**Series cap.** Line, bar, column, stacked: **8 series maximum** (the palette's fixed slot count). Scatter, bubble, heatmap, and small multiples: **3 series maximum** — with all pairs potentially adjacent, the palette validates only its first three slots at the all-pairs floor. Past the cap, fold to `Other`, facet into small multiples, or change form. Never generate a ninth hue.

---

## 2. Palette

Validated with `dataviz/scripts/validate_palette.js` against this product's chart surfaces (light `#FFFFFF`, dark `#121519`). All hard gates pass in both modes.

### 2.1 Categorical — fixed order, assigned in sequence, never cycled

The order is the colorblind-safety mechanism, not a style choice. Do not reorder it.

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | indigo *(brand)* | `#5B5BD6` | `#7C7FF5` |
| 2 | orange | `#EB6834` | `#D95926` |
| 3 | aqua | `#1BAF7A` | `#199E70` |
| 4 | yellow | `#EDA100` | `#C98500` |
| 5 | magenta | `#E87BA4` | `#D55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | blue | `#2A78D6` | `#3987E5` |
| 8 | red | `#E34948` | `#E66767` |

**Validation results (adjacent pairlist — lines, bars, stacks):**

- Light: worst adjacent CVD ΔE **9.1** (`yellow ↔ aqua`, protan) · worst normal-vision ΔE **19.6** — both pass.
- Dark: worst adjacent CVD ΔE **8.4** (`yellow ↔ aqua`, protan) · worst normal-vision ΔE **19.3** — both pass.
- Light contrast: `aqua` (2.82:1), `yellow` (2.17:1), and `magenta` (2.69:1) sit below 3:1 on white. **The relief rule applies:** any chart using slots 3, 4, or 5 in light mode must ship visible direct labels or the table view. This is not optional.
- Dark contrast: all eight clear 3:1.

**All-pairs (scatter, bubble, heatmap, small multiples):** only the **first three slots** validate (light CVD ΔE 9.2 / normal 27.6; dark CVD ΔE 9.4 / normal 25.8). Slot 4 puts yellow beside orange and fails the normal-vision floor in light (13.7) and both floors in dark (CVD 4.8). Hence the 3-series cap on those forms.

**Assignment is by entity, never by rank.** A filter that removes a series must not repaint the survivors. Bind slot index to a stable entity key (category id, segment name), not to array position after filtering.

**Nominal single-series bars all take slot 1.** Coloring nominal bars by their value spends the identity channel re-encoding what bar length already shows.

### 2.2 Sequential — one hue, light → dark

Default hue **indigo**. For a second simultaneous sequential context, use orange as its own one-hue ramp.

| Step | Hex | Step | Hex |
|---|---|---|---|
| 100 | `#E0E0FB` | 450 | `#5B5BD6` |
| 150 | `#CFD0F9` | 500 | `#4E4EC0` |
| 200 | `#BDBEF7` | 550 | `#4242A6` |
| 250 | `#A8A9F4` | 600 | `#37378C` |
| 300 | `#9394F1` | 650 | `#2C2C72` |
| 350 | `#7E7FEE` | 700 | `#23235B` |
| 400 | `#6B6CE8` | | |

Use the full 100→700 range for **continuous** magnitude (heatmaps, choropleths), where the lightest step means "near zero" and may recede into the surface.

**Ordinal ramps** (discrete ordered marks — tiers, buckets, funnel stages) use a 5-step subset with visible lightness gaps, validated with `--ordinal`:

- Light: `#A8A9F4 · #7E7FEE · #5B5BD6 · #4242A6 · #2C2C72` (light end 2.18:1 — passes)
- Dark: `#E0E0FB · #BDBEF7 · #9394F1 · #6B6CE8 · #4E4EC0` (dark end 2.77:1 — passes)

### 2.3 Diverging — two hues + a neutral midpoint

**Indigo ↔ orange.** Cool/warm poles that read as opposite. Midpoint is neutral gray, never a hue.

| | Light | Dark |
|---|---|---|
| Negative pole (far) | `#37378C` | `#BDBEF7` |
| Negative (near) | `#7E7FEE` | `#6B6CE8` |
| **Midpoint** | `#F1F3F6` | `#23272E` |
| Positive (near) | `#F0894F` | `#C4551F` |
| Positive pole (far) | `#B8420F` | `#EB6834` |

Equal step count per arm. Center the scale on the semantic zero, not on the data's median — a diverging scale centered on the median is a rainbow with extra steps.

**Do not use red/green as the diverging pair.** It is the single worst pair for the 8% of male viewers with red-green CVD, and it collides with the confidence status palette.

### 2.4 Status — reserved, never a series color

Used only when a series *means* good/bad (error rate, pass/fail, a confidence-state breakdown). Always paired with an icon and a label; never carried by color alone.

| Role | Light (≥3:1 on white) | Dark (≥3:1 on `#121519`) |
|---|---|---|
| verified / good | `#079455` (3.91) | `#3DD68C` (9.76) |
| qualified / warning | `#DC6803` (3.49) | `#FDB022` (9.95) |
| contested / critical | `#D92D20` (4.83) | `#F97066` (6.57) |
| unverified / neutral | `#7A8598` (3.73) | `#7A828F` (4.72) |

A status color and a categorical slot never appear in the same chart carrying different meanings. If a chart shows both, the status marks get an icon and a labeled legend group separated from the series legend by a rule.

### 2.5 Chart chrome

| Role | Light | Dark |
|---|---|---|
| Chart surface | `#FFFFFF` | `#121519` |
| Page plane behind it | `#F7F8FA` | `#0B0D10` |
| Primary ink (values, titles) | `#14171B` | `#F2F4F7` |
| Secondary ink (labels) | `#4B5462` | `#A8B0BD` |
| Muted ink (axis, ticks) | `#667085` | `#7A828F` |
| Gridline (hairline) | `#EDF0F4` | `rgb(255 255 255 / 0.06)` |
| Baseline / axis line | `#D0D5DD` | `rgb(255 255 255 / 0.16)` |
| Annotation line | `#98A2B3` | `#545C69` |
| Reference band fill | `rgb(102 112 133 / 0.08)` | `rgb(255 255 255 / 0.05)` |

**Text in a chart wears text tokens, never the series color.** Value labels, axis labels, and legend labels are `primary`/`secondary`/`muted` ink; a colored swatch beside them carries identity. Colored text at 11px fails contrast in half the palette and reads as decoration.

### 2.6 Re-validating after any change

```bash
cd <dataviz-skill>/
node scripts/validate_palette.js "#5B5BD6,#EB6834,#1BAF7A,#EDA100,#E87BA4,#008300,#2A78D6,#E34948" \
  --mode light --surface "#FFFFFF"
node scripts/validate_palette.js "#7C7FF5,#D95926,#199E70,#C98500,#D55181,#008300,#3987E5,#E66767" \
  --mode dark --surface "#121519"
# scatter / bubble / heatmap / small multiples — first three slots only
node scripts/validate_palette.js "#5B5BD6,#EB6834,#1BAF7A" --mode light --surface "#FFFFFF" --pairs all
```

Never eyeball colorblind safety. Run the script.

---

## 3. Mark specifications

| Mark | Spec |
|---|---|
| **Line** | 2px stroke, round cap and join, no shadow. No point markers by default; markers appear on hover and on the last point of each series. |
| **Area** | Fill at 12% of the series hue over the chart surface, with the 2px line on top. Single series only. |
| **Bar / column** | 4px rounded corners on the **data end only** (the end away from the baseline); the baseline end is square. Bars are thin: bar thickness ≤ 60% of the band, min 6px, max 32px. |
| **Adjacent bars / stacked segments** | 2px gap in the **surface color** between fills — not a border, a gap. This is what keeps stacked segments legible when two adjacent hues are close. |
| **Overlapping marks** (scatter, bubble) | 2px ring in the surface color around each mark. |
| **Scatter point** | ≥ 8px diameter. Below 8px, hue cannot be judged. |
| **Sparkline** | 1.5px stroke, no axes, no grid, no labels; final point gets a 3px dot in the series hue. |
| **Reference band** (normal range) | Filled with the reference-band token, no border, behind all marks. Labeled once at the right edge, `label` type. |
| **Annotation** | 1px dashed vertical or horizontal line in annotation ink, with an 11px label at the top; max 2 per chart. |
| **Grid** | Horizontal only, hairline (1px, gridline token). No vertical grid unless the x-axis is continuous and unlabeled. |
| **Axis** | The baseline is visible; the opposite axis line is not. Ticks are inferred by labels; no tick marks. |

---

## 4. Axes, labels, legends

**Y-axis.** 3–5 ticks, never more. Abbreviate at the tick (`$3.8M`, `1.2k`) — abbreviation is correct on an axis and forbidden on the hero number. Always include the unit, either in the axis label or on the top tick.

**X-axis.** Show every label when they fit; otherwise show first, last, and evenly spaced interior labels — never rotate labels past 0°. If labels don't fit horizontally, switch to a horizontal bar chart. Rotated axis labels are a signal that the form is wrong.

**Zero baseline.** Mandatory for bars and columns. Optional for lines; when omitted, annotate the axis with a break glyph and state the range.

**Direct labels beat legends.** With ≤ 4 series, label each series at its last point, in text ink, with a 8×8px swatch. Keep the legend too — identity must never be color-alone — but the direct label is what people actually read.

**Legend.** Present whenever there are ≥ 2 series. Placed top-left under the title, horizontal, wrapping. A single series has no legend box; the title names it. Legend items are clickable to isolate/mute a series, with the muted series rendered at 20% opacity rather than removed (removing it rescales the axis and disorients).

**Value labels.** Never on every point. Label the max, the min, the last point, and any annotated point. On bar charts with ≤ 8 bars, label every bar and drop the value axis entirely — that is denser and easier to read than an axis plus grid.

**Number formatting** follows `design-system.md` §10.1, with the one exception that axis ticks may abbreviate.

---

## 5. Interaction

Every HTML/SVG chart in this product is interactive by default. The only exception is a bare sparkline inside a hero block.

**Hover.**
- Line and area: a **crosshair** (1px vertical, annotation ink) snapping to the nearest x, with a tooltip showing every series at that x, sorted descending by value, with the hovered series bolded.
- Bar, column, scatter, heatmap cell: per-mark tooltip; the hovered mark gets a 2px surface ring; siblings drop to 55% opacity.
- Hit targets are larger than the marks — for lines, the full column band; for scatter, a 16px radius.
- Tooltip: `surface-3`, `radius-md`, overlay elevation, `p-2.5`, `ui-sm`. Header is the x value in `text-primary`; rows are `[swatch] [series] [value tabular-nums right-aligned]`. Appears in 100ms, no fade-out delay beyond 60ms.

**Click.** A mark click drills down: it appends the corresponding filter as a **context chip** on the parent answer and re-runs. This is the connective tissue between the chart and the ask loop — clicking "Outerwear" in a bar chart is the same act as typing "just outerwear", and it produces a fully verified new answer, not a client-side filter.

**Brush.** On time-series with > 60 points, drag-to-zoom on the x-axis. Zooming is client-side and does **not** re-run the query or change the seal; a `Reset zoom` chip appears while zoomed. If the user wants a genuinely different range, they edit the time-range chip — which does re-run and re-verify.

**Filters** live in a single row above the chart, never inside it, and are the same context chips used everywhere else.

**Keyboard.** Charts are focusable (`tabindex=0`, `role="img"` with a full `aria-label` describing the trend and endpoints). `←`/`→` step the crosshair through x values, announcing each via a visually-hidden live region. `T` toggles the table view.

**Table view.** Every chart has a `Table` toggle in its header revealing the underlying rows as a real `<table>`. This is the accessibility relief channel that the light-mode contrast WARN obligates, and it is also the fastest path to "just give me the numbers."

---

## 6. Rendering confidence in a chart

This is the section that differentiates this product's charts from every other BI tool's. **The confidence state of the answer changes how the chart renders.** No exceptions.

### 6.1 By state

| State | Chart treatment |
|---|---|
| **verified** | Standard. Solid marks, full opacity. The `inline` seal sits in the chart header, right-aligned. |
| **qualified** | Standard marks, **plus** a caveat strip directly beneath the plot: a 24px row, `qualified-bg` tint, `qualified` ink, 12px, containing the caveat sentence verbatim. If the caveat is scoped to a region of the chart (a period, a series), that region also gets a 45° hatch overlay at 10% opacity and a small `⚠` at its top edge. |
| **unverified** | **Marks are hatched.** Bars and areas take a 45° line texture in their own hue over the surface; lines become 2px dashed (`6 4`). A `○ Unverified` chip sits at the top-right of the plot area, over the chart, not in the header. The y-axis label gains the suffix `(unverified)`. |
| **refused** | **No chart is drawn.** The ambiguity fork's spread bar takes its place (§7). Drawing one candidate's chart would be picking, which is precisely what the product refuses to do. |
| **contested** | Both derivations are drawn: the primary in slot 1, the conflicting one as a 2px dashed line in `contested` ink, with the divergence region shaded. A `≠` annotation marks the point of maximum divergence with the absolute and percentage gap. |
| **superseded** | Marks render at 55% opacity with a `⟲ Superseded` chip and a `Re-run` action in the chart header. |

The hatch is the load-bearing device: it survives greyscale, printing, screenshots pasted into decks, and every form of colorblindness. **An unverified chart must be recognizable as unverified in a black-and-white screenshot.**

### 6.2 Excluded rows are always visualized

When the `join_loss` or `coverage` check reports excluded rows, the chart carries a **coverage bar** immediately beneath the plot: a 4px full-width track in `surface-2` with the included fraction filled in the series hue, labeled `181,759 of 181,759 rows` (or `1,306,240 of 2,431,963 rows — 46.3% had no linked user`).

Below 95% coverage the bar's unfilled portion takes the `qualified` hue and the label goes into `qualified` ink. This is how a business user sees "half your web traffic isn't in this chart" without reading a single line of SQL.

### 6.3 Partial series

When some series in a multi-series chart are verified and others are not (common in dashboards composed of separate answers), verified series render solid and unverified series render hatched **within the same chart**, and the legend annotates each with its state glyph. Do not downgrade the whole chart to unverified — that is dishonest in the other direction.

---

## 7. Product-specific chart forms

Three forms are specific to this product and are specified here in full because they carry product meaning.

### 7.1 The spread bar (ambiguity fork)

A single horizontal axis showing every candidate reading at its true value.

- Height 56px total: 2px axis rule in baseline ink, 10px dots in slot-1 indigo at each candidate's position, direct value labels above (`hero-sm` for the recommended candidate, `subtitle` for others), candidate names below in `ui-sm text-tertiary`.
- The axis spans `min × 0.9` to `max × 1.1`.
- **If the spread exceeds 5×, switch to a log scale** and annotate `log scale` at the right end of the axis in `label` type. Linear scaling a 4× spread makes the small candidate vanish; log scaling without saying so is a lie. Both problems are solved by saying so.
- Above the bar, the spread multiple: `4.0× spread` in `subtitle`, `text-accent`.
- No grid, no y-axis, no legend.

### 7.2 The contribution waterfall (investigations)

- Start bar (the prior-period value) and end bar (the current value) in `text-tertiary` fill; contribution bars in slot 1 (positive) and slot 2 (negative), or in the diverging pair when the sign is semantically good/bad.
- Bars are connected by 1px dotted leader lines in annotation ink.
- **The `Unexplained` residual bar is mandatory and always drawn**, even at zero, in the `unverified` neutral hue. A decomposition without a visible residual implies a completeness the analysis does not have.
- Sorted by absolute contribution descending, positives and negatives interleaved in that order (not grouped by sign) — grouping by sign makes the running total meaningless.
- Every bar direct-labeled with its contribution in percentage points.

### 7.3 The watch band (monitoring)

- Time series of the watched metric, 90 points default.
- The **normal range** is a filled reference band (reference-band token) computed from the watch's sensitivity, labeled once at the right edge with its bounds.
- Breach points get a 6px dot in `qualified` (warning) or `contested` (critical) ink plus a vertical annotation line.
- Incomplete trailing periods render hatched with the label `in progress` — this is what prevents "revenue is down!" alerts on a half-finished day, and the chart should show the reason at a glance.

---

## 8. Implementation notes

- **Renderer:** SVG for anything under ~2,000 marks; canvas above that. Both must produce the same marks, tooltips, and accessibility affordances.
- **Server-rendered images** (Slack, email, exports) render at 2× in the *requester's* theme, at 800×360 for a standard chart, with the seal, caveat strip, and coverage bar baked into the image. A chart image that drops the confidence apparatus reintroduces the bare-confident-number failure mode in the medium where it does the most damage.
- **Theme swapping:** define chart colors as CSS custom properties on a `.viz-root` wrapper, declared under both `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]` scopes so the theme toggle wins in both directions. Never compute a dark palette by inverting the light one.
- **Axis domain is computed before the first mark paints** and does not change during the draw-in animation. A rescaling axis reads as a system changing its mind.
- **Draw-in:** 180ms, `--ease-out`, once, on first render only. Never on re-render, never on filter change (the marks transition in place at 140ms instead). Disabled entirely under `prefers-reduced-motion`.
- **Every chart component takes `confidenceState` and `checks` as required props.** Making them optional guarantees that some chart, somewhere, ships without them.

---

## 9. Anti-patterns (review-blocking)

1. A dual-axis chart.
2. A pie or donut that violates the donut constraints in §1 (negative measure, > 8 unfolded slices, no total, suggested as the default form).
3. A truncated baseline on a bar or column chart.
4. A ninth categorical hue, or hues generated at runtime.
5. Series color reassigned when a filter changes the series count.
6. More than 3 series in a scatter, bubble, heatmap, or small-multiples chart.
7. A categorical palette shipped without running the validator.
8. Light-mode slots 3, 4, or 5 used without direct labels or a table view.
9. A status color used as "series 4".
10. Value labels on every point.
11. Rotated x-axis labels.
12. Text in a chart wearing the series color.
13. Red/green as a diverging pair.
14. A hue at the midpoint of a diverging scale.
15. A chart of an unverified answer rendered identically to a verified one.
16. A chart of a refused answer.
17. A waterfall without an `Unexplained` bar.
18. A log-scaled axis that doesn't say it is log-scaled.
19. An exported or Slack-rendered chart image without its seal and caveat.
20. A chart with no table view and no keyboard access.

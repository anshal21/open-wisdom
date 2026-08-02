# Screen Specifications

**Companion docs:** [`design-system.md`](./design-system.md) (tokens, components) · [`data-viz.md`](./data-viz.md) (charts)
**Read the design system first.** Everything here assumes its tokens, components, and confidence-state vocabulary.

Nothing in this document may be hardcoded to a specific warehouse or schema. TheLook is demo data; every string that names a table, column, metric, or source is data-driven.

---

## Contents

| § | Surface |
|---|---|
| 0 | Global shell, navigation, keyboard model |
| 1 | Ask / Answer — the core loop |
| 2 | Answer detail & permalink |
| 3 | **Ambiguity fork (refusal)** — the signature screen |
| 4 | Definitions — the earned semantic layer |
| 5 | Answer ledger |
| 6 | Dashboards |
| 7 | Notebook |
| 8 | Investigations |
| 9 | Watches & alerts |
| 10 | Sources & schema browser |
| 11 | Admin |
| 12 | Slack surfaces |
| 13 | Responsive behavior |
| 14 | Cross-cutting state matrix |

---

## 0. Global shell

### 0.1 Frame

```
┌────────────┬───────────────────────────────────────────────┬──────────────────┐
│            │  surface header                          52px │                  │
│  left rail ├───────────────────────────────────────────────┤  evidence panel  │
│   236px    │                                               │      380px       │
│            │              content region                   │   (contextual,   │
│            │        max 1080px, centered w/ 24px gutter     │    collapsible)  │
│            │                                               │                  │
│  ─────────  │                                               │                  │
│  footer    │                                               │                  │
└────────────┴───────────────────────────────────────────────┴──────────────────┘
```

The rail is full height and always mounted. Route changes swap only the header + content region, so navigation never repaints chrome — this is most of what makes the app feel instant.

### 0.2 Left rail

`bg-surface-1`, `border-r border-border-default`, `w-236px`. Collapsible to `52px` (icon-only) with `⌘\`, persisted.

```
┌────────────────────────────┐
│  ◇ Workspace name      ⌄   │   32px, opens workspace/source switcher
├────────────────────────────┤
│  ⌘K  Search or ask…        │   28px, opens command palette (not a real input)
├────────────────────────────┤
│  ✳  Ask                    │   primary loop
│  ▤  Ledger            1.2k │
│  ◈  Definitions        34  │
│  ▦  Dashboards          6  │
│  ⌥  Notebooks           3  │
│  ⌕  Investigations      2  │
│  ◉  Watches             9  │   badge turns qualified-amber when any watch is firing
├────────────────────────────┤
│  DATA                      │   label type, 11/600/uppercase
│  ⛁  Sources             2  │
├────────────────────────────┤
│                            │
│  ⚙  Settings               │   bottom-anchored
│  ●  Avatar  Name       ⌄   │
└────────────────────────────┘
```

**Item spec.** `h-30px`, `radius-sm`, `px-2 gap-2`, icon 16px. Rest `text-secondary`. Hover `bg-overlay-hover text-primary` (100ms). Active `bg-overlay-selected text-accent` with a 2px accent left-edge bar inset 4px from the rail edge. Counts are `ui-sm text-tertiary`, right-aligned.

**Status is ambient, not navigational.** The only colored signal in the rail is the Watches badge when a watch is firing (amber) or a definition change has superseded answers (amber dot on Definitions). Nothing else in the rail is ever green, red, or accent-tinted except the active item.

### 0.3 Surface header

`h-52px`, `border-b border-border-default`, `bg-surface-canvas`, sticky. Left: breadcrumb (`Section / Object`) in `title` for the leaf, `text-tertiary` for ancestors. Right: surface actions (`ghost sm`), then the primary action for that surface if it has one.

When the content region scrolls past 40px, the header gains `border-strong` and the leaf breadcrumb shrinks from `title` to `subtitle` over 100ms. No other scroll effects.

### 0.4 Evidence panel

Right-docked, `w-380px` default, drag-resizable `320–560px`, persisted. `bg-surface-1`, `border-l border-border-default`. Toggled with `E`.

It is **contextual, not global** — it shows the evidence for whatever is focused: an answer, a dashboard tile, a notebook cell, an investigation step, a ledger row. If nothing is focused, it shows the evidence for the most recent answer on the surface, with a `text-tertiary` header noting what it is pinned to.

```
┌──────────────────────────────────────┐
│ EVIDENCE            ⌕ pin  ×    36px │
├──────────────────────────────────────┤
│ ⛊ Qualified · 7 of 8 checks     44px │  banner seal
│ February has 28 days vs January's 31 │
├──────────────────────────────────────┤
│ CHECKS                          8    │  label row
│ ⚠ Fair time comparison           ›   │  failures & warnings first
│   February has 28 days vs January's  │
│   31. Per-day revenue rose 4.7%.     │
│ ✓ Computed a second way          ›   │
│   Two queries agree: $203,220        │
│ ✓ No rows silently dropped       ›   │
│ ✓ No rows double-counted         ›   │
│ ○ Consistent with what we said…  ›   │  skipped, greyed, with reason
├──────────────────────────────────────┤
│ DEFINITIONS USED                     │
│ ⛊ Revenue v3   Priya Nair · 4 Mar    │
│ ⛊ Order date   inferred  ⟳ ratify?   │
├──────────────────────────────────────┤
│ COVERAGE                             │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░  181,759 /      │
│                       181,759 rows   │
├──────────────────────────────────────┤
│ ▸ Derivation (SQL, 2 paths)     ⌥E   │  Tier 3, collapsed
└──────────────────────────────────────┘
```

Checks stream in during generation with a 40ms stagger. The panel is never empty during generation — it shows the check list up front with all rows in a pending state, so the user can read *what is going to be checked* before the results land. This is a deliberate trust move: knowing the checklist in advance is more reassuring than watching items appear from nowhere.

### 0.5 Keyboard model

Global, always active:

| Key | Action |
|---|---|
| `⌘K` | Command palette (ask, jump, act) |
| `/` | Focus the ask composer on the current surface |
| `⌘\` | Collapse / expand left rail |
| `E` | Toggle evidence panel |
| `⌥E` | Toggle evidence panel expanded to Tier 3 (derivation) |
| `⌘↵` | Submit (composer, dialog forms) |
| `Esc` | Close overlay / clear selection / blur composer |
| `?` | Keyboard shortcut sheet |
| `⌘.` | Toggle theme |

Navigation chords (Linear-style `g` then key): `g a` Ask · `g l` Ledger · `g d` Definitions · `g b` Dashboards (**b** for boards, `d` is taken) · `g n` Notebooks · `g i` Investigations · `g w` Watches · `g s` Sources.

Answer-scoped (when an answer is focused):

| Key | Action |
|---|---|
| `S` | Show SQL (jumps to Tier 3) |
| `C` | Copy answer for Slack (formatted, with seal) |
| `R` | Re-run |
| `P` | Copy permalink |
| `F` | Follow up (focus composer, keeping chips) |
| `D` | Add to dashboard |
| `I` | Start an investigation from this answer |
| `1…9` | Focus the Nth context chip |
| `⌫` | Remove the focused chip |

List-scoped: `↑ ↓` move, `↵` open, `⌘↵` open in new pane, `Space` preview, `X` select, `⌘A` select all.

`?` opens a shortcut sheet grouped by these scopes. It is a dialog, not a page.

---

## 1. Ask / Answer — the core loop

The default surface. Route `/ask` (new) or `/ask/:threadId`.

### 1.1 Layout

```
┌──────────────────────────────────────────────────────┬────────────────┐
│  Thread title (auto-named from Q1)     ⋯   R  P  D   │                │
├──────────────────────────────────────────────────────┤   EVIDENCE     │
│                                                      │                │
│  ╭ scrollback (previous turns, collapsed to 2 lines ╮│   (pinned to   │
│  │  each; click to expand)                          ││    the focused │
│  ╰──────────────────────────────────────────────────╯│    turn)       │
│                                                      │                │
│  ┌ ACTIVE TURN ───────────────────────────────────┐  │                │
│  │ Q  What was revenue in February?               │  │                │
│  │                                                │  │                │
│  │ [metric Revenue⌄][time Feb 2023⌄][filter …⌄]+ │  │  ← context chips│
│  │                                                │  │                │
│  │ Interpret ✓ Resolve ✓ Plan ✓ Query ◜ Verify Compose │            │
│  │ ────────────────────────────                   │  │  ← stage rail  │
│  │                                                │  │                │
│  │        $203,220     ⛊ Qualified · 7/8          │  │  ← Tier 1      │
│  │        February 2023 revenue                   │  │                │
│  │                                                │  │                │
│  │ ⚠ February has 28 days vs January's 31.        │  │                │
│  │   Per-day revenue rose 4.7% while the total    │  │                │
│  │   fell 5.4%.                          Review ▸ │  │  ← banner seal │
│  │                                                │  │                │
│  │  ┌──────────── chart ───────────────────────┐  │  │                │
│  │  └──────────────────────────────────────────┘  │  │                │
│  │                                                │  │                │
│  │  Narrative, ≤3 sentences, streamed.            │  │                │
│  │                                                │  │                │
│  │  Answered in 6.4s · 8 checks · Revenue v3      │  │  ← collapsed   │
│  │  ─────────────────────────────────────────     │  │     rail       │
│  │  ▸ Show the data (181,759 rows → 1)            │  │                │
│  │  Follow up:  [by category] [vs last year] [+]  │  │                │
│  └────────────────────────────────────────────────┘  │                │
│                                                      │                │
│  ╭────────── ask composer (docked) ───────────────╮   │                │
│  │ ⛁  Ask a follow-up…                    ⌘↵  →  │   │                │
│  ╰────────────────────────────────────────────────╯   │                │
└──────────────────────────────────────────────────────┴────────────────┘
```

### 1.2 The answer block, in order

1. **The question**, `title` weight, with an inline edit affordance (pencil on hover). Editing re-runs.
2. **The context chip row** — fixed 24px height, never wraps (§9.4 of the design system). This is the state; it is the primary control for follow-ups that don't need language.
3. **The stage rail** during generation; collapses to a one-line summary after.
4. **Tier 1 — the claim.** The number at `hero`, the one-line read at `body text-secondary` beneath it, and the `standard` seal to the number's right, vertically centered on the number's cap height.
5. **The banner seal**, only when the state is `qualified`, `unverified`, `contested`, or `superseded`. For `verified` the `standard` seal is sufficient — a green banner on every good answer becomes wallpaper within a day and stops meaning anything.
6. **The chart**, when the shape warrants one (see `data-viz.md` §1). Not every answer gets a chart; a single scalar gets a sparkline at most.
7. **Narrative**, max three sentences, streamed. States the number, the comparison, and the single most important caveat. Not a restatement of the chart.
8. **The collapsed footer**: timing, check count, definitions used.
9. **`Show the data`** — a disclosure revealing the result table (§9.8 of the design system) with row counts before and after aggregation.
10. **Follow-up suggestions** — max 3 chips, generated from the answer's actual dimensions, never generic.

### 1.3 Streaming choreography (the snappiness spec)

| t | What happens |
|---|---|
| 0ms | Composer clears; question paints into the thread; scrollback collapses; stage rail appears with `Interpret` active |
| < 400ms | `Interpret` completes; context chips appear (inferred ones dashed) |
| < 1.2s | `Resolve` completes; chips that matched a ratified definition gain their shield glyph; evidence panel populates with the **pending check list** |
| ~2s | `Plan` completes; the chart's axes and skeleton frame render at final geometry (so nothing jumps when data arrives) |
| 3–8s | `Query` completes → **the number snaps in**, seal shows `checking · n/m` |
| 8–20s | `Verify` — checks land into the evidence panel with 40ms stagger; seal count increments; the moment a check fails, the seal changes state immediately and the banner appears |
| overlap | `Compose` — narrative streams. Composing begins as soon as the number exists and is *revised* if a late check fails; a revised sentence is replaced whole, never re-typed character by character |
| resolve | Stage rail collapses to the summary line |

**The user can ask a follow-up while checks are still running.** The prior turn keeps verifying in the background and its seal resolves in the scrollback.

**If verification will exceed 20s**, the seal shows `checking · 6/8 · slow check running` with the name of the slow check. Never let a progress indicator sit without a changing label.

### 1.4 Follow-ups and context

- A follow-up inherits the full chip set. Chips the follow-up changes animate (`base`, 140ms) to their new value with a brief accent border pulse — the only "pulse" in the system, and it exists because a silently-changed filter is exactly the failure mode this product is about.
- **Branching:** hovering any turn in scrollback reveals `⑂ Branch from here`. Branching forks the thread; the parent stays intact. The thread header shows `main` / branch chips when more than one exists.
- **Scrollback density:** prior turns collapse to `Q + number + inline seal` on two lines. Click expands in place. The active turn is always fully expanded.

### 1.5 Empty state (`/ask`, new workspace, no answers yet)

Centered, above the composer, no illustration:

```
              ✳
      Ask anything about your data

  Connected to <source name> · <n> tables

  Nothing has been modeled yet. Ask a question
  and definitions will accumulate as you go.

  [ What was revenue last month? ]
  [ How many customers do we have? ]
  [ Which products sell best? ]
```

The three suggestions are **generated from the connected schema** — table names, detected date columns, detected measure columns. They are never hardcoded. If schema introspection has not finished, show three skeleton chips, not placeholder text.

If no source is connected, replace the whole block with the Sources empty state (§10.2) — asking is impossible, so don't offer it.

### 1.6 Failure states on this surface

| Condition | Rendering |
|---|---|
| Question not answerable from the schema | Not an error. `unverified` state, headline *"No table here holds `<concept>`"*, and a list of the closest available concepts with sample questions. Offer `Connect another source`. |
| Query timed out | Answer block stays; number region shows the timeout error card (§9.13); chips remain editable so the user can narrow the range without retyping. |
| Query failed | Same, with plain-English cause + `Show SQL` |
| Model unavailable | Toast + composer disabled with an inline reason. The thread stays readable. |

Under no circumstance does an error remove the question, the chips, or previous turns from the screen.

---

## 2. Answer detail & permalink

Route `/a/:answerId`. This is the durable artifact — the thing that goes in a Slack message, a board deck footnote, an audit trail. It must render for someone who was not in the conversation and has no context.

### 2.1 Layout

Single centered column, `max-w-1080px`, evidence panel available but **collapsed by default** (a permalink recipient sees the claim first).

```
┌───────────────────────────────────────────────────────────┐
│  ← Ledger                          ⟳ Re-run  ⧉ Copy  ⋯    │
├───────────────────────────────────────────────────────────┤
│  What was revenue in February 2023?                       │
│  Asked by Dana Okafor       · 12 Mar 2026, 09:14 IST          │
│                                                           │
│      $203,220        ⛊ Qualified · 7 of 8 checks          │
│      February 2023 revenue                                │
│                                                           │
│  ⚠ February has 28 days vs January's 31. Per-day revenue  │
│    rose 4.7% while the total fell 5.4%.        Review ▸   │
│                                                           │
│  [ chart ]                                                │
│                                                           │
│  Narrative                                                │
│                                                           │
│  ── CONTEXT ────────────────────────────────────────────  │
│  Metric      Revenue  ⛊ v3 · Priya Nair · 4 Mar           │
│  Filters     status ≠ Cancelled, Returned                 │
│  Grain       month                                        │
│  Range       1–28 Feb 2023                                │
│  Source      <source name> · loaded 2h ago                │
│                                                           │
│  ── CHECKS (8) ─────────────────────────────────────────  │
│  [full check list, expanded — not behind a panel here]    │
│                                                           │
│  ── DERIVATION ─────────────────────────────────────────  │
│  ▸ Path A SQL   ▸ Path B SQL   ▸ Timings   ▸ Model        │
│                                                           │
│  ── HISTORY ────────────────────────────────────────────  │
│  Run 3 · 12 Mar · $203,220   ⛊ Qualified      current     │
│  Run 2 · 04 Mar · $203,220   ⛊ Qualified      diff ▸      │
│  Run 1 · 11 Feb · $198,410   ⛉ Superseded     diff ▸      │
└───────────────────────────────────────────────────────────┘
```

On the permalink page the checks are **inline and expanded**, not in a side panel. A recipient will not click a panel toggle; the evidence must be in the document.

### 2.2 States

- **Superseded** — a `superseded` banner at the very top: *"A definition this answer used has changed since it was recorded. Revenue v3 → v4 on 18 Mar."* with `Re-run` (primary) and `View diff`. The original figure stays visible and is **not** struck through in the hero — striking through the number implies it was wrong, when in fact it was correct under the old definition. Instead the hero number carries a dotted underline and the seal reads `Superseded`.
- **Re-run diff** — after a re-run, if the figure changed, a diff banner appears above the hero: `$198,410 → $203,220 (+2.4%)` with `What changed?` opening §9.15 diff.
- **Corrections** — `This is wrong` (ghost, in the `⋯` menu) opens a small form: what should it have been, and why. The correction is attached to the answer, appears in the check list as a `precedent` finding for future answers, and creates a definition proposal if the reason names an ambiguity.

---

## 3. Ambiguity fork (refusal) — the signature screen

> This is the product's money shot. It gets more design attention than any other screen.

### 3.1 The core idea

When a question has multiple defensible readings, the system does not pick. It **shows every candidate with its actual computed number**, side by side, and asks the user to choose. The candidates are already computed by the time the fork renders — so refusal is not a delay, it is the *fastest* path to a correct answer. That is what makes this feel like power rather than friction.

### 3.2 Layout (2–3 candidates, side by side)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  What was 2023 revenue?                                                  │
│                                                                          │
│  ⑂  This question has 3 defensible answers                               │
│     They differ by 4.0x. Which one do you mean?                          │
│                                                                          │
│     ├──────●───────────────●──────────────────────────────●─────┤        │
│    $1.28M                $3.82M                         $5.10M           │
│                                                          spread bar      │
│                                                                          │
│  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐    │
│  │ ⌾ RECOMMENDED      │ │                    │ │                    │    │
│  │                    │ │                    │ │                    │    │
│  │   $3,820,425       │ │   $5,101,373       │ │   $1,278,434       │    │
│  │                    │ │                    │ │                    │    │
│  │ Exclude cancelled  │ │ All order items    │ │ Completed orders   │    │
│  │ and returned       │ │                    │ │ only               │    │
│  │                    │ │                    │ │                    │    │
│  │ Counts every order │ │ Counts every order │ │ Counts only orders │    │
│  │ that wasn't        │ │ ever placed,       │ │ marked complete.   │    │
│  │ cancelled or sent  │ │ including ones     │ │ Excludes shipped   │    │
│  │ back.              │ │ cancelled or       │ │ and processing.    │    │
│  │                    │ │ returned.          │ │                    │    │
│  │ 136,437 of         │ │ 181,759 of         │ │ 45,609 of          │    │
│  │ 181,759 rows       │ │ 181,759 rows       │ │ 181,759 rows       │    │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  │ │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │ │ ▓▓▓▓░░░░░░░░░░░░░  │    │
│  │                    │ │                    │ │                    │    │
│  │ ▸ Why this differs │ │ ▸ Why this differs │ │ ▸ Why this differs │    │
│  │                    │ │                    │ │                    │    │
│  │ [Use once]         │ │ [Use once]         │ │ [Use once]         │    │
│  │ [Use & ratify  ⛊]  │ │ [Use & ratify  ⛊]  │ │ [Use & ratify  ⛊]  │    │
│  └────────────────────┘ └────────────────────┘ └────────────────────┘    │
│                                                                          │
│  None of these — define "revenue" yourself ›                             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Specification

**Frame.** Indigo. `surface-1` cards on `surface-canvas`, `border-accent-tint-border`, `radius-xl`, `p-5`. The fork glyph and headline are `text-accent`. **No red. No amber. No alert icon. No "error" word anywhere on this screen.**

**Headline.** Always states the count and the spread: *"3 defensible answers · they differ by 4.0x"*. The spread multiple is the honesty payload — it tells a non-technical reader instantly whether this matters. If the spread is under 2%, do not fork at all; pick the recommended reading and record the alternative as a `filter_sensitivity` pass.

**Spread bar.** A single horizontal axis with the candidates plotted at their true positions, log-scaled if the spread exceeds 5x (annotate `log scale`). It converts "these are different" into "these are *this* different" without any SQL. Values are direct-labeled; no legend.

**Candidate card.** Five parts, always in this order:
1. `hero-sm` number, `tabular-nums`
2. Definition name — short, human, 2–4 words
3. Plain-English explanation, ≤ 2 sentences, **no column names, no SQL, no jargon**
4. Row coverage: `n of N rows` plus a 6px coverage bar (`accent` fill on `surface-2` track)
5. `▸ Why this differs` — a Tier-3 disclosure with the filter predicate and SQL fragment

**Recommendation.** At most one card carries a `⌾ RECOMMENDED` eyebrow, and only when there is a real basis: a ratified definition exists elsewhere in the workspace, a dbt/Cube model defines it, the source's own documentation states it, or precedent from the ledger. The card shows *why*: *"Matches how Finance defined revenue on 4 Mar"*. **If there is no basis, no card is recommended** — inventing a recommendation is the exact behavior this screen exists to prevent.

**Actions.**
- `Use once` (secondary) — answers now, records nothing. For exploratory or one-off readings.
- `Use & ratify` (primary, accent) — answers now **and** opens the one-click ratify sheet (§4.4). This is the earned-semantic-layer moment, and it must be the visually dominant action.
- `None of these — define it yourself` — a text link at the bottom, opening the definition editor pre-filled with the question and the candidates as starting points.

**Ordering.** Candidates order by likelihood, not by value. The recommended card is first. Never order by size — that implies a magnitude judgment the system has not made.

**More than 3 candidates.** Show the top 3 as cards plus `Show N more readings ▸` expanding to a compact table (name · number · rows · action). Never render 5 cards; the comparison stops being scannable past 3.

**Keyboard.** `1` `2` `3` select a candidate; `↵` uses the selected one; `⌘↵` uses and ratifies; `Esc` returns to the composer with the question preserved for rephrasing.

### 3.4 The `contested` variant

When two derivations of the *same* reading disagree, the frame is red and the copy is different:

```
  ≠  Two ways of computing this disagree

     Path A            Path B
     $3,820,425        $3,791,002        0.77% apart

     The difference is 47 orders that appear in the items table
     but have no matching order record.

     [Investigate the gap]   [Show both queries]   [Use Path A anyway]
```

No number is promoted to the hero. `Use Path A anyway` is a `secondary` button, never primary, and the resulting answer permanently wears a `contested` seal. This state should be rare; if it is common, that is a data-quality finding and the Investigations surface should be offered.

### 3.5 Fork rate governance

The research sets the bar: *no more than 1 clarification per 5 questions on a warmed-up workspace.* The Definitions surface exposes this as a live metric (§4.1). If fork rate exceeds 20%, the Definitions surface shows a nudge: *"You're being asked to disambiguate often. Ratifying these 4 definitions would cover 78% of recent forks."*

---

## 4. Definitions — the earned semantic layer

Route `/definitions`. This surface makes the accumulating semantic layer visible and satisfying. It is the surface that proves the product gets better with use.

### 4.1 Header — the coverage metric

The coverage number is the adoption story and it gets hero treatment at the top of the surface, not buried in a settings page.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Definitions                                    [+ New definition]   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   68%          34 ratified · 7 proposed · 2 contested                │
│   of this month's questions were answered entirely from              │
│   ratified definitions                            ▲ up from 41% ─┐   │
│                                                                  │   │
│   ▁▂▃▃▄▅▅▆▇█   coverage, last 12 weeks ───────────────────────────┘   │
│                                                                      │
│   Clarification rate  14%   ✓ under the 20% target                   │
└──────────────────────────────────────────────────────────────────────┘
```

Coverage is `hero`, the sparkline is 12 weekly points, and the delta is stated with its base per the number rules. This block is the first thing on the surface because it is the answer to "is this working?"

### 4.2 The list

Tabs: `Ratified` · `Proposed (7)` · `Contested (2)` · `All`. `Proposed` carries an accent-tinted count badge — it is a to-do.

Table columns: **Name · Definition (plain English, truncated) · Confidence · Version · Ratified by · Used in · Updated**.

- `Used in` shows a count of answers, and clicking it filters the Ledger — the link between the two surfaces is the point.
- `Confidence` column uses the `inline` seal to describe the *definition's* standing: `verified` (ratified, used, no conflicts), `qualified` (ratified but a conflicting usage was detected), `unverified` (inferred, never ratified), `contested` (two ratified definitions overlap).

Row hover reveals `Edit` · `New version` · `View usage`. Left rail of each row: a 2px accent bar if the definition was born from a fork (i.e. earned) versus imported.

### 4.3 The proposal queue

Proposals are the heart of the wedge and get a distinct card layout, not a table row:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⑂  "New customers"                              proposed 3 days ago │
│                                                                      │
│  Asked 6 times. Answered 3 different ways.                           │
│                                                                      │
│  ● Signups (users.created_at)          1,632 in Mar 2023   used 4×   │
│  ● First-time buyers (min order date)  2,335 in Mar 2023   used 2×   │
│                                        43% apart                     │
│                                                                      │
│  Evidence: this ambiguity was detected by the filter-sensitivity     │
│  check on 4 questions. It has never been ratified.                   │
│                                                                      │
│  [Ratify signups]  [Ratify first-time buyers]  [Both, named apart]   │
│  Dismiss — not worth defining                                        │
└──────────────────────────────────────────────────────────────────────┘
```

**`Both, named apart`** is a first-class action, and it matters: many "ambiguities" are two legitimate metrics wearing one word. Resolving it by naming both is often the right answer, and no competitor offers it as a one-click path.

The evidence line always states **how the system knows this is ambiguous** — that it came from a check firing, not from a documentation gap. That provenance is what makes the prompt compelling rather than a chore.

### 4.4 The ratify sheet (one click, from anywhere)

A `640px` dialog, reachable from a fork card, a proposal, an answer's evidence panel, or the definitions surface.

```
  Ratify "Revenue"

  Plain English    Total sale price of order items, excluding
                   cancelled and returned orders.
                   [editable, 2 lines, required]

  Expression       sum(order_items.sale_price)
                   where status not in ('Cancelled','Returned')
                   [mono, editable, syntax-checked live]

  Applies to       ◉ This workspace   ○ Just me

  Precedence       ◉ Official — use without asking
                   ○ Preferred — use, but keep flagging alternatives

  ── This will affect ──────────────────────────────────────
  47 recorded answers used a different reading of "revenue".
  ○ Leave them as they are (they'll be marked Superseded)
  ● Re-run them now (about 40 seconds)

                              [Cancel]  [Ratify as v4]
```

**The impact block is mandatory and is the differentiating detail.** No competitor tells you what a definition change invalidates. Showing "47 recorded answers" *before* the click is what makes the ledger real rather than a log.

The plain-English field is **required and comes first**, above the expression. If a business user cannot read the definition, ratification is theater.

### 4.5 Definition detail

Route `/definitions/:id`. Sections: plain English · expression · version history (with §9.15 diffs) · usage (which answers, dashboards, watches, notebooks depend on it — with a warning count if a change would break something) · conflicts (overlapping definitions, if any) · export.

**Export** offers dbt metric YAML and Cube schema. Per the research, never require our own spec and never trap the work: the export button sits at the top of the section, not hidden in a menu.

### 4.6 Empty state

```
        ◈
   No definitions yet — and that's fine

   Definitions accumulate as you ask questions. When a
   question is ambiguous, you'll pick a reading and can
   ratify it in one click.

   [ Ask a question ]    Import from dbt or Cube ›
```

This copy carries the positioning. The empty state of a semantic layer is normally a shameful "you have work to do"; here it is the promise.

---

## 5. Answer ledger

Route `/ledger`. Durable, searchable, permalinkable answers — not chat messages. This surface is the answer to G4.

### 5.1 Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  Ledger                                    ⌕ search   ⇩ export   ⋯     │
├────────────────────────────────────────────────────────────────────────┤
│  [All ⌄] [Anyone ⌄] [Any confidence ⌄] [Last 30 days ⌄]   1,204 answers│
├────────────────────────────────────────────────────────────────────────┤
│ QUESTION                       ANSWER      CONFIDENCE  WHO    WHEN     │
│ What was revenue in Feb 2023?  $203,220    ⛊ Qualified AD  12 Mar 09:14│
│ How many new customers…        2,335       ⛉ Superseded PN  12 Mar 08:52│
│ Top products by margin         —           ⑂ Refused   AD  11 Mar 17:03│
│ Repeat purchase rate           30.2%       ⛊ Verified  RS  11 Mar 16:40│
│ …                                                                      │
└────────────────────────────────────────────────────────────────────────┘
```

Columns are fixed: Question (flex) · Answer (right-aligned, tabular) · Confidence (`inline` seal, 96px) · Who (avatar + initials) · When (**absolute**, per the time rules).

Refused answers show `—` for the value and are still recorded — a refusal is a finding, and the ledger of refusals is what drives the proposal queue.

### 5.2 Behaviors that make this a ledger and not a history list

- **Semantic dedupe.** Questions that resolve to the same metric + filters + grain + range group into one row with a `× n` badge and expand to show every run. A ledger that lists the same question 40 times is a log.
- **Divergence flag.** If two runs of an equivalent question produced different numbers, the group row carries a `contested` inline seal and a `⚠ answered 2 ways` label. Clicking opens the diff. **This is the feature no competitor has**; it should be prominent.
- **Definition filter.** `Filter by definition` shows every answer that used a given definition version — the mechanism behind "what did this change invalidate?".
- **Bulk re-run.** Select rows → `Re-run (n)`. Progress shown as a compact inline bar in the toolbar; results update in place; changed figures flash a `qualified` tint for 800ms then settle.
- **Search** covers question text, answer values, definitions used, and narrative text. `⌘K` from anywhere searches the ledger.
- **`What did we say about X?`** — a saved-search shape surfaced as a suggestion in the search field. Returns prior *findings*, not just prior SQL (J10, institutional memory).

### 5.3 Row preview

`Space` on a focused row opens a `640px` preview overlay with Tier 1 + Tier 2 and `Open ↵` / `Re-run R`. Preview lets a head of data audit 30 answers in a minute without navigation.

### 5.4 Export

CSV and JSON. Both **must** carry the confidence state and check summary per row. An export that strips the warrant recreates the exact failure the product exists to prevent — a bare, confident, context-free number in a spreadsheet.

---

## 6. Dashboards

Route `/dashboards/:id`. **Dashboards here are compositions of ratified answers, not standalone charts.** Every tile is a permalinked answer that re-runs on a schedule, carries its own seal, and links back to its full evidence.

### 6.1 Layout

12-column grid, 8px gutters, tiles snap to `1×1`, `2×1`, `2×2`, `3×2`, `4×2`, `6×2`, `12×2`. Drag to move, drag edges to resize, `⌘Z` undoes.

Header: title, `Last refreshed <relative>`, a **dashboard-level confidence roll-up**, refresh, share, edit toggle.

**The roll-up** is the design decision that makes this surface consistent with the thesis:

```
  Q1 Business Review        Refreshed 6 min ago     ⛊ 9 verified · ⚠ 2 qualified · ○ 1 unverified
```

It is a per-state count, never an average, never a percentage, never a single "dashboard health score". Clicking any segment filters the grid to those tiles.

### 6.2 Tile anatomy

```
┌──────────────────────────┐
│ Revenue           ⛊  ⋯   │  ← inline seal, top-right; ⋯ on hover
│                          │
│   $3,820,425             │  ← hero-sm
│   ▲ +12.4% vs Q4         │  ← delta, never bare
│                          │
│   ▁▂▄▅▇█▇▅               │  ← sparkline or chart
│                          │
│ Revenue v3 · 6 min ago   │  ← ui-sm text-tertiary
└──────────────────────────┘
```

Card spec from the design system §9.7. Whole tile is clickable → answer detail. Hover reveals `⋯` (Re-run · Open answer · Replace · Remove).

**Tile confidence rules:**
- `qualified` tiles show the caveat as a single truncated line under the number in `qualified` ink. Truncation is acceptable here — the full text is one click away — but the *presence* of a caveat must never be hidden.
- `unverified` tiles render the number in `text-secondary` rather than `text-primary` and the chart with hatched marks (`data-viz.md` §6). An unverified tile must be visibly less emphatic than a verified one. This is the single most important rule on this surface: a dashboard where checked and unchecked numbers look identical is exactly the product we are arguing against.
- `superseded` tiles get an amber left-edge bar and a `Re-run` inline action in the tile footer.
- `refused` tiles cannot exist — you cannot add a refused answer to a dashboard. Attempting it opens the ambiguity fork to resolve first.

### 6.3 Adding a tile

Three paths, all leading to the same place: `+ Add tile` → picker with tabs `From ledger` (searchable, the default) · `From definitions` (pick a metric, then a range) · `Ask` (a composer inline in the dialog).

There is deliberately **no chart builder**. You do not configure a dashboard tile; you ask a question, verify the answer, and place it. That constraint is what keeps every tile auditable.

### 6.4 States

- **Empty:** `Nothing on this dashboard yet` + `Add your first tile` + a hint that tiles come from answers you've already verified.
- **Refreshing:** each tile independently shows a 2px accent progress line at its top edge; numbers stay visible and do not blank out. Optimistic and non-blocking.
- **A tile's source definition changed:** amber bar + roll-up updates; a dashboard-level banner appears once: *"2 tiles use a definition that changed. Re-run all?"*

---

## 7. Notebook

Route `/notebooks/:id`. For the analyst persona. Multi-step analysis with SQL and Python cells.

**The design position:** this is not a general-purpose notebook competing with Hex. It is a notebook where **every cell that produces a figure carries the same verification apparatus as an answer**, and where a cell can be promoted into a ratified definition or a dashboard tile. That is the only reason for it to exist here.

### 7.1 Layout

Two columns: cell stack (flex, `max-w-1080px`) and the evidence panel showing the focused cell's checks. Left gutter shows cell numbers and run status.

### 7.2 Cell types

| Type | Notes |
|---|---|
| `question` | A natural-language cell that produces a full verified answer. **This is the default cell type** — the notebook opens with one. |
| `sql` | Editable SQL. Runs against the source. Gets `join_loss`, `fan_out`, `grain`, `coverage` checks automatically. Cannot get `cross_derivation` (there is no second path for hand-written SQL) so it resolves to `unverified` at best unless the author supplies a second query. |
| `python` | Runs against the previous cell's result frame. **Explicitly cannot be verified** — its output always wears an `unverified` seal with the finding *"Python output can't be independently re-derived."* Honest, and consistent with the thesis. |
| `markdown` | Prose. No seal. |

### 7.3 Cell chrome

```
 ⌗3 ┌────────────────────────────────────────────── ▶ Run  ⋯ ──┐
    │ [ sql editor, mono, auto-height, 2–20 lines ]             │
    ├───────────────────────────────────────────────────────────┤
    │ ⛊ Qualified · 3/4     1,204 rows · 240ms                  │
    │ [ result table or chart ]                                 │
    └───────────────────────────────────────────────────────────┘
```

Cell states: `idle` · `queued` (dimmed, accent left bar) · `running` (2px accent progress line at cell top) · `done` · `error` · `stale` (a dependency ran after this cell — dotted left bar and a `Re-run from here` affordance).

`⇧↵` runs a cell and moves to the next. `⌘↵` runs in place. `⌘⇧↵` runs all. `Esc` exits the editor to cell-navigation mode, where `↑`/`↓` move, `A`/`B` insert above/below, `DD` deletes, `⌘⇧V` toggles cell type.

### 7.4 Promotion

Every cell footer has `⋯ → Promote`:
- `Promote to definition` — opens the ratify sheet pre-filled with the cell's expression
- `Promote to dashboard tile` — only enabled for cells with a `verified` or `qualified` seal
- `Promote to watch` — creates a metric watch from this cell

Promotion is the notebook's reason for existing. It should be one click from the cell, not buried in a menu that requires hunting.

---

## 8. Investigations

Route `/investigations/:id`. The "why did X change?" flow. The design must enforce the research's ordering: **rule out measurement artifacts, then data incidents, then business drivers** — and must make "nothing happened" a first-class, well-designed conclusion.

### 8.1 The rule-out ladder

The spine of the surface is a vertical ladder in a left rail (`260px`), always visible:

```
  INVESTIGATION
  Why did revenue drop in Feb?

  ┌─ 1 ─ MEASUREMENT ────────┐
  │ ⚠  Period length          │   ← failed to rule out → investigation stops here
  │ ✓  Calendar shift         │
  │ ✓  Definition changed     │
  │ ✓  Mix effect             │
  └───────────────────────────┘
            │
       ■ STOPPED HERE
            │
  ┌─ 2 ─ DATA QUALITY ───────┐
  │ ○  Row-count anomaly      │   ← not run (greyed)
  │ ○  Freshness              │
  │ ○  Null-rate shift        │
  │ ○  New / missing values   │
  └───────────────────────────┘
            │
  ┌─ 3 ─ BUSINESS DRIVERS ───┐
  │ ○  Segment decomposition  │
  │ ○  Rate vs mix            │
  │ ○  Cohort                 │
  └───────────────────────────┘
```

**The `■ STOPPED HERE` marker is the most important element on this surface.** It says: we did not go hunting for a business driver, because the metric did not actually move. Products that skip to phase 3 confabulate; this marker is the visual proof that we didn't.

Phases the investigation never reached render at 45% opacity with hollow glyphs and are explicitly labeled `not run` — not hidden. Hiding them would let a user assume they passed.

### 8.2 The conclusion block

Top of the content region, above the evidence:

```
  ⚠  Revenue didn't drop.

     February has 28 days; January had 31. Revenue per day rose
     4.7% ($6,933 → $7,258). The -5.4% headline is a calendar
     artifact, not a business change.

     $203,220 total  ·  -5.4% vs January
     $7,258 per day  ·  +4.7% vs January     ← the honest comparison

     ⑂ We stopped here. No business drivers were examined because
       the metric did not move on a normalized basis.

     [ Investigate anyway ▸ ]        [ Share ⌘⇧C ]
```

`Investigate anyway` is available (users are entitled to overrule) but it is a `secondary` button and the resulting driver analysis is permanently labeled *"Run after the metric was shown not to have moved."* Honest, not paternalistic.

### 8.3 The null result

When the ladder completes all three phases and no driver clears significance, the conclusion is:

```
  ○  No significant driver found.

     Revenue fell 3.1% ($203,220 → $196,930). We examined 14
     segments across 4 dimensions. The largest single contribution
     was Outerwear at -0.8pp, which is within its normal month-to-
     month range (±1.4pp over the last 12 months).

     This is consistent with ordinary variation.

     [ Show all 14 segments ]  [ Widen the search ]
```

This screen must look **deliberate and complete**, not like an empty state. It gets the same typographic weight as a positive finding, a full segment table on disclosure, and a normal-range comparison for every claim. The research is explicit that no vendor ships this because it "looks like product failure"; designing it to look like rigor is the differentiation.

### 8.4 Driver decomposition (phase 3, when reached)

When drivers *are* found, the required rendering is **rate vs mix**, never a bare ranked list:

```
  DRIVERS                                    contribution to -3.1%

  Segment            Δ rate    Δ mix    net contribution
  Outerwear          -2.1%     +0.4%    -0.8pp   ▇▇▇▇▇▇▇▇
  Accessories        -0.3%     -0.9%    -0.5pp   ▇▇▇▇▇
  Footwear           +1.2%     -1.8%    -0.4pp   ▇▇▇▇
  …                                                            
  Unexplained                            -1.1pp  ▇▇▇▇▇▇▇▇▇▇▇
```

**The `Unexplained` row is mandatory and is always shown**, even when small. A decomposition that sums to exactly the observed change without a residual is either lucky or lying. Its bar uses the neutral/unverified ink.

Each segment row expands to a sparkline of its last 12 periods with the normal range shaded, so "is this unusual?" is answerable without a second query.

### 8.5 Narrative

The investigation ends in a written narrative (`body`, ≤ 68ch, max 5 sentences) that a user can paste into Slack. It states: what moved, what it was not, what it was, and how confident. It is generated last, after the ladder resolves, and it is regenerated if the user runs additional phases.

`⌘⇧C` copies it with the seal, the numbers, and the permalink.

---

## 9. Watches & alerts

Route `/watches`. Metric watches and anomaly notifications.

**Design position:** the research is explicit that proactive monitoring is *not* a gap — plumbing is table stakes and everyone floods. The differentiation is **judgment about what's worth a human's attention**, so this surface is designed around suppression and evidence, not around rule-building.

### 9.1 List

Table: **Metric · Condition · Status · Last fired · Recipients**.

`Status` uses confidence-adjacent but distinct ink: `● watching` (tertiary), `▲ firing` (qualified amber), `✓ resolved` (verified), `⏸ paused` (disabled). A firing watch also lights the rail badge.

### 9.2 Watch detail

```
  Revenue — daily                                  ▲ Firing since 09:00
  ─────────────────────────────────────────────────────────────────────
  [ chart: 90 days, with the normal band shaded and the breach marked ]

  ⚠  $4,120 today — 34% below the 30-day normal range ($6,240–$8,900)

  BEFORE ALERTING, WE CHECKED
  ✓ Data is fresh              source loaded 40 min ago
  ✓ Row counts normal          12,404 rows (normal: 11.8k–13.1k)
  ⚠ Period is incomplete       today is 62% elapsed
  ✓ Definition unchanged       Revenue v3, unchanged since 4 Mar

  → This alert was held for 4 hours because the period was incomplete.

  [ Investigate ]   [ Snooze ]   [ Adjust threshold ]
```

**The "before alerting, we checked" block is the whole point.** The same check apparatus that verifies answers gates alerts. An alert that fired without those checks is the flooding behavior everyone else ships.

**Held alerts are shown, not hidden.** The `→ This alert was held for 4 hours` line teaches the user that the system exercises judgment, which is what earns the right to notify them at all.

### 9.3 Creating a watch

Three paths: from an answer (`⋯ → Watch this`), from a definition, or `+ New watch`. The form is short: metric (definition picker), grain, condition (`outside normal range` default / `above` / `below` / `changes by more than`), sensitivity slider with a live preview *"would have fired 3 times in the last 90 days"*, recipients, and quiet hours.

The live back-test preview is required. A threshold set without knowing its historical fire rate is how alert fatigue starts.

### 9.4 Notification rendering

In-app: a `qualified`-tinted row in a notifications popover, never a modal, never a red badge unless a watch is in a `contested` state.
Slack: see §12.3.
Email: the same content, plain, with the seal rendered as a text glyph + word.

---

## 10. Sources & schema browser

Route `/sources`.

### 10.1 List

Cards, one per source: name, engine glyph, host/database, connection state (`● connected` / `▲ degraded` / `○ disconnected`), table count, last introspected, last query. `⋯` → Test connection · Re-introspect · Edit · Disconnect.

### 10.2 Empty state (first-run — the most important empty state in the product)

```
        ⛁
   Connect a warehouse to get started

   We introspect your schema automatically. There's no
   modeling step — you can ask a question as soon as
   the connection is live.

   Read-only credentials are enough.

   [ DuckDB ]  [ Snowflake ]  [ BigQuery ]  [ Postgres ]
```

The middle sentence is the positioning — the whole adoption-tax argument in one line — and it belongs in the product, not just on the marketing site.

### 10.3 Connect flow

A `640px` dialog, three steps with a progress rail: **Credentials → Test → Introspect**.

- **Test** shows the actual result: latency, server version, the role's grants. If the role can write, warn: *"This role can modify data. A read-only role is recommended."* Do not block — warn honestly and let the user proceed.
- **Introspect** streams: `Found 7 tables · 42 columns · 6 relationships · 3 date columns`. Each finding appears as it lands. On completion, the primary action is `Ask your first question`, not `Done` — route the user straight into the loop.

### 10.4 Schema browser

Route `/sources/:id/schema`. Three panes: table list (searchable, `240px`) · table detail · sample rows.

Table detail shows columns with inferred role badges (`measure`, `dimension`, `date`, `key`, `pii`), null rate, distinct count, and detected relationships with cardinality (`1:N`, `N:1`, `N:N`). **N:N relationships get a `qualified` badge** with the tooltip *"Joins through this can multiply rows"* — the fan-out risk is surfaced at the schema level, before anyone asks a question.

Columns detected as PII show a `pii` badge and are excluded from answers by default; the admin setting that governs this is linked directly from the badge.

Sample rows: 20 rows, masked for PII columns, with a `Show unmasked` action gated on permission.

---

## 11. Admin

Route `/settings/*`. Standard shell, left sub-nav (`200px`) inside the content region.

| Section | Contents |
|---|---|
| **Workspace** | Name, default source, default time zone (affects every date bucket in the product — state that), theme default |
| **Members** | Table: person · role · last active · answers asked. Roles: `Owner`, `Admin`, `Editor` (can ratify), `Viewer` (can ask, cannot ratify). **Ratification is a permission** — that is what makes ratified definitions meaningful |
| **Access** | Which sources/schemas each role can query; the credential each role executes under; PII exposure policy |
| **Model** | Provider, model, temperature-equivalent controls, per-answer cost ceiling, and a **check policy** table: which checks are required, which are advisory, and the thresholds (join-loss %, filter-sensitivity %, fan-out tolerance) |
| **Audit** | Every query with principal, source, timestamp, row count, and answer link. Exportable |
| **Usage** | Questions asked, answers verified, fork rate, coverage — the same numbers as the Definitions header, over time and per person |

**The check policy table is the most product-specific admin screen** and should not be treated as generic settings. Each row: check name, plain description, `Required / Advisory / Off`, threshold input, and a live back-test — *"At 5%, this would have fired on 12 of your last 200 answers."* Turning a check off requires a confirm dialog explaining what stops being detected.

---

## 12. Slack surfaces

Slack is the delivery surface, per TS-6. The design constraint is severe: Block Kit, no custom CSS, and a reader who is scrolling fast. **The confidence state must survive the medium.**

### 12.1 An answer in Slack

```
┌──────────────────────────────────────────────────┐
│ ⬤ Analyst  APP                                   │
│                                                  │
│ *$203,220*                                       │
│ February 2023 revenue                            │
│                                                  │
│ ⚠️ *Qualified* · 7 of 8 checks passed             │
│ February has 28 days vs January's 31. Per-day     │
│ revenue rose 4.7% while the total fell 5.4%.     │
│                                                  │
│ [chart image, 800×360, rendered in the           │
│  requester's theme]                              │
│                                                  │
│ _Revenue v3 · ratified by Priya Nair · 4 Mar_    │
│                                                  │
│ [ View evidence ] [ Ask a follow-up ] [ Re-run ] │
└──────────────────────────────────────────────────┘
```

Rules:
- **The state word is always spelled out** (`Verified` / `Qualified` / `Unverified` / `Refused` / `Contested`). An emoji alone does not survive a screenshot or a screen reader.
- **The caveat text is in the message body, not behind the button.** A caveat one click away in Slack is a caveat nobody reads.
- One image, one context line, max three buttons.
- The chart image is rendered server-side at 2× and follows `data-viz.md`, including hatched marks for unverified series.

### 12.2 A refusal in Slack

```
 ⑂ *"2023 revenue" has 3 defensible answers* — they differ by 4.0x.

 • *$3,820,425* — excluding cancelled and returned   ⌾ recommended
 • *$5,101,373* — all order items
 • *$1,278,434* — completed orders only

 Pick one and I'll answer. Ratifying makes it the default for everyone.

 [ Use $3.82M ] [ Use $5.10M ] [ Use $1.28M ] [ Open in Analyst ]
```

The candidate numbers are in the message. A refusal in Slack that only links out is a dead end; a refusal that shows the numbers is a decision the user can make in three seconds without leaving the channel. Selecting a candidate posts the full answer as a threaded reply.

### 12.3 A watch firing in Slack

Leads with the check block, not the number:

```
 ▲ *Revenue is 34% below its normal range*
 $4,120 today vs a normal $6,240–$8,900

 Before alerting we confirmed: data is fresh (40 min), row counts
 normal, definition unchanged. Today is 62% elapsed — this alert
 was held 4 hours to be sure.

 [ Investigate ] [ Snooze 1 day ] [ Open watch ]
```

### 12.4 Threading and context

Threaded replies inherit the full chip context (TS-2 parity). The bot posts a compact context line on the first reply: `_Context: Revenue v3 · Feb 2023 · excl. cancelled_`, and updates it whenever a chip changes. Slack has no chip UI, so the context becomes text — but it is never invisible.

---

## 13. Responsive behavior

This is a desktop tool. Design for 1440×900 as the target, support 1280 fully, degrade gracefully, and make the read-only paths usable on a phone (because a permalink will be opened on a phone).

| Breakpoint | Behavior |
|---|---|
| **≥1600px** | Full shell. Content region caps at 1080px and centers; the extra space goes to the evidence panel's max width. |
| **1280–1599px** | Default. Rail 236px, evidence panel 380px. |
| **1024–1279px** | Left rail auto-collapses to 52px icon rail (still expandable, not persisted). Evidence panel becomes an overlay drawer (`E` slides it over the content with a scrim) rather than a docked column. |
| **768–1023px** | Rail becomes a `⌘K`-first hamburger drawer. Content full width, 16px gutter. Dashboard grid → 6 columns. Notebook cells full width. Tables get horizontal scroll inside their own container — **the page body never scrolls horizontally**. |
| **< 768px** | Read-optimized. Answer detail, ledger, dashboards (single column, tiles stack), and definitions are readable. Composer docks to the bottom with the keyboard. Notebook and Investigations show a "best on desktop" notice with the narrative and conclusion still fully readable. Ambiguity fork stacks candidates vertically, full width, with the spread bar above them — this must work on mobile because refusals arrive via Slack. |

Touch: all targets ≥32px; hover-only affordances (row actions, tile `⋯`) become always-visible below 1024px.

---

## 14. Cross-cutting state matrix

Every surface must specify all five. This table is the checklist for "is this screen done?"

| Surface | Empty | Loading | Streaming | Error | Refusal / null result |
|---|---|---|---|---|---|
| Ask | Schema-derived starters | Composer live, thread skeleton | Stage rail + progressive checks | Inline card, chips preserved | Full fork screen (§3) |
| Answer detail | n/a (404 → "This answer was deleted") | Full-layout skeleton | n/a | Re-run failed banner, prior value kept | Renders the fork inline |
| Definitions | "No definitions yet — and that's fine" | Table skeleton, coverage skeleton | Proposals stream in | Retry banner | n/a |
| Ledger | "No answers yet" | 8 skeleton rows | Bulk re-run inline progress | Per-row error badge | Refused rows show `—` |
| Dashboards | "Nothing here yet" + add-tile | Tile skeletons at final geometry | Per-tile 2px progress line | Per-tile error, others unaffected | Refused answers cannot be tiles |
| Notebook | One empty `question` cell | Per-cell skeleton | Per-cell progress line | Per-cell error, run stops | Fork renders inside the cell |
| Investigations | "Start from a metric that moved" | Ladder skeleton | Phases resolve top-down | Phase-level error, ladder continues | **"No significant driver found"** (§8.3) |
| Watches | "Nothing is being watched" | Table skeleton | Live status polling | Per-watch error badge | Held-alert explanation |
| Sources | Connect-a-warehouse | Card skeletons | Introspection streams findings | Connection error with cause | n/a |
| Admin | Role-specific | Table skeleton | n/a | Per-section error | n/a |

---

## 15. Definition of done for any screen

1. All five states in §14 are implemented and designed, not stubbed.
2. Every figure carries a `<ConfidenceSeal>`.
3. Every action has a keyboard path; every list is arrow-navigable.
4. Light and dark are both checked on real content, not on a swatch page.
5. Skeleton geometry matches loaded geometry — no layout jump.
6. No animation exceeds 220ms; no number animates.
7. Nothing references a specific table, column, metric, or source name in code.
8. Terminology matches `design-system.md` §10.3.
9. Tested at 1280px and 1024px, and the read paths tested at 390px.
10. Tested with `prefers-reduced-motion: reduce` and with keyboard only.

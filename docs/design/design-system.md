# Design System

**Product:** AI Data Analyst
**Status:** v1 specification — authoritative for all frontend work
**Stack target:** Next.js + React + Tailwind v4 + plain React components (no component library)
**Companion docs:** [`screens.md`](./screens.md) (surface specs) · [`data-viz.md`](./data-viz.md) (charts)

---

## 0. What this product is, in design terms

> An AI analyst that fails like an error message instead of like a plausible wrong answer — without making you build a semantic layer first.

Read that sentence as a design brief and it says three things:

1. **The number is not the deliverable. The number *plus its warrant* is the deliverable.** Every surface that shows a figure must also carry, at a glance, how much that figure has been checked.
2. **Refusal is a feature, not an error.** When the product declines to answer, that is the product working. It must never look like a failure state, a crash, or a dead end.
3. **Trust must be legible without SQL.** The research is unambiguous on this: *"showing SQL only helps someone who could have written the SQL."* SQL is the third disclosure tier, never the first.

Everything below serves those three sentences.

---

## 1. Principles

### P1 — Evidence beats assertion

Never show a confidence percentage with no referent. `92% confident` is a number about a number; it is unfalsifiable and it teaches users nothing. Show **which checks ran, what each one found, and the figures behind it**: *"Cross-derived: $3,820,425 both ways"*, *"46.3% of web events have no user — excluded from this answer."*

A user who reads only the evidence line should be able to decide whether to forward the number to their CFO.

### P2 — Three tiers of disclosure, and only three

Every answer, everywhere in the product, resolves into the same three tiers. This is the IA spine — memorize it.

| Tier | Name | Contains | Audience | Default |
|---|---|---|---|---|
| 1 | **The Claim** | The number, a one-sentence read, the confidence seal | Anyone | Always visible |
| 2 | **The Evidence** | Checks with plain-English findings, definitions applied, coverage, the chart | Business user | One click / `E` |
| 3 | **The Derivation** | SQL (both paths), row counts, tables touched, model + prompt version, timings | Analyst | Two clicks / `⌥E` |

Tier 2 is the product. Competitors ship Tier 1 and Tier 3 and call it transparency.

### P3 — Speed is a specification, not an optimization

Independent testing clocked a competitor at *">a minute vs 20 sec for other providers"*, and their own reviewers report slowness *"drives people to use Looker Studio instead."* Latency budget is a design constraint:

| Event | Budget |
|---|---|
| Keystroke → visible character | < 16ms |
| Submit → question echoed + skeleton painted | < 100ms |
| Submit → first streamed token | < 1.2s |
| Submit → **number rendered** | < 8s (p50), < 15s (p95) |
| Submit → all checks resolved | < 20s (p95) |
| Route change (cached) | < 120ms |
| Hover / focus / press feedback | 100ms |

**The resolution to the verification-vs-latency tension:** the number renders as soon as it is computed, wearing a `checking` seal. Checks land progressively into the Evidence panel. Verification never blocks the number, and the number is never presented as final until the seal resolves.

### P4 — Density is respect

This is a tool a data lead lives in for six hours a day. Base UI type is 13px, table rows are 32px, the base grid unit is 4px. Whitespace is used to group, not to decorate. If a screen feels airy, it is probably wasting the user's scroll.

Density is not clutter. Clutter is *undifferentiated* density. Every screen has exactly one primary thing, and everything else recedes into secondary or tertiary ink.

### P5 — State lives in chips, not in scrollback

Chat products bury the active context — metric, filters, grain, time range — in message history, so users re-prompt instead of exploring. Here, the active context is a **row of editable chips** directly beneath the question. Chat is a log of what happened; chips are the current state of the world, and they are the control surface.

### P6 — Dark and light are both first-class, and neither is a filter of the other

Dark is not light-inverted. Each mode's steps are chosen for its own surface and validated against it. In dark, elevation reads as *lighter*; in light, elevation reads as *whiter + a stronger border*. Charts get their own per-mode steps (see `data-viz.md`).

### P7 — Numbers never animate

A currency figure that counts up digit by digit reads as unstable. Text may stream; **numbers snap in whole**. Charts may draw in, but the axis domain is fixed before the first mark is painted — a rescaling axis reads as a system changing its mind.

---

## 2. Color

### 2.1 Ramps (raw scales — never used directly in components)

These are the source of all semantic tokens. Components reference semantic tokens only.

**Neutral — `gray` (cool, slightly blue)**

| Step | Hex | Step | Hex |
|---|---|---|---|
| 0 | `#FFFFFF` | 500 | `#667085` |
| 25 | `#FCFCFD` | 600 | `#4B5462` |
| 50 | `#F7F8FA` | 700 | `#353B45` |
| 100 | `#F1F3F6` | 800 | `#23272E` |
| 200 | `#E4E7EC` | 850 | `#181C21` |
| 300 | `#D0D5DD` | 900 | `#121519` |
| 400 | `#98A2B3` | 950 | `#0B0D10` |
| 450 | `#7A8598` | 1000 | `#08090B` |

**Accent — `indigo`** (brand, primary action, focus, *and the refusal state* — see §3.4)

| Step | Hex | Step | Hex |
|---|---|---|---|
| 50 | `#EEF0FF` | 500 | `#5B5BD6` |
| 100 | `#E0E0FB` | 550 | `#4F46E5` |
| 200 | `#BDBEF7` | 600 | `#4338CA` |
| 250 | `#A8A9F4` | 650 | `#4242A6` |
| 300 | `#9394F1` | 700 | `#37378C` |
| 350 | `#7E7FEE` | 800 | `#2C2C72` |
| 400 | `#6B6CE8` | 900 | `#23235B` |
| 450 | `#7C7FF5` *(dark-mode mark step)* | | |

Light-mode accent text: `#4338CA` · Dark-mode accent text: `#A5A6FF` · Solid button fill: `#4F46E5` (light) / `#5B5BD6` (dark).

**Green — `verified`**

| Role | Hex |
|---|---|
| Light text / icon | `#067647` |
| Light chart mark (≥3:1) | `#079455` |
| Light tint bg | `#ECFDF3` |
| Light tint border | `#ABEFC6` |
| Dark text / icon / mark | `#3DD68C` |
| Dark tint bg | `rgb(61 214 140 / 0.12)` |
| Dark tint border | `rgb(61 214 140 / 0.28)` |

**Amber — `qualified`**

| Role | Hex |
|---|---|
| Light text / icon | `#B54708` |
| Light chart mark | `#DC6803` |
| Light tint bg | `#FFFAEB` |
| Light tint border | `#FEDF89` |
| Dark text / icon / mark | `#FDB022` |
| Dark tint bg | `rgb(253 176 34 / 0.12)` |
| Dark tint border | `rgb(253 176 34 / 0.28)` |

**Red — `contested` / destructive**

| Role | Hex |
|---|---|
| Light text / icon | `#B42318` |
| Light chart mark | `#D92D20` |
| Light tint bg | `#FEF3F2` |
| Light tint border | `#FECDCA` |
| Dark text / icon / mark | `#F97066` |
| Dark tint bg | `rgb(249 112 102 / 0.12)` |
| Dark tint border | `rgb(249 112 102 / 0.28)` |

There is deliberately **no separate `info` blue.** Informational emphasis wears the accent. Five hues total: neutral, indigo, green, amber, red. A sixth hue would have to earn its place, and none has.

### 2.2 Semantic tokens

Components use these names and nothing else. A raw ramp step in a component is a review-blocking defect.

#### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `surface-canvas` | `#F7F8FA` | `#0B0D10` | Page background |
| `surface-1` | `#FFFFFF` | `#121519` | Cards, panels, table body, sidebar |
| `surface-2` | `#F1F3F6` | `#181C21` | Table header, hover, segmented control track, inline wells |
| `surface-3` | `#FFFFFF` | `#1E232A` | Popovers, menus, comboboxes, tooltips |
| `surface-4` | `#FFFFFF` | `#242A32` | Dialogs, command palette |
| `surface-inset` | `#F7F8FA` | `#08090B` | Code blocks, SQL viewer, terminal-like wells |
| `surface-inverse` | `#14171B` | `#F2F4F7` | Inverted chips, primary button fill |

In light mode `surface-3` and `surface-4` share a hex with `surface-1`; separation comes from border strength and shadow (see §6). In dark mode separation comes from lightness stepping and shadow is barely used.

#### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `text-primary` | `#14171B` | `#F2F4F7` | Headings, the number, key values |
| `text-secondary` | `#4B5462` | `#A8B0BD` | Body prose, table cells |
| `text-tertiary` | `#667085` | `#7A828F` | Metadata, labels, axis ink, timestamps |
| `text-disabled` | `#98A2B3` | `#545C69` | Disabled controls only |
| `text-inverse` | `#FFFFFF` | `#0B0D10` | On `surface-inverse` and solid accent fills |
| `text-accent` | `#4338CA` | `#A5A6FF` | Links, active nav, inline emphasis |

All body and metadata tokens clear WCAG AA on their intended surfaces. `text-disabled` is intentionally below threshold (disabled controls are exempt) and must never carry information that is not repeated elsewhere.

#### Borders

| Token | Light | Dark |
|---|---|---|
| `border-subtle` | `#EDF0F4` | `rgb(255 255 255 / 0.06)` |
| `border-default` | `#E2E6EC` | `rgb(255 255 255 / 0.10)` |
| `border-strong` | `#D0D6DE` | `rgb(255 255 255 / 0.16)` |
| `border-hover` | `#B8C0CC` | `rgb(255 255 255 / 0.24)` |
| `border-accent` | `#4F46E5` | `#7C7FF5` |

#### Interaction overlays

| Token | Light | Dark |
|---|---|---|
| `overlay-hover` | `rgb(20 23 27 / 0.04)` | `rgb(255 255 255 / 0.05)` |
| `overlay-press` | `rgb(20 23 27 / 0.08)` | `rgb(255 255 255 / 0.09)` |
| `overlay-selected` | `rgb(79 70 229 / 0.08)` | `rgb(124 127 245 / 0.14)` |
| `overlay-scrim` | `rgb(11 13 16 / 0.40)` | `rgb(0 0 0 / 0.60)` |

### 2.3 Tailwind v4 wiring

Define the values as plain CSS variables per mode, then map them into the theme with `@theme inline`. This gives one place to swap modes and full Tailwind utility generation (`bg-surface-1`, `text-tertiary`, `border-strong`, …).

```css
/* globals.css */
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  color-scheme: light;

  --c-surface-canvas: #F7F8FA;
  --c-surface-1: #FFFFFF;
  --c-surface-2: #F1F3F6;
  --c-surface-3: #FFFFFF;
  --c-surface-4: #FFFFFF;
  --c-surface-inset: #F7F8FA;
  --c-surface-inverse: #14171B;

  --c-text-primary: #14171B;
  --c-text-secondary: #4B5462;
  --c-text-tertiary: #667085;
  --c-text-disabled: #98A2B3;
  --c-text-inverse: #FFFFFF;
  --c-text-accent: #4338CA;

  --c-border-subtle: #EDF0F4;
  --c-border-default: #E2E6EC;
  --c-border-strong: #D0D6DE;
  --c-border-hover: #B8C0CC;
  --c-border-accent: #4F46E5;

  --c-accent-solid: #4F46E5;
  --c-accent-solid-hover: #4338CA;
  --c-accent-tint: #EEF0FF;
  --c-accent-tint-border: #C9CBFB;

  --c-verified-fg: #067647;
  --c-verified-bg: #ECFDF3;
  --c-verified-border: #ABEFC6;
  --c-qualified-fg: #B54708;
  --c-qualified-bg: #FFFAEB;
  --c-qualified-border: #FEDF89;
  --c-contested-fg: #B42318;
  --c-contested-bg: #FEF3F2;
  --c-contested-border: #FECDCA;
  --c-unverified-fg: #4B5462;
  --c-unverified-bg: #F1F3F6;
  --c-unverified-border: #D0D5DD;

  --c-overlay-hover: rgb(20 23 27 / 0.04);
  --c-overlay-press: rgb(20 23 27 / 0.08);
  --c-overlay-selected: rgb(79 70 229 / 0.08);
  --c-overlay-scrim: rgb(11 13 16 / 0.40);
}

.dark {
  color-scheme: dark;

  --c-surface-canvas: #0B0D10;
  --c-surface-1: #121519;
  --c-surface-2: #181C21;
  --c-surface-3: #1E232A;
  --c-surface-4: #242A32;
  --c-surface-inset: #08090B;
  --c-surface-inverse: #F2F4F7;

  --c-text-primary: #F2F4F7;
  --c-text-secondary: #A8B0BD;
  --c-text-tertiary: #7A828F;
  --c-text-disabled: #545C69;
  --c-text-inverse: #0B0D10;
  --c-text-accent: #A5A6FF;

  --c-border-subtle: rgb(255 255 255 / 0.06);
  --c-border-default: rgb(255 255 255 / 0.10);
  --c-border-strong: rgb(255 255 255 / 0.16);
  --c-border-hover: rgb(255 255 255 / 0.24);
  --c-border-accent: #7C7FF5;

  --c-accent-solid: #5B5BD6;
  --c-accent-solid-hover: #6B6CE8;
  --c-accent-tint: rgb(124 127 245 / 0.14);
  --c-accent-tint-border: rgb(124 127 245 / 0.32);

  --c-verified-fg: #3DD68C;
  --c-verified-bg: rgb(61 214 140 / 0.12);
  --c-verified-border: rgb(61 214 140 / 0.28);
  --c-qualified-fg: #FDB022;
  --c-qualified-bg: rgb(253 176 34 / 0.12);
  --c-qualified-border: rgb(253 176 34 / 0.28);
  --c-contested-fg: #F97066;
  --c-contested-bg: rgb(249 112 102 / 0.12);
  --c-contested-border: rgb(249 112 102 / 0.28);
  --c-unverified-fg: #A8B0BD;
  --c-unverified-bg: rgb(255 255 255 / 0.05);
  --c-unverified-border: rgb(255 255 255 / 0.16);

  --c-overlay-hover: rgb(255 255 255 / 0.05);
  --c-overlay-press: rgb(255 255 255 / 0.09);
  --c-overlay-selected: rgb(124 127 245 / 0.14);
  --c-overlay-scrim: rgb(0 0 0 / 0.60);
}

@theme inline {
  --color-surface-canvas: var(--c-surface-canvas);
  --color-surface-1: var(--c-surface-1);
  --color-surface-2: var(--c-surface-2);
  --color-surface-3: var(--c-surface-3);
  --color-surface-4: var(--c-surface-4);
  --color-surface-inset: var(--c-surface-inset);
  --color-surface-inverse: var(--c-surface-inverse);

  --color-primary: var(--c-text-primary);
  --color-secondary: var(--c-text-secondary);
  --color-tertiary: var(--c-text-tertiary);
  --color-disabled: var(--c-text-disabled);
  --color-inverse: var(--c-text-inverse);
  --color-accent: var(--c-text-accent);
  --color-accent-solid: var(--c-accent-solid);
  --color-accent-tint: var(--c-accent-tint);

  --color-border-subtle: var(--c-border-subtle);
  --color-border-default: var(--c-border-default);
  --color-border-strong: var(--c-border-strong);
  --color-border-hover: var(--c-border-hover);
  --color-border-accent: var(--c-border-accent);

  --color-verified: var(--c-verified-fg);
  --color-verified-bg: var(--c-verified-bg);
  --color-verified-border: var(--c-verified-border);
  --color-qualified: var(--c-qualified-fg);
  --color-qualified-bg: var(--c-qualified-bg);
  --color-qualified-border: var(--c-qualified-border);
  --color-contested: var(--c-contested-fg);
  --color-contested-bg: var(--c-contested-bg);
  --color-contested-border: var(--c-contested-border);
  --color-unverified: var(--c-unverified-fg);
  --color-unverified-bg: var(--c-unverified-bg);
  --color-unverified-border: var(--c-unverified-border);

  --font-sans: "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", "Menlo", monospace;

  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 14px;

  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-standard: cubic-bezier(0.3, 0, 0.2, 1);
}
```

**Theme selection:** `class="dark"` on `<html>`, set by a blocking inline script before first paint from `localStorage.theme ?? matchMedia('(prefers-color-scheme: dark)')`. There must be **no flash** — a theme flash on an analytics tool reads as a page that is still loading, which contradicts P3.

---

## 3. Confidence states — the signature system

This is the part of the design system that is the product. Get it wrong and nothing else matters.

### 3.1 The states — six terminal, one transient

| State | Meaning (what the system is asserting) | Hue | Glyph | Border | Number shown? |
|---|---|---|---|---|---|
| `checking` | Answer computed; checks still running | neutral | animated arc | solid | **Yes**, with a live seal |
| `verified` | Re-derived independently and agreed; every structural check passed | green | shield-check (filled) | solid | Yes |
| `qualified` | Answered, but at least one check raised a caveat that changes how you should read it | amber | triangle-alert (filled) | solid | Yes, with the caveat inline |
| `unverified` | Could not be independently checked (no second derivation path, or checks skipped) | neutral | circle-dashed | **dashed** | Yes, visually recessive |
| `refused` | Genuinely ambiguous — the system will not pick for you | **accent (indigo)** | branch / fork | solid | **No.** Candidates shown instead |
| `contested` | Two derivations disagreed | red | `≠` | solid | **No.** Both figures shown as a conflict |
| `superseded` | Was answered, but a definition it relied on has since changed | neutral | clock-rewind | **dotted** | Yes, struck-through affordance + "re-run" |

`checking` is transient; the other six are terminal. Model all seven as a single `ConfidenceState` union in TypeScript; render them through a single `<ConfidenceSeal>` component.

### 3.2 The two decisions that matter here

**Unverified is neutral, not red.** Unverified does not mean wrong; it means unchecked. Painting it red trains users to ignore red. It gets a **dashed border** — the dash is the semantic carrier, so the state survives greyscale, colorblindness, and printing.

**Refused wears the brand color.** Refusal-with-options is the moment this product is most itself, and it is a call to action, not a failure. It must never be red, never amber, never an error dialog. It is indigo, it is centered, and it is the most confidently designed screen in the app.

### 3.3 The rule about percentages

> **Never render a confidence percentage.**

The seal renders `n/m checks` and, on expansion, the checks themselves with their findings. If a model produces an internal confidence scalar, it may gate behavior but it may not be shown as a number to the user. `92% confident` is not evidence; *"Cross-derived two ways, same result"* is.

### 3.4 The check taxonomy

Every check has: `id`, a **plain label** (no jargon), a **finding** sentence containing real figures, a `result`, and an optional Tier-3 expansion. The label and finding are what a non-SQL user reads.

| id | Plain label | What a passing finding looks like | What a failing finding looks like |
|---|---|---|---|
| `cross_derivation` | Computed a second way | "Two independent queries agree: $3,820,425" | "Two queries disagree: $3,820,425 vs $3,791,002 (0.8% apart)" |
| `join_loss` | No rows silently dropped | "All 181,759 order items were included" | "46.3% of web events have no linked user and were excluded" |
| `fan_out` | No rows double-counted | "Each order counted once" | "Joining to inventory multiplied 125,226 orders into 490,705 rows" |
| `period_normalization` | Fair time comparison | "Both periods are 31 days" | "February has 28 days vs January's 31. Per-day revenue rose 4.7% while the total fell 5.4%" |
| `filter_sensitivity` | Answer is stable under reasonable variations | "Changing order-status treatment moves this by under 2%" | "Excluding vs including cancelled orders changes this by 4.0x" |
| `definition_source` | Uses a ratified definition | "Revenue v3 — ratified by Priya Nair, 4 Mar" | "No ratified definition for 'active user'. Inferred from column names" |
| `grain` | Aggregation is valid at this grain | "Summing a measure at its native grain" | "This averages an already-averaged rate; the weighted figure is 3.2%, not 4.1%" |
| `coverage` | Data covers the whole question | "0 nulls in the measure column" | "12% of orders have no region; they are excluded from the regional split" |
| `freshness` | Data is current | "Source last loaded 2 hours ago" | "Orders table last loaded 6 days ago; the current month is incomplete" |
| `precedent` | Consistent with what we said before | "Matches the answer given on 12 Mar" | "On 12 Mar this was answered as $3.1M under Revenue v2" |

`result` is one of `pass | warn | fail | skipped | not_applicable`. Skipped and not-applicable checks are shown, greyed, with a reason — *hiding a check that did not run is the same dishonesty as a bare confidence score.*

Seal state derives mechanically:

```
any fail on cross_derivation           → contested
any fail on filter_sensitivity         → refused (ambiguity fork)
any other fail, or any warn            → qualified
all pass, and cross_derivation ran     → verified
all pass, but cross_derivation skipped → unverified
```

### 3.5 `<ConfidenceSeal>` — anatomy and sizes

Three sizes. All three are the same component.

**`inline` (h 20px)** — for ledger rows, table cells, dashboard tiles, search results.
`[glyph 12px] [label 11px/600 uppercase tracking-[0.06em]]` in a `rounded-xs` pill, tint bg, tint border, `px-1.5 gap-1`. On dashboards and tables the label may collapse to glyph-only with an accessible name; never collapse it in the ledger.

**`standard` (h 26px)** — sits immediately right of a number or answer title.
`[glyph 14px] [label 12px/600] [· n/m checks 12px, text-tertiary]` in a `rounded-sm` pill, `px-2 gap-1.5`. Entire pill is a button that opens the Evidence panel. Hover raises border to `border-hover`, 100ms.

**`banner` (h 44px, full width)** — top of an answer detail view, refusal screen, permalink page.
`[glyph 18px] [headline 14px/600] [finding sentence 13px text-secondary] ......... [Review evidence ▸]`
Tint bg, 1px tint border, `rounded-md`, `px-3.5`. For `qualified`, the headline is the caveat itself, verbatim — not the word "Qualified". *"February has 28 days — per-day revenue rose 4.7%"* is the headline. The state name is carried by the glyph and color.

**`checking` animation:** a 14px arc rotating at 900ms linear, plus the label `Checking… 3/8`. The count increments as checks land. Under `prefers-reduced-motion` the arc is static and only the count updates.

### 3.6 Where seals are mandatory

A figure without a seal, anywhere in the product, is a bug. Non-negotiable placements:

- Every answer, every tier
- Every ledger row
- Every dashboard tile (`inline`, glyph + label)
- Every chart (see `data-viz.md` §6)
- Every Slack message (rendered as a Block Kit context row with the glyph as an emoji + text)
- Every CSV export (a header comment block, and a `_confidence` column)
- Every notebook cell that produces a figure
- Every alert notification

---

## 4. Typography

**Faces.** `Inter Variable` for all UI and prose. `JetBrains Mono` for SQL, identifiers, hashes, and column names. No display face, no serif — the tone is instrument, not editorial.

**Numerals.** `font-variant-numeric: tabular-nums` on every table cell, axis tick, ledger row, and any column of figures. Proportional figures for the hero number and prose (tabular figures look mechanical at display size). Slashed zero is **off** everywhere — a slashed zero in a currency figure reads as engineering, not finance. In `mono` contexts (SQL, identifiers, hashes) slashed zero is **on**, because there disambiguation is the point.

```css
body { font-feature-settings: "cv11" 1, "ss01" 1; font-variant-numeric: proportional-nums; }
.tabular, td, th, .axis-tick { font-variant-numeric: tabular-nums; }
code, pre, .mono { font-feature-settings: "zero" 1; }
```

**Scale.** Every size ships with its own line-height, weight, and tracking. Do not improvise combinations.

| Token | Size / LH | Weight | Tracking | Use |
|---|---|---|---|---|
| `hero` | 44px / 48px | 600 | -0.03em | The answer number, single-metric screens |
| `hero-sm` | 30px / 36px | 600 | -0.02em | The number in a dashboard tile, refusal candidate figures |
| `title-lg` | 22px / 30px | 600 | -0.02em | Page titles |
| `title` | 17px / 24px | 600 | -0.01em | Panel titles, dialog titles, answer questions |
| `subtitle` | 14px / 20px | 600 | -0.005em | Section headers, card titles |
| `body` | 14px / 22px | 400 | 0 | Answer prose, narrative, long-form |
| `ui` | 13px / 18px | 400/500 | 0 | Default UI: buttons, inputs, table cells, menus |
| `ui-sm` | 12px / 16px | 400/500 | 0 | Metadata, chip text, secondary table cells |
| `label` | 11px / 14px | 600 | 0.06em, uppercase | Column headers, section eyebrows, seal labels |
| `mono` | 12.5px / 20px | 400 | 0 | SQL, identifiers |
| `mono-sm` | 11.5px / 18px | 400 | 0 | Inline code, hashes, versions |

**Prose measure.** Answer narrative and investigation write-ups cap at `68ch`. Tables, charts, and SQL are exempt and may use full column width.

**Weight ceiling.** 600 is the maximum. 700 is permitted only for the `hero` token when a design explicitly calls for it. 800/900 never.

---

## 5. Space, size, radius

### 5.1 Grid

Base unit **4px**. Permitted spacing values: `2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64`. Nothing else.

| Context | Padding |
|---|---|
| Card / panel | `16px` (compact) or `20px` (standard) |
| Dialog | `20px` |
| Popover / menu | `4px` outer, `6px 8px` per item |
| Table cell | `8px 12px` |
| Page gutter | `24px` desktop, `16px` ≤1024px |
| Section gap | `24px` |
| Related-element gap | `8px` |
| Label-to-control gap | `6px` |

### 5.2 Control heights

| Size | Height | Use |
|---|---|---|
| `xs` | 24px | Chips, inline table actions, filter pills |
| `sm` | 28px | Toolbar buttons, secondary actions, segmented controls |
| `md` | 32px | **Default.** Buttons, inputs, selects |
| `lg` | 40px | The ask composer, primary empty-state CTA |

Table row heights: `compact 32px` (default), `comfortable 40px` (user preference, persisted).

### 5.3 Radius

| Token | Value | Use |
|---|---|---|
| `xs` | 4px | Inline seals, tiny pills, checkbox |
| `sm` | 6px | Chips, `xs`/`sm` buttons, inputs, menu items |
| `md` | 8px | `md`/`lg` buttons, popovers, toasts |
| `lg` | 10px | Cards, panels, code blocks |
| `xl` | 14px | Dialogs, the ask composer, refusal candidate cards |
| `full` | 9999px | Avatars only |

Never mix radii within a nesting: a `sm` control inside an `lg` card is correct; an `xl` control inside a `sm` card is not.

### 5.4 Layout constants

| Constant | Value |
|---|---|
| Left rail (expanded) | `236px` |
| Left rail (collapsed) | `52px` |
| Surface header bar | `52px` |
| Evidence panel (default / min / max) | `380px / 320px / 560px`, drag-resizable, persisted |
| Prose column max | `68ch` |
| Answer content column max | `1080px` |
| Command palette | `640px` wide, `max-h 60vh` |
| Focus ring offset | `2px` |

---

## 6. Elevation

Dark mode elevates with **lightness + border**; light mode elevates with **border + a restrained shadow**. Shadows in dark mode exist only for true overlays and are used to create separation from the scrim, never to imply a card is raised.

| Level | Light | Dark |
|---|---|---|
| `flat` (cards, panels) | `surface-1` + `1px border-default` | `surface-1` + `1px border-default` |
| `raised` (hovered card, sticky header) | `surface-1` + `border-strong` + `0 1px 2px rgb(16 24 40 / 0.06)` | `surface-2` + `border-strong` |
| `overlay` (popover, menu, tooltip) | `surface-3` + `border-default` + `0 8px 24px -6px rgb(16 24 40 / 0.12), 0 2px 6px -2px rgb(16 24 40 / 0.06)` | `surface-3` + `border-strong` + `0 8px 24px -6px rgb(0 0 0 / 0.6)` |
| `modal` (dialog, palette) | `surface-4` + `border-default` + `0 24px 48px -12px rgb(16 24 40 / 0.18)` | `surface-4` + `border-strong` + `0 24px 48px -12px rgb(0 0 0 / 0.7)` |

**Never** use a shadow to indicate state (hover, selected, active). State is border and background.

---

## 7. Motion

| Token | Duration | Use |
|---|---|---|
| `instant` | 0ms | Number appearance, tab content swap, value updates |
| `fast` | 100ms | Hover, focus, press, checkbox, chip toggle |
| `base` | 140ms | Disclosure, tab indicator, inline expand, chip add/remove |
| `slow` | 180ms | Popover, dropdown, toast, panel slide |
| `overlay` | 220ms | Dialog, command palette, drawer |

Easing: `--ease-out` (`cubic-bezier(0.2, 0, 0, 1)`) for anything entering; `--ease-in` for anything leaving; `--ease-standard` for anything that moves and stays.

**Hard limit: 220ms.** Nothing in this product animates longer.

**No springs, no bounces, no overshoots, no scale-from-0.9 "pop".** Overlays enter with `opacity 0→1` plus `translateY(4px)→0`. That is the entire vocabulary.

**Streaming motion.**
- Narrative text streams token-wise; no per-character fade (it's expensive and it looks jittery).
- Checks land into the Evidence panel with a **40ms stagger, max 6 staggered items**, then the rest land together.
- Charts draw once, over 180ms, with the axis domain fixed before the first mark paints.
- **Numbers do not animate.** `instant`. Always.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` sets all durations to `1ms`, removes the stagger, disables the `checking` arc rotation (count still updates), and makes streamed text appear in whole paragraphs.

---

## 8. Focus, keyboard, accessibility

- **Focus ring:** `outline: 2px solid var(--c-border-accent); outline-offset: 2px;` applied via `:focus-visible` only. Identical on every interactive element — no per-component variation.
- **Keyboard-first is a requirement, not a feature.** Every action reachable by mouse has a keyboard path. Every list is arrow-navigable. Every dialog traps focus and restores it on close.
- **Never color alone.** Every confidence state carries a distinct glyph *and* a distinct border style (solid / dashed / dotted). Every chart series with ≥2 series carries a legend, and ≤4 series are also direct-labeled.
- **Live regions.** The streaming answer container is `aria-live="polite"`. The seal announces on resolution only, not on every check (`aria-live="polite"` on the seal, `aria-atomic="true"`). Toasts are `role="status"`; destructive confirmations are `role="alertdialog"`.
- **Announce the seal in the accessible name of the number**, e.g. `aria-label="3,820,425 US dollars. Qualified: February has 28 days versus January's 31."`
- **Tables** use real `<table>` semantics with `<th scope>`, and sortable headers expose `aria-sort`.
- **Targets** are ≥24×24px effective (padding counts); ≥32px on touch.
- **Contrast:** all text tokens meet AA on their intended surfaces; all chart marks meet 3:1 against the chart surface.

---

## 9. Components

Only the specs that are non-obvious or product-specific are given in full. Anything not listed inherits §4–§8.

### 9.1 Buttons

Five variants. Heights from §5.2, radius `sm` (xs/sm) or `md` (md/lg).

| Variant | Rest | Hover | Press | Use |
|---|---|---|---|---|
| `primary` | `bg-accent-solid text-white` | `bg-accent-solid-hover` | `+overlay-press` | The one main action on a surface |
| `secondary` | `bg-surface-2 text-primary border-default` | `border-hover` | `+overlay-press` | Everything else |
| `ghost` | transparent, `text-secondary` | `bg-overlay-hover text-primary` | `+overlay-press` | Toolbars, icon buttons, row actions |
| `outline` | transparent, `border-strong text-primary` | `bg-overlay-hover` | `+overlay-press` | Secondary CTA beside a primary in an empty state |
| `danger` | `bg-contested-bg text-contested border-contested-border` | `border` → solid red | `+overlay-press` | Delete, revoke, disconnect |

There is exactly **one** `primary` button per surface region. Disabled: `text-disabled`, `bg-surface-2`, `cursor-not-allowed`, no hover. Loading: replace the label's leading icon with a 14px arc; **keep the label and the width** — a button that shrinks while loading is a layout shift.

Icon-only buttons are `ghost`, square at the size's height, and require `aria-label` + a 400ms-delay tooltip.

### 9.2 Inputs & selects

`h-32px`, `radius-sm`, `bg-surface-1`, `border-default`, `px-2.5`, `text-ui`. Focus: `border-accent` + focus ring. Placeholder `text-tertiary`. Invalid: `border-contested-border` plus a 12px `text-contested` message below — never a red glow, never a shake.

Prefix/suffix affordances (units, `⌘K`, clear `×`) sit inside the border at `text-tertiary`.

### 9.3 The Ask Composer

The single most important input in the product.

- `h-lg` minimum (40px), auto-grows to 5 lines then scrolls. `radius-xl`. `bg-surface-1`, `border-strong` at rest, `border-accent` + ring on focus.
- Left: a 16px source glyph indicating which source will be queried; click to switch.
- Right: `⌘↵` hint at `text-tertiary`, then the submit button (`primary`, `sm`, icon-only arrow). Submit is enabled only with non-whitespace content.
- Below the field, a single 24px row of **suggestion chips** — max 4, derived from ratified definitions and recent questions, never generic ("Try asking about revenue!" is banned).
- **Docked bottom** of the answer column with a `surface-canvas` gradient fade above it (the only gradient permitted in this system, and it is a scrim not a decoration).
- `⌘↵` submits. `↵` submits when the field is one line; inserts a newline when multi-line. `↑` on an empty field recalls the previous question for editing.
- On submit: field clears **optimistically**, the question paints into the thread within 100ms, the composer keeps focus.

### 9.4 Context chips

The state of the conversation, made editable. Rendered in a single wrapping row directly under the active question.

**Anatomy:** `[icon 12px] [type-label 11px text-tertiary] [value 12px/500 text-primary] [caret ⌄]`, `h-24px`, `radius-sm`, `px-2 gap-1`, `bg-surface-2 border-subtle`.

**Types and their icons:** `metric`, `filter`, `grain`, `time-range`, `definition`, `segment`.

**States:**
- *rest* — `bg-surface-2 border-subtle`
- *hover* — `border-hover`
- *open* — `border-accent`, popover editor below
- *pinned* — a 2px accent left-edge bar; pinned chips survive topic changes and follow-ups until explicitly removed
- *inferred* — **dashed border**; the system guessed this. Hovering shows *"Inferred from your question — click to confirm"*. Confirming converts it to rest and is a ratification candidate.
- *from-definition* — a 10px shield glyph before the value, indicating a ratified definition backs it

**Interactions:** click opens a typed editor popover (date-range picker for `time-range`, combobox for `filter`, radio list for `definition`). `⌫`/`Delete` with the chip focused removes it. Arrow keys move between chips. Removing or editing any chip **re-runs the answer** with an optimistic `checking` seal; the previous answer stays visible, dimmed to 60%, until the new one lands.

Overflow beyond one row collapses to `+N more` opening a popover with the full list. Never wrap to a second row — the chip row has a fixed height so the answer below it does not jump.

### 9.5 `<ConfidenceSeal>`

See §3.5. It is a real component with `state`, `checks`, `size`, and `onOpenEvidence`. It renders no percentage. Ever.

### 9.6 `<CheckRow>` — an item in the Evidence panel

```
[result glyph 14px] [plain label 13px/500 text-primary]            [chevron]
                    [finding sentence 12.5px text-secondary, up to 2 lines]
```

`py-2.5 px-3`, separated by `border-subtle`. Result glyph colors: pass → verified, warn → qualified, fail → contested, skipped/na → tertiary (hollow).

Expanded (Tier 3) reveals: the SQL fragment or both query paths for `cross_derivation`, row counts, and a "why this check exists" sentence. Expansion is `base` (140ms) height animation.

Rows sort **failures first, then warnings, then passes, then skipped** — the reader must hit the problem before the reassurance.

### 9.7 Cards & panels

`bg-surface-1 border border-border-default rounded-lg p-4` (compact) or `p-5`. Header row: `subtitle` left, `ghost sm` actions right, `border-subtle` divider below if the card has sections.

Interactive cards (dashboard tiles, ledger cards, definition cards) add `hover:border-border-hover hover:bg-surface-2 transition-colors duration-100` and a whole-card click target with a real `<a>` or `<button>` wrapper.

### 9.8 Tables

The workhorse. Ledger, definitions, schema browser, admin, and every result grid.

- Wrapper: `border border-border-default rounded-lg overflow-hidden bg-surface-1`.
- Header: `bg-surface-2`, `label` type (11px/600/uppercase/0.06em), `h-36px`, `border-b border-default`, sticky at `top-0` inside a scroll container. Sortable headers show a 12px chevron on hover and always when active.
- Rows: `h-32px` compact, `border-b border-subtle`, last row borderless. Hover `bg-overlay-hover`. Selected `bg-overlay-selected` + a 2px accent left-edge bar.
- Numeric columns: right-aligned, `tabular-nums`.
- Confidence column: `inline` seal, fixed 96px width, always the column immediately after the primary identifier.
- Row actions: `ghost xs` icon buttons, `opacity-0 group-hover:opacity-100`, always `opacity-100` when the row is keyboard-focused (a hover-only affordance is a keyboard bug).
- Empty: see §9.13. Loading: 8 skeleton rows at exact row height — **never a spinner**, because a spinner collapses the layout and then re-expands it.
- Column resizing: drag handles on header edges, persisted per user per table.
- Row density toggle in the table toolbar, persisted globally.

### 9.9 SQL / code viewer

`bg-surface-inset`, `border border-border-default rounded-lg`, `mono` type, `p-3`, `overflow-x-auto` (the block scrolls, the page never does). Line numbers in `text-disabled`, `select-none`.

Syntax highlight uses only four inks — keywords `text-accent`, strings `verified`, numbers `text-primary`, comments/identifiers `text-tertiary`. Do not import a rainbow theme; a seven-color SQL block fights the confidence palette for attention.

Header strip: `SQL` label, execution time, row count, and `Copy` (`ghost xs`). Copy confirms by swapping the icon to a check for 1.2s — no toast for a copy.

For `cross_derivation`, the viewer has a **two-tab** mode: `Path A` / `Path B`, with a `Diff` tab when the two disagree.

### 9.10 Toasts

Bottom-right stack, `max 3`, `surface-3`, `radius-md`, `overlay` elevation, `w-360px`. Enter `slow` with `translateY(4px)`. Auto-dismiss 5s (success/info), 8s (warning), **never** for errors — an error toast requires dismissal or an action.

Anatomy: `[glyph] [message 13px] [action link] [× ghost xs]`. One action maximum.

Toasts are for **background outcomes** only: "Definition ratified", "Answer re-run", "Alert created", "Export ready". Anything the user is looking at reports inline; a toast for an inline outcome is duplicated feedback.

### 9.11 Dialogs

`surface-4`, `radius-xl`, `w-480px` (confirm) / `w-640px` (form) / `w-880px` (compare & diff). Scrim `overlay-scrim` with **no blur** — a blurred scrim over a data table looks like a rendering fault. Enter `overlay` (220ms). Focus traps; `Esc` closes unless the dialog has unsaved input, in which case `Esc` prompts.

Footer actions right-aligned: secondary then primary. Destructive dialogs put the danger button on the right and require typing the object's name only when the action is irreversible *and* affects other users.

### 9.12 Command palette (`⌘K`)

`surface-4`, `w-640px`, `radius-xl`, top-anchored at `18vh`. Sections: *Ask*, *Jump to*, *Actions*, *Recent answers*, *Definitions*. Fuzzy match, keyboard-only navigable, `⌘K` also closes it.

The first row is always **"Ask: `<what you typed>`"** — typing a question into the palette and hitting `↵` starts an answer. The palette is a second entry point to the core loop, not just a navigator.

### 9.13 Empty, loading, error, and refusal states

**Empty states** have four parts and no illustration: a 20px glyph in `text-tertiary`, a `subtitle` headline stating what is missing, one `ui-sm text-secondary` sentence stating what to do, and one primary action. Where a command or query is the answer, show it in a `mono` block that is click-to-copy.

Empty states are written per-surface, never generic. "No data" is banned; "No answers yet — ask your first question and it will be recorded here" is the shape.

**Loading states** are always skeletons matched to the real layout's geometry — same heights, same column widths, same number of rows. `bg-surface-2`, `radius-sm`, a 1.4s shimmer that is disabled under reduced motion. A skeleton that does not match the final layout causes a jump and is worse than nothing.

Spinners exist only for: in-button loading, the `checking` seal arc, and inline re-run indicators. Never full-screen. **Never a blank route** — every route renders its shell (rail, header, panel frames) instantly and fills the content region with skeletons.

**Error states** distinguish four causes and never show a stack trace:

| Cause | Headline shape | Action |
|---|---|---|
| Source unreachable | "Can't reach `<source name>`" | Retry · Check connection |
| Query failed | "The query didn't run" + the plain-English reason | Show SQL · Rephrase |
| Timeout | "This took longer than `<n>`s" | Retry · Narrow the time range |
| Permission | "You don't have access to `<table>`" | Request access |

**Refusal is not an error state.** It has its own full screen (`screens.md` §3).

### 9.14 Progress: the stage rail

Shown during answer generation, in the answer column, above the streaming content.

A horizontal rail of six named stages: `Interpret · Resolve · Plan · Query · Verify · Compose`. Each is `ui-sm`; completed stages are `text-secondary` with a 12px check, the active stage is `text-primary` with a 12px arc, pending stages are `text-disabled`. A 2px accent progress line sits under the rail.

The stage rail exists because **15 seconds of unexplained wait feels broken, and 15 seconds of legible progress feels like work being done.** Each stage also carries a one-line detail under it when active: *"Resolve — matched 'revenue' to Revenue v3"*, *"Query — scanning order_items (181,759 rows)"*.

After the answer resolves the rail collapses to a single `ui-sm text-tertiary` line: `Answered in 6.4s · 8 checks`. Clicking it re-expands the timing breakdown.

### 9.15 Diff view

Used for: answer re-runs, definition versions, ledger comparison.

Two-column at ≥1280px, stacked below. Changed figures get a `qualified` tint background on the changed cell and a delta annotation `▲ +4.2%` in `verified`/`contested` ink by direction. Unchanged rows collapse behind `Show N unchanged rows`.

For definitions, diff the SQL expression with standard add/remove line tinting (`verified-bg` / `contested-bg` at low alpha), plus a plain-English summary above it: *"Now excludes Returned orders. Affects 47 recorded answers."*

### 9.16 Provenance stamp

A recurring inline component: `[avatar 16px] [name] · [relative time]`, `ui-sm text-tertiary`. Used on ratified definitions, corrections, investigation conclusions, and dashboard tiles. The name is a link to the person; the time carries a `title` with the absolute ISO timestamp.

---

## 10. Content rules

### 10.1 Numbers

- Currency ≥ 1000: no decimals, grouped — `$3,820,425`. Below 1000: two decimals — `$83.77`.
- **The hero number is never abbreviated.** `$3.8M` belongs on an axis tick, not on the deliverable. Auditability beats compactness at the point of the claim.
- Percentages: one decimal max — `46.3%`. Whole numbers when the precision is not real.
- Counts: full digits with grouping in tables and findings — `181,759`.
- **Deltas never appear bare.** Always `-5.4% vs January`, never `-5.4%`. A delta without its base is the exact ambiguity this product exists to eliminate.
- Where a period-normalization check fired, the normalized rate is shown **beside** the raw delta, not instead of it: `-5.4% vs January · +4.7% per day`.
- Null / missing renders as `—` in `text-disabled`, never `0`, never blank.

### 10.2 Time

- Relative under 7 days (`3 minutes ago`, `yesterday`), absolute after (`4 Mar 2026`). Always a `title` attribute with the full ISO timestamp and timezone.
- **The ledger uses absolute timestamps always.** It is a record, and a record that says "2 months ago" is not a record.
- Time ranges render as `1 Jan – 31 Mar 2023` with an en dash, and always state the timezone of the underlying data when it is not the viewer's.

### 10.3 Terminology (locked)

Drift here is expensive because these words carry product meaning. Use exactly these:

| Use | Never |
|---|---|
| **Answer** | message, response, result card |
| **Question** | prompt, query (a query is SQL) |
| **Check** | test, validation, guardrail |
| **Definition** | metric model, semantic entity, KPI |
| **Ratify** | approve, confirm, accept |
| **Refused** | failed, error, blocked |
| **Superseded** | stale, outdated, invalid |
| **Investigation** | analysis, deep dive |
| **Ledger** | history, log, feed |
| **Source** | connection, datasource, integration |
| **Watch** | monitor, alert rule |

"Ratify" is chosen deliberately over "approve" — it implies authority conferred by a person, which is the whole point of the earned semantic layer.

### 10.4 Voice

- Plain, specific, unhedged about facts and honest about uncertainty. *"February has 28 days"* not *"It's possible that day count may be a factor."*
- Never apologize for refusing. *"Three defensible answers"* not *"Sorry, I'm not sure."*
- Never claim certainty the checks don't support. If `cross_derivation` was skipped, the copy says so.
- No exclamation marks. No emoji in product chrome (Slack rendering is the only exception, where a single state glyph emoji is required by the medium).

---

## 11. Anti-patterns (review-blocking)

1. A raw ramp step or a Tailwind default color (`bg-zinc-800`, `text-slate-400`) in a component.
2. A confidence percentage rendered as a number.
3. A figure without a `<ConfidenceSeal>`.
4. Refusal styled as an error (red, alert icon, "something went wrong").
5. Unverified styled as danger.
6. A shadow used to indicate hover, selection, or active state.
7. Any animation over 220ms. Any spring, bounce, or overshoot.
8. A number that animates or counts up.
9. A full-screen spinner, or a route that paints blank before content.
10. A skeleton whose geometry does not match the loaded layout.
11. A delta shown without its comparison base.
12. Font weight above 600 (700 permitted only for `hero`).
13. Gradients on surfaces (the composer scrim is the sole exception).
14. Backdrop blur on content, cards, or scrims.
15. A hover-only affordance with no keyboard-focus equivalent.
16. Confidence, status, or series identity communicated by color alone.
17. SQL presented as the primary evidence for a business user.
18. A generic empty state ("No data").
19. Dual-axis charts, or any chart rule violation from `data-viz.md`.
20. Terminology drift from §10.3.

---

## 12. Evolving this document

The system grows by accretion of solved problems. When a product need produces a pattern this spec does not cover:

1. Implement it correctly, using existing tokens.
2. Add its specification here in the matching section.
3. If it introduces a new interaction pattern, document the pattern in `screens.md`.
4. If it introduces a chart form, document it in `data-viz.md` and re-run the palette validator.

Do not ship a pattern and document it later. Undocumented patterns are how a design system becomes 92% compliant, which is another way of saying 8% broken.

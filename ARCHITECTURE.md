# Architecture

A map for people reading this codebase for the first time. It explains the
shape and, more importantly, *why* the shape is that way — the design docs in
`docs/design/` go deeper on each area.

---

## The one idea

Everything here follows from a single claim: **an answer is a durable artifact
with provenance, not a chat message.**

That is why there is a ledger rather than a transcript, why a number carries a
seal, why a question with two defensible readings is refused rather than
guessed, and why the same figure is computed twice by different routes. If a
design decision in this repository looks over-built, it is usually because a
cheaper version would have produced a confident number nobody could check.

---

## The shape

```
                    ┌──────────────┐
   question ───────▶│  UNDERSTAND  │  interpret · enumerate readings · refuse if ambiguous
                    └──────┬───────┘
                           │  plan + an independent second plan
                    ┌──────▼───────┐
                    │     DIG      │  execute both. no model involvement here
                    └──────┬───────┘
                           │  two results
                    ┌──────▼───────┐
                    │    VERIFY    │  deterministic checks → confidence
                    └──────┬───────┘
                           │  sealed answer
                    ┌──────▼───────┐
                    │   PRESENT    │  narrative + chart hint, having SEEN the values
                    └──────┬───────┘
                           ▼
                       the ledger
```

The split matters. **Dig** contains no model call, so execution cannot be talked
out of what the plan said. **Verify** is entirely deterministic, so a confidence
seal is reproducible rather than a model's opinion of its own work. **Present**
runs *after* execution with the real values in view, which is what lets it
suggest a chart form that fits the data rather than the question.

Full contract: [`docs/design/agents.md`](docs/design/agents.md).

---

## Backend — `backend/`

Go, one binary, standard library HTTP. No framework.

| Package | Responsibility |
|---|---|
| `internal/api` | HTTP handlers. Thin — parse, delegate, serialise. |
| `internal/ask` | The pipeline: prompts, planning, streaming, chart hints. |
| `internal/verify` | The check engine and the confidence rollup. **The core IP.** |
| `internal/warehouse` | Connector interface, DuckDB implementation, the read-only SQL guard. |
| `internal/sources` | Source registry, catalog caching, column profiling. |
| `internal/llm` | Provider interface and implementations (mock, claude-cli, anthropic). |
| `internal/store` | SQLite persistence for everything the product remembers. |
| `internal/investigate` | Watches and driver decomposition. |
| `internal/pyrun` | Sandboxed-ish Python execution for notebook cells. |
| `internal/fixture` | The generated synthetic warehouse every test runs against, and the ground truth the conformance suite scores providers with. |

### Verification, concretely

Ten checks with fixed IDs run against the result. Each returns
`pass` / `warn` / `fail` / `skipped`, and **skipped checks never count toward
the denominator** — a seal reading "8 of 8" means eight checks actually ran.

The rollup (`verify.Summarize`) is deliberately simple and deliberately fixed:

```
contested  ← the cross-derivation check FAILED     (outranks everything)
qualified  ← any other check failed, or any warned
unverified ← no checks could run at all
verified   ← cross-derivation RAN and agreed, and nothing else failed
```

`verified` requires the cross-derivation to have **run**, not merely to have
not-failed. A skipped one caps the answer at `qualified`: the seal claims a
second independent derivation agreed, and it may not say that when none
happened.

`contested` is separated from every other failure because it means something
categorically different: not "there is a caveat" but "we do not know the
number." Two independent derivations disagreeing is the strongest negative
signal the system can produce, and it is reserved for that.

Deeper: [`docs/design/agents.md`](docs/design/agents.md) for the module
contract, and `backend/internal/verify/` — the checks are short and each one
documents the failure it exists to catch.

### Storage

One SQLite file holds answers, definitions, dashboards, notebooks, watches and
sources. A workspace is therefore a single portable artifact — and also a
sensitive one: it contains every question asked and every source DSN.

---

## Frontend — `frontend/`

Next.js (App Router), React, TypeScript, Tailwind. No component library.

| Area | Notes |
|---|---|
| `app/(app)/*` | Route surfaces: ask, ledger, definitions, dashboards, notebooks, investigations, watches, sources. |
| `lib/api/` | Typed client mirroring `docs/api-contract.md`. Browser calls `/api/v1/*`; Next route handlers proxy server-side. |
| `lib/viz/` | Chart resolution — pure, React-free, unit-tested. |
| `components/viz/plugins/` | Chart renderers, one file per form. |
| `components/seal/` | The confidence apparatus. |

### The charting registry — the model for the other seams

A chart form is a plugin declaring `{id, channels, legality, affinity, options,
render}`. From that single declaration the type switcher, the encoding popover,
the degradation messages and the suggestion ranking all fall out. Adding a form
is one file plus one registration — `plugins/bignum.tsx` is the smallest
complete example.

Two rules the renderers enforce because the product's honesty depends on them:
unverified data is **hatched** (so it stays distinguishable in greyscale, in a
screenshot, in a printout), and a chart that cannot be drawn honestly refuses
and shows the table instead, with the reason.

Deeper: [`docs/design/charting.md`](docs/design/charting.md),
[`docs/design/data-viz.md`](docs/design/data-viz.md).

---

## Extension points

Three registries, same pattern: implement a small interface, call `Register`
from an `init()`, and nothing in the core needs editing.

| Point | Interface | Location |
|---|---|---|
| Model provider | `llm.Provider` | `backend/internal/llm/` |
| Data connector | `warehouse.Connector` | `backend/internal/warehouse/` |
| Chart form | renderer plugin | `frontend/src/components/viz/plugins/` |

Provider and connector contributions run a conformance suite — see
[CONTRIBUTING.md](CONTRIBUTING.md) for what it checks and why it exists.

**Deliberately not extensible:** the confidence rollup, the meaning of
`contested`, and any client-side transformation of verified results. Each would
let a plugin change what a seal means, and a seal that means different things in
different installations means nothing.

---

## Request lifecycle, end to end

1. Browser posts a question to a Next route handler, which proxies to the API.
2. `ask` interprets it. If more than one reading is defensible, it streams an
   ambiguity payload and stops — a refusal is a terminal, successful outcome.
3. Otherwise it plans a query *and* an independent second derivation, and `dig`
   executes both against the warehouse (read-only, guarded).
4. `verify` runs the checks and computes the seal.
5. `present` writes the narrative and suggests a chart, having seen the values.
6. The answer is written to the ledger and streamed to the client, which renders
   it through the charting module.

Every stage streams as it completes, which is why the number appears before the
checks that scrutinise it — deliberate, and part of the API contract.

---

## Where to look first

| If you want to… | Start at |
|---|---|
| Understand the product's claim | [README](README.md) |
| Add a connector or provider | [CONTRIBUTING](CONTRIBUTING.md) |
| Change how answers are checked | `backend/internal/verify/` |
| Change how charts are chosen | `frontend/src/lib/viz/resolve.ts` |
| Understand an API shape | [`docs/api-contract.md`](docs/api-contract.md) |
| Know why something looks the way it does | [`docs/design/`](docs/design/) |

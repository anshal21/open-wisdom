# Contributing to Analyst

Thanks for considering it. This document covers the two contributions most
likely to be useful — **a data connector** and **a model provider** — plus the
one rule that makes this project different from most.

## The rule

**A contribution that can silently degrade a verification is not accepted
without a conformance run.**

Analyst's entire claim is that a number arrives with evidence. A connector that
mis-maps a `DATE` to a nominal type, or a model provider that writes subtly
worse SQL, does not produce visibly worse output — it produces *more false
`contested` results*, and occasionally two equally-wrong derivations that agree,
which renders as **verified**. The failure mode of a bad plugin here is a
confidently wrong number wearing our badge.

So provider and connector PRs run a conformance suite and publish the score.
This is not gatekeeping — the suites exist so that a contribution from someone
nobody has met can be trusted on evidence rather than vibes.

---

## Getting set up

```bash
docker compose up          # fastest way to see it working
```

For development:

```bash
cd backend  && go run ./cmd/server -llm mock -warehouse /path/to/your.duckdb
cd frontend && npm ci && npm run dev
```

Prerequisites are in the [README](README.md#running-without-docker). The short
version: Go ≥ 1.25 with `CGO_ENABLED=1` (DuckDB is cgo), Node ≥ 22.

Tests:

```bash
cd backend  && go test ./...
cd frontend && npx tsc --noEmit && npx vitest run && npx eslint src
```

**Nothing to fetch, nothing to configure.** The suites build a small DuckDB
warehouse from CSVs embedded in the test binary
(`backend/internal/fixture/testdata`), so a bare clone runs the whole thing.
Set `ANALYST_TEST_WAREHOUSE=/path/to/your.duckdb` to run against your own data
instead; it must present the fixture's schema.

**Skipped tests fail CI.** If a test cannot run, that is a fixture or
environment problem to fix, not a condition to tolerate — a suite that prints
`ok` while executing nothing is worse than no suite, and this project has been
bitten by exactly that twice. The first time, three files hardcoded a path under
one developer's home directory. The second, the fixture was a large third-party
download, which is the same bug wearing better clothes: a test that only runs
if you first obtain something is a test that mostly does not run.

### If you change the fixture

`backend/internal/fixture` owns the test data, and it is generated:

```bash
cd backend && go run ./cmd/gensample -scale tiny -csv internal/fixture/testdata
```

That must produce **no diff** — the generator is seeded, and CI fails if
regenerating changes a byte. If you deliberately change the data, the ground
truth in `internal/fixture/truth.go` moves with it: `TestGroundTruth` will fail
and print the correct values. Update them, and remember that those same figures
are what the model conformance suite scores providers against, so every
published score shifts.

The fixture is small on purpose, but it is not arbitrary. Each property it has
exists because a check needs it — capitalised status literals, events with a
null user, orders with several lines. `fixture_test.go` asserts each one, so if
you remove a property you will be told which check you just disarmed.

---

## Adding a data connector

A connector teaches Analyst to read a new engine. The interface is deliberately
small:

```go
type Connector interface {
    Introspect(ctx context.Context) (*Catalog, error)  // tables, columns, types, cheap stats
    Query(ctx context.Context, sql string) (*Result, error)  // read-only
    Dialect() Dialect                                   // SQL flavour + capabilities
    Close() error
}
```

**Steps**

1. Create `backend/internal/warehouse/<engine>.go`.
2. Implement `Connector`.
3. Register it: `func init() { Register("<engine>", newConnector) }`.
4. Run the conformance suite and paste the output into your PR.

Nothing outside that one file changes. `sources/` resolves connectors through
the registry, so it never learns your engine's name.

**Running the conformance suite**

Load `internal/warehouse/conformance/testdata/*.csv` into your engine as tables
named `orders` and `regions` — the loading is your business, the schema is the
contract — then:

```go
func TestConformance(t *testing.T) {
    conformance.Run(t, conformance.Target{
        Name:    "postgres",
        Connect: func(t *testing.T) warehouse.Connector { /* open through warehouse.Open */ },
        // Escapes only you know about. This one is not optional.
        ExtraHostReads: []string{
            `SELECT pg_read_file('/etc/passwd')`,
            `COPY t FROM PROGRAM 'cat /etc/passwd'`,
        },
    })
}
```

`duckdb_conformance_test.go` is the worked example. Note that it opens through
`warehouse.Open` rather than constructing a handle directly — testing a
specially-built connector proves nothing about what production does.

**`ExtraHostReads` deserves a paragraph.** The base suite knows DuckDB-shaped
readers (`read_csv`, `glob`, a URL as a table). It cannot guess that Postgres
has `pg_read_file`, MySQL has `LOAD_FILE`, or ClickHouse has `url()`. Analyst
executes model-generated SQL over data it does not control, so an unlisted
escape is arbitrary file disclosure on every deployment of your connector. You
are the person who knows your engine's escapes; please list them.

**What the conformance suite checks, and why each one matters**

| Check | Why |
|---|---|
| Type mapping | Column types decide chart form, sort order and whether a time axis is used. A `DATE` mapped to nominal produces a chart that is wrong in a way nothing else catches. |
| Read-only enforcement | Every write form must be refused, including stacked statements and anything reaching the filesystem or network. |
| Catalog shape | The planner builds prompts from the catalog. A missing column type is a worse plan. |
| NULL and timezone handling | The verification engine compares two derivations numerically. Inconsistent NULL or TZ semantics manufacture false disagreement. |

**Things that catch people out**

- `Dialect()` carries *capabilities*, not just a name. If your engine lacks CTEs
  or window functions, declare it — the planner reads this. Claiming a
  capability you do not have produces failing queries at answer time.
- Credentials belong in environment variables. DSNs support `${VAR}`
  interpolation and are stored **uninterpolated**; never persist a resolved
  secret.
- Analyst runs *every query twice* by design (that is the cross-derivation). If
  your engine bills per query, say so in the connector's docs and support the
  row/byte/time limits in `Options`.

---

## Adding a model provider

```go
type Provider interface {
    Complete(ctx context.Context, req Request) (*Response, error)
    Name() string
}
```

**Steps**

1. Create `backend/internal/llm/<provider>.go`.
2. Implement `Provider`, plus its model map (Fast / Balanced / Deep), its cost
   hook, and its capability declaration.
3. Register it: `func init() { Register("<provider>", newProvider) }`.
4. Run the provider conformance suite and paste the score into your PR:

```bash
cd backend
go test ./internal/llm/conformance -run TestConformance -v -provider <your-provider>

# a hosted provider is ~48 calls over 12 cases; narrow it while iterating
go test ./internal/llm/conformance -run TestConformance -v \
  -provider <your-provider> -case revenue -suite-timeout 40m

# write the markdown straight to a file to attach
ANALYST_CONFORMANCE_OUT=score.md go test ./internal/llm/conformance \
  -run TestConformance -provider <your-provider>
```

**What the suite scores, and why each category exists**

| Category | Why |
|---|---|
| Structured output | Every pipeline call expects JSON of a specific shape. A provider that drifts here fails at a layer with no fallback. |
| Executable SQL | Well-formed JSON is not evidence the query runs. A hallucinated column is valid JSON and a broken answer. |
| Ground truth | Eight cases have a figure computed independently of the model and frozen in the suite (`internal/fixture/truth.go`, each with the SQL that derived it, all re-checked by `TestGroundTruth`). This is the only category that measures whether the provider is *right* rather than merely well-behaved. |
| Independent derivation | The cross-derivation must not be the primary query in disguise. Two identical queries always agree, so a copy manufactures a `verified` seal that carries no evidence. This is the one the product is most exposed to. |

The suite prints a route-divergence figure alongside the score. That one is
informational, not graded: `crossSystem` explicitly tells the model to write the
single available path when the schema offers only one, and for
`SELECT count(*) FROM users` there honestly is only one. Grading it would punish
a provider for being truthful about the schema.

**Requirements that are easy to miss**

- **Cost.** If your provider returns tokens rather than a price, convert them.
  Without it the cost ledger silently reads `$0.00`, and cost visibility is a
  user-facing feature.
- **JSON.** Declare whether you support constrained JSON output. Analyst has a
  salvage path for models that emit fenced markdown anyway; providers with real
  JSON mode should skip it.
- **Secrets.** API keys must never be logged, persisted, or appear in an error
  message. There is a test for this.

**Interpreting your conformance score.** We do not currently gate on a
threshold — we require the number to be *visible*, because "is this model good
enough for verified answers?" is precisely the question a user of an
open-source verification tool needs answered before trusting it.

For calibration: the built-in `mock` provider scores **100% on structured
output, executable SQL and independence, and 0% on ground truth**. That is not a
bug. The mock answers from the schema rather than from the question — it is a
plumbing harness that lets the product run offline, not an analyst. If your
provider scores near zero on ground truth, it is behaving like the mock.

---

## Adding a chart form

Renderers are a plugin registry too — see `frontend/src/lib/viz/registry.ts`.
A form declares its channels, legality, affinity, options schema and render
function in one file; the switcher, encoding popover and suggestion ranking all
derive from that declaration. `plugins/bignum.tsx` is the smallest complete
example.

Note the house rules in [`docs/design/data-viz.md`](docs/design/data-viz.md) —
particularly that unverified data must render distinguishably (it is hatched, so
it survives greyscale and screenshots), and that dual-axis charts are banned
outright.

---

## Adding a verification check

The ten built-in checks are the product's core claim and stay in the binary.
The registry exists so you can add an eleventh — "currency mixing", "timezone
consistency", whatever your warehouse taught you to distrust.

```go
func init() {
    verify.RegisterCheck(verify.RegisteredCheck{
        ID:    "currency_mixing",
        Label: "Currency mixing",
        Needs: verify.Needs{Warehouse: true},
        Run:   currencyMixing,
    })
}
```

Two rules are enforced in code, not by convention:

- **A contributed check can never produce `contested`.** That state means two
  independent derivations of the same figure disagreed — the strongest negative
  claim the product makes — and it belongs to the core cross-derivation check
  alone. Your check can pass, warn, fail or skip; a failure qualifies the
  answer, which is the honest ceiling for a single check's opinion. Registering
  a built-in id panics at startup, and impersonating one in a returned `Check`
  is overwritten.
- **A skip must say why.** The seal renders "8 of 8" and skipped checks never
  count toward the denominator, so a silent skip quietly shrinks the evidence
  behind a number while leaving the badge looking just as strong. If you skip
  without a reason, the engine writes one naming your check.

Write the failing case first. A check that has never fired is a check nobody
knows works.

## What we are careful about

Some things are deliberately **not** extensible, and PRs changing them will get
a design conversation first:

- **The confidence rollup.** If plugins can change how `verified` is computed,
  the seal means something different in every installation.
- **`contested` as a state.** A third-party check may pass, warn, fail or skip —
  but only the core cross-derivation check may declare two derivations in
  disagreement. It is the strongest claim the product makes.
- **Client-side transformation of results.** Reshaping values after verification
  produces a number the verifier never saw, wearing a seal that says it was
  checked.

---

## Pull requests

- Keep them focused; a connector plus a refactor is two PRs.
- Explain the *why* in the description — this codebase comments the reasoning,
  not the mechanics, and reviews follow the same standard.
- New behaviour comes with a test. Bug fixes come with the test that would have
  caught them.
- If you find something wrong in the docs, fixing it is a welcome PR on its own.

## Code of conduct

By participating you agree to uphold the
[Code of Conduct](CODE_OF_CONDUCT.md).

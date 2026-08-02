<!--
Thank you for this. Two of the boxes below are unusual; they exist because a
plugin can degrade a confidence seal without anything looking broken, and a
reviewer cannot see that by reading a diff.
-->

## What this changes

<!-- And why. Link an issue if there is one. -->

## Checks

- [ ] `go test ./...` passes in `backend/` (no new skips — CI fails on them)
- [ ] `npx tsc --noEmit`, `npx eslint src` and `npx vitest run` pass in `frontend/`
- [ ] Behaviour I changed is covered by a test that **fails without the change**

## If this adds or changes a model provider

Paste the conformance report. Run:

```
go test ./internal/llm/conformance -run TestConformance -v -provider <yours>
```

<details><summary>Conformance report</summary>

```
(paste)
```

</details>

A low score does not block a merge — the suite is not a gate, it is a
disclosure. What blocks a merge is not knowing the number.

## If this adds or changes a data connector

Paste the connector conformance report (`internal/warehouse/conformance`).

<details><summary>Conformance report</summary>

```
(paste)
```

</details>

## If this touches the verification engine

- [ ] I have read the rollup contract in [ARCHITECTURE.md](../ARCHITECTURE.md#verification-concretely)
- [ ] No change makes `verified` reachable without the cross-derivation having run

<!--
That last box is not boilerplate. A bug that let a skipped cross-derivation keep
a `verified` seal is exactly how this project's own ledger ended up with 44% of
its verified answers never independently re-derived.
-->

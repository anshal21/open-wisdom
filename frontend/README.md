# Analyst — frontend

Next.js 16 · React 19 · TypeScript · Tailwind v4 (App Router).

Implements `docs/design/design-system.md`, `docs/design/screens.md` and
`docs/design/data-viz.md` against the contract in `docs/api-contract.md`.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
```

The backend is optional. `NEXT_PUBLIC_API_MODE` selects the transport:

| value | behaviour |
|---|---|
| `auto` (default) | probe the backend once; fall back to fixtures if it is not up |
| `mock` | always fixtures |
| `live` | always the backend |

The browser never talks to `:8080` directly — `src/app/api/v1/[...path]/route.ts`
proxies same-origin (including SSE), so CORS never enters the picture. Copy
`.env.example` to `.env.local` to point at a different backend origin.

The left rail footer states which transport is in use (`Live warehouse` /
`Demo data`) so it is never ambiguous which data you are looking at.

## Checks

```bash
npm run build
npm run lint
npx tsc --noEmit
```

## Layout

```
src/
  app/
    (app)/            every surface; the route group mounts the shell
    api/              same-origin proxy + backend liveness probe
  components/
    seal/             <ConfidenceSeal> and the seven state glyphs
    charts/           hand-built SVG; no chart library
    evidence/         the right-hand evidence panel and <CheckRow>
    ui/               buttons, tables, overlays, SQL viewer, primitives
    shell/            rail, header, command palette, shortcut sheet
    ask/ ledger/ definitions/ dashboards/ notebook/ investigations/
    watches/ sources/ admin/ slack/
  lib/
    api/              wire types, client, SSE reader, fixture transport
    confidence.ts     the seven states and their mechanical derivation
    format.ts         number and time rendering
  state/              ui prefs, evidence subject, the ask state machine
```

## Rules that are enforced, not aspirational

- Components use semantic tokens only. A raw ramp step or a Tailwind default
  colour in a component is a defect.
- No confidence percentage is ever rendered. The seal reads `n of m checks`.
- Every figure carries a `<ConfidenceSeal>`; every chart takes
  `confidenceState` and `checks` as **required** props.
- Numbers never animate. Nothing animates longer than 220ms. No springs.
- Skeletons, never spinners, and skeleton geometry matches the loaded layout.
- Nothing references a specific table, column, metric or source name. The demo
  warehouse is data, not code.

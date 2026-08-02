import type { Answer, DashboardTile, ResultColumn, TileSize } from "@/lib/api/types";
import { sortChecks, type ConfidenceState } from "@/lib/confidence";
import type { EvidenceSubject } from "@/state/evidence";
import { resolve } from "@/lib/viz/resolve";

/**
 * Client-side derivations for a dashboard tile. Nothing here is dataset
 * specific — every label comes off the wire. screens.md §6.
 */

/**
 * One entry on the canvas: a tile, the answer behind it (once loaded), and any
 * error fetching that answer. Callbacks are keyed by `index` into the
 * dashboard's full tile list.
 *
 * Relocated here when `grid.tsx` was deleted — the old renderer was dead but
 * this type was still live, which is why the file lingered.
 */
export interface GridItem {
  index: number;
  tile: DashboardTile;
  answer?: Answer;
  error?: string;
}

/** One grid row unit. 12 columns, 8px gutters. §6.1 */
export const ROW_H = 112;
export const GUTTER = 8;

export interface Geom {
  cols: number;
  rows: number;
}

const SIZES: Record<TileSize, Geom> = {
  "1x1": { cols: 1, rows: 1 },
  "2x1": { cols: 2, rows: 1 },
  "2x2": { cols: 2, rows: 2 },
  "3x2": { cols: 3, rows: 2 },
  "4x2": { cols: 4, rows: 2 },
  "6x2": { cols: 6, rows: 2 },
  "12x2": { cols: 12, rows: 2 },
};

export const TILE_SIZES = Object.keys(SIZES) as TileSize[];

export function geom(size: TileSize): Geom {
  return SIZES[size] ?? SIZES["3x2"];
}

const COL_STEPS = [1, 2, 3, 4, 6, 12];

function nearest(steps: number[], v: number): number {
  return steps.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), steps[0]);
}

/** Tiles snap to the listed sizes — there is no free-form geometry. §6.1 */
export function snapSize(cols: number, rows: number): TileSize {
  const c = nearest(COL_STEPS, cols);
  if (c === 1) return "1x1";
  if (c === 2) return rows <= 1 ? "2x1" : "2x2";
  return `${c}x2` as TileSize;
}

/** Keyboard resizing: step one notch along an axis, staying inside the set. */
export function stepSize(size: TileSize, axis: "cols" | "rows", dir: 1 | -1): TileSize {
  const g = geom(size);
  if (axis === "rows") return snapSize(g.cols, Math.min(2, Math.max(1, g.rows + dir)));
  const i = COL_STEPS.indexOf(g.cols);
  const next = COL_STEPS[Math.min(COL_STEPS.length - 1, Math.max(0, i + dir))];
  return snapSize(next, g.rows);
}

/* ---------------------------------------------------------------------------
   State
--------------------------------------------------------------------------- */

/**
 * A definition change supersedes the answer behind the tile. The wire carries
 * that as `supersession`; the seal state is a client-side state (§3.1).
 */
export function tileState(answer: Answer): ConfidenceState {
  if (answer.supersession) return "superseded";
  return answer.report?.confidence ?? "refused";
}

export const ROLLUP_ORDER: ConfidenceState[] = [
  "verified",
  "qualified",
  "unverified",
  "superseded",
  "contested",
  "refused",
];

export function rollup(states: ConfidenceState[]): Array<{ state: ConfidenceState; count: number }> {
  const counts = new Map<ConfidenceState, number>();
  for (const s of states) counts.set(s, (counts.get(s) ?? 0) + 1);
  return ROLLUP_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
    state: s,
    count: counts.get(s) ?? 0,
  }));
}

/* ---------------------------------------------------------------------------
   Series
--------------------------------------------------------------------------- */

interface SeriesIndices {
  xIdx: number;
  yIdx: number;
  xCol?: ResultColumn;
}

/**
 * Tiles resolve their columns through the shared charting module — one
 * resolver for every surface (docs/design/charting.md). The sparkline is a
 * deliberately minimal form, so only the x/first-y indexes are consumed.
 */
function seriesIndices(answer: Answer): SeriesIndices {
  const spec = resolve({ columns: answer.columns, rows: answer.rows }, answer.chart);
  return {
    xIdx: spec.xIdx,
    yIdx: spec.yIdxs[0] ?? -1,
    xCol: spec.xIdx >= 0 ? answer.columns[spec.xIdx] : undefined,
  };
}

export function isTemporalSeries(answer: Answer): boolean {
  const { xCol } = seriesIndices(answer);
  return xCol?.type === "temporal" || xCol?.type === "ordinal";
}

/** Ordered measure values — the sparkline's input. */
export function seriesValues(answer: Answer): number[] {
  const { yIdx } = seriesIndices(answer);
  if (yIdx < 0) return [];
  return answer.rows
    .map((r) => Number(r[yIdx]))
    .filter((v) => Number.isFinite(v));
}

/** Nominal categories, sorted by value descending. data-viz.md §1 */
export function categorySeries(answer: Answer): Array<{ label: string; value: number }> {
  const { xIdx, yIdx } = seriesIndices(answer);
  if (xIdx < 0 || yIdx < 0) return [];
  return answer.rows
    .map((r) => ({ label: String(r[xIdx] ?? ""), value: Number(r[yIdx]) }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => b.value - a.value);
}

export interface TileDelta {
  pct: number;
  /** The comparison base. A delta without its base is banned. §10.1 */
  base: string;
}

/**
 * The change across the answer's own series, labelled with the period it is
 * measured against. Never rendered bare.
 */
export function tileDelta(answer: Answer): TileDelta | null {
  const { xIdx, yIdx, xCol } = seriesIndices(answer);
  if (xIdx < 0 || yIdx < 0) return null;
  if (xCol?.type !== "temporal" && xCol?.type !== "ordinal") return null;
  const rows = answer.rows;
  if (rows.length < 2) return null;
  const first = Number(rows[0][yIdx]);
  const last = Number(rows[rows.length - 1][yIdx]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return {
    pct: ((last - first) / Math.abs(first)) * 100,
    base: periodLabel(String(rows[0][xIdx] ?? "")),
  };
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `2023-02-01` → `1 Feb`, `2023-02` → `Feb 23`. Anything else passes through. */
export function periodLabel(v: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (!m) return v.length > 14 ? `${v.slice(0, 13)}…` : v;
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  return m[3] ? `${Number(m[3])} ${mon}` : `${mon} ${m[1].slice(2)}`;
}

/* ---------------------------------------------------------------------------
   Evidence
--------------------------------------------------------------------------- */

/** The panel tracks whatever is focused — a tile publishes this on focus. §0.4 */
export function tileEvidence(answer: Answer, label: string): EvidenceSubject {
  const coverage = answer.chart?.coverage;
  const paths = [
    answer.sql ? { label: "Path A", sql: answer.sql } : null,
    answer.sql_path_b ? { label: "Path B", sql: answer.sql_path_b } : null,
  ].filter(Boolean) as Array<{ label: string; sql: string }>;

  return {
    id: answer.id,
    label,
    title: answer.question,
    state: tileState(answer),
    headline: answer.report?.headline,
    checks: sortChecks(answer.report?.checks ?? []),
    passed: answer.report?.passed,
    total: answer.report?.total,
    definitions: answer.definition_used
      ? [
          {
            id: answer.definition_used.id,
            name: answer.definition_used.name,
            version: answer.definition_used.version,
          },
        ]
      : undefined,
    coverage: coverage
      ? {
          included: coverage.included_rows,
          total: coverage.included_rows + coverage.excluded_rows,
          reason: coverage.reason || undefined,
        }
      : undefined,
    derivation:
      paths.length > 0
        ? {
            paths,
            rowCount: answer.row_count,
            scannedRows: answer.scanned_rows,
            elapsedMs: answer.cost?.elapsed_ms,
            llmCalls: answer.cost?.llm_calls,
            usd: answer.cost?.usd,
          }
        : undefined,
  };
}

/* ---------------------------------------------------------------------------
   Tile list mutation — every mutation returns a new array so the undo stack
   can hold plain snapshots.
--------------------------------------------------------------------------- */

export function reposition(tiles: DashboardTile[]): DashboardTile[] {
  return tiles.map((t, i) => ({ ...t, position: i }));
}

/**
 * The first free {x, y} on the 12-column grid that fits a w×h tile — scanning
 * left-to-right, top-to-bottom. A new tile lands in the first gap it fits,
 * rather than flowing row-major from legacy positions and leaving a hole
 * beside an existing tile.
 */
export function firstFreeSlot(
  tiles: DashboardTile[],
  w: number,
  h: number,
  cols = 12,
): { x: number; y: number } {
  const placed = tiles.filter(
    (t) => (t.x ?? -1) >= 0 && (t.y ?? -1) >= 0 && (t.w ?? 0) > 0,
  );
  const collides = (x: number, y: number) =>
    placed.some((t) => {
      const tx = t.x!;
      const ty = t.y!;
      const tw = t.w!;
      const th = t.h ?? 2;
      return x < tx + tw && x + w > tx && y < ty + th && y + h > ty;
    });
  const maxY = placed.reduce((m, t) => Math.max(m, (t.y ?? 0) + (t.h ?? 2)), 0);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (!collides(x, y)) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}



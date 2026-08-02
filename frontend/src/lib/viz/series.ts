/**
 * Pivot a flat table into renderable series, applying the cap.
 *
 * The design system has exactly eight categorical hues and hues are assigned
 * in fixed order, never cycled — so a ninth series is never a new color: the
 * remainder folds into "Other" and the frame says how many were folded.
 * Nothing is silently dropped.
 */

import type { Cell } from "@/lib/api/types";
import { SERIES_CAP, type ResolvedSpec, type VizTable } from "./resolve";

export interface SeriesPoint {
  x: string; // raw cell as string; renderer formats temporal labels
  value: number | null; // null = this series has no row at this x
}

export interface VizSeries {
  key: string; // series identity (entity, not rank) — color follows this
  label: string;
  points: SeriesPoint[]; // aligned to xLabels, one entry per bucket
  total: number;
  isOther?: boolean;
}

export interface PivotResult {
  xLabels: string[];
  series: VizSeries[];
  /** How many real series were folded into "Other"; 0 when none. */
  folded: number;
  /** Total distinct series before the cap. */
  seriesTotal: number;
  /**
   * Parsed epoch ms per x bucket, present only when every bucket parsed as a
   * date. A renderer that has these places marks on a TIME scale, so unequal
   * gaps carry information — three months and then a year apart must not draw
   * as two equal steps. (B9)
   */
  xEpochs?: number[];
}

/** Every bucket parsed as a date, or nothing — a partial parse is not a scale. */
function epochsOf(labels: string[]): number[] | undefined {
  const out: number[] = [];
  for (const l of labels) {
    const t = Date.parse(l);
    if (Number.isNaN(t)) return undefined;
    out.push(t);
  }
  return out;
}

/**
 * Build aligned series from the table. With no series column, each measure
 * becomes one series (multi-measure); with one measure and no series, a
 * single series results.
 */
export function pivot(table: VizTable, spec: ResolvedSpec): PivotResult {
  const { columns, rows } = table;
  const xIdx = spec.xIdx;

  // X buckets keep first-seen order: the query's ORDER BY is the author's
  // intent and re-sorting here would override it.
  //
  // Time is the exception. Row order is NOT intent for a temporal axis — a
  // query grouped by month can emit Mar, Jun, Oct, Dec, Aug, Jan, and drawing
  // that in row order produces a chart whose title promises a trend and whose
  // line is noise (B9 / audit P1-13). Chronology is the only honest order.
  const temporal = xIdx >= 0 && columns[xIdx]?.type === "temporal";
  const seen: string[] = [];
  const firstSeen = new Set<string>();
  for (const r of rows) {
    const key = String(r[xIdx] ?? "");
    if (!firstSeen.has(key)) {
      firstSeen.add(key);
      seen.push(key);
    }
  }

  let xLabels = seen;
  if (temporal) {
    const parsed = epochsOf(seen);
    if (parsed) {
      xLabels = [...seen].sort((a, b) => Date.parse(a) - Date.parse(b));
    }
  }

  const xPos = new Map<string, number>();
  xLabels.forEach((label, i) => xPos.set(label, i));
  const xEpochs = temporal ? epochsOf(xLabels) : undefined;

  if (spec.seriesIdx < 0) {
    const series = spec.yIdxs.map((yIdx) => {
      const points: SeriesPoint[] = xLabels.map((x) => ({ x, value: null }));
      for (const r of rows) {
        const p = xPos.get(String(r[xIdx] ?? ""))!;
        const v = asNumber(r[yIdx]);
        if (v !== null) points[p] = { x: xLabels[p], value: v };
      }
      return {
        key: columns[yIdx].name,
        label: columns[yIdx].label ?? columns[yIdx].name,
        points,
        total: sum(points),
      };
    });
    return { xLabels, series, folded: 0, seriesTotal: series.length, xEpochs };
  }

  // One measure split by the series column.
  const yIdx = spec.yIdxs[0];
  const byKey = new Map<string, SeriesPoint[]>();
  for (const r of rows) {
    const key = String(r[spec.seriesIdx] ?? "");
    if (!byKey.has(key)) byKey.set(key, xLabels.map((x) => ({ x, value: null })));
    const p = xPos.get(String(r[xIdx] ?? ""))!;
    const v = asNumber(r[yIdx]);
    if (v !== null) {
      const pts = byKey.get(key)!;
      // Duplicate (x, series) rows accumulate — the honest reading of a
      // table that was not fully grouped.
      pts[p] = { x: xLabels[p], value: (pts[p].value ?? 0) + v };
    }
  }

  const all: VizSeries[] = [...byKey.entries()].map(([key, points]) => ({
    key,
    label: key,
    points,
    total: sum(points),
  }));
  // Rank by |contribution| for the cap; color still follows the entity —
  // the renderer assigns hues by this order once, and a filter that removes
  // a series later must not repaint survivors (the key stays the identity).
  all.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  if (all.length <= SERIES_CAP) {
    return { xLabels, series: all, folded: 0, seriesTotal: all.length, xEpochs };
  }

  // Keep the full 8 real series — the cap is the hue count, and "Other" is
  // not a series wearing a hue: it renders in the annotation gray as a
  // residual. Folding at CAP-1 quietly threw away a real series (B12).
  const kept = all.slice(0, SERIES_CAP);
  const rest = all.slice(SERIES_CAP);
  const other: VizSeries = {
    key: "__other__",
    label: `Other (${rest.length})`,
    isOther: true,
    points: xLabels.map((x, i) => {
      let acc: number | null = null;
      for (const s of rest) {
        const v = s.points[i].value;
        if (v !== null) acc = (acc ?? 0) + v;
      }
      return { x, value: acc };
    }),
    total: rest.reduce((a, s) => a + s.total, 0),
  };
  return {
    xLabels,
    series: [...kept, other],
    folded: rest.length,
    seriesTotal: all.length,
    xEpochs,
  };
}

function asNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

const sum = (pts: SeriesPoint[]) => pts.reduce((a, p) => a + (p.value ?? 0), 0);

/* ---------------------------------------------------------------- stacking */

export interface StackedPoint {
  /** Cumulative lower edge for this series at this bucket. */
  y0: number;
  /** Cumulative upper edge. `y1 - y0` is the segment's own value. */
  y1: number;
}

/**
 * Cumulative bands per series per bucket, bottom-up in series order.
 *
 * `"100%"` normalises each bucket to its own total, which is the honest way
 * to read composition when the absolute totals differ wildly — and why
 * data-viz.md:27 asks for the absolute view and the 100% view as a pair
 * rather than a choice.
 *
 * Nulls contribute nothing and do not break the stack: a missing series at a
 * bucket is absent, not zero, but the bands above it must still sit flush.
 */
export function stack(
  series: VizSeries[],
  xCount: number,
  mode: "stacked" | "100%",
): StackedPoint[][] {
  const bands: StackedPoint[][] = series.map(() => []);
  for (let i = 0; i < xCount; i++) {
    let total = 0;
    if (mode === "100%") {
      for (const s of series) {
        const v = s.points[i]?.value;
        if (v !== null && v !== undefined && v > 0) total += v;
      }
    }
    let acc = 0;
    series.forEach((s, si) => {
      const raw = s.points[i]?.value ?? null;
      if (raw === null) {
        bands[si].push({ y0: acc, y1: acc });
        return;
      }
      const v = mode === "100%" ? (total > 0 ? (raw / total) * 100 : 0) : raw;
      bands[si].push({ y0: acc, y1: acc + v });
      acc += v;
    });
  }
  return bands;
}

/** The stacked domain's top — the tallest bucket total. */
export function stackMax(bands: StackedPoint[][]): number {
  let max = 0;
  for (const b of bands) for (const p of b) if (p.y1 > max) max = p.y1;
  return max;
}

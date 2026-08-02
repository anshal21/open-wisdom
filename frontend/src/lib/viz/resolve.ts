/**
 * The charting module's brain. docs/design/charting.md.
 *
 * A chart takes a table and gives a visualization; the table is always
 * available. This file decides HOW — merging three voices in strict
 * precedence (user > agent hint > shape defaults) into one complete,
 * index-resolved spec. Every field records which voice decided it, so a
 * chart can explain its choices the way an answer explains its number.
 *
 * The shape-defaults table is no longer an if-ladder here: each form declares
 * its own `affinity` and the resolver takes the argmax, so adding a form
 * cannot require editing this file (roadmap §2).
 *
 * Pure functions only: no React, no fetch, no model. Everything here is
 * deterministic on (table, hint, override).
 */

import type { ChartSpec, ResultColumn } from "@/lib/api/types";
import {
  getMeta,
  listMetas,
  optionDefaults,
  type Encoding,
  type OptionsSchema,
  type VizTable,
  type VizType,
} from "./registry";
// Side-effect import: registering the built-in forms here means every caller
// of resolve() — a dashboard tile, a unit test, a notebook cell — sees a
// populated registry without having to know it exists.
import "./plugins";
import { barSpanReason } from "./plugins/bar";
import { pieDominanceReason } from "./plugins/pie";

export type { VizTable, VizType, Encoding } from "./registry";
export { distinctCount } from "./registry";
export { POINT_CAP } from "./plugins/line";

/** Where a decision came from — surfaced in the encoding popover. */
export type Voice = "user" | "suggested" | "default";

/** A user's explicit choices. Partial: unset fields fall through. */
export interface VizOverride {
  type?: VizType;
  x?: string; // column name
  y?: string[];
  series?: string | null; // null = explicitly no series
  /** Per-form settings — stacking, orientation, sort. */
  options?: Record<string, unknown>;
}

export interface ResolvedSpec {
  type: VizType;
  xIdx: number; // -1 when the form has no x (scalar, table)
  yIdxs: number[];
  seriesIdx: number; // -1 when none
  /** Resolved per-form options, complete: every key the form declares. */
  options: Record<string, unknown>;
  why: {
    type: Voice;
    x: Voice;
    y: Voice;
    series: Voice;
    options: Record<string, Voice>;
  };
  /** Non-empty when a voice was overruled by reality (e.g. line with no x). */
  degraded?: string;
}

/** More series than this and a legend stops being readable; the renderer
 * folds the rest into "Other". Matches the design system's 8 fixed hues —
 * a 9th series is never a generated color. */
export const SERIES_CAP = 8;

const findIdx = (cols: ResultColumn[], name?: string | null) =>
  name == null ? -1 : cols.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());

const idxsOf = (cols: ResultColumn[], type: string, except: number[] = []) =>
  cols
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => c.type === type && !except.includes(i))
    .map(({ i }) => i);

/**
 * Merge the three voices into a complete spec.
 *
 * The user is never wrong: an explicit pick renders even when ugly, and is
 * only *degraded* when impossible — with the reason recorded, never silently.
 */
export function resolve(
  table: VizTable,
  hint?: ChartSpec | null,
  override?: VizOverride | null,
): ResolvedSpec {
  const { columns } = table;
  const why: ResolvedSpec["why"] = {
    type: "default",
    x: "default",
    y: "default",
    series: "default",
    options: {},
  };

  // ---- encodings ----------------------------------------------------------
  let xIdx = -1;
  if (override?.x !== undefined && findIdx(columns, override.x) >= 0) {
    xIdx = findIdx(columns, override.x);
    why.x = "user";
  } else if (hint?.x && findIdx(columns, hint.x.field) >= 0) {
    xIdx = findIdx(columns, hint.x.field);
    why.x = "suggested";
  } else {
    // Default dimension: temporal first (time is the most common story),
    // else the first nominal column.
    const t = idxsOf(columns, "temporal");
    const n = idxsOf(columns, "nominal");
    xIdx = t[0] ?? n[0] ?? -1;
  }

  let yIdxs: number[] = [];
  if (override?.y?.length) {
    yIdxs = override.y.map((name) => findIdx(columns, name)).filter((i) => i >= 0);
    if (yIdxs.length) why.y = "user";
  }
  if (!yIdxs.length && hint?.y?.length) {
    yIdxs = hint.y.map((f) => findIdx(columns, f.field)).filter((i) => i >= 0 && i !== xIdx);
    if (yIdxs.length) why.y = "suggested";
  }
  if (!yIdxs.length) {
    yIdxs = idxsOf(columns, "quantitative", [xIdx]);
    why.y = "default";
  }

  let seriesIdx = -1;
  if (override?.series !== undefined) {
    seriesIdx = override.series === null ? -1 : findIdx(columns, override.series);
    why.series = "user";
  } else if (hint?.series && findIdx(columns, hint.series.field) >= 0) {
    seriesIdx = findIdx(columns, hint.series.field);
    why.series = "suggested";
  } else {
    // The missing default that broke "trend per item": an unclaimed nominal
    // column alongside an x and a measure IS the series.
    const spare = idxsOf(columns, "nominal", [xIdx, ...yIdxs]);
    if (xIdx >= 0 && yIdxs.length === 1 && spare.length === 1) {
      seriesIdx = spare[0];
      why.series = "default";
    }
  }
  if (seriesIdx === xIdx || yIdxs.includes(seriesIdx)) seriesIdx = -1;

  // Multiple measures ARE the series; a column can't split twice.
  if (yIdxs.length > 1) seriesIdx = -1;

  const enc: Encoding = { xIdx, yIdxs, seriesIdx };

  // ---- type ---------------------------------------------------------------
  // The shape default is the highest-affinity legal form. `table` returns 1
  // and is always legal, so there is always an answer.
  const shapeDefault = bestByAffinity(table, enc);
  let type: VizType = shapeDefault;
  let degraded: string | undefined;

  if (override?.type && getMeta(override.type)) {
    type = override.type;
    why.type = "user";
  } else if (hint?.type && getMeta(hint.type as VizType) && hint.type !== "table") {
    // A hint is honored only when the shape can carry it.
    if (legalityOf(hint.type as VizType, table, enc).ok) {
      type = hint.type as VizType;
      why.type = "suggested";
    }
  }

  // Degrade the impossible, say why — in the FORM's own words, not a
  // synthesised sentence. (User picks included, and visibly.)
  const verdict = legalityOf(type, table, enc);
  if (!verdict.ok) {
    degraded = `${labelOf(type)} ${verdict.reason} — showing ${labelOf(shapeDefault).toLowerCase()} instead`;
    type = shapeDefault;
  }

  // ---- honesty ------------------------------------------------------------
  // A product that refuses to answer an ambiguous question refuses to draw a
  // dishonest chart. Suggested/default voices degrade to the table with the
  // reason stated; an explicit USER pick still renders — the user outranks
  // the guard and can see what they asked for.
  if (why.type !== "user") {
    const refusal = dishonest(type === "table" ? shapeCandidate(table, enc) : type, table, enc);
    if (refusal) {
      degraded = refusal;
      type = "table";
    }
  }

  // ---- options ------------------------------------------------------------
  const { options, voices } = resolveOptions(type, hint, override);
  why.options = voices;

  return { type, xIdx, yIdxs, seriesIdx, options, why, degraded };
}

/** The highest-affinity legal form for this shape. */
function bestByAffinity(table: VizTable, enc: Encoding): VizType {
  let best: VizType = "table";
  let bestScore = -1;
  for (const meta of listMetas()) {
    if (!meta.legality(table, enc).ok) continue;
    const score = meta.affinity(table, enc);
    if (score > bestScore) {
      bestScore = score;
      best = meta.id;
    }
  }
  return best;
}

/**
 * The form the shape WOULD have volunteered if honesty were not a question —
 * so a guard can name what it declined. Ignores the table floor.
 */
function shapeCandidate(table: VizTable, enc: Encoding): VizType {
  let best: VizType = "table";
  let bestScore = 1;
  for (const meta of listMetas()) {
    if (meta.id === "table" || !meta.legality(table, enc).ok) continue;
    const score = meta.affinity(table, enc);
    if (score > bestScore) {
      bestScore = score;
      best = meta.id;
    }
  }
  // Nothing volunteered: a nominal x with a measure would still have been a
  // bar, so ask bar directly — that is the form whose honesty is in doubt.
  if (best === "table" && enc.xIdx >= 0 && enc.yIdxs.length) {
    const x = table.columns[enc.xIdx];
    if (x.type === "nominal" || x.type === "ordinal") return "bar";
  }
  return best;
}

function legalityOf(type: VizType, table: VizTable, enc: Encoding) {
  const meta = getMeta(type);
  if (!meta) return { ok: false as const, reason: "is not a known chart form" };
  return meta.legality(table, enc);
}

function labelOf(type: VizType): string {
  return getMeta(type)?.label ?? type;
}

/** Whether a form can carry this table at all — drives the switcher's
 * disabled states as well as degradation. */
export function isLegal(
  type: VizType,
  table: VizTable,
  xIdx: number,
  yIdxs: number[],
  seriesIdx = -1,
): boolean {
  return legalityOf(type, table, { xIdx, yIdxs, seriesIdx }).ok;
}

/** The reason a form is unavailable, for the disabled control's tooltip. */
export function legalityReason(
  type: VizType,
  table: VizTable,
  enc: Encoding,
): string | undefined {
  const v = legalityOf(type, table, enc);
  return v.ok ? undefined : v.reason;
}

/**
 * Forms that are LEGAL but would lie for this data. Returns the reason, or
 * undefined when the form is honest. Each guard lives with its form.
 */
function dishonest(type: VizType, table: VizTable, enc: Encoding): string | undefined {
  if (type === "pie") return pieDominanceReason(table, enc);
  if (type === "bar") return barSpanReason(table, enc);
  return undefined;
}

/** user > suggested > default, per option key, with the voice recorded. */
function resolveOptions(
  type: VizType,
  hint?: ChartSpec | null,
  override?: VizOverride | null,
): { options: Record<string, unknown>; voices: Record<string, Voice> } {
  const schema = getMeta(type)?.options ?? [];
  const options = optionDefaults(schema);
  const voices: Record<string, Voice> = {};
  // The wire has no options field yet (roadmap D1 widens the presenter's
  // hint to the options schema); reading it here means that lands without
  // touching the resolver.
  const suggested = (hint as { options?: Record<string, unknown> } | null | undefined)?.options;

  for (const def of schema) {
    voices[def.key] = "default";
    if (suggested && suggested[def.key] !== undefined && valid(def.key, suggested[def.key], schema)) {
      options[def.key] = suggested[def.key];
      voices[def.key] = "suggested";
    }
    if (override?.options && override.options[def.key] !== undefined) {
      options[def.key] = override.options[def.key];
      voices[def.key] = "user";
    }
  }
  return { options, voices };
}

/** A suggested option is dropped silently when it is not in the schema's
 * vocabulary — a bad suggestion degrades to the default, never to a break. */
function valid(key: string, value: unknown, schema: OptionsSchema): boolean {
  const def = schema.find((d) => d.key === key);
  if (!def) return false;
  if (def.kind === "select") return def.values.some((v) => v.value === value);
  if (def.kind === "toggle") return typeof value === "boolean";
  return typeof value === "number" && Number.isFinite(value);
}

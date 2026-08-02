/**
 * The viz plugin registry. docs/design/charting-roadmap.md §2.
 *
 * Every chart form is a plugin that owns its own row of the knowledge that
 * used to live in one growing switch statement:
 *
 *   channels   — what it can encode, which generates the popover's rows
 *   legality   — HARD constraint (Draco): can this form carry this table,
 *                and if not, the REASON, because the reason is shown twice
 *                (disabled tooltip, degradation note)
 *   affinity   — SOFT constraint: how strongly this shape volunteers this
 *                form. The resolver takes the argmax instead of running an
 *                if-ladder, so the shape-defaults table is data, not code.
 *   options    — per-form settings; the schema IS the editor UI
 *
 * This module is pure: no React, no DOM. Renderers attach separately from
 * the component layer via `attachRenderer`, so the resolver can run in a
 * unit test — or on a dashboard tile — without pulling in a renderer.
 */

import type { ResultColumn } from "@/lib/api/types";

export type VizType =
  | "scalar"
  | "line"
  | "area"
  | "bar"
  | "pie"
  | "scatter"
  | "table"
  | "bignum";

export type ColType = ResultColumn["type"];

/** The table a chart renders. Shape only — never the answer's metadata. */
export interface VizTable {
  columns: ResultColumn[];
  rows: import("@/lib/api/types").Cell[][];
}

/** Resolved column indexes. -1 means "not encoded". */
export interface Encoding {
  xIdx: number;
  yIdxs: number[];
  seriesIdx: number;
}

export interface Channel {
  id: "x" | "y" | "series";
  label: string;
  accepts: ColType[];
  required?: boolean;
  multiple?: boolean;
}

export type Legality = { ok: true } | { ok: false; reason: string };

export type VizCapability = "brush" | "drill" | "legendIsolate" | "crosshair";

/* ------------------------------------------------------------------ options */

interface OptionBase {
  key: string;
  label: string;
  /** Hide the control unless the current options say otherwise. */
  showIf?: (o: Record<string, unknown>) => boolean;
}

export type OptionDef =
  | (OptionBase & {
      kind: "select";
      values: Array<{ value: string; label: string }>;
      default: string;
    })
  | (OptionBase & { kind: "toggle"; default: boolean })
  | (OptionBase & {
      kind: "number";
      default: number;
      min?: number;
      max?: number;
      step?: number;
    });

export type OptionsSchema = OptionDef[];

/** Every option's declared default, as a plain object. */
export function optionDefaults(schema: OptionsSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of schema) out[o.key] = o.default;
  return out;
}

/* ------------------------------------------------------------------ plugins */

/**
 * The pure half of a plugin — everything the resolver needs. The renderer is
 * attached separately so this stays free of React.
 */
export interface VizPluginMeta {
  id: VizType;
  label: string;
  /** Switcher position. */
  order: number;
  channels: Channel[];
  legality(t: VizTable, enc: Encoding): Legality;
  /** 0 = never volunteered as a default (pie, area). */
  affinity(t: VizTable, enc: Encoding): number;
  options: OptionsSchema;
  capabilities?: VizCapability[];
  /** Forms whose figure is the headline, not a plot — Viz renders no frame. */
  frameless?: boolean;
}

/** The React half, attached by `components/viz/plugins/*`. */
export interface VizRendererEntry {
  /** lucide icon component. Opaque here — typed at the component layer. */
  icon: unknown;
  render: unknown;
  legend?: unknown;
}

const METAS = new Map<VizType, VizPluginMeta>();
const RENDERERS = new Map<VizType, VizRendererEntry>();

export function registerMeta(meta: VizPluginMeta): VizPluginMeta {
  METAS.set(meta.id, meta);
  return meta;
}

export function attachRenderer(id: VizType, entry: VizRendererEntry): void {
  RENDERERS.set(id, entry);
}

export function getMeta(id: VizType): VizPluginMeta | undefined {
  return METAS.get(id);
}

export function getRenderer(id: VizType): VizRendererEntry | undefined {
  return RENDERERS.get(id);
}

/** All metas in switcher order. */
export function listMetas(): VizPluginMeta[] {
  return [...METAS.values()].sort((a, b) => a.order - b.order);
}

export function isVizType(t: string): t is VizType {
  return METAS.has(t as VizType);
}

/* ------------------------------------------------- shared legality helpers */

export const hasDimAndMeasure = (enc: Encoding): Legality =>
  enc.xIdx >= 0 && enc.yIdxs.length >= 1
    ? { ok: true }
    : { ok: false, reason: "needs one dimension and one measure" };

export function columnsOfType(
  columns: ResultColumn[],
  accepts: ColType[],
  except: number[] = [],
): number[] {
  return columns
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => accepts.includes(c.type) && !except.includes(i))
    .map(({ i }) => i);
}

export function distinctCount(
  rows: import("@/lib/api/types").Cell[][],
  idx: number,
): number {
  const seen = new Set<string>();
  for (const r of rows) seen.add(String(r[idx]));
  return seen.size;
}

/** Positive, finite measure values for the first y — the honesty guards' input. */
export function measureValues(t: VizTable, enc: Encoding): number[] {
  if (enc.yIdxs.length === 0) return [];
  return t.rows
    .map((r) => r[enc.yIdxs[0]])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

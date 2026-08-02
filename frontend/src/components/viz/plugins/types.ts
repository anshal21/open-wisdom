/**
 * The React half of a plugin. The pure half — channels, legality, affinity,
 * options — lives in `lib/viz/plugins/` and is already registered by the time
 * these attach, so the resolver never depends on a renderer existing.
 */

import type * as React from "react";
import type { FormatHint } from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";
import type { ResolvedSpec } from "@/lib/viz/resolve";
import type { VizTable, VizType } from "@/lib/viz/registry";
import { attachRenderer, getRenderer } from "@/lib/viz/registry";
import type { PivotResult } from "@/lib/viz/series";

export interface VizRenderProps {
  table: VizTable;
  spec: ResolvedSpec;
  /** null when the encoding cannot be pivoted (no x, or no measure). */
  pivotResult: PivotResult | null;
  unit?: string;
  formatHint: FormatHint;
  confidenceState: ConfidenceState;
  /** Plot height in px. Tiles embed smaller. */
  height: number;
  /** True inside a dashboard tile: no axis furniture that will not fit. */
  embedded: boolean;
  /** The form's resolved options, complete. */
  options: Record<string, unknown>;
}

export interface VizRenderer {
  icon: React.ComponentType<{ size?: number | string }>;
  render(p: VizRenderProps): React.ReactNode;
  /** Optional — pie's slice legend is pie's business, not the frame's. */
  legend?(p: VizRenderProps): React.ReactNode;
}

/** Attach a renderer to an already-registered form. */
export function defineRenderer(id: VizType, r: VizRenderer): VizRenderer {
  attachRenderer(id, r as unknown as Parameters<typeof attachRenderer>[1]);
  return r;
}

/** The typed accessor — the registry stores renderers opaquely. */
export function rendererFor(id: VizType): VizRenderer | undefined {
  return getRenderer(id) as VizRenderer | undefined;
}

/* ------------------------------------------------------------- option reads */

export const optStr = (o: Record<string, unknown>, k: string, fallback: string): string =>
  typeof o[k] === "string" ? (o[k] as string) : fallback;

export const optBool = (o: Record<string, unknown>, k: string, fallback: boolean): boolean =>
  typeof o[k] === "boolean" ? (o[k] as boolean) : fallback;

export const optNum = (o: Record<string, unknown>, k: string, fallback: number): number =>
  typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : fallback;

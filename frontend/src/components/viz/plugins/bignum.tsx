"use client";

/**
 * Big number with trend — the exec-weekly form (roadmap §2.5 T2).
 *
 * The figure is the last period. The delta always carries its comparison base
 * ("vs Jan 23"), because a delta without its base is banned (data-viz.md
 * §10.1) — a number that moved 12% means nothing until you know from what.
 * The sparkline gives the shape with no axes and no grid.
 *
 * This file plus one line in `plugins/index.ts` is the entire cost of adding
 * a chart form. Nothing in `resolve.ts`, `viz.tsx` or the switcher changed.
 */

import * as React from "react";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDelta, formatValue } from "@/lib/format";
import { temporalLabel } from "@/lib/viz/labels";
import { defineRenderer, optBool, optStr, type VizRenderProps } from "./types";

/** 48x20 per data-viz.md:172 — no axes, no grid, no interaction. */
function Sparkline({ values, width = 96, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join("");
  const lastX = width;
  const lastY = height - ((values[values.length - 1] - min) / span) * height;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height + 2}`} className="block overflow-visible">
      <path d={d} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill="var(--viz-1)" />
    </svg>
  );
}

function readTrend(p: VizRenderProps) {
  const s = p.pivotResult?.series[0];
  if (!s) return null;
  const points = s.points.filter((pt) => pt.value !== null) as Array<{ x: string; value: number }>;
  if (!points.length) return null;

  const last = points[points.length - 1];
  const compareTo = optStr(p.options, "compareTo", "first");
  const base =
    compareTo === "previous" && points.length >= 2 ? points[points.length - 2] : points[0];

  const pct =
    base && base !== last && base.value !== 0
      ? ((last.value - base.value) / Math.abs(base.value)) * 100
      : null;

  const xCol = p.spec.xIdx >= 0 ? p.table.columns[p.spec.xIdx] : undefined;
  const baseLabel = xCol?.type === "temporal" ? temporalLabel(base.x) : base.x;

  return {
    value: last.value,
    pct,
    baseLabel,
    values: points.map((pt) => pt.value),
  };
}

defineRenderer("bignum", {
  icon: TrendingUp,

  render: (p) => {
    const t = readTrend(p);
    if (!t) return null;
    const up = t.pct !== null && t.pct > 0;
    const down = t.pct !== null && t.pct < 0;

    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col justify-center gap-1",
          p.embedded ? "" : "py-6",
        )}
      >
        <p
          className={cn(
            "tabular text-primary",
            p.embedded ? "text-hero-sm" : "text-hero",
            p.confidenceState === "unverified" && "text-secondary",
          )}
        >
          {formatValue(t.value, p.formatHint, { unit: p.unit, abbreviate: p.embedded })}
        </p>

        {t.pct !== null ? (
          <p
            className={cn(
              "text-ui-sm tabular",
              up ? "text-verified" : down ? "text-serious" : "text-tertiary",
            )}
          >
            {formatDelta(t.pct, t.baseLabel)}
          </p>
        ) : null}

        {optBool(p.options, "sparkline", true) ? (
          <div className="mt-1">
            <Sparkline values={t.values} width={p.embedded ? 96 : 160} height={p.embedded ? 22 : 32} />
          </div>
        ) : null}

        {p.confidenceState === "unverified" ? (
          <p className="text-ui-sm text-tertiary">○ Unverified</p>
        ) : null}
      </div>
    );
  },
});

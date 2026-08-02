"use client";

/**
 * Line, area, bar and scatter renderers. They share one workhorse
 * (`MultiCartesian`), so they live together — four ~20-line declarations, not
 * four files of duplicated wiring.
 */

import * as React from "react";
import { AreaChart, BarChart3, ChartLine, ChartScatter } from "lucide-react";
import { barIsHorizontal } from "@/lib/viz/plugins/bar";
import { SCATTER_SERIES_CAP } from "@/lib/viz/plugins/scatter";
import type { PivotResult } from "@/lib/viz/series";
import { HorizontalBars, MultiCartesian, VizLegend } from "../multi-cartesian";
import { defineRenderer, optBool, optNum, optStr, type VizRenderProps } from "./types";

const temporalX = (p: VizRenderProps) =>
  p.spec.xIdx >= 0 && p.table.columns[p.spec.xIdx]?.type === "temporal";

/** Legend belongs to whoever has series; one implementation, four forms. */
function cartesianLegend(p: VizRenderProps) {
  return p.pivotResult ? <VizLegend {...p.pivotResult} /> : null;
}

/* ------------------------------------------------------------------- line */

defineRenderer("line", {
  icon: ChartLine,
  legend: cartesianLegend,
  render: (p) =>
    p.pivotResult ? (
      <MultiCartesian
        pivotResult={p.pivotResult}
        kind="line"
        temporalX={temporalX(p)}
        unit={p.unit}
        formatHint={p.formatHint}
        confidenceState={p.confidenceState}
        height={p.height}
        markers={optBool(p.options, "markers", false)}
      />
    ) : null,
});

/* ------------------------------------------------------------------- area */

defineRenderer("area", {
  icon: AreaChart,
  legend: cartesianLegend,
  render: (p) =>
    p.pivotResult ? (
      <MultiCartesian
        pivotResult={p.pivotResult}
        kind="area"
        temporalX={temporalX(p)}
        unit={p.unit}
        formatHint={p.formatHint}
        confidenceState={p.confidenceState}
        height={p.height}
        stacking={
          optStr(p.options, "stacking", "stacked") as "none" | "stacked" | "100%"
        }
      />
    ) : null,
});

/* -------------------------------------------------------------------- bar */

/**
 * Sort is a presentation choice, applied to the pivoted buckets — never to the
 * data. `none` keeps the query's ORDER BY, which is the author's intent; a
 * horizontal bar defaults to descending because data-viz.md:24 requires a
 * ranked picture for a ranked question.
 */
function sortBuckets(pr: PivotResult, mode: string, horizontal: boolean): PivotResult {
  const effective = mode === "none" && horizontal ? "value-desc" : mode;
  if (effective === "none" || pr.series.length === 0) return pr;
  const dir = effective === "value-asc" ? 1 : -1;
  const totalAt = (i: number) =>
    pr.series.reduce((a, s) => a + (s.points[i]?.value ?? 0), 0);
  const order = pr.xLabels.map((_, i) => i).sort((a, b) => dir * (totalAt(b) - totalAt(a)));
  return {
    ...pr,
    xLabels: order.map((i) => pr.xLabels[i]),
    xEpochs: pr.xEpochs ? order.map((i) => pr.xEpochs![i]) : undefined,
    series: pr.series.map((s) => ({ ...s, points: order.map((i) => s.points[i]) })),
  };
}

defineRenderer("bar", {
  icon: BarChart3,
  legend: cartesianLegend,
  render: (p) => {
    if (!p.pivotResult) return null;
    const horizontal = barIsHorizontal(
      p.table,
      { xIdx: p.spec.xIdx, yIdxs: p.spec.yIdxs, seriesIdx: p.spec.seriesIdx },
      p.options.orientation,
    );
    const data = sortBuckets(p.pivotResult, optStr(p.options, "sort", "none"), horizontal);

    if (horizontal) {
      return (
        <HorizontalBars
          pivotResult={data}
          unit={p.unit}
          formatHint={p.formatHint}
          confidenceState={p.confidenceState}
          height={p.height}
          valueLabels={!p.embedded}
        />
      );
    }
    return (
      <MultiCartesian
        pivotResult={data}
        kind="column"
        temporalX={temporalX(p)}
        unit={p.unit}
        formatHint={p.formatHint}
        confidenceState={p.confidenceState}
        height={p.height}
        stacking={optStr(p.options, "stacking", "none") as "none" | "stacked" | "100%"}
        // data-viz.md:192 — few enough bars to label, and the axis is redundant.
        valueLabels={
          optBool(p.options, "valueLabels", false) ||
          (!p.embedded && data.xLabels.length <= 8 && data.series.length === 1)
        }
      />
    );
  },
});

/* ---------------------------------------------------------------- scatter */

defineRenderer("scatter", {
  icon: ChartScatter,
  legend: (p) =>
    p.pivotResult && p.pivotResult.series.length > SCATTER_SERIES_CAP ? (
      <div className="flex min-w-0 flex-wrap items-center gap-x-3">
        <VizLegend {...p.pivotResult} />
        <span className="text-ui-sm text-qualified">
          over {SCATTER_SERIES_CAP} series — colours are not reliably distinct here
        </span>
      </div>
    ) : (
      cartesianLegend(p)
    ),
  render: (p) =>
    p.pivotResult ? (
      <MultiCartesian
        pivotResult={p.pivotResult}
        kind="scatter"
        temporalX={temporalX(p)}
        unit={p.unit}
        formatHint={p.formatHint}
        confidenceState={p.confidenceState}
        height={p.height}
        pointSize={optNum(p.options, "pointSize", 3)}
      />
    ) : null,
});

"use client";

/**
 * The donut renderer. Owning its own legend here is what removed the pie
 * branch from `Viz` — a form's bespoke chrome is the form's business.
 */

import * as React from "react";
import { ChartPie } from "lucide-react";
import {
  Donut,
  DonutLegend,
  LEGEND_ROW_H,
  makeSlices,
  sliceColor,
  type Slice,
} from "../donut";
import { defineRenderer, optBool, type VizRenderProps } from "./types";

/** Slices are the x buckets — a pie declares no series channel, so the pivot
 * already produced exactly one series. */
function slicesOf(p: VizRenderProps) {
  const s = p.pivotResult?.series[0];
  return s ? makeSlices(s.points) : null;
}

defineRenderer("pie", {
  icon: ChartPie,

  legend: (p) => {
    const data = slicesOf(p);
    if (!data) return null;
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
        {data.slices.map((sl: Slice, i: number) => (
          <span
            key={sl.label}
            className="inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-secondary"
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: sliceColor(sl, i) }}
            />
            <span className="max-w-[16ch] truncate">{sl.label}</span>
          </span>
        ))}
        {data.folded > 0 ? (
          <span className="text-ui-sm text-tertiary">
            top {data.slices.length - 1} of {data.slices.length - 1 + data.folded} · rest
            grouped as Other
          </span>
        ) : null}
      </div>
    );
  },

  render: (p) => {
    const data = slicesOf(p);
    if (!data) return null;

    // At tile scale the ring is too thin to carry in-slice labels, so identity
    // moves to a legend beside it — never colour alone.
    if (p.embedded) {
      // Everything here is sized from the box the host gave us. The legend
      // used to be `max-h-full` inside a parent with no definite height, so
      // it grew past the tile and printed itself over the footer.
      const ring = Math.max(64, Math.min(p.height, 160));
      const rows = Math.max(1, Math.floor(p.height / LEGEND_ROW_H));
      return (
        <div className="flex h-full min-h-0 items-center gap-3 overflow-hidden">
          <Donut
            slices={data.slices}
            total={data.total}
            unit={p.unit}
            formatHint={p.formatHint}
            confidenceState={p.confidenceState}
            size={ring}
            className="shrink-0"
          />
          <DonutLegend
            slices={data.slices}
            total={data.total}
            maxRows={rows}
            className="min-w-0 flex-1 overflow-hidden pr-1"
          />
        </div>
      );
    }

    return (
      <Donut
        slices={data.slices}
        total={data.total}
        unit={p.unit}
        formatHint={p.formatHint}
        confidenceState={p.confidenceState}
        showLabels={optBool(p.options, "sliceLabels", true)}
      />
    );
  },
});

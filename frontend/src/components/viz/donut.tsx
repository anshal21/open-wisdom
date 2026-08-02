"use client";

/**
 * Share-of-whole as a donut. A pie is only honest for a categorical dimension
 * and one non-negative measure (the resolver enforces that); this renderer
 * enforces the readability half: slices sorted by share, at most 8 with the
 * remainder folded into "Other", 2px surface gaps between segments, direct
 * labels only on slices big enough to carry them, the total in the hole, and
 * a per-slice hover tooltip. Text wears ink tokens; hue follows the slice.
 */

import * as React from "react";
import { cn } from "@/lib/cn";
import { formatPercent, formatValue } from "@/lib/format";
import type { FormatHint } from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";

export interface Slice {
  label: string;
  value: number;
  isOther?: boolean;
}

export const SLICE_CAP = 8;

/** Sort desc, fold beyond the cap into "Other (n)". Nothing silently dropped. */
export function makeSlices(points: Array<{ x: string; value: number | null }>): {
  slices: Slice[];
  folded: number;
  total: number;
} {
  const real = points
    .filter((p) => p.value !== null && p.value! > 0)
    .map((p) => ({ label: p.x, value: p.value! }))
    .sort((a, b) => b.value - a.value);
  const total = real.reduce((a, s) => a + s.value, 0);
  if (real.length <= SLICE_CAP) return { slices: real, folded: 0, total };
  // Keep the full 8 real slices; "Other" is a gray residual, not a ninth hue.
  const kept = real.slice(0, SLICE_CAP);
  const rest = real.slice(SLICE_CAP);
  return {
    slices: [
      ...kept,
      {
        label: `${residualNoun(kept)} (${rest.length})`,
        value: rest.reduce((a, s) => a + s.value, 0),
        isOther: true,
      },
    ],
    folded: rest.length,
    total,
  };
}

/**
 * What to call the folded remainder.
 *
 * The data can already contain a category called "Other"/"Others" — a
 * question like "top 10 by revenue and rest in others" produces exactly that.
 * Two different rows both reading "Other" is a chart telling the reader two
 * unrelated things share an identity. When the data claims the word, ours
 * takes a different one.
 */
export function residualNoun(kept: Slice[]): string {
  const taken = kept.some((s) => /^others?\b/i.test(s.label.trim()));
  return taken ? "All remaining" : "Other";
}

export function sliceColor(s: Slice, i: number): string {
  return s.isOther ? "var(--viz-annotation)" : `var(--viz-${(i % 8) + 1})`;
}

const SIZE = 220;
const R = 88;
const INNER = 54;

/**
 * Compact slice legend for contexts where direct labels can't fit (embedded
 * tiles). Identity never rides on color alone — every slice gets its name and
 * share here.
 */
export const LEGEND_ROW_H = 18;

export function DonutLegend({
  slices,
  total,
  maxRows,
  className,
}: {
  slices: Slice[];
  total: number;
  /** Rows the host has room for. Beyond it the remainder is SUMMARISED, not
   * scrolled away: a hidden row inside a 100px tile is a row nobody will ever
   * find, and silently dropping it would understate the whole. */
  maxRows?: number;
  className?: string;
}) {
  if (!slices.length || total <= 0) return null;

  const cap = maxRows && maxRows > 0 ? Math.max(1, maxRows) : slices.length;
  const fits = cap >= slices.length;
  // Leave a row for the summary line when one is needed.
  const shown = fits ? slices : slices.slice(0, Math.max(1, cap - 1));
  const hidden = slices.slice(shown.length);
  const hiddenPct = hidden.reduce((a, s) => a + s.value, 0) / total;

  return (
    <ul className={cn("min-w-0 space-y-0.5", className)}>
      {shown.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5 text-ui-sm">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: sliceColor(s, i) }}
          />
          <span className="min-w-0 flex-1 truncate text-secondary">{s.label}</span>
          <span className="shrink-0 tabular text-tertiary">
            {formatPercent((s.value / total) * 100, 0)}
          </span>
        </li>
      ))}
      {hidden.length > 0 ? (
        <li className="flex items-center gap-1.5 text-ui-sm text-tertiary">
          <span className="inline-block h-2 w-2 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            +{hidden.length} more
          </span>
          <span className="shrink-0 tabular">{formatPercent(hiddenPct * 100, 0)}</span>
        </li>
      ) : null}
    </ul>
  );
}

export function Donut({
  slices,
  total,
  unit,
  formatHint,
  confidenceState = "verified",
  size = SIZE,
  showLabels = true,
  className,
}: {
  slices: Slice[];
  total: number;
  unit?: string;
  formatHint: FormatHint;
  /** data-viz.md §6: unverified slices are HATCHED in their own hue (survives
   * greyscale); superseded renders at 55% opacity. Distinct treatments. */
  confidenceState?: ConfidenceState;
  /** Diameter in px — tiles embed at smaller sizes. */
  size?: number;
  /** In-slice % labels; the pie form's `sliceLabels` option. */
  showLabels?: boolean;
  className?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const uid = React.useId();
  const unverified = confidenceState === "unverified";
  const superseded = confidenceState === "superseded";
  if (!slices.length || total <= 0) return null;

  // "percent" only fits values that are actually shares of one whole.
  // A donut's whole must itself be a share for "percent" to fit — a total of
  // 4.4M is not 100%. Stricter than the generic guard, so it stays local.
  const sliceHint: FormatHint =
    formatHint === "percent" && Math.abs(total - 100) > 1 && Math.abs(total - 1) > 0.05
      ? "number"
      : formatHint;

  const scale = size / SIZE;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = R * scale;
  const rInner = INNER * scale;
  // Arcs accumulate clockwise from 12 o'clock. Built by scan rather than by
  // mutating a running angle, so the geometry is a pure function of `slices`.
  const START = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const before = slices.slice(0, i).reduce((a, x) => a + x.value, 0);
    const frac = s.value / total;
    const a0 = START + (before / total) * Math.PI * 2;
    return { s, a0, a1: a0 + frac * Math.PI * 2, frac };
  });

  const point = (a: number, r: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

  const active = hover !== null ? arcs[hover] : null;

  return (
    <div className={cn("relative flex items-center justify-center py-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="block"
        onMouseLeave={() => setHover(null)}
        role="img"
      >
        {unverified ? (
          <defs>
            {arcs.map(({ s }, i) => (
              <pattern
                key={s.label}
                id={`${uid}h${i}`}
                width={6}
                height={6}
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <line x1={0} y1={0} x2={0} y2={6} stroke={sliceColor(s, i)} strokeWidth={2} opacity={0.55} />
              </pattern>
            ))}
          </defs>
        ) : null}
        {arcs.map(({ s, a0, a1, frac }, i) => {
          const [x0, y0] = point(a0, rOuter);
          const [x1, y1] = point(a1, rOuter);
          const [ix1, iy1] = point(a1, rInner);
          const [ix0, iy0] = point(a0, rInner);
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = `M${x0},${y0} A${rOuter},${rOuter} 0 ${large} 1 ${x1},${y1} L${ix1},${iy1} A${rInner},${rInner} 0 ${large} 0 ${ix0},${iy0} Z`;
          // Direct label only when the slice can PHYSICALLY carry it. The
          // 10px glyphs do not scale with the ring; at tile scale a "53%"
          // overflows a thin band and the clipped remainder reads as "3%" —
          // a verified answer visually lying. So: measure, don't hope. The
          // band must clear the glyph height and the mid-band arc must clear
          // the label width, or the label is not drawn (legend + tooltip
          // carry identity instead).
          const mid = (a0 + a1) / 2;
          const rMid = (rOuter + rInner) / 2;
          const [lx, ly] = point(mid, rMid);
          const label = formatPercent(frac * 100, 0);
          // The label is horizontal but the band's orientation rotates around
          // the ring — at 3 and 9 o'clock the text crosses the band radially.
          // So the WIDTH must fit the band (the tightest crossing), not just
          // the arc: min(band, arc) ≥ text width, or no label.
          const labelW = label.length * 6 + 4;
          const labelFits =
            rOuter - rInner >= labelW && frac * 2 * Math.PI * rMid >= labelW + 2;
          return (
            <g key={s.label} opacity={superseded ? 0.55 : 1}>
              <path
                d={d}
                fill={unverified ? `url(#${uid}h${i})` : sliceColor(s, i)}
                stroke="var(--viz-surface)"
                strokeWidth={2}
                opacity={hover === null || hover === i ? 1 : 0.45}
                onMouseEnter={() => setHover(i)}
              />
              {showLabels && frac >= 0.08 && labelFits ? (
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={
                    unverified
                      ? "pointer-events-none fill-[var(--viz-ink-secondary)] text-[10px] font-medium"
                      : "pointer-events-none fill-[var(--viz-surface)] text-[10px] font-medium"
                  }
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* The hole states the whole — a share means nothing without it. The
            answer-level format hint can say "percent" while the sliced measure
            is a raw quantity (a share question sliced by revenue); a percent
            label only fits a total that actually sums to one whole. */}
        <text
          x={cx}
          y={cy - (rInner >= 40 ? 6 : -1)}
          textAnchor="middle"
          dominantBaseline={rInner >= 40 ? undefined : "middle"}
          fontSize={Math.max(11, Math.round(14 * Math.min(1, scale)))}
          className="fill-[var(--viz-ink-primary)] font-semibold tabular-nums"
        >
          {formatValue(total, sliceHint, { unit, abbreviate: true })}
        </text>
        {rInner >= 40 ? (
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            className="fill-[var(--viz-ink-muted)] text-[10px]"
          >
            total
          </text>
        ) : null}
      </svg>

      {unverified ? (
        <span className="pointer-events-none absolute left-1 top-1 rounded-sm border border-unverified-border bg-unverified-bg px-1.5 py-0.5 text-ui-sm text-secondary">
          ○ Unverified
        </span>
      ) : null}
      {active ? (
        <div className="pointer-events-none absolute right-2 top-2 min-w-[140px] rounded-md border border-border-default bg-surface-1 px-2.5 py-2 shadow-md">
          <div className="flex items-center gap-1.5 text-ui-sm">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: sliceColor(active.s, hover!) }}
            />
            <span className="min-w-0 flex-1 truncate text-secondary">{active.s.label}</span>
          </div>
          <p className="mt-0.5 text-ui-sm tabular text-primary">
            {formatValue(active.s.value, sliceHint, { unit })} ·{" "}
            {formatPercent(active.frac * 100, 1)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

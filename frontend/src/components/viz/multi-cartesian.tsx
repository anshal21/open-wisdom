"use client";

/**
 * The n-series cartesian: lines, areas, grouped columns, scatter.
 *
 * Mark specs follow the dataviz method: 2px lines, thin columns with a 2px
 * surface gap inside a group, hues assigned by series order from the eight
 * fixed tokens (never cycled — the pivot already folded the excess into
 * "Other", which renders in the annotation gray because it is not an entity).
 * A legend is always present for ≥2 series; ≤4 series also get direct labels
 * at the line end. Hover is a crosshair + tooltip listing every series at the
 * bucket. Text wears ink tokens, never the series color.
 */

import * as React from "react";
import { cn } from "@/lib/cn";
import { effectiveHint, formatValue } from "@/lib/format";
import type { FormatHint } from "@/lib/api/types";
import type { PivotResult, VizSeries } from "@/lib/viz/series";
import { stack, stackMax } from "@/lib/viz/series";
import type { ConfidenceState } from "@/lib/confidence";
import { temporalLabel } from "@/lib/viz/labels";
import { band, domainFor, linear } from "@/components/charts/scales";

const H = 220;
const M = { top: 12, right: 16, bottom: 24, left: 48 };
const OTHER_COLOR = "var(--viz-annotation)";

export type CartesianKind = "line" | "area" | "column" | "scatter";

function seriesColor(s: VizSeries, i: number): string {
  return s.isOther ? OTHER_COLOR : `var(--viz-${(i % 8) + 1})`;
}

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(640);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function MultiCartesian({
  pivotResult,
  kind,
  temporalX,
  unit,
  formatHint,
  confidenceState = "verified",
  height = H,
  stacking = "none",
  valueLabels = false,
  markers = false,
  pointSize = 3,
  className,
}: {
  pivotResult: PivotResult;
  kind: CartesianKind;
  temporalX: boolean;
  unit?: string;
  formatHint: FormatHint;
  /** Cumulative bands instead of side-by-side; "100%" normalises each bucket. */
  stacking?: "none" | "stacked" | "100%";
  valueLabels?: boolean;
  markers?: boolean;
  pointSize?: number;
  /** Drives the mark treatment — data-viz.md §6: unverified marks are HATCHED
   * or dashed (survives greyscale/print); superseded marks render at 55%
   * opacity (the header carries its chip + Re-run). These are distinct states
   * and must never share a treatment. */
  confidenceState?: ConfidenceState;
  /** Plot height in px — tiles embed at smaller sizes. */
  height?: number;
  className?: string;
}) {
  const { xLabels, series, xEpochs } = pivotResult;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const unverified = confidenceState === "unverified";
  const superseded = confidenceState === "superseded";
  const uid = React.useId();
  const dim = superseded ? 0.55 : 1;

  const innerW = Math.max(80, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;

  const displayLabels = React.useMemo(
    () => xLabels.map((x) => (temporalX ? temporalLabel(x) : x)),
    [xLabels, temporalX],
  );

  const isColumn = kind === "column";
  const stacked = stacking !== "none" && series.length > 1;
  const bands = stacked ? stack(series, xLabels.length, stacking as "stacked" | "100%") : null;

  const allValues = series.flatMap((s) => s.points.map((p) => p.value ?? NaN));
  const domain: [number, number] = bands
    ? [0, stacking === "100%" ? 100 : stackMax(bands)]
    : domainFor(allValues, kind === "column");
  const y = linear(domain, [M.top + innerH, M.top], 4);
  // The answer-level hint describes the headline, not this series: a share
  // question sliced by raw revenue would print an axis reading "2000000%".
  const valueHint: FormatHint = effectiveHint(formatHint, allValues);
  // A 100% stack is a share of each bucket's own whole — the axis says so.
  const axisHint: FormatHint = stacking === "100%" && bands ? "percent" : valueHint;
  const x = band(xLabels.length, [M.left, M.left + innerW], isColumn ? 0.35 : 0);

  // A temporal axis is placed on a TIME scale, so unequal gaps carry
  // information: Jan→Feb→Dec must not draw as three equal steps. Only when
  // every bucket parsed, and only for continuous forms — a column band is
  // categorical by construction. (B9)
  const timeScale =
    !isColumn && xEpochs && xEpochs.length > 1 && xEpochs[xEpochs.length - 1] > xEpochs[0]
      ? { t0: xEpochs[0], span: xEpochs[xEpochs.length - 1] - xEpochs[0] }
      : null;

  const cx = (i: number) =>
    isColumn
      ? x(i) + x.bandwidth / 2
      : timeScale && xEpochs
        ? M.left + ((xEpochs[i] - timeScale.t0) / timeScale.span) * innerW
        : M.left + (xLabels.length <= 1 ? innerW / 2 : (i / (xLabels.length - 1)) * innerW);

  // Column geometry: series side by side inside the band, 2px surface gaps.
  const GAP = 2;
  const barW = stacked
    ? x.bandwidth
    : Math.max(2, (x.bandwidth - GAP * (series.length - 1)) / Math.max(1, series.length));

  const zeroY = y(Math.max(domain[0], 0));
  const tickStep = Math.max(1, Math.ceil(xLabels.length / Math.max(2, Math.floor(innerW / 72))));

  const directLabels = series.length >= 2 && series.length <= 4 && !isColumn;

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${Math.max(width, 1)} ${height}`}
        className="block overflow-visible"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (xLabels.length === 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          let i: number;
          if (isColumn) {
            i = Math.max(0, Math.min(xLabels.length - 1, Math.floor((px - M.left) / x.step)));
          } else if (timeScale) {
            // Nearest bucket by pixel distance — with unequal gaps, "closest"
            // is not "proportional".
            let best = 0;
            let bestD = Infinity;
            for (let k = 0; k < xLabels.length; k++) {
              const d = Math.abs(cx(k) - px);
              if (d < bestD) {
                bestD = d;
                best = k;
              }
            }
            i = best;
          } else {
            i = Math.max(
              0,
              Math.min(
                xLabels.length - 1,
                Math.round(((px - M.left) / innerW) * (xLabels.length - 1)),
              ),
            );
          }
          setHover(i);
        }}
      >
        {unverified ? (
          <defs>
            {series.map((s, si) => (
              <pattern
                key={s.key}
                id={`${uid}h${si}`}
                width={6}
                height={6}
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <line x1={0} y1={0} x2={0} y2={6} stroke={seriesColor(s, si)} strokeWidth={2} opacity={0.55} />
              </pattern>
            ))}
          </defs>
        ) : null}

        {/* Horizontal grid only, hairline, recessive. */}
        {y.ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={M.left + innerW}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-[var(--viz-ink-muted)] text-[10px] tabular-nums"
            >
              {formatValue(t, axisHint, { unit, abbreviate: true })}
            </text>
          </g>
        ))}
        <line
          x1={M.left}
          x2={M.left + innerW}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--viz-baseline)"
          strokeWidth={1}
        />

        {/* Crosshair under the marks. */}
        {hover !== null && !isColumn ? (
          <line
            x1={cx(hover)}
            x2={cx(hover)}
            y1={M.top}
            y2={M.top + innerH}
            stroke="var(--viz-baseline)"
            strokeWidth={1}
          />
        ) : null}

        {/* Marks, one pass per series; hue follows the series, never its rank
            at render time — order was fixed by the pivot. */}
        {series.map((s, si) => {
          const color = seriesColor(s, si);
          if (isColumn) {
            return (
              <g key={s.key} opacity={dim}>
                {s.points.map((p, i) => {
                  if (p.value === null) return null;
                  // Stacked: the segment spans its own cumulative band, with a
                  // 2px surface gap so adjacent segments never bleed together.
                  const b = bands?.[si]?.[i];
                  const top = b ? y(b.y1) : Math.min(y(p.value), zeroY);
                  const bottom = b ? y(b.y0) : zeroY;
                  const rawH = Math.abs(bottom - top);
                  const h = b ? Math.max(0, rawH - (rawH > 3 ? 2 : 0)) : Math.max(1, rawH);
                  if (h <= 0) return null;
                  return (
                    <rect
                      key={i}
                      x={x(i) + (stacked ? 0 : si * (barW + GAP))}
                      y={top}
                      width={barW}
                      height={h}
                      rx={Math.min(3, barW / 2)}
                      fill={unverified ? `url(#${uid}h${si})` : color}
                      stroke={unverified ? color : undefined}
                      strokeWidth={unverified ? 1 : undefined}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  );
                })}
                {/* Value labels replace the axis when few enough to read. */}
                {valueLabels && !stacked
                  ? s.points.map((p, i) =>
                      p.value === null ? null : (
                        <text
                          key={`v${i}`}
                          x={x(i) + si * (barW + GAP) + barW / 2}
                          y={Math.min(y(p.value), zeroY) - 4}
                          textAnchor="middle"
                          className="fill-[var(--viz-ink-secondary)] text-[10px] tabular-nums"
                        >
                          {formatValue(p.value, valueHint, { unit, abbreviate: true })}
                        </text>
                      ),
                    )
                  : null}
              </g>
            );
          }
          if (kind === "scatter") {
            return (
              <g key={s.key} opacity={dim}>
                {s.points.map((p, i) =>
                  p.value === null ? null : (
                    <circle
                      key={i}
                      cx={cx(i)}
                      cy={y(p.value)}
                      r={pointSize}
                      fill={unverified ? "var(--viz-surface)" : color}
                      stroke={unverified ? color : undefined}
                      strokeWidth={unverified ? 1.5 : undefined}
                    />
                  ),
                )}
              </g>
            );
          }
          // line / area: segments break on null gaps rather than bridging them.
          const segs: string[] = [];
          let d = "";
          s.points.forEach((p, i) => {
            if (p.value === null) {
              if (d) segs.push(d);
              d = "";
              return;
            }
            d += `${d ? "L" : "M"}${cx(i)},${y(p.value)}`;
          });
          if (d) segs.push(d);
          return (
            <g key={s.key} opacity={dim}>
              {kind === "area" && bands ? (
                /* Stacked band: the ribbon between this series' lower and
                   upper cumulative edges. Reading the upper edge of an
                   overlaid area is the mistake stacking exists to prevent. */
                <path
                  d={bandPath(bands[si], cx, y, s.points.length)}
                  fill={unverified ? `url(#${uid}h${si})` : color}
                  opacity={unverified ? 1 : 0.5}
                  stroke="var(--viz-surface)"
                  strokeWidth={1}
                />
              ) : kind === "area" ? (
                segs.map((seg, i) => (
                  <path
                    key={`a${i}`}
                    d={`${seg}L${cx(s.points.length - 1)},${zeroY}L${cx(0)},${zeroY}Z`}
                    fill={unverified ? `url(#${uid}h${si})` : color}
                    opacity={unverified ? 1 : 0.12}
                  />
                ))
              ) : null}
              {bands && kind === "area"
                ? null
                : segs.map((seg, i) => (
                    <path
                      key={i}
                      d={seg}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeDasharray={unverified ? "6 4" : undefined}
                    />
                  ))}
              {markers && !bands
                ? s.points.map((p, i) =>
                    p.value === null ? null : (
                      <circle
                        key={`m${i}`}
                        cx={cx(i)}
                        cy={y(p.value)}
                        r={3}
                        fill={color}
                        stroke="var(--viz-surface)"
                        strokeWidth={1.5}
                      />
                    ),
                  )
                : null}
              {hover !== null && s.points[hover]?.value !== null ? (
                <circle
                  cx={cx(hover)}
                  cy={y(s.points[hover].value!)}
                  r={4}
                  fill={color}
                  stroke="var(--viz-surface)"
                  strokeWidth={2}
                />
              ) : null}
              {directLabels && lastIdx(s) >= 0 ? (
                <text
                  x={cx(lastIdx(s)) + 6}
                  y={y(s.points[lastIdx(s)].value!)}
                  dominantBaseline="middle"
                  className="fill-[var(--viz-ink-secondary)] text-[10px]"
                >
                  {truncate(s.label, 16)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* X ticks, thinned to available width. */}
        {displayLabels.map((label, i) =>
          i % tickStep !== 0 ? null : (
            <text
              key={i}
              x={cx(i)}
              y={height - 6}
              textAnchor="middle"
              className="fill-[var(--viz-ink-muted)] text-[10px]"
            >
              {truncate(label, 12)}
            </text>
          ),
        )}
      </svg>

      {/* data-viz.md §6: the unverified chip lives ON the plot, not in the
          header — a screenshot of the plot alone must still carry the state. */}
      {unverified ? (
        <span className="pointer-events-none absolute right-2 top-1 rounded-sm border border-unverified-border bg-unverified-bg px-1.5 py-0.5 text-ui-sm text-secondary">
          ○ Unverified
        </span>
      ) : null}

      {/* Tooltip: the hovered bucket, every series' value, ink tokens only. */}
      {hover !== null ? (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[140px] rounded-md border border-border-default bg-surface-1 px-2.5 py-2 shadow-md"
          style={{
            left: Math.min(Math.max(cx(hover) + 10, M.left), Math.max(width - 170, M.left)),
          }}
        >
          <p className="text-ui-sm font-medium text-primary">{displayLabels[hover]}</p>
          <div className="mt-1 space-y-0.5">
            {series.map((s, si) => (
              <div key={s.key} className="flex items-center gap-1.5 text-ui-sm">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: seriesColor(s, si) }}
                />
                <span className="min-w-0 flex-1 truncate text-secondary">{s.label}</span>
                <span className="tabular text-primary">
                  {s.points[hover].value === null
                    ? "—"
                    : formatValue(s.points[hover].value, valueHint, { unit })}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Legend: always rendered by the caller for ≥2 series. Color chip + ink text. */
export function VizLegend({ series, folded, seriesTotal }: PivotResult & { className?: string }) {
  if (series.length < 2) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
      {series.map((s, si) => (
        <span key={s.key} className="inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-secondary">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: seriesColor(s, si) }}
          />
          <span className="max-w-[16ch] truncate">{s.label}</span>
        </span>
      ))}
      {folded > 0 ? (
        <span className="text-ui-sm text-tertiary">
          top {series.length - 1} of {seriesTotal} · rest grouped as Other
        </span>
      ) : null}
    </div>
  );
}

/** The closed ribbon between a stacked series' lower and upper edges. */
function bandPath(
  band: Array<{ y0: number; y1: number }>,
  cx: (i: number) => number,
  y: (v: number) => number,
  n: number,
): string {
  const top = band.slice(0, n).map((b, i) => `${i ? "L" : "M"}${cx(i)},${y(b.y1)}`).join("");
  const bottom = band
    .slice(0, n)
    .map((b, i) => ({ b, i }))
    .reverse()
    .map(({ b, i }) => `L${cx(i)},${y(b.y0)}`)
    .join("");
  return `${top}${bottom}Z`;
}

function lastIdx(s: VizSeries): number {
  for (let i = s.points.length - 1; i >= 0; i--) if (s.points[i].value !== null) return i;
  return -1;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/* ------------------------------------------------------------- horizontal */

const HM = { top: 8, right: 44, bottom: 22, left: 8 };
/** A bar thicker than this stops reading as a bar and starts reading as a block. */
const MAX_THICK = 32;
/** Any non-zero value must be visible — a 1px sliver is a rounding error. */
const MIN_LEN = 2;

/**
 * Horizontal bars: categories on y with room for their full labels, values on
 * x. This is the form data-viz.md:24 requires past ~12 categories or when the
 * labels are long — the case where vertical columns truncate three different
 * categories to the same string.
 *
 * Sorted descending by default, because a ranked question deserves a ranked
 * picture; the bar plugin's `sort` option overrides.
 */
export function HorizontalBars({
  pivotResult,
  unit,
  formatHint,
  confidenceState = "verified",
  height = H,
  valueLabels = true,
  className,
}: {
  pivotResult: PivotResult;
  unit?: string;
  formatHint: FormatHint;
  confidenceState?: ConfidenceState;
  height?: number;
  valueLabels?: boolean;
  className?: string;
}) {
  const { xLabels, series } = pivotResult;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const unverified = confidenceState === "unverified";
  const superseded = confidenceState === "superseded";
  const uid = React.useId();

  // Only the first measure draws; a grouped horizontal bar is unreadable and
  // the switcher offers vertical columns for that case.
  const s = series[0];
  const values = xLabels.map((_, i) => s?.points[i]?.value ?? null);

  // The label gutter is sized to the longest label, capped so the bars keep
  // at least half the width.
  const longest = xLabels.reduce((a, l) => Math.max(a, l.length), 0);
  const gutter = Math.min(Math.max(64, longest * 6.2), Math.max(80, width * 0.38));
  const innerW = Math.max(40, width - gutter - HM.right);

  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const max = finite.length ? Math.max(...finite, 0) : 1;
  const min = finite.length ? Math.min(...finite, 0) : 0;
  const span = max - min || 1;
  const lenOf = (v: number) => Math.max(v === 0 ? 0 : MIN_LEN, (Math.abs(v) / span) * innerW);

  const rowH = Math.max(14, Math.min(MAX_THICK + 8, (height - HM.top - HM.bottom) / Math.max(1, xLabels.length)));
  const thick = Math.min(MAX_THICK, rowH - 6);
  const svgH = Math.max(height, HM.top + HM.bottom + rowH * xLabels.length);

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <svg
        width="100%"
        height={svgH}
        viewBox={`0 0 ${Math.max(width, 1)} ${svgH}`}
        className="block overflow-visible"
        onMouseLeave={() => setHover(null)}
        role="img"
      >
        {unverified ? (
          <defs>
            <pattern
              id={`${uid}hb`}
              width={6}
              height={6}
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <line x1={0} y1={0} x2={0} y2={6} stroke="var(--viz-1)" strokeWidth={2} opacity={0.55} />
            </pattern>
          </defs>
        ) : null}

        <line
          x1={gutter}
          x2={gutter}
          y1={HM.top}
          y2={HM.top + rowH * xLabels.length}
          stroke="var(--viz-baseline)"
          strokeWidth={1}
        />

        {xLabels.map((label, i) => {
          const v = values[i];
          const yTop = HM.top + i * rowH + (rowH - thick) / 2;
          const len = v === null ? 0 : lenOf(v);
          return (
            <g
              key={label}
              opacity={superseded ? 0.55 : 1}
              onMouseEnter={() => setHover(i)}
            >
              <text
                x={gutter - 8}
                y={yTop + thick / 2}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-[var(--viz-ink-secondary)] text-[10px]"
              >
                {truncate(label, Math.max(8, Math.floor(gutter / 6.2)))}
              </text>
              {v === null ? null : (
                <path
                  d={barPath(gutter, yTop, len, thick)}
                  fill={unverified ? `url(#${uid}hb)` : "var(--viz-1)"}
                  stroke={unverified ? "var(--viz-1)" : undefined}
                  strokeWidth={unverified ? 1 : undefined}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {valueLabels && v !== null ? (
                <text
                  x={gutter + len + 6}
                  y={yTop + thick / 2}
                  dominantBaseline="middle"
                  className="fill-[var(--viz-ink-muted)] text-[10px] tabular-nums"
                >
                  {formatValue(v, formatHint, { unit, abbreviate: true })}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {unverified ? (
        <span className="pointer-events-none absolute right-2 top-1 rounded-sm border border-unverified-border bg-unverified-bg px-1.5 py-0.5 text-ui-sm text-secondary">
          ○ Unverified
        </span>
      ) : null}
    </div>
  );
}

/**
 * Rounded on the DATA end only — the baseline end stays square, because a
 * rounded baseline detaches the bar from the axis it is measured against.
 */
function barPath(x: number, y: number, len: number, thick: number): string {
  const r = Math.min(4, len, thick / 2);
  if (len <= r) return `M${x},${y}h${len}v${thick}h${-len}Z`;
  return `M${x},${y}h${len - r}a${r},${r} 0 0 1 ${r},${r}v${thick - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(len - r)}Z`;
}

"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { abbreviate, formatValue } from "@/lib/format";
import type {
  Cell,
  Check,
  ChartSpec,
  FormatHint,
  ResultColumn,
} from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";
import { ChartFrame, HatchDefs } from "./chart-frame";
import { areaPath, band, barPath, barThickness, domainFor, linear, path } from "./scales";

const H = 200;
const M = { top: 10, right: 16, bottom: 24, left: 48 };

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Calendar label for a temporal bucket: month buckets read "Jan 23", day
 * buckets "5 Mar", years "2023". Falls back to the raw string when the cell
 * is not a parseable timestamp.
 */
function temporalLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Timestamps are UTC wall-clock; render in UTC so a bucket never shifts.
  if (d.getUTCDate() === 1 && d.getUTCHours() === 0) {
    return `${MONTH_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  }
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
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

export interface AnswerChartProps {
  spec: ChartSpec;
  columns: ResultColumn[];
  rows: Cell[][];
  /** Required on every chart. */
  confidenceState: ConfidenceState;
  checks: Check[];
  passed?: number;
  total?: number;
  caveat?: string;
  unit?: string;
  formatHint?: FormatHint;
  title?: string;
  onRerun?: () => void;
  /** A mark click appends a filter chip on the parent answer and re-runs. */
  onDrilldown?: (column: string, value: string) => void;
  className?: string;
}

export function AnswerChart(props: AnswerChartProps) {
  const {
    spec,
    columns,
    rows,
    confidenceState,
    checks,
    passed,
    total,
    caveat,
    unit,
    formatHint = "number",
    title,
    onRerun,
    onDrilldown,
    className,
  } = props;

  // Scalar and table specs carry no x axis; there is nothing to plot here and
  // the callers that own those shapes render them differently.
  const x = spec.x;

  const xIdx = columns.findIndex((c) => c.name === x?.field);
  const yIdx = columns.findIndex((c) => c.name === spec.y[0]?.field);

  const temporalX = x?.type === "temporal";
  const points = React.useMemo(
    () =>
      rows
        .map((r) => ({
          // A temporal axis gets calendar labels; the raw cell is an RFC3339
          // timestamp and would print as one.
          label: temporalX ? temporalLabel(String(r[xIdx] ?? "")) : String(r[xIdx] ?? ""),
          value: Number(r[yIdx] ?? 0),
        }))
        .filter((p) => Number.isFinite(p.value)),
    [rows, xIdx, yIdx, temporalX],
  );

  const horizontal = spec.type === "bar" && x?.type === "nominal";
  const unverified = confidenceState === "unverified";
  const superseded = confidenceState === "superseded";

  const ariaLabel = React.useMemo(() => {
    if (points.length === 0) return `${spec.y[0]?.label ?? "Chart"} — no data`;
    const first = points[0];
    const last = points[points.length - 1];
    const max = points.reduce((a, b) => (b.value > a.value ? b : a));
    return `${spec.y[0]?.label ?? "Value"} by ${x?.label ?? "category"}. ${points.length} points from ${first.label} at ${formatValue(first.value, formatHint, { unit })} to ${last.label} at ${formatValue(last.value, formatHint, { unit })}. Highest is ${max.label} at ${formatValue(max.value, formatHint, { unit })}.${unverified ? " This series is unverified." : ""}`;
  }, [points, spec, formatHint, unit, unverified]);

  return (
    <ChartFrame
      title={title}
      confidenceState={confidenceState}
      checks={checks}
      passed={passed}
      total={total}
      caveat={caveat}
      coverage={spec.coverage}
      columns={columns}
      rows={rows}
      formatHint={formatHint}
      unit={unit}
      onRerun={onRerun}
      ariaLabel={ariaLabel}
      className={className}
    >
      {horizontal ? (
        <HorizontalBars
          points={points}
          unit={unit}
          formatHint={formatHint}
          unverified={unverified}
          superseded={superseded}
          onDrilldown={onDrilldown ? (v) => onDrilldown(x!.field, v) : undefined}
        />
      ) : (
        <Cartesian
          points={points}
          type={spec.type === "area" ? "area" : spec.type === "line" ? "line" : "column"}
          unit={unit}
          formatHint={formatHint}
          yLabel={spec.y[0]?.label ?? ""}
          unverified={unverified}
          superseded={superseded}
          onDrilldown={onDrilldown ? (v) => onDrilldown(x!.field, v) : undefined}
        />
      )}
    </ChartFrame>
  );
}

/* ---------------------------------------------------------------------------
   Vertical: line / area / column
--------------------------------------------------------------------------- */

function Cartesian({
  points,
  type,
  unit,
  formatHint,
  yLabel,
  unverified,
  superseded,
  onDrilldown,
}: {
  points: Array<{ label: string; value: number }>;
  type: "line" | "area" | "column";
  unit?: string;
  formatHint: FormatHint;
  yLabel: string;
  unverified: boolean;
  superseded: boolean;
  onDrilldown?: (v: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const hatchId = React.useId();

  const innerW = Math.max(80, width - M.left - M.right);
  const innerH = H - M.top - M.bottom;

  // Axis domain is fixed before the first mark paints.
  const domain = domainFor(
    points.map((p) => p.value),
    type === "column",
  );
  const y = linear(domain, [M.top + innerH, M.top], 4);
  const x = band(points.length, [M.left, M.left + innerW], type === "column" ? 0.4 : 0);
  const cx = (i: number) =>
    type === "column" ? x(i) + x.bandwidth / 2 : M.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);

  const coords: Array<[number, number]> = points.map((p, i) => [cx(i), y(p.value)]);
  const zeroY = y(Math.max(domain[0], 0));

  const tickIdx = labelIndices(points.length, innerW);

  const active = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${Math.max(width, 1)} ${H}`}
        className="block overflow-visible"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          if (points.length === 0) return;
          const i =
            type === "column"
              ? Math.max(0, Math.min(points.length - 1, Math.floor((px - M.left) / x.step)))
              : Math.max(
                  0,
                  Math.min(
                    points.length - 1,
                    Math.round(((px - M.left) / innerW) * (points.length - 1)),
                  ),
                );
          setHover(i);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            setHover((h) => Math.max(0, (h ?? points.length) - 1));
          }
        }}
      >
        <HatchDefs id={hatchId} color="var(--viz-1)" />

        {/* Horizontal grid only, hairline. */}
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
              className="axis-tick"
              fontSize={11}
              fill="var(--viz-ink-muted)"
            >
              {formatValue(t, formatHint, { unit, abbreviate: true })}
            </text>
          </g>
        ))}

        {/* Baseline is visible; the opposite axis line is not. */}
        <line
          x1={M.left}
          x2={M.left + innerW}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--viz-baseline)"
          strokeWidth={1}
        />

        {type === "column"
          ? points.map((p, i) => {
              const t = barThickness(x.step);
              const bx = cx(i) - t / 2;
              const top = Math.min(y(p.value), zeroY);
              const h = Math.abs(zeroY - y(p.value));
              return (
                <path
                  key={i}
                  d={barPath(bx, top, t, Math.max(h, 1), 4, "up")}
                  fill={unverified ? `url(#${hatchId})` : "var(--viz-1)"}
                  stroke={unverified ? "var(--viz-1)" : "none"}
                  strokeWidth={unverified ? 1 : 0}
                  opacity={superseded ? 0.55 : hover !== null && hover !== i ? 0.55 : 1}
                  className={onDrilldown ? "cursor-pointer" : undefined}
                  onClick={() => onDrilldown?.(p.label)}
                />
              );
            })
          : null}

        {type === "area" ? (
          <path
            d={areaPath(coords, zeroY)}
            fill="var(--viz-1)"
            fillOpacity={unverified ? 0 : 0.12}
          />
        ) : null}

        {type !== "column" ? (
          <path
            d={path(coords)}
            fill="none"
            stroke="var(--viz-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={unverified ? "6 4" : undefined}
            opacity={superseded ? 0.55 : 1}
          />
        ) : null}

        {/* Last point marker. */}
        {type !== "column" && coords.length > 0 ? (
          <circle
            cx={coords[coords.length - 1][0]}
            cy={coords[coords.length - 1][1]}
            r={3}
            fill="var(--viz-1)"
          />
        ) : null}

        {/* Crosshair. */}
        {hover !== null && type !== "column" ? (
          <>
            <line
              x1={cx(hover)}
              x2={cx(hover)}
              y1={M.top}
              y2={M.top + innerH}
              stroke="var(--viz-annotation)"
              strokeWidth={1}
            />
            <circle
              cx={cx(hover)}
              cy={y(points[hover].value)}
              r={4}
              fill="var(--viz-surface)"
              stroke="var(--viz-1)"
              strokeWidth={2}
            />
          </>
        ) : null}

        {/* X labels — never rotated. */}
        {tickIdx.map((i) => (
          <text
            key={i}
            x={cx(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fontSize={11}
            className="axis-tick"
            fill="var(--viz-ink-muted)"
          >
            {shortLabel(points[i].label)}
          </text>
        ))}
      </svg>

      {unverified ? <UnverifiedChip /> : null}
      {superseded ? <SupersededChip /> : null}

      {active ? (
        <Tooltip
          left={cx(hover!)}
          top={type === "column" ? y(active.value) : y(active.value)}
          label={active.label}
          value={formatValue(active.value, formatHint, { unit })}
          series={yLabel}
        />
      ) : null}

      <span aria-live="polite" className="sr-only">
        {active ? `${active.label}: ${formatValue(active.value, formatHint, { unit })}` : ""}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Horizontal bars — nominal categories, sorted descending
--------------------------------------------------------------------------- */

function HorizontalBars({
  points,
  unit,
  formatHint,
  unverified,
  superseded,
  onDrilldown,
}: {
  points: Array<{ label: string; value: number }>;
  unit?: string;
  formatHint: FormatHint;
  unverified: boolean;
  superseded: boolean;
  onDrilldown?: (v: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const hatchId = React.useId();
  const [hover, setHover] = React.useState<number | null>(null);

  const sorted = React.useMemo(
    () => [...points].sort((a, b) => b.value - a.value),
    [points],
  );
  const max = Math.max(...sorted.map((p) => p.value), 1);
  const labelW = Math.min(180, Math.max(90, Math.round(width * 0.24)));
  const valueW = 92;
  const trackW = Math.max(40, width - labelW - valueW - 12);
  const rowH = 28;

  return (
    <div ref={ref} className="w-full">
      <ul className="flex flex-col">
        {sorted.map((p, i) => {
          const w = Math.max(2, (p.value / max) * trackW);
          return (
            <li
              key={p.label}
              style={{ height: rowH }}
              className="flex items-center gap-3"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                style={{ width: labelW }}
                className="truncate text-ui-sm text-secondary"
                title={p.label}
              >
                {p.label}
              </span>
              <svg
                width={trackW}
                height={18}
                className={cn("shrink-0", onDrilldown && "cursor-pointer")}
                onClick={() => onDrilldown?.(p.label)}
              >
                <HatchDefs id={`${hatchId}-${i}`} color="var(--viz-1)" />
                <path
                  d={barPath(0, 3, w, 12, 4, "right")}
                  fill={unverified ? `url(#${hatchId}-${i})` : "var(--viz-1)"}
                  stroke={unverified ? "var(--viz-1)" : "none"}
                  strokeWidth={unverified ? 1 : 0}
                  opacity={superseded ? 0.55 : hover !== null && hover !== i ? 0.55 : 1}
                />
              </svg>
              {/* ≤8 bars: label every bar and drop the value axis entirely. */}
              <span
                style={{ width: valueW }}
                className="text-right text-ui-sm tabular text-primary"
              >
                {formatValue(p.value, formatHint, { unit })}
              </span>
            </li>
          );
        })}
      </ul>
      {unverified ? <UnverifiedChip /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Shared bits
--------------------------------------------------------------------------- */

function UnverifiedChip() {
  return (
    <span className="absolute top-2 right-2 inline-flex h-5 items-center gap-1 rounded-xs border border-dashed border-unverified-border bg-unverified-bg px-1.5 text-label text-unverified uppercase">
      Unverified
    </span>
  );
}

function SupersededChip() {
  return (
    <span className="absolute top-2 right-2 inline-flex h-5 items-center gap-1 rounded-xs border border-dotted border-unverified-border bg-unverified-bg px-1.5 text-label text-unverified uppercase">
      Superseded
    </span>
  );
}

function Tooltip({
  left,
  top,
  label,
  value,
  series,
}: {
  left: number;
  top: number;
  label: string;
  value: string;
  series: string;
}) {
  return (
    <div
      style={{ left, top: top - 12, transform: "translate(-50%, -100%)" }}
      className="pointer-events-none absolute z-10 rounded-md border border-border-default bg-surface-3 px-2.5 py-2 shadow-overlay"
    >
      <p className="text-ui-sm font-medium text-primary">{label}</p>
      <p className="mt-0.5 flex items-center gap-2 text-ui-sm text-secondary">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-[2px]"
          style={{ backgroundColor: "var(--viz-1)" }}
        />
        {series}
        <span className="ml-2 tabular text-primary">{value}</span>
      </p>
    </div>
  );
}

function labelIndices(n: number, width: number): number[] {
  if (n === 0) return [];
  const max = Math.max(2, Math.floor(width / 72));
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

function shortLabel(v: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mon = months[Number(m[2]) - 1] ?? m[2];
    return m[3] ? `${Number(m[3])} ${mon}` : `${mon} ${m[1].slice(2)}`;
  }
  return v.length > 12 ? `${v.slice(0, 11)}…` : v;
}

/* ---------------------------------------------------------------------------
   Sparkline — no axes, no grid, no labels
--------------------------------------------------------------------------- */

export function Sparkline({
  values,
  width = 64,
  height = 20,
  unverified = false,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  unverified?: boolean;
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts: Array<[number, number]> = values.map((v, i) => [
    (i / (values.length - 1)) * (width - 3) + 1.5,
    height - 2 - ((v - min) / span) * (height - 4),
  ]);
  const last = pts[pts.length - 1];
  return (
    <svg
      width={width}
      height={height}
      className={cn("block shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d={path(pts)}
        fill="none"
        stroke="var(--viz-1)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={unverified ? "4 3" : undefined}
      />
      <circle cx={last[0]} cy={last[1]} r={2} fill="var(--viz-1)" />
    </svg>
  );
}

export { abbreviate };

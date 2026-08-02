"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { abbreviate, formatCount, formatMultiple, formatValue } from "@/lib/format";
import type { AmbiguityCandidate, FormatHint, Spread } from "@/lib/api/types";
import { path } from "./scales";

/* ---------------------------------------------------------------------------
   7.1 The spread bar — converts "these are different" into "this different"
--------------------------------------------------------------------------- */

export function SpreadBar({
  candidates,
  spread,
  unit,
  formatHint = "currency",
  selectedId,
  onSelect,
  className,
}: {
  candidates: AmbiguityCandidate[];
  spread: Spread;
  unit?: string;
  formatHint?: FormatHint;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(720);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // If the spread exceeds 5x, switch to a log scale — and say so.
  const log = spread.log_scaled || spread.ratio > 5;
  const pad = 72;
  const inner = Math.max(120, w - pad * 2);
  const lo = spread.min * 0.9;
  const hi = spread.max * 1.1;

  const project = (v: number) => {
    if (log) {
      const a = Math.log10(Math.max(lo, 1));
      const b = Math.log10(Math.max(hi, 10));
      return pad + ((Math.log10(Math.max(v, 1)) - a) / (b - a || 1)) * inner;
    }
    return pad + ((v - lo) / (hi - lo || 1)) * inner;
  };

  const sorted = [...candidates].sort((a, b) => a.value - b.value);
  const recommendedId = candidates.find((c) => c.recommendation_basis)?.id;

  return (
    <div ref={ref} className={cn("w-full", className)}>
      <p className="mb-2 text-subtitle text-accent">
        {formatMultiple(spread.ratio)} spread
        {log ? (
          <span className="ml-2 text-label text-tertiary uppercase">log scale</span>
        ) : null}
      </p>
      <div className="relative" style={{ height: 56 }}>
        <svg width="100%" height={56} viewBox={`0 0 ${Math.max(w, 1)} 56`} aria-hidden="true">
          <line
            x1={pad - 12}
            x2={pad + inner + 12}
            y1={38}
            y2={38}
            stroke="var(--viz-baseline)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          {sorted.map((c) => {
            const cx = project(c.value);
            const isRec = c.id === recommendedId;
            const isSel = c.id === selectedId;
            return (
              <g key={c.id}>
                <line
                  x1={cx}
                  x2={cx}
                  y1={30}
                  y2={46}
                  stroke="var(--viz-1)"
                  strokeWidth={isSel ? 2 : 1}
                  opacity={isSel ? 1 : 0.4}
                />
                <circle
                  cx={cx}
                  cy={38}
                  r={isRec || isSel ? 6 : 5}
                  fill="var(--viz-1)"
                  stroke="var(--viz-surface)"
                  strokeWidth={2}
                  opacity={isSel || !selectedId ? 1 : 0.55}
                />
              </g>
            );
          })}
        </svg>

        {sorted.map((c, i) => {
          const cx = project(c.value);
          const isRec = c.id === recommendedId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect?.(c.id)}
              style={{
                left: cx,
                transform: `translateX(${i === 0 ? "-20%" : i === sorted.length - 1 ? "-80%" : "-50%"})`,
              }}
              className={cn(
                "absolute top-0 rounded-sm px-1 text-center transition-colors duration-100",
                onSelect && "hover:bg-overlay-hover",
              )}
            >
              <span
                className={cn(
                  "block tabular whitespace-nowrap",
                  isRec ? "text-title text-primary" : "text-subtitle text-secondary",
                )}
              >
                {formatValue(c.value, formatHint, { unit, abbreviate: c.value >= 1e6 })}
              </span>
            </button>
          );
        })}
      </div>
      <div className="relative mt-1 h-4">
        {sorted.map((c, i) => {
          const cx = project(c.value);
          return (
            <span
              key={c.id}
              style={{
                left: cx,
                transform: `translateX(${i === 0 ? "-20%" : i === sorted.length - 1 ? "-80%" : "-50%"})`,
              }}
              className="absolute top-0 max-w-[16ch] truncate text-ui-sm text-tertiary"
            >
              {c.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   7.2 The contribution waterfall — `Unexplained` is mandatory
--------------------------------------------------------------------------- */

export function Waterfall({
  bars,
  unexplained,
  className,
}: {
  bars: Array<{ label: string; value: number }>;
  unexplained: number;
  className?: string;
}) {
  const all = [...bars, { label: "Unexplained", value: unexplained }];
  const max = Math.max(...all.map((b) => Math.abs(b.value)), 0.001);
  const rowH = 26;
  const trackW = 240;

  return (
    <div className={cn("w-full", className)}>
      <ul>
        {all.map((b, i) => {
          const residual = i === all.length - 1;
          const w = Math.max(2, (Math.abs(b.value) / max) * (trackW / 2));
          const negative = b.value < 0;
          return (
            <li key={b.label} style={{ height: rowH }} className="flex items-center gap-3">
              <span className="w-40 truncate text-ui-sm text-secondary" title={b.label}>
                {b.label}
              </span>
              <svg width={trackW} height={14} className="shrink-0">
                <line
                  x1={trackW / 2}
                  x2={trackW / 2}
                  y1={0}
                  y2={14}
                  stroke="var(--viz-grid)"
                  strokeWidth={1}
                />
                <rect
                  x={negative ? trackW / 2 - w : trackW / 2}
                  y={2}
                  width={w}
                  height={10}
                  rx={2}
                  fill={
                    residual
                      ? "var(--viz-status-unverified)"
                      : negative
                        ? "var(--viz-2)"
                        : "var(--viz-1)"
                  }
                />
              </svg>
              <span className="w-16 text-right text-ui-sm tabular text-primary">
                {b.value > 0 ? "+" : ""}
                {(b.value * 100).toFixed(1)}pp
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   7.3 The watch band
--------------------------------------------------------------------------- */

export function WatchBand({
  history,
  normalRange,
  unit,
  formatHint = "currency",
  className,
}: {
  history: Array<{ t: string; value: number; incomplete?: boolean }>;
  normalRange: [number, number];
  unit?: string;
  formatHint?: FormatHint;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(720);
  const hatchId = React.useId();

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const H = 180;
  const M = { top: 12, right: 96, bottom: 22, left: 52 };
  const innerW = Math.max(80, w - M.left - M.right);
  const innerH = H - M.top - M.bottom;

  const values = history.map((h) => h.value);
  const min = Math.min(...values, normalRange[0]) * 0.94;
  const max = Math.max(...values, normalRange[1]) * 1.06;
  const y = (v: number) => M.top + innerH - ((v - min) / (max - min || 1)) * innerH;
  const x = (i: number) => M.left + (i / Math.max(1, history.length - 1)) * innerW;

  const complete = history.filter((h) => !h.incomplete);
  const incompleteStart = complete.length - 1;

  const pts: Array<[number, number]> = complete.map((h, i) => [x(i), y(h.value)]);
  const tailPts: Array<[number, number]> = history
    .slice(Math.max(0, incompleteStart))
    .map((h, i) => [x(Math.max(0, incompleteStart) + i), y(h.value)]);

  const ticks = [normalRange[0], normalRange[1]];

  return (
    <div ref={ref} className={cn("w-full", className)}>
      <svg width="100%" height={H} viewBox={`0 0 ${Math.max(w, 1)} ${H}`}>
        <defs>
          <pattern
            id={hatchId}
            width={6}
            height={6}
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--viz-ink-muted)" strokeWidth={2} />
          </pattern>
        </defs>

        {/* normal range reference band */}
        <rect
          x={M.left}
          y={y(normalRange[1])}
          width={innerW}
          height={Math.max(1, y(normalRange[0]) - y(normalRange[1]))}
          fill="var(--viz-band)"
        />
        <text
          x={M.left + innerW + 8}
          y={(y(normalRange[0]) + y(normalRange[1])) / 2}
          dominantBaseline="middle"
          fontSize={11}
          className="axis-tick"
          fill="var(--viz-ink-muted)"
        >
          normal range
        </text>

        {ticks.map((t) => (
          <text
            key={t}
            x={M.left - 8}
            y={y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={11}
            className="axis-tick"
            fill="var(--viz-ink-muted)"
          >
            {formatValue(t, formatHint, { unit, abbreviate: true })}
          </text>
        ))}

        <line
          x1={M.left}
          x2={M.left + innerW}
          y1={M.top + innerH}
          y2={M.top + innerH}
          stroke="var(--viz-baseline)"
          strokeWidth={1}
        />

        <path d={path(pts)} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" />

        {/* incomplete trailing periods render hatched and say why */}
        {tailPts.length > 1 ? (
          <>
            <rect
              x={tailPts[0][0]}
              y={M.top}
              width={Math.max(2, tailPts[tailPts.length - 1][0] - tailPts[0][0])}
              height={innerH}
              fill={`url(#${hatchId})`}
              opacity={0.18}
            />
            <path
              d={path(tailPts)}
              fill="none"
              stroke="var(--viz-1)"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <text
              x={tailPts[0][0] + 4}
              y={M.top + 10}
              fontSize={11}
              className="axis-tick"
              fill="var(--viz-ink-muted)"
            >
              in progress
            </text>
          </>
        ) : null}

        {/* breach marks */}
        {history.map((h, i) =>
          h.value < normalRange[0] || h.value > normalRange[1] ? (
            <g key={i}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={M.top}
                y2={M.top + innerH}
                stroke="var(--viz-status-qualified)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle cx={x(i)} cy={y(h.value)} r={3.5} fill="var(--viz-status-qualified)" />
            </g>
          ) : null,
        )}

        <text
          x={M.left}
          y={H - 6}
          fontSize={11}
          className="axis-tick"
          fill="var(--viz-ink-muted)"
        >
          {history[0]?.t ?? ""}
        </text>
        <text
          x={M.left + innerW}
          y={H - 6}
          textAnchor="end"
          fontSize={11}
          className="axis-tick"
          fill="var(--viz-ink-muted)"
        >
          {history[history.length - 1]?.t ?? ""}
        </text>
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Coverage meter used on refusal candidate cards
--------------------------------------------------------------------------- */

export function CandidateCoverage({
  included,
  total,
  className,
}: {
  included: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? (included / total) * 100 : 0;
  return (
    <div className={className}>
      <p className="text-ui-sm tabular text-tertiary">
        {formatCount(included)} of {formatCount(total)} rows
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: "var(--c-accent-solid)" }}
        />
      </div>
    </div>
  );
}

export { abbreviate };

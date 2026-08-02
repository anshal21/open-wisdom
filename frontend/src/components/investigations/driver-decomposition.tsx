"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Check, DriverEvent, WaterfallEvent } from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Sparkline } from "@/components/charts/answer-chart";
import { Waterfall } from "@/components/charts/product-forms";
import { Segmented, Skeleton } from "@/components/ui/primitives";
import { byMagnitude, signed } from "./model";

/**
 * Driver decomposition. screens.md §8.4.
 *
 * Required rendering is **rate vs mix**, never a bare ranked list, and the
 * `Unexplained` residual row is mandatory and always drawn — a decomposition
 * that sums exactly to the observed change is either lucky or lying.
 *
 * Each row expands to a sparkline of its last 12 periods with the normal range
 * shaded, so "is this unusual?" is answerable without a second query.
 */

const BAR_W = 112;

function ContributionBar({
  value,
  max,
  residual = false,
}: {
  value: number;
  max: number;
  residual?: boolean;
}) {
  const half = BAR_W / 2;
  const w = Math.max(2, (Math.abs(value) / (max || 1)) * half);
  const negative = value < 0;
  return (
    <svg width={BAR_W} height={12} aria-hidden="true" className="block">
      <line x1={half} x2={half} y1={0} y2={12} stroke="var(--viz-grid)" strokeWidth={1} />
      <rect
        x={negative ? half - w : half}
        y={2}
        width={w}
        height={8}
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
  );
}

/**
 * The last 12 periods with the normal range shaded. The band shares the
 * sparkline's domain (min/max of the series) and is clamped to it, so a band
 * wider than the plotted values reads as "everything shown is normal".
 */
function SegmentHistory({ driver }: { driver: DriverEvent }) {
  const history = driver.history ?? [];
  const range = driver.normal_range;
  const W = 260;
  const H = 48;

  if (history.length < 2) {
    return (
      <p className="text-ui-sm text-tertiary">
        No period history is recorded for this segment.
      </p>
    );
  }

  const min = Math.min(...history);
  const max = Math.max(...history);
  const span = max - min || 1;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);

  const latest = history[history.length - 1];
  const outside = range ? latest < range[0] || latest > range[1] : false;

  const bandTop = range ? Math.max(0, Math.min(H, y(range[1]))) : 0;
  const bandBottom = range ? Math.max(0, Math.min(H, y(range[0]))) : 0;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative shrink-0" style={{ width: W, height: H }}>
        {range ? (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 rounded-xs"
            style={{
              top: bandTop,
              height: Math.max(2, bandBottom - bandTop),
              backgroundColor: "var(--viz-band)",
            }}
          />
        ) : null}
        <Sparkline values={history} width={W} height={H} className="relative" />
      </div>
      <div className="min-w-0">
        <p className="text-ui-sm tabular text-tertiary">
          Last {history.length} periods · latest {signed(latest, "pp")}
        </p>
        {range ? (
          <p
            className={cn(
              "mt-0.5 text-ui-sm tabular",
              outside ? "text-qualified" : "text-tertiary",
            )}
          >
            Normal range {signed(range[0], "pp")} to {signed(range[1], "pp")}
            {" — "}
            {outside ? "latest is outside it" : "latest is inside it"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DriverDecomposition({
  drivers,
  waterfall,
  totalLabel,
  state,
  checks,
  passed,
  total,
  overruleLabel,
  widenLabel,
  className,
}: {
  drivers: DriverEvent[];
  waterfall: WaterfallEvent | null;
  /** e.g. "-3.1% vs May" — the change the contributions decompose. */
  totalLabel: string;
  state: ConfidenceState;
  checks: Check[];
  passed: number;
  total: number;
  /** Permanent label when the run was ordered after the metric was shown flat. */
  overruleLabel?: string;
  widenLabel?: string;
  className?: string;
}) {
  const [view, setView] = React.useState<"table" | "waterfall">("table");
  const [openSegment, setOpenSegment] = React.useState<string | null>(null);

  const sorted = React.useMemo(() => byMagnitude(drivers), [drivers]);
  /** Verbatim caveat, as the chart frame renders it. data-viz §6.1 */
  const caveat = React.useMemo(
    () =>
      state === "qualified"
        ? (checks.find((c) => c.status === "fail" || c.status === "warn")?.finding ?? null)
        : null,
    [checks, state],
  );
  const residual = waterfall?.unexplained ?? null;
  const max = React.useMemo(
    () =>
      Math.max(
        ...sorted.map((d) => Math.abs(d.contribution)),
        Math.abs(residual ?? 0),
        0.001,
      ),
    [sorted, residual],
  );

  const waterfallBars = React.useMemo(
    () =>
      byMagnitude(waterfall?.bars ?? []).map((b) => ({
        label: b.label,
        // Waterfall renders `value * 100` as percentage points; contributions
        // arrive already in points.
        value: b.value / 100,
      })),
    [waterfall],
  );

  return (
    <section className={cn("min-w-0", className)} aria-labelledby="drivers-label">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="drivers-label" className="text-label text-tertiary uppercase">
          Drivers
        </h3>
        <span className="text-ui-sm tabular text-tertiary">
          contribution to {totalLabel}
        </span>
        <span className="flex-1" />
        <ConfidenceSeal size="inline" state={state} passed={passed} total={total} />
        <Segmented
          size="xs"
          value={view}
          onChange={setView}
          options={[
            { value: "table", label: "Rate vs mix" },
            { value: "waterfall", label: "Waterfall" },
          ]}
        />
      </div>

      {overruleLabel ? (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-sm border border-qualified-border bg-qualified-bg px-2.5 py-1.5 text-ui-sm text-qualified">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {overruleLabel}
        </p>
      ) : null}

      {widenLabel ? (
        <p className="mt-2.5 rounded-sm border border-border-default bg-surface-2 px-2.5 py-1.5 text-ui-sm text-secondary">
          {widenLabel}
        </p>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        {view === "table" ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-ui">
              <thead className="bg-surface-2">
                <tr className="h-9 border-b border-border-default">
                  <th scope="col" className="px-3 text-left text-label text-tertiary uppercase">
                    Segment
                  </th>
                  <th scope="col" className="px-3 text-right text-label text-tertiary uppercase">
                    Δ rate
                  </th>
                  <th scope="col" className="px-3 text-right text-label text-tertiary uppercase">
                    Δ mix
                  </th>
                  <th scope="col" className="px-3 text-right text-label text-tertiary uppercase">
                    Net contribution
                  </th>
                  <th scope="col" className="px-3 text-left text-label text-tertiary uppercase">
                    <span className="sr-only">Contribution bar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const open = openSegment === d.segment;
                  return (
                    <React.Fragment key={d.segment}>
                      <tr
                        tabIndex={0}
                        aria-expanded={open}
                        onClick={() =>
                          setOpenSegment((cur) => (cur === d.segment ? null : d.segment))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpenSegment((cur) =>
                              cur === d.segment ? null : d.segment,
                            );
                          }
                        }}
                        className={cn(
                          "h-8 cursor-pointer border-b border-border-subtle transition-colors duration-100 outline-offset-[-2px]",
                          open
                            ? "bg-overlay-selected"
                            : "hover:bg-overlay-hover focus:bg-overlay-hover",
                        )}
                      >
                        <td className="max-w-[220px] truncate px-3 text-primary">
                          {d.segment}
                          <span className="ml-2 text-ui-sm text-tertiary">{d.kind}</span>
                        </td>
                        <td className="px-3 text-right tabular text-secondary">
                          {signed(d.rate_delta, "%")}
                        </td>
                        <td className="px-3 text-right tabular text-secondary">
                          {signed(d.mix_delta, "%")}
                        </td>
                        <td className="px-3 text-right tabular text-primary">
                          {signed(d.contribution, "pp")}
                        </td>
                        <td className="px-3">
                          <ContributionBar value={d.contribution} max={max} />
                        </td>
                      </tr>
                      {open ? (
                        <tr className="ds-fade border-b border-border-subtle bg-surface-2">
                          <td colSpan={5} className="px-3 py-3">
                            <SegmentHistory driver={d} />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}

                {/* Mandatory residual. Always drawn, even at zero. */}
                <tr className="h-8 border-t border-border-default">
                  <td className="px-3 text-unverified">Unexplained</td>
                  <td className="px-3 text-right tabular text-disabled">—</td>
                  <td className="px-3 text-right tabular text-disabled">—</td>
                  <td className="px-3 text-right tabular text-unverified">
                    {residual === null ? "—" : signed(residual, "pp")}
                  </td>
                  <td className="px-3">
                    <ContributionBar value={residual ?? 0} max={max} residual />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-3">
            <Waterfall bars={waterfallBars} unexplained={(residual ?? 0) / 100} />
          </div>
        )}
      </div>

      {caveat ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-sm bg-qualified-bg px-2.5 py-1.5 text-ui-sm text-qualified">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {caveat}
        </p>
      ) : null}

      <p className="prose-measure mt-2 text-ui-sm text-tertiary">
        {residual === null
          ? "The residual was not reported for this run, so it is shown as unknown rather than folded into the segments."
          : "The residual is always reported. A decomposition that sums exactly to the observed change is claiming a completeness the analysis does not have."}
        {" "}
        Checked figures: {passed} of {total}.
      </p>
    </section>
  );
}

/** Skeleton at the decomposition's final geometry. */
export function DriverSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-2.5 w-40" />
      <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        <div className="h-9 border-b border-border-default bg-surface-2" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex h-8 items-center gap-3 border-b border-border-subtle px-3">
            <Skeleton className="h-2.5 w-40" />
            <span className="flex-1" />
            <Skeleton className="h-2.5 w-10" />
            <Skeleton className="h-2.5 w-10" />
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-2.5" style={{ width: BAR_W }} />
          </div>
        ))}
      </div>
    </div>
  );
}

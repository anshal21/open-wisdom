"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import type { Cell, ResultColumn, Watch } from "@/lib/api/types";
import { deriveState, tally } from "@/lib/confidence";
import { formatDateShort, formatValue } from "@/lib/format";
import { ChartFrame } from "@/components/charts/chart-frame";
import { WatchBand } from "@/components/charts/product-forms";
import { Skeleton } from "@/components/ui/primitives";
import { breachSentence, rangeLabel } from "./model";

/**
 * The watch band. data-viz.md §7.3 — 90 points, the normal range shaded,
 * breaches marked, and incomplete trailing periods hatched and labelled
 * `in progress`. The hatching is what stops a half-finished period reading as
 * a collapse.
 */
export function WatchBandCard({ watch }: { watch: Watch }) {
  const history = React.useMemo(() => watch.history ?? [], [watch.history]);
  const range = watch.normal_range;

  const checks = watch.pre_alert_checks ?? [];
  const state = checks.length ? deriveState(checks) : "unverified";
  const counts = tally(checks);
  const caveat = checks.find((c) => c.status === "warn" || c.status === "fail")?.finding;

  // The chart's own axis labels want a short date, not an ISO stamp.
  const plotted = React.useMemo(
    () => history.map((p) => ({ ...p, t: formatDateShort(p.t) })),
    [history],
  );

  const columns: ResultColumn[] = [
    { name: "period", label: "Period", type: "temporal" },
    { name: "value", label: watch.definition_name, type: "quantitative" },
    { name: "state", label: "Period state", type: "nominal" },
  ];
  const rows: Cell[][] = history.map((p) => [
    formatDateShort(p.t),
    p.value,
    p.incomplete ? "in progress" : "complete",
  ]);

  if (!range || history.length < 2) {
    return (
      <div className="rounded-lg border border-border-default bg-surface-1 px-4 py-6">
        <p className="text-ui text-secondary">
          No history has loaded for this watch yet.
        </p>
        <p className="mt-1 text-ui-sm text-tertiary">
          The band is drawn from the metric&apos;s own readings; it appears once enough
          periods have been recorded.
        </p>
      </div>
    );
  }

  const first = history[0];
  const last = history[history.length - 1];

  return (
    <ChartFrame
      title={`${watch.definition_name} · per ${watch.grain}`}
      confidenceState={state}
      checks={checks}
      passed={counts.passed}
      total={counts.total}
      caveat={caveat}
      columns={columns}
      rows={rows}
      formatHint={watch.format_hint}
      unit={watch.unit}
      ariaLabel={`${watch.definition_name} per ${watch.grain}, ${history.length} periods from ${formatDateShort(
        first.t,
      )} to ${formatDateShort(last.t)}. Normal range ${rangeLabel(watch)}. Latest reading ${formatValue(
        last.value,
        watch.format_hint,
        { unit: watch.unit },
      )}.`}
      legend={
        <span className="flex items-center gap-4 text-ui-sm text-tertiary">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-4 rounded-[2px]"
              style={{ backgroundColor: "var(--viz-band)" }}
            />
            Normal range {rangeLabel(watch)}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="hatch-unverified inline-block h-2.5 w-4 rounded-[2px] text-tertiary"
            />
            In progress
          </span>
        </span>
      }
    >
      <WatchBand
        history={plotted}
        normalRange={range}
        unit={watch.unit}
        formatHint={watch.format_hint}
      />
    </ChartFrame>
  );
}

/** The breach, stated in words. A delta never appears without its range. */
export function BreachLine({ watch }: { watch: Watch }) {
  const sentence = breachSentence(watch);
  if (!sentence) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-qualified-border bg-qualified-bg px-3 py-2.5 text-body tabular text-qualified">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
      {sentence}
    </p>
  );
}

export function WatchBandSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border border-border-default bg-surface-1"
    >
      <div className="flex h-9 items-center gap-2 border-b border-border-subtle px-3">
        <Skeleton className="h-2.5 w-40" />
        <span className="flex-1" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <div className="px-3 pt-3 pb-3">
        <Skeleton className="h-[180px] w-full" />
      </div>
    </div>
  );
}

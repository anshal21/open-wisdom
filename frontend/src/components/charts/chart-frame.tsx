"use client";

import * as React from "react";
import { Table2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { effectiveHint, formatCount, formatValue } from "@/lib/format";
import type { Cell, Check, ChartCoverage, FormatHint, ResultColumn } from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";

/**
 * Everything wrapped around the plot: header seal, caveat strip, coverage bar,
 * legend, and the mandatory table view.
 *
 * `confidenceState` and `checks` are required props on every chart. Making them
 * optional guarantees that some chart, somewhere, ships without them.
 */
export interface ChartFrameProps {
  title?: string;
  confidenceState: ConfidenceState;
  checks: Check[];
  passed?: number;
  total?: number;
  /** Verbatim caveat sentence for `qualified`. */
  caveat?: string;
  coverage?: ChartCoverage;
  columns: ResultColumn[];
  rows: Cell[][];
  formatHint?: FormatHint;
  unit?: string;
  onRerun?: () => void;
  children: React.ReactNode;
  legend?: React.ReactNode;
  /** Extra header controls (the chart-type switcher) next to the table toggle. */
  controls?: React.ReactNode;
  /** Controlled table view: when set, the frame's Table button reports to the
   * owner instead of toggling internal state — so the switcher's "table" type
   * and this button are one state, never two. */
  tableView?: boolean;
  onTableViewChange?: (v: boolean) => void;
  className?: string;
  /** Accessible description of the trend and endpoints. */
  ariaLabel: string;
}

export function ChartFrame({
  title,
  confidenceState,
  checks,
  passed,
  total,
  caveat,
  coverage,
  columns,
  rows,
  formatHint = "number",
  unit,
  onRerun,
  children,
  legend,
  controls,
  tableView,
  onTableViewChange,
  className,
  ariaLabel,
}: ChartFrameProps) {
  const [internalShowTable, setInternalShowTable] = React.useState(false);
  const showTable = tableView ?? internalShowTable;
  const setShowTable = (v: boolean) =>
    onTableViewChange ? onTableViewChange(v) : setInternalShowTable(v);

  React.useEffect(() => {
    void checks;
  }, [checks]);

  const coverageLow =
    coverage && coverage.included_rows + coverage.excluded_rows > 0
      ? coverage.included_rows / (coverage.included_rows + coverage.excluded_rows) < 0.95
      : false;

  return (
    <figure
      className={cn(
        "m-0 rounded-lg border border-border-default bg-surface-1",
        className,
      )}
    >
      {/* Control row is fixed-height; the legend gets its OWN row below and
          wraps freely (data-viz.md: "under the title, horizontal, wrapping").
          A fixed h-9 header holding a wrapping legend sliced text at every
          viewport (design-audit P1-1). */}
      <figcaption className="border-b border-border-subtle">
        <div className="flex h-9 items-center gap-2 px-3">
          {title ? (
            <span className="min-w-0 truncate text-ui font-medium text-primary">{title}</span>
          ) : null}
          <span className="flex-1" />
          {controls}
          {confidenceState === "superseded" && onRerun ? (
            <button
              type="button"
              onClick={onRerun}
              className="h-6 rounded-sm px-1.5 text-ui-sm font-medium text-accent transition-colors duration-100 hover:bg-overlay-hover"
            >
              Re-run
            </button>
          ) : null}
          {/* When a type switcher is present it includes Table as a type —
              one state must not have two buttons. */}
          {controls && onTableViewChange ? null : (
            <button
              type="button"
              onClick={() => setShowTable(!showTable)}
              aria-pressed={showTable}
              title="Table view"
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-ui-sm transition-colors duration-100",
                showTable
                  ? "bg-overlay-selected text-accent"
                  : "text-tertiary hover:bg-overlay-hover hover:text-primary",
              )}
            >
              <Table2 size={13} />
              Table
            </button>
          )}
          <ConfidenceSeal
            state={confidenceState}
            size="inline"
            passed={passed}
            total={total}
          />
        </div>
        {legend ? (
          <div className="border-t border-border-subtle px-3 py-1.5">{legend}</div>
        ) : null}
      </figcaption>

      {showTable ? (
        <ChartTable
          columns={columns}
          rows={rows}
          formatHint={formatHint}
          unit={unit}
        />
      ) : (
        <div
          role="img"
          tabIndex={0}
          aria-label={ariaLabel}
          className="relative px-3 pt-3 outline-offset-[-2px]"
        >
          {children}
        </div>
      )}

      {/* Caveat strip — verbatim, directly beneath the plot. data-viz §6.1 */}
      {confidenceState === "qualified" && caveat ? (
        <div className="flex min-h-6 items-center gap-1.5 bg-qualified-bg px-3 py-1">
          <TriangleAlert size={12} className="shrink-0 text-qualified" />
          <p className="text-ui-sm text-qualified">{caveat}</p>
        </div>
      ) : null}

      {/* Coverage bar — excluded rows are always visualised. data-viz §6.2 */}
      {coverage ? (
        <div className="px-3 pt-2 pb-3">
          <CoverageStrip coverage={coverage} low={coverageLow} />
        </div>
      ) : (
        <div className="pb-3" />
      )}
    </figure>
  );
}

function CoverageStrip({
  coverage,
  low,
}: {
  coverage: ChartCoverage;
  low: boolean;
}) {
  const total = coverage.included_rows + coverage.excluded_rows;
  const pct = total > 0 ? (coverage.included_rows / total) * 100 : 100;
  const label = `${formatCount(coverage.included_rows)} of ${formatCount(total)} rows`;
  const excludedPct = total > 0 ? (coverage.excluded_rows / total) * 100 : 0;

  return (
    <div>
      <div
        className="flex h-1 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--c-surface-2)" }}
        role="img"
        aria-label={`${label}${coverage.reason ? `. ${coverage.reason}` : ""}`}
      >
        <div style={{ width: `${pct}%`, backgroundColor: "var(--viz-1)" }} />
        {low ? (
          <div
            style={{
              width: `${100 - pct}%`,
              backgroundColor: "var(--viz-status-qualified)",
              opacity: 0.55,
            }}
          />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-1.5 text-ui-sm tabular",
          low ? "text-qualified" : "text-tertiary",
        )}
      >
        {label}
        {coverage.excluded_rows > 0 ? (
          <>
            {" — "}
            <span>
              {excludedPct.toFixed(1)}% {coverage.reason || "excluded"}
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function ChartTable({
  columns,
  rows,
  formatHint,
  unit,
}: {
  columns: ResultColumn[];
  rows: Cell[][];
  formatHint: FormatHint;
  unit?: string;
}) {
  // The answer-level hint describes the headline; "percent" applied to a raw
  // measure column prints revenue as 2297175.1%. Per column, the hint holds
  // only when the values could plausibly be percentages.
  const columnHint = (j: number): FormatHint =>
    effectiveHint(formatHint, rows.map((r) => r[j] as number | null));
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-collapse text-ui">
        <thead className="sticky top-0 bg-surface-2">
          <tr className="h-8">
            {columns.map((c) => (
              <th
                key={c.name}
                scope="col"
                className={cn(
                  "border-b border-border-default px-3 text-label text-tertiary uppercase",
                  c.type === "quantitative" ? "text-right" : "text-left",
                )}
              >
                {c.label ?? c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="h-8 border-b border-border-subtle last:border-0">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-3",
                    columns[j]?.type === "quantitative"
                      ? "text-right tabular text-primary"
                      : "text-left text-secondary",
                  )}
                >
                  {columns[j]?.type === "quantitative" && typeof cell === "number"
                    ? formatValue(cell, columnHint(j), { unit })
                    : String(cell ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The hatch pattern defs — one per chart instance so ids never collide. */
export function HatchDefs({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern
        id={id}
        width={6}
        height={6}
        patternTransform="rotate(45)"
        patternUnits="userSpaceOnUse"
      >
        <rect width={6} height={6} fill="transparent" />
        <line x1={0} y1={0} x2={0} y2={6} stroke={color} strokeWidth={2.2} />
      </pattern>
    </defs>
  );
}

export function ChartLegend({
  items,
}: {
  items: Array<{ label: string; color: string; state?: ConfidenceState }>;
}) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5 text-ui-sm text-secondary">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ backgroundColor: s.color }}
          />
          {s.label}
          {s.state === "unverified" ? (
            <span className="text-tertiary">(unverified)</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

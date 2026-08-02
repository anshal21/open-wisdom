"use client";

/**
 * <Viz> — the one chart component. docs/design/charting.md.
 *
 * A chart takes a table and gives a visualization; the table is always one
 * toggle away. Chart type and encodings resolve user > agent hint > shape
 * default, and the popover shows which voice decided each field.
 *
 * There is exactly one render path now: resolve → pivot → the form's own
 * renderer, wrapped in ChartFrame (or bare, embedded in a tile). No form is
 * special-cased here — pie owns its legend, bar owns its orientation, the
 * table is a form like any other.
 *
 * Consumed by Ask, the permalink page, notebook cells, and dashboard tiles.
 */

import * as React from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Cell, ChartSpec, Check, ChartCoverage, FormatHint, ResultColumn } from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";
import { getMeta } from "@/lib/viz/registry";
import { resolve, type VizOverride } from "@/lib/viz/resolve";
import { explain } from "@/lib/viz/explain";
import { pivot } from "@/lib/viz/series";
import { ChartFrame } from "@/components/charts/chart-frame";
import { TypeSwitcher } from "./type-switcher";
import { EncodingPopover } from "./encoding-popover";
import { rendererFor, type VizRenderProps } from "./plugins";

export interface VizProps {
  columns: ResultColumn[];
  rows: Cell[][];
  hint?: ChartSpec | null;
  override?: VizOverride | null;
  /** Present ⇒ the switcher and popover render; absent ⇒ read-only chart. */
  onOverride?: (next: VizOverride) => void;
  confidenceState: ConfidenceState;
  checks: Check[];
  passed?: number;
  total?: number;
  caveat?: string;
  coverage?: ChartCoverage;
  unit?: string;
  formatHint?: FormatHint;
  title?: string;
  onRerun?: () => void;
  /** Frameless mode for tiles: no ChartFrame chrome, compact controls that
   * appear on hover, size-fitted plot. The host provides title/seal/border. */
  embedded?: boolean;
  /** Plot height in px (embedded mode). */
  height?: number;
  className?: string;
}

export function Viz(props: VizProps) {
  const {
    columns,
    rows,
    hint,
    override,
    onOverride,
    unit,
    formatHint = "number",
    embedded = false,
    height = 220,
    className,
  } = props;

  const table = React.useMemo(() => ({ columns, rows }), [columns, rows]);
  const spec = React.useMemo(() => resolve(table, hint, override), [table, hint, override]);
  const p = React.useMemo(() => {
    if (spec.xIdx < 0 || !spec.yIdxs.length) return null;
    return pivot(table, spec);
  }, [table, spec]);

  const [encodingOpen, setEncodingOpen] = React.useState(false);
  const encodingRef = React.useRef<HTMLButtonElement>(null);

  const meta = getMeta(spec.type);
  const renderer = rendererFor(spec.type);

  // A scalar's figure is the headline — the host surface already renders it.
  if (meta?.frameless || !renderer) return null;

  const renderProps: VizRenderProps = {
    table,
    spec,
    pivotResult: p,
    unit,
    formatHint,
    confidenceState: props.confidenceState,
    height: embedded ? height : 220,
    embedded,
    options: spec.options,
  };

  const plot = renderer.render(renderProps);
  const legend = renderer.legend?.(renderProps) ?? null;
  const sentence = explain(table, spec, p);
  const ariaId = `viz-why-${spec.type}`;

  const ariaLabel =
    spec.type === "table"
      ? `${props.title ?? "Result"}: table of ${rows.length} rows.`
      : `${props.title ?? "Chart"}: ${meta?.label ?? spec.type}${
          p ? `, ${p.series.length} series over ${p.xLabels.length} buckets` : ""
        }.${props.confidenceState === "unverified" ? " This chart is unverified." : ""}`;

  const controls = onOverride ? (
    <div className="flex items-center gap-0.5">
      <TypeSwitcher
        table={table}
        spec={spec}
        onPick={(t) => onOverride({ ...override, type: t })}
      />
      <button
        ref={encodingRef}
        type="button"
        title="Encodings"
        aria-label="Encodings and options"
        aria-expanded={encodingOpen}
        aria-haspopup="dialog"
        onClick={() => setEncodingOpen((v) => !v)}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors duration-100",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--c-border-accent)]",
          encodingOpen
            ? "bg-overlay-selected text-accent"
            : "text-tertiary hover:bg-overlay-hover hover:text-primary",
        )}
      >
        <Settings2 size={13} />
      </button>
      <EncodingPopover
        open={encodingOpen}
        onClose={() => setEncodingOpen(false)}
        anchorRef={encodingRef}
        table={table}
        spec={spec}
        pivotResult={p}
        override={override}
        onOverride={onOverride}
      />
    </div>
  ) : undefined;

  if (embedded) {
    return (
      <div
        className={cn("group/viz relative min-h-0", className)}
        aria-label={ariaLabel}
        aria-describedby={sentence ? ariaId : undefined}
      >
        {sentence ? (
          <span id={ariaId} className="sr-only">
            {sentence}
          </span>
        ) : null}
        {controls ? (
          <div
            className={cn(
              "absolute -top-0.5 right-0 z-10 rounded-sm bg-surface-1/95 opacity-0 shadow-sm transition-opacity duration-100",
              "group-hover/viz:opacity-100 focus-within:opacity-100",
            )}
          >
            {controls}
          </div>
        ) : null}
        {/* The embedded box is a HARD boundary. `height` is the space the host
            reserved; without a definite height here, a child's `h-full` /
            `max-h-full` resolves against nothing and the form grows over the
            tile's own footer (the donut legend did exactly that). Every form
            gets the same box, so no renderer has to remember. */}
        <div style={{ height }} className="min-h-0 overflow-hidden">
          {plot}
        </div>
      </div>
    );
  }

  return (
    <ChartFrame
      title={props.title}
      confidenceState={props.confidenceState}
      checks={props.checks}
      passed={props.passed}
      total={props.total}
      caveat={props.caveat}
      coverage={props.coverage}
      columns={columns}
      rows={rows}
      formatHint={formatHint}
      unit={unit}
      onRerun={props.onRerun}
      ariaLabel={ariaLabel}
      className={className}
      tableView={spec.type === "table"}
      onTableViewChange={
        onOverride
          ? (v) => onOverride({ ...override, type: v ? "table" : undefined })
          : undefined
      }
      legend={legend ?? undefined}
      controls={controls}
    >
      {sentence ? (
        <span id={ariaId} className="sr-only">
          {sentence}
        </span>
      ) : null}
      {spec.degraded ? (
        <p className="px-3 pt-2 text-ui-sm text-qualified">{spec.degraded}</p>
      ) : null}
      {plot}
    </ChartFrame>
  );
}

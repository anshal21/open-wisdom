"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDelta, formatRelative, formatValue, isoTitle } from "@/lib/format";
import { figureAriaLabel } from "@/lib/confidence";
import type { Answer, TileSize } from "@/lib/api/types";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import { Sparkline } from "@/components/charts/answer-chart";
import { AnswerInspector } from "@/components/viz/inspector";
import { Viz } from "@/components/viz/viz";
import { Button, IconButton } from "@/components/ui/button";
import { MenuItem, Popover } from "@/components/ui/overlays";
import { Skeleton } from "@/components/ui/primitives";
import { useEvidence } from "@/state/evidence";
import {
  categorySeries,
  geom,
  isTemporalSeries,
  seriesValues,
  tileDelta,
  tileEvidence,
  tileState,
} from "./tile-model";

/* ---------------------------------------------------------------------------
   The 2px accent progress line. Numbers stay visible underneath — a refresh
   never blanks a tile out. §6.4
--------------------------------------------------------------------------- */

export function ProgressLine({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-accent-tint",
        className,
      )}
    >
      <span
        className="block h-full w-full"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, var(--c-accent-solid) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "ds-shimmer 1.4s linear infinite",
        }}
      />
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Small charts. Unverified marks are hatched or dashed — an unverified tile is
   recognisable as unverified in a black-and-white screenshot. data-viz.md §6
--------------------------------------------------------------------------- */

function useMeasuredWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(180);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function TileSpark({
  values,
  height,
  unverified,
}: {
  values: number[];
  height: number;
  unverified: boolean;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="w-full">
      {width > 8 ? (
        <Sparkline
          values={values}
          width={width}
          height={height}
          unverified={unverified}
        />
      ) : null}
    </div>
  );
}

function MiniBars({
  points,
  unit,
  formatHint,
  unverified,
  max: maxRows,
}: {
  points: Array<{ label: string; value: number }>;
  unit?: string;
  formatHint: Answer["format_hint"];
  unverified: boolean;
  max: number;
}) {
  const shown = points.slice(0, maxRows);
  const top = Math.max(...shown.map((p) => p.value), 1);
  // "percent" only fits shares of one whole; a raw measure under a
  // percent-flavoured answer (share questions) renders as a number.
  const sum = shown.reduce((a, p) => a + p.value, 0);
  const effectiveHint =
    formatHint === "percent" && Math.abs(sum - 100) > 1 && Math.abs(sum - 1) > 0.05
      ? "number"
      : formatHint;
  return (
    <ul className="flex w-full flex-col gap-1">
      {shown.map((p) => (
        <li key={p.label} className="flex items-center gap-2">
          <span className="w-[38%] truncate text-ui-sm text-tertiary" title={p.label}>
            {p.label}
          </span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-xs bg-surface-2">
            <span
              className={cn("block h-full rounded-xs", unverified && "hatch-unverified border")}
              style={{
                width: `${Math.max(3, (p.value / top) * 100)}%`,
                color: "var(--viz-1)",
                borderColor: "var(--viz-1)",
                backgroundColor: unverified ? "transparent" : "var(--viz-1)",
              }}
            />
          </span>
          <span className="shrink-0 text-ui-sm tabular text-secondary">
            {formatValue(p.value, effectiveHint, { unit, abbreviate: true })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
   Tile — §6.2
--------------------------------------------------------------------------- */

export interface DashboardTileProps {
  answer: Answer;
  size: TileSize;
  /** The tile's persisted chart override + its change handler. */
  viz?: import("@/lib/viz/resolve").VizOverride;
  onVizChange?: (v: import("@/lib/viz/resolve").VizOverride) => void;
  /** When the dashboard was last refreshed; the tile footer's timestamp. */
  refreshedAt: string | null;
  refreshing?: boolean;
  editing?: boolean;
  /** The tile's ACTUAL grid geometry. `size` is a legacy bucket that caps at
   * two rows, so a tile dragged taller kept rendering a two-row chart inside
   * a much larger box. When the canvas knows the real w/h, it wins. */
  gridCols?: number;
  gridRows?: number;
  onRerun?: () => void;
  onReplace?: () => void;
  onRemove?: () => void;
  className?: string;
}

export function DashboardTile({
  answer,
  size,
  viz,
  onVizChange,
  refreshedAt,
  refreshing = false,
  editing = false,
  gridCols,
  gridRows,
  onRerun,
  onReplace,
  onRemove,
  className,
}: DashboardTileProps) {
  const bucket = geom(size);
  const cols = gridCols ?? bucket.cols;
  const rows = gridRows ?? bucket.rows;
  const state = tileState(answer);
  const router = useRouter();
  const setSubject = useEvidence((s) => s.setSubject);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [inspecting, setInspecting] = React.useState(false);
  const menuRef = React.useRef<HTMLButtonElement>(null);

  const publish = React.useCallback(() => {
    setSubject(tileEvidence(answer, `Tile · ${answer.question}`));
  }, [answer, setSubject]);

  const unverified = state === "unverified";
  const superseded = state === "superseded";
  const qualified = state === "qualified";
  const at = refreshedAt ?? answer.created_at;

  const delta = tileDelta(answer);
  const values = seriesValues(answer);
  const categories = categorySeries(answer);
  const temporal = isTemporalSeries(answer);
  const chartHeight = rows > 1 ? 40 : 0;

  const definitionLabel = answer.definition_used
    ? `${answer.definition_used.name}${answer.definition_used.version ? ` v${answer.definition_used.version}` : ""}`
    : "No ratified definition";

  return (
    <article
      onMouseEnter={publish}
      onFocusCapture={publish}
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-surface-1 transition-colors duration-100",
        unverified ? "border-dashed border-border-strong" : "border-border-default",
        !editing && "hover:border-border-hover",
        className,
      )}
    >
      {refreshing ? <ProgressLine /> : null}
      {superseded ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 z-20 w-0.5 bg-qualified"
        />
      ) : null}

      {/* Whole tile is a link to the answer. §6.2 */}
      <Link
        href={`/a/${answer.id}`}
        draggable={false}
        aria-label={`Open answer: ${answer.question}`}
        className={cn("absolute inset-0 z-10", editing && "pointer-events-none")}
      />

      <div className="relative z-20 flex min-h-0 flex-1 flex-col gap-1.5 p-3.5">
        {/* Title + seal + overflow */}
        <div className="pointer-events-none flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate text-ui font-medium text-primary" title={answer.question}>
            {answer.question}
          </h3>
          <ConfidenceSeal state={state} size="inline" labelHidden className="pointer-events-auto" />
          <span
            className={cn(
              "pointer-events-auto -mt-0.5 -mr-1 shrink-0 opacity-0 transition-opacity duration-100",
              "group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            <IconButton
              ref={menuRef}
              label="Tile actions"
              size="xs"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal size={14} />
            </IconButton>
          </span>
        </div>

        {state === "refused" ? (
          <RefusedTileBody answer={answer} />
        ) : (
          <>
            <p
              aria-label={figureAriaLabel(
                formatValue(answer.value, answer.format_hint, { unit: answer.unit }),
                state,
                answer.report?.headline,
              )}
              className={cn(
                "truncate tabular",
                cols >= 3 ? "text-hero-sm" : "text-title-lg",
                /* Unverified is visibly less emphatic than verified. §6.2 */
                unverified ? "text-secondary" : "text-primary",
              )}
            >
              {formatValue(answer.value, answer.format_hint, { unit: answer.unit })}
            </p>

            {/* The caveat's presence is never hidden — truncation is fine. §6.2 */}
            {qualified ? (
              <p className="truncate text-ui-sm text-qualified" title={answer.report?.headline}>
                {answer.report?.headline}
              </p>
            ) : null}

            {delta ? (
              <p className="truncate text-ui-sm text-secondary">
                {formatDelta(delta.pct, delta.base)}
              </p>
            ) : null}

            {chartHeight > 0 ? (
              answer.rows.length > 1 && answer.columns.length > 0 ? (
                /* A real result renders the real chart module — same switcher,
                   same forms as everywhere else; the choice persists on the
                   tile. pointer-events stay ON so the switcher works. */
                /* The control lane is RESERVED, not overlaid: the hover
                   switcher used to sit on top of the plot's first row, which
                   for a table view is the column header. Reserving 26px costs
                   nothing at rest and never covers data. */
                <div
                  className={cn(
                    "pointer-events-auto relative z-20 mt-auto min-h-0",
                    onVizChange ? "pt-[26px]" : "pt-1",
                  )}
                >
                  <Viz
                    embedded
                    height={Math.max(84, rows * 112 - (onVizChange ? 143 : 118))}
                    columns={answer.columns}
                    rows={answer.rows}
                    hint={answer.chart}
                    override={viz}
                    onOverride={onVizChange}
                    confidenceState={state}
                    checks={answer.report?.checks ?? []}
                    unit={answer.unit}
                    formatHint={answer.format_hint}
                  />
                </div>
              ) : (
                <div className="pointer-events-none mt-auto min-h-0 pt-1">
                  {temporal && values.length > 1 ? (
                    <TileSpark values={values} height={chartHeight} unverified={unverified} />
                  ) : categories.length > 1 ? (
                    <MiniBars
                      points={categories}
                      unit={answer.unit}
                      formatHint={answer.format_hint}
                      unverified={unverified}
                      max={cols >= 6 ? 4 : 3}
                    />
                  ) : null}
                </div>
              )
            ) : null}
          </>
        )}

        {/* Footer */}
        <div className="mt-auto flex items-center gap-1.5 pt-1.5 text-ui-sm text-tertiary">
          <span className="min-w-0 truncate" title={definitionLabel}>
            {definitionLabel}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={at} title={isoTitle(at)} className="shrink-0">
            {formatRelative(at)}
          </time>
          {superseded && onRerun ? (
            <button
              type="button"
              onClick={onRerun}
              className="pointer-events-auto ml-auto shrink-0 rounded-xs px-1 text-ui-sm font-medium text-qualified transition-colors duration-100 hover:bg-overlay-hover"
            >
              Re-run
            </button>
          ) : null}
        </div>
      </div>

      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={menuRef}
        align="end"
        width={188}
      >
        <MenuItem
          onSelect={() => {
            setMenuOpen(false);
            onRerun?.();
          }}
        >
          Re-run
        </MenuItem>
        <MenuItem
          onSelect={() => {
            setMenuOpen(false);
            setInspecting(true);
          }}
        >
          Inspect data &amp; SQL
        </MenuItem>
        <MenuItem
          onSelect={() => {
            setMenuOpen(false);
            router.push(`/a/${answer.id}`);
          }}
        >
          Open answer
        </MenuItem>
        <MenuItem
          onSelect={() => {
            setMenuOpen(false);
            onReplace?.();
          }}
        >
          Replace
        </MenuItem>
        <MenuItem
          danger
          onSelect={() => {
            setMenuOpen(false);
            onRemove?.();
          }}
        >
          Remove
        </MenuItem>
      </Popover>

      <AnswerInspector answer={answer} open={inspecting} onClose={() => setInspecting(false)} />
    </article>
  );
}

/**
 * A refused answer cannot be a tile (§6.2). If one reaches the grid through
 * stale data, the tile routes to the fork rather than inventing a number.
 */
function RefusedTileBody({ answer }: { answer: Answer }) {
  const n = answer.ambiguity?.candidates.length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
      <p className="flex items-center gap-1.5 text-subtitle text-accent">
        <ConfidenceGlyph state="refused" size={14} />
        {n > 0 ? `${n} defensible answers` : "Ambiguous question"}
      </p>
      <p className="text-ui-sm text-secondary">
        This question has more than one defensible reading, so it has no number to show.
        Resolve the fork and the tile fills in.
      </p>
      <Link
        href={`/a/${answer.id}`}
        className="pointer-events-auto relative z-20 w-fit text-ui-sm font-medium text-accent hover:underline"
      >
        Resolve the fork
      </Link>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Loading & error — geometry matches the loaded tile exactly. §9.13
--------------------------------------------------------------------------- */

export function TileSkeleton({ size }: { size: TileSize }) {
  const { cols, rows } = geom(size);
  return (
    <div className="flex h-full flex-col gap-1.5 rounded-lg border border-border-default bg-surface-1 p-3.5">
      <div className="flex items-start gap-2">
        <Skeleton className="h-3.5 w-full max-w-[150px]" />
        <Skeleton className="h-5 w-5 shrink-0 rounded-xs" />
      </div>
      <Skeleton className={cn("w-[62%]", cols >= 3 ? "h-9" : "h-7")} />
      <Skeleton className="h-3 w-[45%]" />
      {rows > 1 ? <Skeleton className="mt-auto h-10 w-full" /> : null}
      <Skeleton className="mt-auto h-3 w-[58%]" />
    </div>
  );
}

export function TileError({
  message,
  onRemove,
  onRetry,
}: {
  message: string;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-contested-border bg-surface-1 p-3.5">
      <p className="text-subtitle text-contested">This tile could not load</p>
      <p className="min-h-0 flex-1 overflow-hidden text-ui-sm text-secondary">{message}</p>
      <div className="flex items-center gap-1.5">
        {onRetry ? (
          <Button size="xs" variant="secondary" onClick={onRetry}>
            <RotateCw size={12} />
            Retry
          </Button>
        ) : null}
        {onRemove ? (
          <Button size="xs" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { Pencil, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCount, formatValue } from "@/lib/format";
import type { ApiError, Cell, ResultColumn } from "@/lib/api/types";
import { CONFIDENCE, figureAriaLabel, sortChecks } from "@/lib/confidence";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Viz } from "@/components/viz/viz";
import { Button } from "@/components/ui/button";
import { Disclosure, Skeleton } from "@/components/ui/primitives";
import { ContextChipRow } from "./context-chips";
import { StageRail, StageSummary } from "./stage-rail";
import { RefusalFork } from "./refusal-fork";
import { ContestedFork } from "./contested-fork";
import { slowCheckOf, turnState, turnTally, type Turn } from "@/state/ask";

export function AnswerBlock({
  turn,
  active,
  onEditQuestion,
  onEditChip,
  onRemoveChip,
  onTogglePin,
  onOpenEvidence,
  onFollowUp,
  onUseCandidate,
  onRatifyCandidate,
  onDefineYourself,
  onInvestigate,
  onRetry,
  onVizChange,
  className,
}: {
  turn: Turn;
  active: boolean;
  onEditQuestion: (q: string) => void;
  onEditChip: (id: string, value: string) => void;
  onRemoveChip: (id: string) => void;
  onTogglePin: (id: string) => void;
  onOpenEvidence: () => void;
  onFollowUp: (q: string) => void;
  onUseCandidate: (id: string) => void;
  onRatifyCandidate: (id: string) => void;
  onDefineYourself: () => void;
  onInvestigate: () => void;
  onRetry: () => void;
  onVizChange?: (viz: import("@/lib/viz/resolve").VizOverride) => void;
  className?: string;
}) {
  const state = turnState(turn);
  const { passed, total } = turnTally(turn);
  const meta = state ? CONFIDENCE[state] : null;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(turn.question);

  const contestedCheck = turn.checks.find(
    (c) => c.id === "cross_derivation" && c.status === "fail",
  );

  const headline = turn.report?.headline;
  const formatHint = turn.result?.format_hint ?? "number";
  const unit = turn.result?.unit;

  const streaming = turn.status === "streaming";
  const showRail = streaming && !turn.ambiguity;

  return (
    <article
      className={cn(
        "transition-opacity duration-140",
        turn.rerunning && "opacity-60",
        className,
      )}
    >
      {/* 1 — the question */}
      <div className="group flex items-start gap-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setEditing(false);
                if (draft.trim() && draft !== turn.question) onEditQuestion(draft.trim());
              } else if (e.key === "Escape") {
                setDraft(turn.question);
                setEditing(false);
              }
            }}
            className="w-full border-b border-border-accent bg-transparent pb-1 text-title text-primary outline-none"
          />
        ) : (
          <>
            <h2 className="min-w-0 text-title text-primary">{turn.question}</h2>
            <button
              type="button"
              aria-label="Edit question"
              onClick={() => {
                setDraft(turn.question);
                setEditing(true);
              }}
              className="mt-0.5 shrink-0 rounded-sm p-1 text-tertiary opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-overlay-hover focus-visible:opacity-100"
            >
              <Pencil size={13} />
            </button>
          </>
        )}
      </div>

      {/* 2 — the context chips: this is the state, and the control surface */}
      {turn.chips.length > 0 ? (
        <ContextChipRow
          className="mt-3"
          chips={turn.chips}
          disabled={streaming}
          onEdit={onEditChip}
          onRemove={onRemoveChip}
          onTogglePin={onTogglePin}
        />
      ) : streaming ? (
        <div className="mt-3 flex h-6 items-center gap-1.5">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-24" />
        </div>
      ) : null}

      {/* 3 — the stage rail */}
      {showRail ? (
        <StageRail className="mt-5" stages={turn.stages} detail={turn.stageDetail} />
      ) : null}

      {/* Refusal takes the whole block. It is not an error state. */}
      {turn.ambiguity ? (
        <RefusalFork
          className="mt-6"
          ambiguity={turn.ambiguity}
          unit={turn.ambiguity.unit ?? unit}
          formatHint={turn.ambiguity.format_hint ?? formatHint}
          onUseOnce={onUseCandidate}
          onUseAndRatify={onRatifyCandidate}
          onDefineYourself={onDefineYourself}
        />
      ) : contestedCheck && state === "contested" ? (
        <ContestedFork
          className="mt-6"
          check={contestedCheck}
          unit={unit}
          formatHint={formatHint}
          onInvestigate={onInvestigate}
          onUsePathA={onRetry}
        />
      ) : turn.error ? (
        <ErrorCard error={turn.error} onRetry={onRetry} className="mt-5" />
      ) : (
        <>
          {/* 4 — Tier 1, the claim. The number snaps in; it never animates. */}
          {turn.result ? (
            <div className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-2">
              <p
                className="text-hero text-primary"
                aria-label={figureAriaLabel(
                  formatValue(turn.result.value, formatHint, { unit }),
                  state ?? "checking",
                  headline,
                )}
              >
                {formatValue(turn.result.value, formatHint, { unit })}
              </p>
              {state ? (
                <span className="mb-2">
                  <ConfidenceSeal
                    state={state}
                    size="standard"
                    passed={passed}
                    total={total}
                    onOpenEvidence={onOpenEvidence}
                    slowCheck={slowCheckOf(turn)}
                  />
                </span>
              ) : null}
            </div>
          ) : streaming ? (
            <div className="mt-6 flex items-end gap-4">
              <Skeleton className="h-11 w-64" />
              <Skeleton className="mb-2 h-[26px] w-32" />
            </div>
          ) : null}

          {turn.interpretation?.restated && turn.result ? (
            <p className="mt-1.5 text-body text-secondary">
              {turn.interpretation.restated}
            </p>
          ) : null}

          {/* 5 — the banner seal, only where it earns its place */}
          {state && meta?.banner && headline ? (
            <ConfidenceSeal
              className="mt-5"
              state={state}
              size="banner"
              passed={passed}
              total={total}
              headline={headline}
              onOpenEvidence={onOpenEvidence}
            />
          ) : null}

          {/* 6 — the chart. A scalar answer's figure is already the headline;
              rendering an axis-less chart under it would say nothing twice. */}
          {turn.chart && turn.chart.x && state ? (
            turn.result ? (
              <Viz
                className="mt-5"
                columns={turn.result.columns}
                rows={turn.result.rows}
                hint={turn.chart}
                override={turn.viz}
                onOverride={onVizChange}
                confidenceState={state}
                checks={turn.checks}
                passed={passed}
                total={total}
                caveat={headline}
                unit={unit}
                formatHint={formatHint}
                title={turn.chart.y[0]?.label}
              />
            ) : (
              // Axes render at final geometry before data arrives, so nothing jumps.
              <div className="mt-5 overflow-hidden rounded-lg border border-border-default bg-surface-1">
                <div className="flex h-9 items-center border-b border-border-subtle px-3">
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="px-3 pt-3">
                  <Skeleton className="h-[200px] w-full" />
                </div>
                <div className="px-3 pt-2 pb-3">
                  <Skeleton className="h-1 w-full" />
                </div>
              </div>
            )
          ) : null}

          {/* 7 — narrative, streamed */}
          {turn.narrative ? (
            <p
              aria-live="polite"
              className="mt-5 text-body text-secondary prose-measure"
            >
              {turn.narrative}
            </p>
          ) : streaming && turn.result ? (
            <div className="mt-5 space-y-1.5">
              <Skeleton className="h-3.5 w-full max-w-[62ch]" />
              <Skeleton className="h-3.5 w-full max-w-[54ch]" />
            </div>
          ) : null}

          {/* 8 — the collapsed footer */}
          {!streaming && turn.result ? (
            <StageSummary
              className="mt-5 border-t border-border-subtle pt-3"
              elapsedMs={turn.elapsedMs}
              checkCount={turn.checks.length}
              definition={
                turn.interpretation?.definition_used?.name || undefined
              }
              stages={turn.stages}
              detail={turn.stageDetail}
            />
          ) : null}

          {/* 9 — show the data */}
          {turn.result && turn.result.rows.length > 0 ? (
            <Disclosure
              className="mt-2"
              summary={
                <span className="text-ui-sm">
                  Show the data (
                  {turn.result.scanned_rows
                    ? `${formatCount(turn.result.scanned_rows)} rows → ${formatCount(turn.result.row_count)}`
                    : `${formatCount(turn.result.row_count)} rows`}
                  )
                </span>
              }
              contentClassName="mt-2"
            >
              <ResultTable
                columns={turn.result.columns}
                rows={turn.result.rows}
                formatHint={formatHint}
                unit={unit}
              />
            </Disclosure>
          ) : null}

          {/* 10 — follow-up suggestions, from the answer's own dimensions */}
          {!streaming && turn.result && active ? (
            <FollowUps turn={turn} onFollowUp={onFollowUp} className="mt-4" />
          ) : null}
        </>
      )}
    </article>
  );
}

function ResultTable({
  columns,
  rows,
  formatHint,
  unit,
}: {
  columns: ResultColumn[];
  rows: Cell[][];
  formatHint: import("@/lib/api/types").FormatHint;
  unit?: string;
}) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-border-default bg-surface-1">
      <table className="w-full border-collapse text-ui">
        <thead className="sticky top-0 bg-surface-2">
          <tr className="h-9">
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
                  {cell === null || cell === undefined ? (
                    <span className="text-disabled">—</span>
                  ) : columns[j]?.type === "quantitative" && typeof cell === "number" ? (
                    formatValue(cell, formatHint, { unit })
                  ) : (
                    String(cell)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FollowUps({
  turn,
  onFollowUp,
  className,
}: {
  turn: Turn;
  onFollowUp: (q: string) => void;
  className?: string;
}) {
  // Generated from the answer's actual dimensions, never generic.
  const suggestions = React.useMemo(() => {
    const out: string[] = [];
    const dim = turn.result?.columns.find((c) => c.type === "nominal");
    const time = turn.result?.columns.find((c) => c.type === "temporal");
    const measure = turn.result?.columns.find((c) => c.type === "quantitative");
    if (dim) out.push(`Break this down by ${(dim.label ?? dim.name).toLowerCase()}`);
    if (time) out.push("Compare with the same period last year");
    if (measure && turn.interpretation?.definition_used?.name)
      out.push(`What moved ${turn.interpretation.definition_used.name.toLowerCase()} most?`);
    return out.slice(0, 3);
  }, [turn]);

  if (suggestions.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-ui-sm text-tertiary">Follow up:</span>
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onFollowUp(s)}
          className="h-6 rounded-sm border border-border-subtle bg-surface-2 px-2 text-ui-sm text-secondary transition-colors duration-100 hover:border-border-hover hover:text-primary"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

/**
 * §9.13 / §1.6 — four causes, never a stack trace, and never removes the
 * question, the chips, or previous turns from the screen.
 */
export function ErrorCard({
  error,
  onRetry,
  className,
}: {
  error: ApiError;
  onRetry: () => void;
  className?: string;
}) {
  const { headline, actions } = describeError(error);
  return (
    <div
      className={cn(
        "rounded-lg border border-border-default bg-surface-1 p-4",
        className,
      )}
      role="alert"
    >
      <p className="text-subtitle text-primary">{headline}</p>
      <p className="mt-1 text-ui text-secondary">{error.message}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw size={13} />
          Retry
        </Button>
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            className="h-7 rounded-sm px-2 text-ui font-medium text-accent transition-colors duration-100 hover:bg-overlay-hover"
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}

function describeError(error: ApiError): { headline: string; actions: string[] } {
  switch (error.code) {
    case "source_unreachable":
      return { headline: "Can't reach the source", actions: ["Check connection"] };
    case "query_failed":
      return { headline: "The query didn't run", actions: ["Show SQL", "Rephrase"] };
    case "timeout":
      return {
        headline: "This took longer than expected",
        actions: ["Narrow the time range"],
      };
    case "permission_denied":
      return { headline: "You don't have access to this table", actions: ["Request access"] };
    default:
      return { headline: "The answer stopped early", actions: [] };
  }
}

export { sortChecks };

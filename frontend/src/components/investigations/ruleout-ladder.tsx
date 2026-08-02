"use client";

import * as React from "react";
import { Check, Circle, RotateCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RuleoutEvent, RuleoutStatus } from "@/lib/api/types";
import { Skeleton } from "@/components/ui/primitives";
import {
  PHASES,
  itemsInPhase,
  ladderOrder,
  phaseReached,
  type PhaseNumber,
} from "./model";

/**
 * The rule-out ladder — the spine of the investigation surface. screens.md §8.1.
 *
 * Three invariants this component exists to hold:
 *  1. Phases that never ran are rendered, at 45% opacity, with hollow glyphs
 *     and an explicit `not run` label. Hiding them would let a reader assume
 *     they passed.
 *  2. `■ STOPPED HERE` sits between the phase the ladder stopped in and the
 *     next one, connected by the spine. It is the proof that we did not go
 *     hunting for a business driver.
 *  3. A phase-level error does not halt the ladder — the remaining phases
 *     still render.
 */

const STATUS_GLYPH: Record<RuleoutStatus, React.ReactNode> = {
  implicated: <TriangleAlert size={13} strokeWidth={2.2} className="text-qualified" />,
  cleared: <Check size={13} strokeWidth={2.4} className="text-verified" />,
  not_run: <Circle size={12} strokeWidth={1.6} className="text-tertiary" />,
};

const STATUS_WORD: Record<RuleoutStatus, string> = {
  implicated: "implicated",
  cleared: "cleared",
  not_run: "not run",
};

function Spine({ tall = false }: { tall?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn("ml-6 w-px bg-border-strong", tall ? "h-4" : "h-3")}
    />
  );
}

function StoppedHere() {
  return (
    <div className="py-0.5">
      <Spine />
      <div className="flex items-center gap-2 rounded-sm border border-qualified-border bg-qualified-bg px-2.5 py-2">
        <span aria-hidden="true" className="text-[10px] leading-none text-qualified">
          ■
        </span>
        <span className="text-label text-qualified uppercase">Stopped here</span>
      </div>
      <Spine />
    </div>
  );
}

function LadderItem({
  item,
  revealed,
  open,
  onToggle,
}: {
  item: RuleoutEvent;
  revealed: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const notRun = item.status === "not_run";
  const expandable = !notRun && Boolean(item.finding);

  if (!revealed) {
    return (
      <li className="flex h-7 items-center gap-2 px-1.5">
        <Skeleton className="h-3 w-3 shrink-0 rounded-full" />
        <Skeleton className="h-2.5 w-full max-w-[120px]" />
      </li>
    );
  }

  return (
    <li className="ds-enter">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors duration-100",
          expandable && "hover:bg-overlay-hover",
          !expandable && "cursor-default",
        )}
      >
        <span className="shrink-0">{STATUS_GLYPH[item.status]}</span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-ui-sm",
            notRun ? "text-tertiary" : "text-secondary",
          )}
        >
          {item.label}
        </span>
        <span className="sr-only">{STATUS_WORD[item.status]}</span>
      </button>
      {expandable && open ? (
        <p className="ds-fade pr-1.5 pb-1.5 pl-[26px] text-ui-sm text-tertiary">
          {item.finding}
        </p>
      ) : null}
    </li>
  );
}

export function RuleoutLadder({
  question,
  ruleouts,
  stoppedAt,
  revealedCount,
  errorPhase,
  onRetryPhase,
  className,
}: {
  question: string;
  ruleouts: RuleoutEvent[];
  stoppedAt: PhaseNumber | null;
  /** How many ladder items have landed. Omit for "all of them". */
  revealedCount?: number;
  /** A phase whose run failed. The ladder continues past it. */
  errorPhase?: PhaseNumber | null;
  onRetryPhase?: (phase: PhaseNumber) => void;
  className?: string;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const order = React.useMemo(() => ladderOrder(ruleouts), [ruleouts]);
  const revealed = revealedCount ?? order.length;

  return (
    <nav aria-label="Rule-out ladder" className={cn("w-[260px] shrink-0", className)}>
      <p className="text-label text-tertiary uppercase">Investigation</p>
      <p className="mt-1.5 text-ui text-primary">{question}</p>

      <ol className="mt-4">
        {PHASES.map(({ phase, name }, i) => {
          const items = itemsInPhase(ruleouts, phase);
          const reached = phaseReached(ruleouts, phase);
          const errored = errorPhase === phase;

          return (
            <li key={phase}>
              {i > 0 && stoppedAt === phase - 1 ? <StoppedHere /> : null}
              {i > 0 && stoppedAt !== phase - 1 ? <Spine tall /> : null}

              <section
                aria-label={`Phase ${phase}, ${name}${reached ? "" : ", not run"}`}
                className={cn(
                  "rounded-md border border-border-default bg-surface-1 p-2 transition-opacity duration-100",
                  !reached && !errored && "opacity-45",
                )}
              >
                <header className="flex items-center gap-1.5 px-1.5 pb-1.5">
                  <span className="text-label text-tertiary tabular">{phase}</span>
                  <span className="text-label text-secondary uppercase">{name}</span>
                  <span className="flex-1" />
                  {!reached && !errored ? (
                    <span className="text-label text-tertiary lowercase">not run</span>
                  ) : null}
                </header>

                {errored ? (
                  <div className="rounded-sm border border-qualified-border bg-qualified-bg px-2 py-1.5">
                    <p className="flex items-start gap-1.5 text-ui-sm text-qualified">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                      This phase did not run — the query did not run.
                    </p>
                    {onRetryPhase ? (
                      <button
                        type="button"
                        onClick={() => onRetryPhase(phase)}
                        className="mt-1 inline-flex h-5 items-center gap-1 rounded-xs px-1 text-ui-sm font-medium text-qualified transition-colors duration-100 hover:bg-overlay-hover"
                      >
                        <RotateCw size={11} />
                        Retry this phase
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <ul>
                  {items.map((item) => {
                    const index = order.indexOf(item);
                    return (
                      <LadderItem
                        key={item.id}
                        item={item}
                        revealed={errored ? true : index < revealed}
                        open={openId === item.id}
                        onToggle={() =>
                          setOpenId((cur) => (cur === item.id ? null : item.id))
                        }
                      />
                    );
                  })}
                </ul>
              </section>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Skeleton at the ladder's final geometry — same boxes, same row counts. */
export function LadderSkeleton({ rows = [4, 4, 3] }: { rows?: number[] }) {
  return (
    <div aria-hidden="true" className="w-[260px] shrink-0">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="mt-2 h-3 w-full max-w-[200px]" />
      <div className="mt-4">
        {rows.map((n, i) => (
          <div key={i}>
            {i > 0 ? <div className="ml-6 h-4 w-px bg-border-subtle" /> : null}
            <div className="rounded-md border border-border-default bg-surface-1 p-2">
              <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
                <Skeleton className="h-2.5 w-24" />
              </div>
              {Array.from({ length: n }).map((_, r) => (
                <div key={r} className="flex h-7 items-center gap-2 px-1.5">
                  <Skeleton className="h-3 w-3 shrink-0 rounded-full" />
                  <Skeleton className="h-2.5 w-full max-w-[120px]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

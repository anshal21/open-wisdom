"use client";

import * as React from "react";
import { Check, GitFork, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import type { DefinitionCoverage, DefinitionProposal } from "@/lib/api/types";
import { Skeleton } from "@/components/ui/primitives";
import { Sparkline } from "@/components/charts/answer-chart";
import { Button } from "@/components/ui/button";

/**
 * screens.md §4.1. The coverage block is the answer to "is this working?", so
 * it opens the surface and it is composed, not a stat strip.
 *
 * Coverage is a share of questions, not a confidence score — §3.3 forbids the
 * latter and says nothing about the former. It carries no seal for the same
 * reason: nothing here was derived from the warehouse.
 */
export function CoverageHeader({ coverage }: { coverage: DefinitionCoverage }) {
  const { pct, previous_pct: previous } = coverage;
  const direction = pct > previous ? "up" : pct < previous ? "down" : "flat";
  const history = coverage.history.map((h) => h.pct);
  const first = history[0];
  const last = history[history.length - 1];

  const underTarget =
    coverage.clarification_rate_pct <= coverage.clarification_target_pct;

  return (
    <section
      aria-label="Definition coverage"
      className="rounded-lg border border-border-default bg-surface-1 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-[44ch]">
          <p className="text-hero text-primary">{formatPercent(pct, 0)}</p>
          <p className="mt-2 text-body text-secondary">
            of this month&rsquo;s questions were answered entirely from ratified
            definitions
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <p className="text-ui text-tertiary">
            <span className="text-primary tabular">{coverage.ratified}</span>{" "}
            ratified
            <span aria-hidden="true" className="px-1.5">
              ·
            </span>
            <span className="text-primary tabular">{coverage.proposed}</span>{" "}
            proposed
            <span aria-hidden="true" className="px-1.5">
              ·
            </span>
            <span className="text-primary tabular">{coverage.contested}</span>{" "}
            contested
          </p>

          <p
            className={cn(
              "text-ui font-medium",
              direction === "up"
                ? "text-verified"
                : direction === "down"
                  ? "text-contested"
                  : "text-tertiary",
            )}
          >
            <span aria-hidden="true">
              {direction === "up" ? "▲" : direction === "down" ? "▼" : "•"}
            </span>{" "}
            {direction === "up" ? "up" : direction === "down" ? "down" : "level"}{" "}
            from {formatPercent(previous, 0)}
          </p>

          <div className="flex items-center gap-3">
            <Sparkline values={history} width={216} height={32} />
            <span className="text-ui-sm text-tertiary">
              coverage, last {history.length} weeks
            </span>
            <span className="sr-only">
              Coverage moved from {formatPercent(first, 0)} to{" "}
              {formatPercent(last, 0)} over the last {history.length} weeks.
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline gap-3 border-t border-border-subtle pt-4">
        <span className="text-label text-tertiary uppercase">
          Clarification rate
        </span>
        <span className="text-title text-primary tabular">
          {formatPercent(coverage.clarification_rate_pct, 0)}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-ui",
            underTarget ? "text-verified" : "text-qualified",
          )}
        >
          {underTarget ? (
            <Check size={13} strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <TriangleAlert size={13} strokeWidth={2.25} aria-hidden="true" />
          )}
          {underTarget ? "under" : "over"} the{" "}
          {formatPercent(coverage.clarification_target_pct, 0)} target
        </span>
      </div>
    </section>
  );
}

/** Same box, same line heights, same gaps. §9.13 — geometry must not jump. */
export function CoverageHeaderSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="rounded-lg border border-border-default bg-surface-1 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-[44ch]">
          <div className="flex h-12 items-center">
            <Skeleton className="h-10 w-[124px]" />
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="flex h-[22px] items-center">
              <Skeleton className="h-3.5 w-[340px] max-w-full" />
            </div>
            <div className="flex h-[22px] items-center">
              <Skeleton className="h-3.5 w-[232px] max-w-full" />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <div className="flex h-[18px] items-center">
            <Skeleton className="h-3 w-[220px]" />
          </div>
          <div className="flex h-[18px] items-center">
            <Skeleton className="h-3 w-[104px]" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-[216px]" />
            <Skeleton className="h-3 w-[124px]" />
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3 border-t border-border-subtle pt-4">
        <div className="flex h-6 items-center">
          <Skeleton className="h-3 w-[112px]" />
        </div>
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-3 w-[148px]" />
      </div>
    </section>
  );
}

/**
 * §3.5 fork-rate governance. Renders only while the clarification rate is
 * genuinely over target — there is no demo switch, and the figures below are
 * computed from the live proposal queue rather than written down.
 */
export function ForkRateNudge({
  coverage,
  proposals,
  onReview,
}: {
  coverage: DefinitionCoverage;
  proposals: DefinitionProposal[];
  onReview: () => void;
}) {
  if (coverage.clarification_rate_pct <= coverage.clarification_target_pct) {
    return null;
  }

  const totalAsked = proposals.reduce((n, p) => n + p.asked_count, 0);
  if (totalAsked === 0) return null;

  // The smallest set of proposals that covers three quarters of recent forks.
  const ranked = [...proposals].sort((a, b) => b.asked_count - a.asked_count);
  let running = 0;
  let count = 0;
  for (const p of ranked) {
    running += p.asked_count;
    count += 1;
    if (running / totalAsked >= 0.75) break;
  }
  const covered = Math.round((running / totalAsked) * 100);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-accent-tint-border bg-accent-tint p-4">
      <GitFork
        size={15}
        strokeWidth={1.75}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-accent"
      />
      <div className="min-w-0 flex-1">
        <p className="text-subtitle text-accent">
          You&rsquo;re being asked to disambiguate often
        </p>
        <p className="mt-1 text-ui text-secondary">
          {formatPercent(coverage.clarification_rate_pct, 0)} of questions asked
          for a clarification, against a{" "}
          {formatPercent(coverage.clarification_target_pct, 0)} target. Ratifying{" "}
          {count === 1 ? "this definition" : `these ${count} definitions`} would
          cover {covered}% of recent forks.
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={onReview}>
        Review the queue
      </Button>
    </div>
  );
}

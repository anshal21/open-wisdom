"use client";

import * as React from "react";
import { GitFork } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DefinitionProposal } from "@/lib/api/types";
import { formatCount, formatRelative, formatValue, isoTitle } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/keyboard";
import { Button } from "@/components/ui/button";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Skeleton } from "@/components/ui/primitives";

type Reading = DefinitionProposal["readings"][number];

const READING_INK = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];

/** Proposals stream in with a 40ms stagger; past six they land together. §14 */
const STAGGER_MS = 40;
const MAX_STAGGERED = 6;

export function ProposalQueue({
  proposals,
  onRatify,
  onBoth,
  onDismiss,
  busyId,
}: {
  proposals: DefinitionProposal[];
  onRatify: (proposal: DefinitionProposal, reading: Reading) => void;
  onBoth: (proposal: DefinitionProposal) => void;
  onDismiss: (proposal: DefinitionProposal) => void;
  busyId?: string | null;
}) {
  const reduced = usePrefersReducedMotion();
  const [revealed, setRevealed] = React.useState(1);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (reduced || started.current) return;
    started.current = true;
    let shown = 1;
    const timer = window.setInterval(() => {
      shown += 1;
      if (shown >= MAX_STAGGERED) {
        // Past the sixth card the entrance stops being legible; land the rest.
        setRevealed(Number.MAX_SAFE_INTEGER);
        window.clearInterval(timer);
        return;
      }
      setRevealed(shown);
    }, STAGGER_MS);
    return () => window.clearInterval(timer);
  }, [reduced]);

  const shown = reduced ? proposals.length : Math.min(revealed, proposals.length);

  return (
    <div className="space-y-4">
      {proposals.slice(0, shown).map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          onRatify={onRatify}
          onBoth={onBoth}
          onDismiss={onDismiss}
          busy={busyId === p.id}
          animate={!reduced}
        />
      ))}
    </div>
  );
}

export function ProposalCard({
  proposal,
  onRatify,
  onBoth,
  onDismiss,
  busy = false,
  animate = false,
}: {
  proposal: DefinitionProposal;
  onRatify: (proposal: DefinitionProposal, reading: Reading) => void;
  onBoth: (proposal: DefinitionProposal) => void;
  onDismiss: (proposal: DefinitionProposal) => void;
  busy?: boolean;
  animate?: boolean;
}) {
  return (
    <article
      aria-label={`Proposed definition: ${proposal.term}`}
      className={cn(
        "rounded-lg border border-border-default bg-surface-1 p-5",
        animate && "ds-enter",
      )}
    >
      <header className="flex flex-wrap items-center gap-3">
        <GitFork
          size={15}
          strokeWidth={1.75}
          aria-hidden="true"
          className="shrink-0 text-accent"
        />
        <h3 className="min-w-0 truncate text-title text-primary">
          &ldquo;{proposal.term}&rdquo;
        </h3>
        <ConfidenceSeal state="refused" size="inline" />
        <span className="flex-1" />
        <time
          dateTime={proposal.proposed_at}
          title={isoTitle(proposal.proposed_at)}
          className="shrink-0 text-ui-sm text-tertiary"
        >
          proposed {formatRelative(proposal.proposed_at)}
        </time>
      </header>

      <p className="mt-3 text-body text-secondary">
        Asked {formatCount(proposal.asked_count)} times. Answered{" "}
        {formatCount(proposal.answered_ways)} different ways.
      </p>

      <ul className="mt-4 space-y-2">
        {proposal.readings.map((r, i) => (
          <li
            key={r.id}
            className="grid grid-cols-[10px_1fr_auto] items-baseline gap-3"
          >
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: READING_INK[i % READING_INK.length],
              }}
            />
            <span className="min-w-0">
              <span className="text-ui font-medium text-primary">{r.label}</span>
              <span className="ml-2 font-mono text-mono-sm text-tertiary">
                {r.expression}
              </span>
            </span>
            <span className="shrink-0 text-ui text-secondary tabular">
              {formatValue(r.value, r.format_hint, { unit: r.unit })}
              <span className="text-tertiary"> in {r.period_label}</span>
              <span className="ml-3 text-tertiary">
                used {formatCount(r.used_count)}×
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-right text-ui font-medium text-accent">
        {proposal.spread_label}
      </p>

      <p className="mt-4 text-ui-sm text-secondary">
        <span className="text-label text-tertiary uppercase">Evidence</span>{" "}
        <span className="ml-1">{proposal.evidence}</span>
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {proposal.readings.map((r) => (
          <Button
            key={r.id}
            variant="secondary"
            onClick={() => onRatify(proposal, r)}
            disabled={busy}
          >
            Ratify {r.label.toLowerCase()}
          </Button>
        ))}
        {/* Many ambiguities are two legitimate metrics wearing one word, so
            naming both apart is a first-class resolution, not a fallback. */}
        <Button variant="primary" onClick={() => onBoth(proposal)} loading={busy}>
          Both, named apart
        </Button>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(proposal)}
        disabled={busy}
        className="mt-3 rounded-sm text-ui-sm text-tertiary transition-colors duration-100 hover:text-primary disabled:text-disabled"
      >
        Dismiss — not worth defining
      </button>
    </article>
  );
}

/** Same card geometry, so nothing jumps when the queue lands. §9.13 */
export function ProposalQueueSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border-default bg-surface-1 p-5"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded-xs" />
            <Skeleton className="h-4 w-[172px]" />
            <Skeleton className="h-5 w-[84px] rounded-xs" />
            <span className="flex-1" />
            <Skeleton className="h-3 w-[120px]" />
          </div>
          <div className="mt-3 flex h-[22px] items-center">
            <Skeleton className="h-3.5 w-[292px]" />
          </div>
          <div className="mt-4 space-y-2">
            {Array.from({ length: 2 }).map((__, j) => (
              <div key={j} className="flex h-4 items-center gap-3">
                <Skeleton className="h-1.5 w-1.5 rounded-full" />
                <Skeleton className="h-3 w-[268px]" />
                <span className="flex-1" />
                <Skeleton className="h-3 w-[196px]" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex h-[18px] justify-end">
            <Skeleton className="h-3 w-[72px]" />
          </div>
          <div className="mt-4 flex h-4 items-center">
            <Skeleton className="h-3 w-full max-w-[520px]" />
          </div>
          <div className="mt-5 flex gap-2">
            <Skeleton className="h-8 w-[136px] rounded-md" />
            <Skeleton className="h-8 w-[168px] rounded-md" />
            <Skeleton className="h-8 w-[152px] rounded-md" />
          </div>
          <div className="mt-3 flex h-4 items-center">
            <Skeleton className="h-3 w-[176px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

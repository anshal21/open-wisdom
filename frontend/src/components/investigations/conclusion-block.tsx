"use client";

import * as React from "react";
import { ChevronRight, Share2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Investigation } from "@/lib/api/types";
import { CONFIDENCE, HUE_CLASS } from "@/lib/confidence";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Button } from "@/components/ui/button";
import { Kbd, ProvenanceStamp } from "@/components/ui/primitives";
import { formatAbsolute, formatRelative, isoTitle } from "@/lib/format";
import {
  DELTA_INK_CLASS,
  VERDICT_META,
  readComparison,
  stoppedSentence,
} from "./model";

/**
 * The conclusion block. screens.md §8.2 / §8.3.
 *
 * The figures are rendered as an honest comparison: the raw total with its
 * delta AND the normalized rate with its delta, side by side. A delta never
 * appears without its base — the wire carries the base in `comparison`.
 *
 * The null result (§8.3) uses this same block at the same typographic weight.
 * It is a finding, not an empty state.
 */

function Figure({
  figure,
  state,
  passed,
  total,
  onOpenEvidence,
}: {
  figure: Investigation["verdict"]["figures"][number];
  state: React.ComponentProps<typeof ConfidenceSeal>["state"];
  passed: number;
  total: number;
  onOpenEvidence?: () => void;
}) {
  const { ink, arrow } = readComparison(figure.comparison);
  return (
    <div className="min-w-0 rounded-md border border-border-default bg-surface-1 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-ui-sm text-tertiary">{figure.label}</p>
        <ConfidenceSeal
          size="inline"
          state={state}
          passed={passed}
          total={total}
          onOpenEvidence={onOpenEvidence}
        />
      </div>
      <p className="mt-1 text-title-lg tabular text-primary">{figure.value}</p>
      <p className={cn("mt-0.5 text-ui-sm tabular", DELTA_INK_CLASS[ink])}>
        {arrow ? (
          <span aria-hidden="true" className="mr-1">
            {arrow}
          </span>
        ) : null}
        {figure.comparison}
      </p>
    </div>
  );
}

export function ConclusionBlock({
  investigation,
  authorName,
  authorInitials,
  overruled,
  segmentsShown,
  onInvestigateAnyway,
  onShowSegments,
  onShare,
  onOpenEvidence,
  segmentCount,
}: {
  investigation: Investigation;
  authorName: string;
  authorInitials?: string;
  overruled: boolean;
  segmentsShown: boolean;
  onInvestigateAnyway: () => void;
  onShowSegments: () => void;
  onShare: () => void;
  onOpenEvidence: () => void;
  segmentCount: number;
}) {
  const { verdict, report, stopped_at: stoppedAt } = investigation;
  const meta = VERDICT_META[verdict.kind];
  const hue = HUE_CLASS[CONFIDENCE[meta.state].hue];
  const nullResult = verdict.kind === "no_driver";

  return (
    <section aria-labelledby="conclusion-headline">
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-1 shrink-0", hue.fg)}>
          <ConfidenceGlyph state={meta.state} size={20} />
        </span>
        <h2 id="conclusion-headline" className="text-title-lg text-primary">
          {verdict.headline}
        </h2>
      </div>

      <p className="prose-measure mt-3 text-body text-secondary">{verdict.detail}</p>

      {verdict.figures.length > 0 ? (
        <div
          className={cn(
            "mt-4 grid gap-3",
            verdict.figures.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1",
          )}
        >
          {verdict.figures.map((f) => (
            <Figure
              key={f.label}
              figure={f}
              state={report.confidence}
              passed={report.passed}
              total={report.total}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </div>
      ) : null}

      {stoppedAt ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-accent-tint-border bg-accent-tint px-3 py-2.5">
          <span aria-hidden="true" className="mt-px shrink-0 text-ui text-accent">
            ⑂
          </span>
          <p className="prose-measure text-ui text-secondary">
            {stoppedSentence(investigation)}
          </p>
        </div>
      ) : null}

      {nullResult ? (
        <p className="prose-measure mt-4 text-body text-secondary">
          This is consistent with ordinary variation. Every contribution below sits
          inside its own normal range, so there is no driver to chase.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {stoppedAt && !overruled ? (
          <Button variant="secondary" size="md" onClick={onInvestigateAnyway}>
            Investigate anyway
            <ChevronRight size={14} />
          </Button>
        ) : null}

        {nullResult ? (
          <>
            <Button
              variant="secondary"
              size="md"
              aria-expanded={segmentsShown}
              onClick={onShowSegments}
            >
              {segmentsShown ? "Hide" : "Show all"} {segmentCount} segments
            </Button>
          </>
        ) : null}

        <Button variant="secondary" size="md" onClick={onShare}>
          <Share2 size={14} />
          Share
          <Kbd className="ml-0.5">⌘⇧C</Kbd>
        </Button>
      </div>

      <div className="mt-4">
        <ProvenanceStamp
          name={authorName}
          initials={authorInitials}
          at={isoTitle(investigation.created_at)}
          atLabel={formatRelative(investigation.created_at)}
        />
        <span className="sr-only">{formatAbsolute(investigation.created_at)}</span>
      </div>
    </section>
  );
}

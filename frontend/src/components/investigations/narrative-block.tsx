"use client";

import type { Investigation } from "@/lib/api/types";
import { CONFIDENCE } from "@/lib/confidence";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Skeleton } from "@/components/ui/primitives";
import { firstSentences } from "./model";

/**
 * The written conclusion. screens.md §8.5 — `body` type, capped at 68ch by
 * `prose-measure`, at most five sentences, generated last.
 */
export function NarrativeBlock({
  investigation,
  onOpenEvidence,
}: {
  investigation: Investigation;
  onOpenEvidence?: () => void;
}) {
  const { report } = investigation;
  return (
    <section aria-labelledby="narrative-label">
      <div className="flex items-center gap-3">
        <h3 id="narrative-label" className="text-label text-tertiary uppercase">
          Conclusion
        </h3>
        <span className="flex-1" />
        <ConfidenceSeal
          size="standard"
          state={report.confidence}
          passed={report.passed}
          total={report.total}
          onOpenEvidence={onOpenEvidence}
        />
      </div>
      <p className="prose-measure mt-3 text-body text-secondary">
        {firstSentences(investigation.narrative, 5)}
      </p>
    </section>
  );
}

export function NarrativeSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-2.5 w-24" />
      <div className="mt-3 space-y-2">
        <Skeleton className="h-3 w-full max-w-[560px]" />
        <Skeleton className="h-3 w-full max-w-[540px]" />
        <Skeleton className="h-3 w-full max-w-[500px]" />
      </div>
    </div>
  );
}

/**
 * `⌘⇧C` copies the narrative with the seal, the numbers and the permalink —
 * everything a reader needs to judge the claim outside this surface.
 */
export function buildShareText(investigation: Investigation, permalink: string): string {
  const { verdict, report } = investigation;
  const seal = CONFIDENCE[report.confidence].label;
  const figures = verdict.figures
    .map((f) => `${f.label}: ${f.value} · ${f.comparison}`)
    .join("\n");

  return [
    verdict.headline,
    "",
    firstSentences(investigation.narrative, 5),
    "",
    figures,
    "",
    `${seal} · ${report.passed} of ${report.total} checks · ${report.headline}`,
    permalink,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

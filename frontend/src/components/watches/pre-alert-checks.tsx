"use client";

import type { Check } from "@/lib/api/types";
import { sortChecks, tally } from "@/lib/confidence";
import { CheckRow } from "@/components/evidence/check-row";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Skeleton } from "@/components/ui/primitives";
import type { ConfidenceState } from "@/lib/confidence";

/**
 * `BEFORE ALERTING, WE CHECKED`. screens.md §9.2 — the whole point of the
 * surface. The same check apparatus that verifies an answer gates the alert.
 * An alert that fired without these is the flooding behaviour everyone ships.
 */
export function PreAlertChecks({
  checks,
  state,
  heldHours,
  heldReason,
}: {
  checks: Check[];
  state: ConfidenceState;
  heldHours?: number;
  heldReason?: string;
}) {
  const counts = tally(checks);
  return (
    <section aria-labelledby="pre-alert-label">
      <div className="flex items-center gap-3">
        <h3 id="pre-alert-label" className="text-label text-tertiary uppercase">
          Before alerting, we checked
        </h3>
        <span className="flex-1" />
        <ConfidenceSeal
          size="inline"
          state={state}
          passed={counts.passed}
          total={counts.total}
        />
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        {sortChecks(checks).map((c, i) => (
          <CheckRow key={c.id} check={c} index={i} />
        ))}
      </div>

      {/* Held alerts are shown, not hidden — the judgment is the product. §9.2 */}
      {heldHours ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-ui text-accent">
          <span aria-hidden="true" className="shrink-0">
            →
          </span>
          <span>
            This alert was held for {heldHours} {heldHours === 1 ? "hour" : "hours"}
            {heldReason ? ` because ${heldReason}` : ""}.
          </span>
        </p>
      ) : null}
    </section>
  );
}

export function PreAlertSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-2.5 w-48" />
      <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-start gap-2 border-b border-border-subtle px-3 py-2.5 last:border-0">
            <Skeleton className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-1.5 h-2.5 w-full max-w-[280px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

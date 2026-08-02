"use client";

import * as React from "react";
import { Pin, PinOff, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCount, formatRelative, isoTitle } from "@/lib/format";
import { CONFIDENCE, sortChecks } from "@/lib/confidence";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { ShieldCheckFilled } from "@/components/seal/glyphs";
import { IconButton } from "@/components/ui/button";
import { Disclosure, SectionLabel, Skeleton } from "@/components/ui/primitives";
import { SqlViewer } from "@/components/ui/sql-viewer";
import { CheckRow, PendingCheckRow } from "./check-row";
import { useEvidence } from "@/state/evidence";
import { useUi } from "@/state/ui";

export function EvidencePanel({
  onRatify,
  className,
}: {
  onRatify?: (definitionId: string) => void;
  className?: string;
}) {
  const { subject, pinned, setPinned } = useEvidence();
  const { setEvidenceOpen, evidenceTier, setEvidenceTier } = useUi();

  return (
    <aside
      aria-label="Evidence"
      className={cn("flex h-full flex-col bg-surface-1", className)}
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-3">
        <span className="text-label text-tertiary uppercase">Evidence</span>
        <span className="flex-1" />
        <IconButton
          label={pinned ? "Unpin evidence" : "Pin evidence"}
          size="xs"
          onClick={() => setPinned(!pinned)}
          className={pinned ? "text-accent" : undefined}
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </IconButton>
        <IconButton label="Close evidence" size="xs" onClick={() => setEvidenceOpen(false)}>
          <X size={13} />
        </IconButton>
      </header>

      {subject ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-3 pt-2.5 pb-1 text-ui-sm text-tertiary">
            Pinned to {subject.label}
          </p>

          <div className="px-3 pb-3">
            <ConfidenceSeal
              size="banner"
              state={subject.state}
              passed={subject.passed}
              total={subject.total}
              headline={subject.headline}
            />
          </div>

          <div className="border-t border-border-subtle">
            <div className="px-3 pt-2.5">
              <SectionLabel count={subject.checks.length || subject.pendingChecks?.length}>
                Checks
              </SectionLabel>
            </div>
            <div>
              {subject.checks.length > 0
                ? sortChecks(subject.checks).map((c, i) => (
                    <CheckRow key={c.id} check={c} index={i} stagger />
                  ))
                : (subject.pendingChecks ?? []).map((id) => (
                    <PendingCheckRow key={id} id={id} />
                  ))}
              {subject.checks.length === 0 && !subject.pendingChecks?.length ? (
                <div className="space-y-2 px-3 py-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="space-y-1.5 py-1">
                      <Skeleton className="h-3 w-40" />
                      <Skeleton className="h-2.5 w-full" />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {subject.definitions && subject.definitions.length > 0 ? (
            <div className="border-t border-border-subtle px-3 py-2.5">
              <SectionLabel>Definitions used</SectionLabel>
              <ul className="mt-1 space-y-1.5">
                {subject.definitions.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <ShieldCheckFilled
                      size={12}
                      className={d.inferred ? "text-disabled" : "text-verified"}
                    />
                    <span className="truncate text-ui text-primary">
                      {d.name}
                      {d.version ? (
                        <span className="ml-1 text-tertiary">v{d.version}</span>
                      ) : null}
                    </span>
                    {d.inferred ? (
                      <button
                        type="button"
                        onClick={() => onRatify?.(d.id)}
                        className="ml-auto shrink-0 text-ui-sm font-medium text-accent hover:underline"
                      >
                        inferred · ratify?
                      </button>
                    ) : (
                      <span className="ml-auto shrink-0 text-ui-sm text-tertiary">
                        {d.ratifiedBy}
                        {d.ratifiedAt ? (
                          <>
                            {" · "}
                            <time dateTime={d.ratifiedAt} title={isoTitle(d.ratifiedAt)}>
                              {formatRelative(d.ratifiedAt)}
                            </time>
                          </>
                        ) : null}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {subject.coverage ? (
            <div className="border-t border-border-subtle px-3 py-2.5">
              <SectionLabel>Coverage</SectionLabel>
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (subject.coverage.included / Math.max(1, subject.coverage.total)) * 100)}%`,
                      backgroundColor: "var(--c-accent-solid)",
                    }}
                  />
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-ui-sm tabular",
                    subject.coverage.included / Math.max(1, subject.coverage.total) < 0.95
                      ? "text-qualified"
                      : "text-tertiary",
                  )}
                >
                  {formatCount(subject.coverage.included)} /{" "}
                  {formatCount(subject.coverage.total)} rows
                  {subject.coverage.reason ? ` — ${subject.coverage.reason}` : ""}
                </p>
              </div>
            </div>
          ) : null}

          {subject.derivation ? (
            <div className="border-t border-border-subtle px-3 py-2.5">
              <Disclosure
                open={evidenceTier === 3}
                onOpenChange={(v) => setEvidenceTier(v ? 3 : 2)}
                summary={
                  <span className="flex w-full items-center justify-between">
                    <span>
                      Derivation
                      {subject.derivation.paths.length > 1
                        ? ` (SQL, ${subject.derivation.paths.length} paths)`
                        : " (SQL)"}
                    </span>
                    <span className="text-ui-sm text-disabled">⌥E</span>
                  </span>
                }
                contentClassName="pt-2 space-y-3"
              >
                {subject.derivation.paths.length > 0 ? (
                  <SqlViewer
                    paths={subject.derivation.paths}
                    rowCount={subject.derivation.rowCount}
                    elapsedMs={subject.derivation.elapsedMs}
                    maxHeight={260}
                  />
                ) : null}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-ui-sm">
                  {subject.derivation.scannedRows ? (
                    <>
                      <dt className="text-tertiary">Rows scanned</dt>
                      <dd className="text-right tabular text-secondary">
                        {formatCount(subject.derivation.scannedRows)}
                      </dd>
                    </>
                  ) : null}
                  {subject.derivation.elapsedMs ? (
                    <>
                      <dt className="text-tertiary">Elapsed</dt>
                      <dd className="text-right tabular text-secondary">
                        {(subject.derivation.elapsedMs / 1000).toFixed(1)}s
                      </dd>
                    </>
                  ) : null}
                  {subject.derivation.llmCalls ? (
                    <>
                      <dt className="text-tertiary">Model calls</dt>
                      <dd className="text-right tabular text-secondary">
                        {subject.derivation.llmCalls}
                      </dd>
                    </>
                  ) : null}
                  {typeof subject.derivation.usd === "number" ? (
                    <>
                      <dt className="text-tertiary">Cost</dt>
                      <dd className="text-right tabular text-secondary">
                        ${subject.derivation.usd.toFixed(2)}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </Disclosure>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-ui font-medium text-secondary">Nothing focused</p>
          <p className="mt-1 text-ui-sm text-tertiary">
            Focus an answer, a tile, a cell or a ledger row and its checks appear here.
          </p>
        </div>
      )}
    </aside>
  );
}

/** Small helper so surfaces can describe their seal in one line. */
export function sealHeadline(state: keyof typeof CONFIDENCE, headline?: string) {
  return headline ?? CONFIDENCE[state].label;
}

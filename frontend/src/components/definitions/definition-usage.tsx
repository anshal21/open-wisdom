"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { AnswerSummary, Definition, DefinitionImpact } from "@/lib/api/types";
import { EMPTY, formatAbsolute, formatCount, formatValue, isoTitle } from "@/lib/format";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { Skeleton } from "@/components/ui/primitives";

/**
 * §4.5 usage — which answers depend on this definition, and what a change to it
 * would cost. The warning count is the honest part: a definition is not free to
 * edit once the ledger references it.
 */
export function DefinitionUsage({
  definition,
  answers,
  impact,
  loading = false,
}: {
  definition: Definition;
  answers: AnswerSummary[];
  impact: DefinitionImpact | null;
  loading?: boolean;
}) {
  if (loading) return <DefinitionUsageSkeleton />;

  const wouldBreak = impact?.would_change ? impact.affected_answers : 0;

  return (
    <div>
      {wouldBreak > 0 ? (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-qualified-border bg-qualified-bg px-3 py-2 text-ui text-qualified">
          <TriangleAlert
            size={14}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          <span>
            Changing this definition would change{" "}
            <span className="tabular">{formatCount(wouldBreak)}</span> recorded{" "}
            {wouldBreak === 1 ? "answer" : "answers"}. They stay in the ledger,
            marked Superseded, until they are re-run.
          </span>
        </p>
      ) : null}

      {answers.length === 0 ? (
        <p className="text-ui text-secondary">
          No recorded answer has used {definition.name} yet. It has been
          referenced{" "}
          <span className="tabular">{formatCount(definition.usage_count)}</span>{" "}
          times in total.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-default bg-surface-1">
          {answers.map((a) => (
            <li key={a.id}>
              <Link
                href={`/a/${a.id}`}
                className="group flex items-center gap-3 px-3 py-2 transition-colors duration-100 hover:bg-overlay-hover"
              >
                <ConfidenceSeal
                  state={a.superseded ? "superseded" : a.confidence}
                  size="inline"
                  labelHidden
                />
                <span className="min-w-0 flex-1 truncate text-ui text-primary">
                  {a.question}
                </span>
                <span className="shrink-0 text-ui text-secondary tabular">
                  {a.value === null
                    ? EMPTY
                    : formatValue(a.value, a.format_hint, { unit: a.unit })}
                </span>
                <time
                  dateTime={a.created_at}
                  title={isoTitle(a.created_at)}
                  className="shrink-0 text-ui-sm text-tertiary tabular"
                >
                  {formatAbsolute(a.created_at, false)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DefinitionUsageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-default bg-surface-1"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 px-3">
          <Skeleton className="h-5 w-5 rounded-xs" />
          <Skeleton className="h-3 w-full max-w-[340px]" />
          <span className="flex-1" />
          <Skeleton className="h-3 w-[76px]" />
          <Skeleton className="h-3 w-[88px]" />
        </div>
      ))}
    </div>
  );
}

/** §4.5 conflicts. Rendered only when the definition actually has one. */
export function DefinitionConflicts({
  definition,
}: {
  definition: Definition;
}) {
  const conflicts = definition.conflicts ?? [];
  if (conflicts.length === 0) return null;

  return (
    <ul className="space-y-2">
      {conflicts.map((c) => (
        <li
          key={c.id}
          className="rounded-lg border border-contested-border bg-contested-bg p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceSeal state="contested" size="inline" />
            <Link
              href={`/definitions/${c.id}`}
              className="text-subtitle text-primary transition-colors duration-100 hover:text-accent"
            >
              {c.name}
            </Link>
          </div>
          <p className="mt-1.5 text-ui text-secondary">{c.reason}</p>
        </li>
      ))}
    </ul>
  );
}

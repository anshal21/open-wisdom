"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCount, formatMultiple, formatValue } from "@/lib/format";
import type { AmbiguityPayload, FormatHint } from "@/lib/api/types";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import { SpreadBar } from "@/components/charts/product-forms";
import { Button } from "@/components/ui/button";

/**
 * The compact, in-cell variant of the ambiguity fork. screens.md §14 — in a
 * notebook the fork renders inside the cell rather than taking the screen.
 *
 * Indigo, never red, never amber, no alert icon, and no word "error". The
 * candidates are already computed, so refusal is the fastest path to a correct
 * answer rather than a delay. §3.3
 */
export function InCellFork({
  ambiguity,
  unit,
  formatHint = "currency",
  onUse,
  busy = false,
  className,
}: {
  ambiguity: AmbiguityPayload;
  unit?: string;
  formatHint?: FormatHint;
  onUse: (candidateId: string, ratify: boolean) => void;
  busy?: boolean;
  className?: string;
}) {
  const [selected, setSelected] = React.useState<string | null>(
    ambiguity.candidates.find((c) => c.recommendation_basis)?.id ?? null,
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-accent-tint-border bg-accent-tint p-4",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-title text-accent">
        <ConfidenceGlyph state="refused" size={16} />
        This question has {ambiguity.candidates.length} defensible answers
      </p>
      <p className="mt-1 text-ui-sm text-secondary">
        They differ by {formatMultiple(ambiguity.spread.ratio)}. Which one do you mean?
      </p>

      <SpreadBar
        className="mt-3"
        candidates={ambiguity.candidates}
        spread={ambiguity.spread}
        unit={unit}
        formatHint={formatHint}
        selectedId={selected}
        onSelect={setSelected}
      />

      <ul className="mt-4 flex flex-col gap-1.5">
        {ambiguity.candidates.map((c) => {
          const active = selected === c.id;
          return (
            <li
              key={c.id}
              onMouseEnter={() => setSelected(c.id)}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border bg-surface-1 px-3 py-2.5 transition-colors duration-100",
                active ? "border-border-accent" : "border-border-default",
              )}
            >
              <div className="min-w-0 flex-1">
                {c.recommendation_basis ? (
                  <p className="mb-0.5 text-label text-accent uppercase">
                    Recommended · {c.recommendation_basis}
                  </p>
                ) : null}
                <p className="flex items-baseline gap-2.5">
                  <span className="text-title-lg tabular text-primary">
                    {formatValue(c.value, formatHint, { unit })}
                  </span>
                  <span className="min-w-0 truncate text-ui font-medium text-primary">
                    {c.label}
                  </span>
                </p>
                <p className="mt-0.5 text-ui-sm text-secondary">{c.description}</p>
                {typeof c.rows_included === "number" &&
                typeof c.rows_total === "number" ? (
                  <p className="mt-1 text-ui-sm tabular text-tertiary">
                    {formatCount(c.rows_included)} of {formatCount(c.rows_total)} rows
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onUse(c.id, false)}
                >
                  Use once
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => onUse(c.id, true)}
                >
                  Use &amp; ratify
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Link
        href="/definitions"
        className="mt-3 inline-block text-ui-sm font-medium text-accent hover:underline"
      >
        None of these — define it yourself
      </Link>
    </div>
  );
}

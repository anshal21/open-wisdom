"use client";

import { EqualNot } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatValue } from "@/lib/format";
import type { Check, FormatHint } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { SqlViewer } from "@/components/ui/sql-viewer";
import { Disclosure } from "@/components/ui/primitives";

/**
 * screens.md §3.4 — two derivations of the *same* reading disagree.
 * No number is promoted to the hero. `Use Path A anyway` is never primary.
 */
export function ContestedFork({
  check,
  unit,
  formatHint = "number",
  onInvestigate,
  onUsePathA,
  className,
}: {
  check: Check;
  unit?: string;
  formatHint?: FormatHint;
  onInvestigate: () => void;
  onUsePathA: () => void;
  className?: string;
}) {
  const a = check.detail?.value_path_a;
  const b = check.detail?.value_path_b;
  const gapPct =
    typeof a === "number" && typeof b === "number" && a !== 0
      ? Math.abs((a - b) / a) * 100
      : null;

  return (
    <section
      className={cn(
        "ds-fade rounded-xl border border-contested-border bg-contested-bg/40 p-5",
        className,
      )}
      aria-label="Two ways of computing this disagree"
    >
      <header className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-contested">
          <EqualNot size={20} strokeWidth={2} />
        </span>
        <h2 className="text-title text-primary">
          Two ways of computing this disagree
        </h2>
      </header>

      <div className="mt-5 flex flex-wrap items-end gap-x-10 gap-y-4 pl-8">
        <div>
          <p className="text-label text-tertiary uppercase">Path A</p>
          <p className="mt-1 text-hero-sm tabular text-primary">
            {formatValue(a ?? null, formatHint, { unit })}
          </p>
        </div>
        <div>
          <p className="text-label text-tertiary uppercase">Path B</p>
          <p className="mt-1 text-hero-sm tabular text-primary">
            {formatValue(b ?? null, formatHint, { unit })}
          </p>
        </div>
        {gapPct !== null ? (
          <p className="pb-2 text-subtitle text-contested tabular">
            {gapPct.toFixed(2)}% apart
          </p>
        ) : null}
      </div>

      {check.detail?.why ? (
        <p className="mt-4 pl-8 text-body text-secondary prose-measure">
          {check.detail.why}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2 pl-8">
        <Button variant="primary" onClick={onInvestigate}>
          Investigate the gap
        </Button>
        <Button variant="secondary" onClick={onUsePathA}>
          Use Path A anyway
        </Button>
      </div>

      {check.detail?.sql_path_a || check.detail?.sql_path_b ? (
        <Disclosure
          className="mt-4 pl-8"
          summary={<span className="text-ui-sm">Show both queries</span>}
          contentClassName="mt-2"
        >
          <SqlViewer
            maxHeight={220}
            paths={[
              ...(check.detail.sql_path_a
                ? [{ label: "Path A", sql: check.detail.sql_path_a }]
                : []),
              ...(check.detail.sql_path_b
                ? [{ label: "Path B", sql: check.detail.sql_path_b }]
                : []),
            ]}
          />
        </Disclosure>
      ) : null}

      <p className="mt-4 pl-8 text-ui-sm text-tertiary">
        Using a path anyway records the answer with a permanent Contested seal.
      </p>
    </section>
  );
}

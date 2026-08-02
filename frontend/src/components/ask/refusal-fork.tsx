"use client";

import * as React from "react";
import { GitFork, Target } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMultiple, formatValue } from "@/lib/format";
import type { AmbiguityCandidate, AmbiguityPayload, FormatHint } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/primitives";
import { SqlBlock } from "@/components/ui/sql-viewer";
import { ShieldCheckFilled } from "@/components/seal/glyphs";
import { CandidateCoverage, SpreadBar } from "@/components/charts/product-forms";

/**
 * The ambiguity fork. screens.md §3.
 *
 * The candidates are already computed by the time this renders, so refusal is
 * not a delay — it is the fastest path to a correct answer. That is what makes
 * it read as power rather than friction.
 *
 * No red. No amber. No alert icon. No "error" word anywhere on this screen.
 */
export function RefusalFork({
  ambiguity,
  unit = "currency",
  formatHint = "currency",
  onUseOnce,
  onUseAndRatify,
  onDefineYourself,
  className,
}: {
  ambiguity: AmbiguityPayload;
  unit?: string;
  formatHint?: FormatHint;
  onUseOnce: (candidateId: string) => void;
  onUseAndRatify: (candidateId: string) => void;
  onDefineYourself: () => void;
  className?: string;
}) {
  // Candidates order by likelihood, never by value. The recommended card is first.
  const ordered = React.useMemo(() => {
    const recommended = ambiguity.candidates.filter((c) => c.recommendation_basis);
    const rest = ambiguity.candidates.filter((c) => !c.recommendation_basis);
    return [...recommended, ...rest];
  }, [ambiguity.candidates]);

  const primary = ordered.slice(0, 3);
  const overflow = ordered.slice(3);
  const [showOverflow, setShowOverflow] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(
    ordered[0]?.id ?? null,
  );

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA/.test(target.tagName)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= primary.length) {
        e.preventDefault();
        setSelected(primary[n - 1].id);
      } else if (e.key === "Enter" && selected) {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) onUseAndRatify(selected);
        else onUseOnce(selected);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [primary, selected, onUseOnce, onUseAndRatify]);

  const term = ambiguity.term ? `“${ambiguity.term}”` : quotedTerm(ambiguity.question);

  return (
    <section className={cn("ds-fade", className)} aria-label="This question has more than one defensible answer">
      <header className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-accent">
          <GitFork size={20} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h2 className="text-title-lg text-primary">
            This question has {ambiguity.candidates.length} defensible answers
          </h2>
          <p className="mt-1 text-body text-secondary">
            They differ by {formatMultiple(ambiguity.spread.ratio)}. Which one do you
            mean?
          </p>
        </div>
      </header>

      <SpreadBar
        className="mt-6"
        candidates={ambiguity.candidates}
        spread={ambiguity.spread}
        unit={unit}
        formatHint={formatHint}
        selectedId={selected}
        onSelect={setSelected}
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {primary.map((c, i) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            index={i + 1}
            unit={unit}
            formatHint={formatHint}
            selected={selected === c.id}
            onFocus={() => setSelected(c.id)}
            onUseOnce={() => onUseOnce(c.id)}
            onUseAndRatify={() => onUseAndRatify(c.id)}
          />
        ))}
      </div>

      {overflow.length > 0 ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowOverflow((v) => !v)}
            aria-expanded={showOverflow}
            className="text-ui font-medium text-accent hover:underline"
          >
            {showOverflow ? "Hide" : `Show ${overflow.length} more readings`}
          </button>
          {showOverflow ? (
            <table className="ds-fade mt-3 w-full border-collapse overflow-hidden rounded-lg border border-border-default text-ui">
              <thead className="bg-surface-2">
                <tr className="h-8">
                  <th scope="col" className="px-3 text-left text-label text-tertiary uppercase">
                    Reading
                  </th>
                  <th scope="col" className="px-3 text-right text-label text-tertiary uppercase">
                    Value
                  </th>
                  <th scope="col" className="px-3 text-right text-label text-tertiary uppercase">
                    Rows
                  </th>
                  <th scope="col" className="w-24" />
                </tr>
              </thead>
              <tbody>
                {overflow.map((c) => (
                  <tr key={c.id} className="h-8 border-t border-border-subtle">
                    <td className="px-3 text-secondary">{c.label}</td>
                    <td className="px-3 text-right tabular text-primary">
                      {formatValue(c.value, formatHint, { unit })}
                    </td>
                    <td className="px-3 text-right tabular text-tertiary">
                      {c.rows_included?.toLocaleString("en-US") ?? "—"}
                    </td>
                    <td className="px-3 text-right">
                      <Button size="xs" onClick={() => onUseOnce(c.id)}>
                        Use once
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onDefineYourself}
        className="mt-5 text-ui font-medium text-accent transition-colors duration-100 hover:underline"
      >
        None of these — define {term} yourself ›
      </button>
    </section>
  );
}

function CandidateCard({
  candidate,
  index,
  unit,
  formatHint,
  selected,
  onFocus,
  onUseOnce,
  onUseAndRatify,
}: {
  candidate: AmbiguityCandidate;
  index: number;
  unit?: string;
  formatHint: FormatHint;
  selected: boolean;
  onFocus: () => void;
  onUseOnce: () => void;
  onUseAndRatify: () => void;
}) {
  const recommended = Boolean(candidate.recommendation_basis);

  return (
    <div
      onMouseEnter={onFocus}
      className={cn(
        "flex flex-col rounded-xl border bg-surface-1 p-5 transition-colors duration-100",
        selected
          ? "border-border-accent"
          : recommended
            ? "border-accent-tint-border"
            : "border-border-default hover:border-border-hover",
      )}
    >
      <div className="flex h-4 items-center justify-between">
        {recommended ? (
          <span className="flex items-center gap-1 text-label text-accent uppercase">
            <Target size={11} strokeWidth={2.2} />
            Recommended
          </span>
        ) : (
          <span />
        )}
        <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-border-default bg-surface-2 px-1 font-sans text-[10.5px] leading-none text-tertiary">
          {index}
        </kbd>
      </div>

      <p className="mt-4 text-hero-sm tabular text-primary">
        {formatValue(candidate.value, formatHint, { unit })}
      </p>

      <p className="mt-3 text-subtitle text-primary">{candidate.label}</p>
      <p className="mt-1.5 text-ui text-secondary">{candidate.description}</p>

      {recommended ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-sm bg-accent-tint px-2 py-1.5 text-ui-sm text-accent">
          <ShieldCheckFilled size={12} className="mt-px shrink-0" />
          {candidate.recommendation_basis}
        </p>
      ) : null}

      {typeof candidate.rows_included === "number" &&
      typeof candidate.rows_total === "number" ? (
        <CandidateCoverage
          className="mt-4"
          included={candidate.rows_included}
          total={candidate.rows_total}
        />
      ) : null}

      <Disclosure
        className="mt-4"
        summary={<span className="text-ui-sm">Why this differs</span>}
        contentClassName="mt-2"
      >
        <div className="overflow-hidden rounded-lg border border-border-default bg-surface-inset">
          <SqlBlock sql={candidate.sql} showLineNumbers={false} maxHeight={180} />
        </div>
      </Disclosure>

      <div className="mt-5 flex flex-col gap-2">
        <Button variant="primary" size="md" onClick={onUseAndRatify}>
          <ShieldCheckFilled size={13} />
          Use &amp; ratify
        </Button>
        <Button variant="secondary" size="md" onClick={onUseOnce}>
          Use once
        </Button>
      </div>
    </div>
  );
}

function quotedTerm(question: string): string {
  const m = /"([^"]+)"/.exec(question);
  if (m) return `“${m[1]}”`;
  const words = question
    .replace(/[?.,]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  return words.length ? `“${words[words.length - 1]}”` : "it";
}

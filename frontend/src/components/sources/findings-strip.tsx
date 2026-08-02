"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Finding } from "./introspection";

/**
 * `Found 7 tables · 42 columns · 6 relationships · 3 date columns` — each
 * finding painted as it lands. Numbers never animate; the row appears whole.
 */
export function FindingsStrip({
  findings,
  shown,
  className,
}: {
  findings: Finding[];
  shown: number;
  className?: string;
}) {
  const done = shown >= findings.length;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5", className)}>
      <span className="text-ui-sm text-tertiary">Found</span>
      {findings.slice(0, shown).map((f, i) => (
        <React.Fragment key={f.id}>
          {i > 0 ? (
            <span aria-hidden="true" className="text-disabled">
              ·
            </span>
          ) : null}
          <span className="ds-fade text-ui-sm tabular text-primary">{f.label}</span>
        </React.Fragment>
      ))}
      {done ? (
        <span className="ds-fade ml-1 inline-flex items-center gap-1 text-ui-sm text-verified">
          <Check size={13} strokeWidth={2.25} />
          complete
        </span>
      ) : (
        <span className="ds-pulse-accent h-1 w-8 rounded-full bg-accent-tint" aria-hidden="true" />
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {done
          ? `Introspection complete. Found ${findings.map((f) => f.label).join(", ")}.`
          : "Introspecting"}
      </span>
    </div>
  );
}

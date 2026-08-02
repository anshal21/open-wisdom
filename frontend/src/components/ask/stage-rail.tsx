"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { STAGES, type StageName } from "@/lib/api/types";
import type { StageStatus } from "@/state/ask";

const LABEL: Record<StageName, string> = {
  interpret: "Interpret",
  resolve: "Resolve",
  plan: "Plan",
  query: "Query",
  verify: "Verify",
  compose: "Compose",
};

/**
 * design-system.md §9.14.
 * Fifteen seconds of unexplained wait feels broken; fifteen seconds of legible
 * progress feels like work being done.
 */
export function StageRail({
  stages,
  detail,
  className,
}: {
  stages: Record<StageName, StageStatus>;
  detail: Partial<Record<StageName, string>>;
  className?: string;
}) {
  const done = STAGES.filter((s) => stages[s] === "done").length;
  const active = STAGES.find((s) => stages[s] === "active");
  const pct = ((done + (active ? 0.5 : 0)) / STAGES.length) * 100;

  return (
    <div className={cn("select-none", className)} aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {STAGES.map((s) => {
          const st = stages[s];
          return (
            <span
              key={s}
              className={cn(
                "flex items-center gap-1 text-ui-sm transition-colors duration-100",
                st === "done" && "text-secondary",
                st === "active" && "font-medium text-primary",
                st === "pending" && "text-disabled",
              )}
            >
              {st === "done" ? (
                <Check size={12} strokeWidth={2.4} className="text-verified" />
              ) : st === "active" ? (
                <svg width={12} height={12} viewBox="0 0 16 16" className="ds-spin" aria-hidden="true">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.25}
                    strokeWidth={2}
                  />
                  <path
                    d="M8 2a6 6 0 0 1 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <span
                  aria-hidden="true"
                  className="inline-block h-[10px] w-[10px] rounded-full border border-current"
                />
              )}
              {LABEL[s]}
            </span>
          );
        })}
      </div>

      <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-180 ease-[cubic-bezier(0.2,0,0,1)]"
          style={{ width: `${pct}%`, backgroundColor: "var(--c-accent-solid)" }}
        />
      </div>

      {active && detail[active] ? (
        <p className="mt-2 text-ui-sm text-tertiary">
          {LABEL[active]} — {detail[active]}
        </p>
      ) : null}
    </div>
  );
}

/** After the answer resolves the rail collapses to one line. */
export function StageSummary({
  elapsedMs,
  checkCount,
  definition,
  stages,
  detail,
  className,
}: {
  elapsedMs?: number;
  checkCount: number;
  definition?: string;
  stages: Record<StageName, StageStatus>;
  detail: Partial<Record<StageName, string>>;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-ui-sm text-tertiary transition-colors duration-100 hover:text-secondary"
      >
        {elapsedMs ? `Answered in ${(elapsedMs / 1000).toFixed(1)}s` : "Answered"}
        {" · "}
        {checkCount} check{checkCount === 1 ? "" : "s"}
        {definition ? ` · ${definition}` : ""}
      </button>
      {open ? (
        <dl className="ds-fade mt-2 grid max-w-sm grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-ui-sm">
          {STAGES.map((s) => (
            <React.Fragment key={s}>
              <dt className="text-tertiary">{LABEL[s]}</dt>
              <dd className="text-secondary">
                {stages[s] === "done" ? detail[s] ?? "complete" : "not run"}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

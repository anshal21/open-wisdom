"use client";

import * as React from "react";
import { BellOff, Check, Circle, Pause, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Watch, WatchStatus } from "@/lib/api/types";
import { formatPercent, formatValue } from "@/lib/format";

/**
 * Watch vocabulary and status ink. screens.md §9.1.
 *
 * Status never relies on colour alone: every state carries its glyph AND its
 * word, so it survives greyscale, colour-blindness and printing.
 */

const STATUS_META: Record<
  WatchStatus,
  { word: string; ink: string; glyph: React.ReactNode }
> = {
  watching: {
    word: "Watching",
    ink: "text-tertiary border-border-default bg-surface-2",
    glyph: <Circle size={9} strokeWidth={0} fill="currentColor" />,
  },
  firing: {
    word: "Firing",
    ink: "text-qualified border-qualified-border bg-qualified-bg",
    glyph: <TriangleAlert size={11} strokeWidth={2.2} />,
  },
  resolved: {
    word: "Resolved",
    ink: "text-verified border-verified-border bg-verified-bg",
    glyph: <Check size={11} strokeWidth={2.6} />,
  },
  snoozed: {
    word: "Snoozed",
    ink: "text-disabled border-border-default bg-surface-2",
    glyph: <BellOff size={10} strokeWidth={2.2} />,
  },
  paused: {
    word: "Paused",
    ink: "text-disabled border-border-default bg-surface-2",
    glyph: <Pause size={10} strokeWidth={2.2} />,
  },
};

export function WatchStatusTag({
  status,
  className,
}: {
  status: WatchStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border px-1.5 text-label uppercase",
        meta.ink,
        className,
      )}
    >
      <span aria-hidden="true" className="flex shrink-0 items-center">
        {meta.glyph}
      </span>
      {meta.word}
    </span>
  );
}

export function statusWord(status: WatchStatus): string {
  return STATUS_META[status].word;
}

/** Plain-English condition. Never SQL, never operator soup. */
export function describeCondition(watch: Watch): string {
  const { condition, unit, format_hint: hint, grain } = watch;
  // `grain` is optional on the wire — watches created through the API do not
  // carry one, only the fixtures did, which is how "per undefined" reached the
  // header. An absent grain drops the clause rather than naming a value nobody
  // set: a description that states a fact it does not have is worse than a
  // shorter one.
  const per = grain ? ` · per ${grain}` : "";
  switch (condition.kind) {
    case "outside_normal_range":
      return `Outside the normal range${per}`;
    case "threshold":
      return `${condition.direction === "above" ? "Above" : "Below"} ${formatValue(
        condition.value,
        hint,
        { unit },
      )}${per}`;
    case "change_pct":
    default: {
      const dir =
        condition.direction === "above"
          ? "up"
          : condition.direction === "below"
            ? "down"
            : "either way";
      return `Changes by more than ${formatPercent(condition.value)} ${dir}${per}`;
    }
  }
}

/** "today" / "this week" — the period the current value covers.
 *
 * Absent grain yields "now": a watch created through the API carries no grain,
 * and "this undefined" is worse than a slightly vaguer word. */
export function periodWord(grain?: string): string {
  if (!grain) return "now";
  if (grain === "day") return "today";
  if (grain === "week") return "this week";
  if (grain === "month") return "this month";
  return "this period";
}

export interface Breach {
  direction: "below" | "above";
  pct: number;
  bound: number;
}

/** The breach, computed from the value and the range. Never a bare delta. */
export function breachOf(watch: Watch): Breach | null {
  const { current_value: value, normal_range: range } = watch;
  if (value === undefined || !range) return null;
  const [lo, hi] = range;
  if (value < lo) return { direction: "below", pct: ((lo - value) / lo) * 100, bound: lo };
  if (value > hi) return { direction: "above", pct: ((value - hi) / hi) * 100, bound: hi };
  return null;
}

export function rangeLabel(watch: Watch): string {
  const range = watch.normal_range;
  if (!range) return "—";
  const opts = { unit: watch.unit };
  return `${formatValue(range[0], watch.format_hint, opts)}–${formatValue(
    range[1],
    watch.format_hint,
    opts,
  )}`;
}

/** "$4,120 today — 34% below the normal range ($6,240–$8,900)" */
export function breachSentence(watch: Watch): string | null {
  const breach = breachOf(watch);
  if (!breach || watch.current_value === undefined) return null;
  return `${formatValue(watch.current_value, watch.format_hint, {
    unit: watch.unit,
  })} ${periodWord(watch.grain)} — ${formatPercent(breach.pct, 0)} ${
    breach.direction
  } the normal range (${rangeLabel(watch)})`;
}

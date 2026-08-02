import type { Investigation, RuleoutEvent } from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";

/**
 * Pure helpers for the investigation surface. screens.md §8.
 *
 * Nothing here knows a table, column, metric or source name — every string a
 * user reads either comes off the wire or is phase vocabulary from the spec.
 */

export type VerdictKind = Investigation["verdict"]["kind"];

/**
 * The verdict kind chooses the seal state of the conclusion. `no_driver` is
 * deliberately neutral, not a failure: a null result is a finding.
 */
export const VERDICT_META: Record<
  VerdictKind,
  { label: string; state: ConfidenceState }
> = {
  artifact: { label: "Measurement artifact", state: "qualified" },
  driver_found: { label: "Driver found", state: "verified" },
  no_driver: { label: "No significant driver", state: "unverified" },
  data_incident: { label: "Data incident", state: "contested" },
};

export type PhaseNumber = 1 | 2 | 3;

export const PHASES: Array<{ phase: PhaseNumber; name: string }> = [
  { phase: 1, name: "Measurement" },
  { phase: 2, name: "Data quality" },
  { phase: 3, name: "Business drivers" },
];

export function phaseName(phase: PhaseNumber): string {
  return PHASES.find((p) => p.phase === phase)?.name ?? String(phase);
}

export function itemsInPhase(
  ruleouts: RuleoutEvent[],
  phase: PhaseNumber,
): RuleoutEvent[] {
  return ruleouts.filter((r) => r.phase === phase);
}

/** A phase was reached if any of its rule-outs actually ran. */
export function phaseReached(ruleouts: RuleoutEvent[], phase: PhaseNumber): boolean {
  return itemsInPhase(ruleouts, phase).some((r) => r.status !== "not_run");
}

/** Flat, ordered list — the order the ladder resolves in while streaming. */
export function ladderOrder(ruleouts: RuleoutEvent[]): RuleoutEvent[] {
  return PHASES.flatMap((p) => itemsInPhase(ruleouts, p.phase));
}

/**
 * Why the ladder stopped, in the product's own voice. Derived from the verdict
 * kind so a data incident does not borrow the measurement sentence.
 */
export function stoppedSentence(inv: Investigation): string {
  const at = inv.stopped_at;
  if (!at) return "";
  const next = PHASES.find((p) => p.phase > at);
  const because =
    inv.verdict.kind === "data_incident"
      ? "a data-quality problem already accounts for the change"
      : "the metric did not move on a normalized basis";
  return next
    ? `We stopped here. ${next.name} was not examined because ${because}.`
    : `We stopped here, because ${because}.`;
}

export function stoppedShort(stoppedAt: PhaseNumber | null): string {
  return stoppedAt ? `Stopped at ${stoppedAt} · ${phaseName(stoppedAt)}` : "Ran all 3 phases";
}

/** `-2.1` -> `-2.1%`, `0.4` -> `+0.4%`. Never a bare unsigned delta. */
export function signed(value: number | undefined | null, suffix: string, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const body = Math.abs(value).toFixed(digits);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${body}${suffix}`;
}

export type DeltaInk = "verified" | "contested" | "neutral";

/**
 * A comparison string off the wire ("-5.4% vs January") carries its own sign.
 * Direction is signalled by an arrow as well as ink — colour is never alone.
 */
export function readComparison(comparison: string): { ink: DeltaInk; arrow: string } {
  const trimmed = comparison.trim();
  if (trimmed.startsWith("+")) return { ink: "verified", arrow: "▲" };
  if (trimmed.startsWith("-") || trimmed.startsWith("−"))
    return { ink: "contested", arrow: "▼" };
  return { ink: "neutral", arrow: "" };
}

export const DELTA_INK_CLASS: Record<DeltaInk, string> = {
  verified: "text-verified",
  contested: "text-contested",
  neutral: "text-tertiary",
};

/** The narrative is capped at five sentences. §8.5 */
export function firstSentences(text: string, max = 5): string {
  // Sentence boundaries are a terminator followed by whitespace and a capital
  // (or quote/currency) opener. Splitting on any period would cut inside
  // figures like $214,612.30 and start the "conclusion" mid-number.
  const parts = text.split(/(?<=[.!?)\]])\s+(?=[A-Z“"'$])/);
  return parts.slice(0, max).join(" ").trim();
}

/** Sorted by absolute contribution, positives and negatives interleaved. */
export function byMagnitude<T extends { contribution?: number; value?: number }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      Math.abs(b.contribution ?? b.value ?? 0) - Math.abs(a.contribution ?? a.value ?? 0),
  );
}

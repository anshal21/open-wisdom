import type { Check, CheckId, CheckStatus, ReportConfidence } from "@/lib/api/types";

/**
 * The seven states. Six terminal, one transient. design-system.md §3.1.
 * `checking` and `superseded` are client-side states: the wire only carries
 * the five terminal states the server can assert.
 */
export type ConfidenceState = ReportConfidence | "checking" | "superseded";

export const CONFIDENCE_STATES: ConfidenceState[] = [
  "checking",
  "verified",
  "qualified",
  "unverified",
  "refused",
  "contested",
  "superseded",
];

export type SealHue = "neutral" | "verified" | "qualified" | "contested" | "accent";
export type SealBorder = "solid" | "dashed" | "dotted";

export interface ConfidenceMeta {
  /** Word shown to the user. Locked by design-system.md §10.3. */
  label: string;
  hue: SealHue;
  /** The dash pattern is the semantic carrier — it survives greyscale. */
  border: SealBorder;
  /** Whether a figure is shown at all in this state. */
  showsNumber: boolean;
  /** Whether a banner seal is warranted above the answer body (§1.2 step 5). */
  banner: boolean;
}

export const CONFIDENCE: Record<ConfidenceState, ConfidenceMeta> = {
  checking: {
    label: "Checking",
    hue: "neutral",
    border: "solid",
    showsNumber: true,
    banner: false,
  },
  verified: {
    label: "Verified",
    hue: "verified",
    border: "solid",
    showsNumber: true,
    banner: false,
  },
  qualified: {
    label: "Qualified",
    hue: "qualified",
    border: "solid",
    showsNumber: true,
    banner: true,
  },
  unverified: {
    label: "Unverified",
    hue: "neutral",
    border: "dashed",
    showsNumber: true,
    banner: true,
  },
  refused: {
    label: "Refused",
    hue: "accent",
    border: "solid",
    showsNumber: false,
    banner: true,
  },
  contested: {
    label: "Contested",
    hue: "contested",
    border: "solid",
    showsNumber: false,
    banner: true,
  },
  superseded: {
    label: "Superseded",
    hue: "neutral",
    border: "dotted",
    showsNumber: true,
    banner: true,
  },
};

/** Tailwind classes per hue. Semantic tokens only. */
export const HUE_CLASS: Record<
  SealHue,
  { fg: string; bg: string; border: string; ring: string }
> = {
  neutral: {
    fg: "text-unverified",
    bg: "bg-unverified-bg",
    border: "border-unverified-border",
    ring: "text-unverified",
  },
  verified: {
    fg: "text-verified",
    bg: "bg-verified-bg",
    border: "border-verified-border",
    ring: "text-verified",
  },
  qualified: {
    fg: "text-qualified",
    bg: "bg-qualified-bg",
    border: "border-qualified-border",
    ring: "text-qualified",
  },
  contested: {
    fg: "text-contested",
    bg: "bg-contested-bg",
    border: "border-contested-border",
    ring: "text-contested",
  },
  accent: {
    fg: "text-accent",
    bg: "bg-accent-tint",
    border: "border-accent-tint-border",
    ring: "text-accent",
  },
};

export const BORDER_CLASS: Record<SealBorder, string> = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
};

/**
 * Plain labels per check id. Used only as a fallback when the server sends an
 * empty label — the wire label always wins. design-system.md §3.4.
 */
export const CHECK_LABEL: Record<CheckId, string> = {
  cross_derivation: "Computed a second way",
  join_loss: "No rows silently dropped",
  fan_out: "No rows double-counted",
  period_normalization: "Fair time comparison",
  filter_sensitivity: "Answer is stable under reasonable variations",
  definition_source: "Uses a ratified definition",
  grain: "Aggregation is valid at this grain",
  coverage: "Data covers the whole question",
  freshness: "Data is current",
  precedent: "Consistent with what we said before",
};

export function checkLabel(check: Pick<Check, "id" | "label">): string {
  return check.label?.trim() || CHECK_LABEL[check.id] || check.id;
}

export function isSkipped(status: CheckStatus): boolean {
  return status === "skipped" || status === "not_applicable";
}

/**
 * Seal state derives mechanically from the checks. design-system.md §3.4.
 * This is the only place the mapping exists.
 */
export function deriveState(checks: Check[]): ReportConfidence {
  const ran = checks.filter((c) => !isSkipped(c.status));
  const failed = (id: CheckId) =>
    ran.some((c) => c.id === id && c.status === "fail");

  if (failed("cross_derivation")) return "contested";
  if (failed("filter_sensitivity")) return "refused";
  if (ran.some((c) => c.status === "fail" || c.status === "warn")) return "qualified";

  const crossRan = checks.some(
    (c) => c.id === "cross_derivation" && !isSkipped(c.status),
  );
  return crossRan ? "verified" : "unverified";
}

/** Skipped checks never count toward passed/total. Contract §4. */
export function tally(checks: Check[]): { passed: number; total: number } {
  const ran = checks.filter((c) => !isSkipped(c.status));
  return { passed: ran.filter((c) => c.status === "pass").length, total: ran.length };
}

/** Failures first, then warnings, then passes, then skipped. §9.6 */
const STATUS_ORDER: Record<CheckStatus, number> = {
  fail: 0,
  warn: 1,
  pass: 2,
  skipped: 3,
  not_applicable: 4,
};

export function sortChecks(checks: Check[]): Check[] {
  return [...checks].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
}

export const CHECK_STATUS_HUE: Record<CheckStatus, SealHue> = {
  pass: "verified",
  warn: "qualified",
  fail: "contested",
  skipped: "neutral",
  not_applicable: "neutral",
};

/**
 * The accessible name of a figure announces its seal.
 * design-system.md §8.
 */
export function figureAriaLabel(
  formatted: string,
  state: ConfidenceState,
  headline?: string,
): string {
  const meta = CONFIDENCE[state];
  return headline
    ? `${formatted}. ${meta.label}: ${headline}`
    : `${formatted}. ${meta.label}.`;
}

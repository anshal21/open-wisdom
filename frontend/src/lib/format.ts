import type { FormatHint } from "@/lib/api/types";

/**
 * Number and time rendering. design-system.md §10.1 / §10.2.
 * Nothing here is dataset-specific; unit and format_hint come from the wire.
 */

const CURRENCY_SYMBOL: Record<string, string> = {
  currency: "$",
  usd: "$",
  USD: "$",
  eur: "€",
  EUR: "€",
  gbp: "£",
  GBP: "£",
  inr: "₹",
  INR: "₹",
};

function symbolFor(unit: string): string {
  return CURRENCY_SYMBOL[unit] ?? CURRENCY_SYMBOL[unit?.toLowerCase()] ?? "";
}

/** Null / missing renders as an em dash, never 0, never blank. */
export const EMPTY = "—";

export interface FormatOptions {
  unit?: string;
  /** Axis ticks may abbreviate. The hero number never may. */
  abbreviate?: boolean;
}

export function formatValue(
  value: number | null | undefined,
  hint: FormatHint = "number",
  opts: FormatOptions = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;

  switch (hint) {
    case "currency": {
      const sym = symbolFor(opts.unit ?? "currency") || "$";
      if (opts.abbreviate) return sym + abbreviate(value);
      const abs = Math.abs(value);
      const digits = abs >= 1000 ? 0 : 2;
      const body = value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      return body.startsWith("-") ? `-${sym}${body.slice(1)}` : `${sym}${body}`;
    }
    case "percent": {
      const rounded = roundTo(value, 1);
      return `${trimZero(rounded)}%`;
    }
    case "count":
      return opts.abbreviate
        ? abbreviate(value)
        : Math.round(value).toLocaleString("en-US");
    case "duration":
      return formatDuration(value);
    case "number":
    default: {
      if (opts.abbreviate) return abbreviate(value);
      const abs = Math.abs(value);
      const digits = Number.isInteger(value) ? 0 : abs >= 1000 ? 0 : 2;
      return value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }
  }
}

/**
 * The answer-level hint describes the HEADLINE figure. A share-of-whole
 * question carries `format_hint: "percent"` while the measure it sliced is
 * raw revenue — so applying the hint blindly prints an axis reading
 * `2000000%` and a cell reading `2297175.1%`. A series of values wears
 * "percent" only when those values could plausibly BE percentages.
 *
 * One rule, one place: every renderer (axis, table, tooltip, donut hole,
 * tile) calls this rather than re-deriving its own threshold.
 */
export function effectiveHint(
  hint: FormatHint,
  values: Array<number | null | undefined>,
): FormatHint {
  if (hint !== "percent") return hint;
  let max = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) max = Math.max(max, Math.abs(v));
  }
  // A little headroom over 100 for rounding and for shares that legitimately
  // exceed the whole (growth against a smaller base).
  return max <= 150 ? "percent" : "number";
}

/** Abbreviation is correct on an axis tick and forbidden on the hero number. */
export function abbreviate(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${trimZero(roundTo(abs / 1e9, 1))}B`;
  if (abs >= 1e6) return `${sign}${trimZero(roundTo(abs / 1e6, 1))}M`;
  if (abs >= 1e3) return `${sign}${trimZero(roundTo(abs / 1e3, 1))}k`;
  return `${sign}${trimZero(roundTo(abs, abs < 10 ? 1 : 0))}`;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return EMPTY;
  return Math.round(n).toLocaleString("en-US");
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return EMPTY;
  return `${trimZero(roundTo(n, digits))}%`;
}

/** Deltas never appear bare — the caller must supply the comparison base. */
export function formatDelta(
  pct: number | null | undefined,
  base: string,
): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return EMPTY;
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "•";
  return `${arrow} ${pct > 0 ? "+" : ""}${trimZero(roundTo(pct, 1))}% vs ${base}`;
}

export function deltaDirection(pct: number | null | undefined): "up" | "down" | "flat" {
  if (pct === null || pct === undefined || Number.isNaN(pct) || pct === 0) return "flat";
  return pct > 0 ? "up" : "down";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${trimZero(roundTo(s, 1))}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function trimZero(n: number): string {
  return String(n);
}

/** Always one decimal: `4.0×` reads as measured, `4×` reads as rounded prose. */
export function formatMultiple(ratio: number): string {
  return `${roundTo(ratio, 1).toFixed(1)}×`;
}

// ---------------------------------------------------------------------------
// Time. §10.2
// ---------------------------------------------------------------------------

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Absolute, always. The ledger is a record. */
export function formatAbsolute(iso: string, withTime = true): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (!withTime) return date;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date}, ${hh}:${mm}`;
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Relative under 7 days, absolute after. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const diff = now.getTime() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return formatAbsolute(iso, false);
}

/** Full ISO for the title attribute. */
export function isoTitle(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString();
}

/** `1 Jan – 31 Mar 2023`, en dash. */
export function formatRange(from: string, to: string): string {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${from} – ${to}`;
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  const left = sameMonth
    ? `${a.getDate()}`
    : sameYear
      ? `${a.getDate()} ${MONTHS[a.getMonth()]}`
      : `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  return `${left} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

export function formatFraction(included: number, total: number): string {
  return `${formatCount(included)} of ${formatCount(total)} rows`;
}

export function pctOf(part: number, whole: number): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}

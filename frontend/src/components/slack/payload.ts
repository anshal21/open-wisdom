import type {
  AmbiguityPayload,
  Answer,
  SlackBlock,
  Watch,
} from "@/lib/api/types";
import { CONFIDENCE, tally, type ConfidenceState } from "@/lib/confidence";
import {
  formatDateShort,
  formatMultiple,
  formatPercent,
  formatRange,
  formatValue,
} from "@/lib/format";
import { SLACK_EMOJI_NAME } from "./emoji";

/**
 * One source of truth for what a Slack message says: the visual preview and
 * the copyable Block Kit payload are built from the same strings, so the
 * preview cannot drift from the thing that actually gets posted.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function isWholeMonth(from: string, to: string): string | null {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  if (a.getUTCFullYear() !== b.getUTCFullYear() || a.getUTCMonth() !== b.getUTCMonth())
    return null;
  const last = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate();
  if (a.getUTCDate() !== 1 || b.getUTCDate() !== last) return null;
  return `${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
}

export function periodLabel(answer: Answer): string | null {
  const range = answer.context?.time_range;
  if (!range) return null;
  return isWholeMonth(range.from, range.to) ?? formatRange(range.from, range.to);
}

/** `excl. cancelled, returned` — chips have no Slack equivalent, so they become text. */
export function filterLabel(answer: Answer): string | null {
  const filters = answer.context?.filters ?? [];
  if (filters.length === 0) return null;
  return filters
    .map((f) => {
      const values = Array.isArray(f.value) ? f.value : [f.value];
      const list = values.map((v) => String(v).toLowerCase()).join(", ");
      if (f.operator === "not in" || f.operator === "!=") return `excl. ${list}`;
      if (f.operator === "in" || f.operator === "=") return `${f.column} ${list}`;
      return `${f.column} ${f.operator} ${list}`;
    })
    .join(" · ");
}

export function definitionLabel(answer: Answer): string | null {
  const d = answer.definition_used;
  return d ? `${d.name} v${d.version}` : null;
}

/** §12.4 — `_Context: Revenue v3 · Feb 2023 · excl. cancelled_` */
export function contextLine(answer: Answer): string {
  const parts = [definitionLabel(answer), periodLabel(answer), filterLabel(answer)].filter(
    Boolean,
  ) as string[];
  return `Context: ${parts.join(" · ")}`;
}

export function readLine(answer: Answer): string {
  return answer.restated ?? answer.question;
}

export function heroValue(answer: Answer): string {
  return formatValue(answer.value, answer.format_hint, { unit: answer.unit });
}

/** `Revenue v3 · ratified by Priya Nair · 4 Mar` */
export function provenanceLine(
  answer: Answer,
  ratifiedBy: string | null,
  ratifiedAt: string | null,
): string | null {
  const d = definitionLabel(answer);
  if (!d) return null;
  if (!ratifiedBy) return `${d} · inferred, not ratified`;
  return `${d} · ratified by ${ratifiedBy}${ratifiedAt ? ` · ${formatDateShort(ratifiedAt)}` : ""}`;
}

/* ---------------------------------------------------------------------------
   Refusal
--------------------------------------------------------------------------- */

export function refusalHeadline(ambiguity: AmbiguityPayload): string {
  return `"${ambiguity.question}" has ${ambiguity.candidates.length} defensible answers — they differ by ${formatMultiple(ambiguity.spread.ratio)}.`;
}

export function candidateValue(answer: Answer, value: number): string {
  return formatValue(value, answer.format_hint, { unit: answer.unit });
}

export function candidateShort(answer: Answer, value: number): string {
  return formatValue(value, answer.format_hint, { unit: answer.unit, abbreviate: true });
}

/* ---------------------------------------------------------------------------
   Watch
--------------------------------------------------------------------------- */

export function watchDeviation(watch: Watch): { pct: number; direction: "above" | "below" } | null {
  const range = watch.normal_range;
  const value = watch.current_value;
  if (!range || value === undefined) return null;
  const [low, high] = range;
  if (value < low) return { pct: ((low - value) / low) * 100, direction: "below" };
  if (value > high) return { pct: ((value - high) / high) * 100, direction: "above" };
  return null;
}

export function watchHeadline(watch: Watch): string {
  const dev = watchDeviation(watch);
  if (!dev) return `${watch.definition_name} moved outside its normal range`;
  return `${watch.definition_name} is ${formatPercent(dev.pct)} ${dev.direction} its normal range`;
}

const GRAIN_WORD: Record<string, string> = {
  day: "today",
  week: "this week",
  month: "this month",
};

export function watchValueLine(watch: Watch): string | null {
  if (watch.current_value === undefined || !watch.normal_range) return null;
  const fmt = (n: number) => formatValue(n, watch.format_hint, { unit: watch.unit });
  // Slack cards are shared outward, so an "undefined" here is seen by
  // people who never opened the product.
  const when = watch.grain ? (GRAIN_WORD[watch.grain] ?? `this ${watch.grain}`) : "now";
  return `${fmt(watch.current_value)} ${when} vs a normal ${fmt(watch.normal_range[0])}–${fmt(watch.normal_range[1])}`;
}

/** The check block leads the message — what was confirmed before alerting. */
export function watchConfirmedLine(watch: Watch): string | null {
  const checks = watch.pre_alert_checks ?? [];
  if (checks.length === 0) return null;
  const confirmed = checks
    .filter((c) => c.status === "pass")
    .map((c) => c.label.charAt(0).toLowerCase() + c.label.slice(1));
  const caveat = checks.find((c) => c.status === "warn");
  const head = confirmed.length
    ? `Before alerting we confirmed: ${confirmed.join(", ")}.`
    : "";
  const tail = caveat
    ? ` ${caveat.finding.replace(/\.$/, "")}${
        watch.held_hours
          ? ` — this alert was held ${watch.held_hours} hours to be sure.`
          : "."
      }`
    : watch.held_hours
      ? ` This alert was held ${watch.held_hours} hours to be sure.`
      : "";
  return `${head}${tail}`.trim();
}

/* ---------------------------------------------------------------------------
   Block Kit payloads
--------------------------------------------------------------------------- */

function stateWord(state: ConfidenceState): string {
  return CONFIDENCE[state].label;
}

export function answerBlocks(
  answer: Answer,
  provenance: string | null,
): SlackBlock[] {
  const report = answer.report;
  const state = (report?.confidence ?? "refused") as ConfidenceState;
  const blocks: SlackBlock[] = [
    { type: "section", text: `*${heroValue(answer)}*\n${readLine(answer)}` },
    {
      type: "section",
      text: report
        ? `${SLACK_EMOJI_NAME[state]} *${stateWord(state)}* · ${report.passed} of ${report.total} checks passed`
        : `${SLACK_EMOJI_NAME[state]} *${stateWord(state)}*`,
    },
  ];
  if (report?.headline) {
    // The caveat is in the message body, never behind a button. §12.1
    blocks.push({ type: "section", text: report.headline });
  }
  if (report) {
    blocks.push({
      type: "image",
      alt: `${readLine(answer)} — ${report.passed} of ${report.total} checks passed`,
      answer_id: answer.id,
    });
  }
  if (provenance) blocks.push({ type: "context", text: `_${provenance}_` });
  blocks.push({
    type: "actions",
    buttons: [
      { label: "View evidence" },
      { label: "Ask a follow-up" },
      { label: "Re-run" },
    ],
  });
  return blocks;
}

export function threadContextBlocks(answer: Answer): SlackBlock[] {
  return [{ type: "context", text: `_${contextLine(answer)}_` }];
}

export function refusalBlocks(answer: Answer, ambiguity: AmbiguityPayload): SlackBlock[] {
  const bullets = ambiguity.candidates
    .map(
      (c) =>
        `• *${candidateValue(answer, c.value)}* — ${c.label.toLowerCase()}${
          c.recommended ? "   ⌾ recommended" : ""
        }`,
    )
    .join("\n");
  return [
    {
      type: "section",
      text: `${SLACK_EMOJI_NAME.refused} *${stateWord("refused")}* — ${refusalHeadline(ambiguity)}`,
    },
    { type: "section", text: bullets },
    {
      type: "section",
      text: "Pick one and I'll answer. Ratifying makes it the default for everyone.",
    },
    {
      type: "actions",
      buttons: [
        ...ambiguity.candidates.map((c) => ({
          label: `Use ${candidateShort(answer, c.value)}`,
          ...(c.recommended ? { style: "primary" as const } : {}),
        })),
        { label: "Open in Analyst" },
      ],
    },
  ];
}

export function watchBlocks(watch: Watch): SlackBlock[] {
  const checks = watch.pre_alert_checks ?? [];
  const { passed, total } = tally(checks);
  const state: ConfidenceState = checks.some((c) => c.status === "warn" || c.status === "fail")
    ? "qualified"
    : "verified";
  const confirmed = watchConfirmedLine(watch);
  const value = watchValueLine(watch);

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: `${SLACK_EMOJI_NAME[state]} *${stateWord(state)}* · ${passed} of ${total} pre-alert checks passed`,
    },
  ];
  if (confirmed) blocks.push({ type: "section", text: confirmed });
  blocks.push({ type: "divider" });
  blocks.push({ type: "section", text: `*${watchHeadline(watch)}*` });
  if (value) blocks.push({ type: "section", text: value });
  blocks.push({
    type: "context",
    text: `_${watch.name} · ${watch.definition_name} · ${watch.schedule}_`,
  });
  blocks.push({
    type: "actions",
    buttons: [
      { label: "Investigate", style: "primary" },
      { label: "Snooze 1 day" },
      { label: "Open watch" },
    ],
  });
  return blocks;
}

export function payloadJson(channel: string, blocks: SlackBlock[]): string {
  return JSON.stringify({ channel, blocks }, null, 2);
}

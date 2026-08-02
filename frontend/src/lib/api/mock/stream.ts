import type {
  AmbiguityPayload,
  Answer,
  AskEvent,
  AskRequest,
  Check,
} from "@/lib/api/types";
import {
  ANSWER_CONTESTED,
  ANSWER_FEB,
  ANSWER_JOIN_LOSS,
  ANSWER_REFUSED,
  ANSWER_REPEAT_RATE,
  ANSWER_UNVERIFIED,
  ANSWER_VERIFIED,
} from "./answers";
import { delay } from "./base";

/**
 * Scripted SSE for the demo transport.
 *
 * The timings are the choreography from screens.md §1.3, compressed by
 * DEMO_SPEED so the loop can be watched repeatedly without waiting 20s. The
 * *ordering* guarantees are the real ones: `result` always precedes `check`
 * and `verdict`, and the number lands wearing a `checking` seal.
 */

const DEMO_SPEED = 1;

const t = (ms: number) => ms * DEMO_SPEED;

type Emit = (e: AskEvent) => void;

interface Scenario {
  match: RegExp;
  answer: Answer;
}

/**
 * Question routing for the demo. The *UI* never inspects question text — this
 * is the fake backend, and a real backend does this with a planner.
 */
const MONTH =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\blast month\b|\bthis month\b/i;

const SCENARIOS: Scenario[] = [
  // A month-scoped revenue question is unambiguous; only the unscoped annual
  // one forks. Order matters: the narrower pattern is tested first.
  { match: new RegExp(`(?=.*revenue)(?=.*(${MONTH.source}))`, "i"), answer: ANSWER_FEB },
  { match: /\b2023\s+revenue|revenue.*\b2023\b|full year|annual revenue/i, answer: ANSWER_REFUSED },
  { match: /ship(ped)?.*(q2|quarter)|orders shipped/i, answer: ANSWER_CONTESTED },
  { match: /categor|product.*(best|top|most)/i, answer: ANSWER_VERIFIED },
  { match: /session|traffic over|visits/i, answer: ANSWER_UNVERIFIED },
  { match: /channel|visitor|acquisition/i, answer: ANSWER_JOIN_LOSS },
  { match: /repeat|retention|loyal/i, answer: ANSWER_REPEAT_RATE },
];

export function scenarioFor(question: string): Answer {
  return SCENARIOS.find((s) => s.match.test(question))?.answer ?? ANSWER_FEB;
}

const CHECK_STAGGER = 40;

/**
 * `assumptions` carries chip-shaped hints using a `type:value` convention so
 * the client can render typed, editable chips for things the user did not pin.
 * Anything without a recognised prefix degrades to a plain inferred chip.
 */
function assumptionsFor(a: Answer): string[] {
  const out: string[] = [];
  if (a.context?.time_range)
    out.push(`time_range:${a.context?.time_range.from}..${a.context?.time_range.to}`);
  if (a.context?.grain) out.push(`grain:${a.context?.grain}`);
  for (const f of a.context?.filters ?? []) {
    const v = Array.isArray(f.value) ? f.value.join(", ") : String(f.value);
    out.push(`filter:${f.column} ${f.operator} ${v}`);
  }
  return out;
}

export async function* mockAskStream(
  req: AskRequest,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  const answer = req.context?.definition_id
    ? scenarioFor(req.question)
    : scenarioFor(req.question);

  const events: AskEvent[] = [];
  const emit: Emit = (e) => events.push(e);

  // --- interpret ---------------------------------------------------------
  yield { event: "stage", data: { stage: "interpret", state: "start" } };
  await delay(t(340), signal);
  yield {
    event: "interpretation",
    data: {
      restated: answer.restated ?? answer.question,
      assumptions: assumptionsFor(answer),
      definition_used: answer.definition_used
        ? { id: answer.definition_used.id, name: answer.definition_used.name }
        : { id: "", name: "" },
    },
  };
  yield { event: "stage", data: { stage: "interpret", state: "done" } };

  // --- resolve -----------------------------------------------------------
  yield {
    event: "stage",
    data: {
      stage: "resolve",
      state: "start",
      detail: answer.definition_used
        ? `matched to ${answer.definition_used.name} v${answer.definition_used.version}`
        : "no ratified definition matched",
    },
  };
  await delay(t(620), signal);
  yield { event: "stage", data: { stage: "resolve", state: "done" } };

  // --- plan --------------------------------------------------------------
  yield { event: "stage", data: { stage: "plan", state: "start" } };
  await delay(t(560), signal);
  // The chart spec lands before the data so axes render at final geometry.
  if (answer.chart) yield { event: "chart", data: answer.chart };
  yield { event: "stage", data: { stage: "plan", state: "done" } };

  // --- query -------------------------------------------------------------
  yield {
    event: "stage",
    data: {
      stage: "query",
      state: "start",
      detail: answer.scanned_rows
        ? `scanning ${answer.scanned_rows.toLocaleString("en-US")} rows`
        : undefined,
    },
  };
  await delay(t(1180), signal);

  // Refusal is terminal and arrives instead of a number.
  if (answer.ambiguity) {
    yield { event: "stage", data: { stage: "query", state: "done" } };
    yield { event: "ambiguity", data: answer.ambiguity };
    if (answer.report) yield { event: "verdict", data: answer.report };
    if (answer.cost) yield { event: "cost", data: answer.cost };
    return;
  }

  yield {
    event: "result",
    data: {
      answer_id: answer.id,
      value: answer.value,
      unit: answer.unit,
      format_hint: answer.format_hint,
      columns: answer.columns,
      rows: answer.rows,
      row_count: answer.row_count,
      scanned_rows: answer.scanned_rows,
    },
  };
  yield { event: "stage", data: { stage: "query", state: "done" } };

  // --- verify + compose (overlapping) ------------------------------------
  yield { event: "stage", data: { stage: "verify", state: "start" } };

  const checks: Check[] = answer.report?.checks ?? [];
  const narrativeChunks = chunk(answer.narrative);
  let narrativeAt = 0;

  for (let i = 0; i < checks.length; i++) {
    await delay(t(i < 6 ? CHECK_STAGGER + 180 : 90), signal);
    yield { event: "check", data: checks[i] };

    // Composing begins as soon as the number exists.
    if (i === 1) yield { event: "stage", data: { stage: "compose", state: "start" } };
    if (i >= 1 && narrativeAt < narrativeChunks.length) {
      narrativeAt += 1;
      yield {
        event: "narrative",
        data: { markdown: narrativeChunks.slice(0, narrativeAt).join("") },
      };
    }
  }

  yield { event: "stage", data: { stage: "verify", state: "done" } };

  while (narrativeAt < narrativeChunks.length) {
    await delay(t(70), signal);
    narrativeAt += 1;
    yield {
      event: "narrative",
      data: { markdown: narrativeChunks.slice(0, narrativeAt).join("") },
    };
  }

  yield { event: "stage", data: { stage: "compose", state: "done" } };
  if (answer.report) yield { event: "verdict", data: answer.report };
  if (answer.cost) yield { event: "cost", data: answer.cost };

  void emit;
  void events;
}

/**
 * Token-wise chunks. Narrative events carry the full text so far, so a backend
 * that emits a single final event renders identically.
 */
function chunk(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/** Continuation after a candidate is chosen on the fork. */
export async function* mockResolveStream(
  ambiguity: AmbiguityPayload,
  candidateId: string,
  ratified: boolean,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  const candidate =
    ambiguity.candidates.find((c) => c.id === candidateId) ?? ambiguity.candidates[0];

  yield { event: "stage", data: { stage: "interpret", state: "done" } };
  yield {
    event: "interpretation",
    data: {
      restated: `${ambiguity.question} — ${candidate.label}.`,
      assumptions: [`filter:${candidate.label}`, "grain:year"],
      definition_used: ratified
        ? { id: "def_revenue", name: "Revenue" }
        : { id: "", name: "" },
    },
  };
  yield {
    event: "stage",
    data: {
      stage: "resolve",
      state: "done",
      detail: ratified ? "ratified as Revenue v4" : "used once, not recorded",
    },
  };
  await delay(t(420), signal);
  yield { event: "stage", data: { stage: "plan", state: "done" } };
  yield {
    event: "chart",
    data: {
      type: "line",
      x: { field: "month", label: "Month", type: "temporal" },
      y: [{ field: "revenue", label: "Revenue", type: "quantitative" }],
      series: null,
      coverage: {
        included_rows: candidate.rows_included ?? 0,
        excluded_rows: (candidate.rows_total ?? 0) - (candidate.rows_included ?? 0),
        reason: "rows outside the chosen reading",
      },
      confidence: "verified",
    },
  };
  await delay(t(900), signal);

  const monthly = MONTHLY_SHAPE.map(([m, share]) => [
    m,
    Math.round(candidate.value * share),
  ]);

  yield {
    event: "result",
    data: {
      answer_id: `ans_resolved_${candidate.id}`,
      value: candidate.value,
      unit: "currency",
      format_hint: "currency",
      columns: [
        { name: "month", label: "Month", type: "temporal" },
        { name: "revenue", label: "Revenue", type: "quantitative" },
      ],
      rows: monthly,
      row_count: 12,
      scanned_rows: candidate.rows_total,
    },
  };
  yield { event: "stage", data: { stage: "query", state: "done" } };
  yield { event: "stage", data: { stage: "verify", state: "start" } };

  const checks = resolvedChecks(candidate.label, candidate.value, ratified);
  for (let i = 0; i < checks.length; i++) {
    await delay(t(CHECK_STAGGER + 170), signal);
    yield { event: "check", data: checks[i] };
  }

  yield { event: "stage", data: { stage: "verify", state: "done" } };
  yield {
    event: "narrative",
    data: {
      markdown: `2023 revenue was ${currency(candidate.value)} under the "${candidate.label}" reading, covering ${(candidate.rows_included ?? 0).toLocaleString("en-US")} of ${(candidate.rows_total ?? 0).toLocaleString("en-US")} order items. Two independent queries agree on the figure.${ratified ? " This reading is now the ratified default for everyone in the workspace." : " This reading was used once and has not been recorded as a definition."}`,
    },
  };
  yield { event: "stage", data: { stage: "compose", state: "done" } };
  yield {
    event: "verdict",
    data: {
      confidence: "verified",
      checks,
      passed: checks.filter((c) => c.status === "pass").length,
      total: checks.filter((c) => c.status !== "skipped").length,
      headline: "Independently re-derived and structurally checked.",
    },
  };
  yield { event: "cost", data: { llm_calls: 2, usd: 0.06, elapsed_ms: 4200 } };
}

const MONTHLY_SHAPE: Array<[string, number]> = [
  ["2023-01", 0.0705], ["2023-02", 0.0611], ["2023-03", 0.0742], ["2023-04", 0.0768],
  ["2023-05", 0.0801], ["2023-06", 0.0786], ["2023-07", 0.0833], ["2023-08", 0.0849],
  ["2023-09", 0.0817], ["2023-10", 0.0901], ["2023-11", 0.1054], ["2023-12", 0.1133],
];

function currency(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function resolvedChecks(label: string, value: number, ratified: boolean): Check[] {
  return [
    {
      id: "cross_derivation",
      label: "Computed a second way",
      status: "pass",
      finding: `Two independent queries agree: ${currency(value)}`,
    },
    {
      id: "filter_sensitivity",
      label: "Answer is stable under reasonable variations",
      status: "pass",
      finding: `The reading is now pinned to "${label}", so status treatment no longer moves this figure.`,
    },
    {
      id: "definition_source",
      label: "Uses a ratified definition",
      status: ratified ? "pass" : "warn",
      finding: ratified
        ? "Revenue v4 — ratified just now."
        : "Used once. No definition was recorded, so the next asker may get a different reading.",
    },
    {
      id: "join_loss",
      label: "No rows silently dropped",
      status: "pass",
      finding: "Every order item reachable under this reading was included.",
    },
    {
      id: "fan_out",
      label: "No rows double-counted",
      status: "pass",
      finding: "Each order counted once.",
    },
    {
      id: "grain",
      label: "Aggregation is valid at this grain",
      status: "pass",
      finding: "Summing a measure at its native grain.",
    },
    {
      id: "freshness",
      label: "Data is current",
      status: "pass",
      finding: "Source last loaded 2 hours ago.",
    },
  ];
}

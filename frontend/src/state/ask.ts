"use client";

import { create } from "zustand";
import type {
  AmbiguityPayload,
  ApiError,
  AskRequest,
  Check,
  CheckId,
  ChartSpec,
  Context,
  ContextFilter,
  CostEvent,
  InterpretationEvent,
  ResultEvent,
  StageName,
} from "@/lib/api/types";
import { STAGES } from "@/lib/api/types";
import { streamAsk, streamResolve } from "@/lib/api/client";
import { formatRange } from "@/lib/format";
import type { ConfidenceState } from "@/lib/confidence";

/* ---------------------------------------------------------------------------
   Context chips — a client view-model over the wire `Context`.

   The wire carries the context the user pinned. Anything the system worked out
   for itself arrives on `interpretation.assumptions`, which this app reads
   using a `type:value` convention; an assumption without a recognised prefix
   degrades to a plain inferred chip carrying the sentence. Nothing is invented
   on the wire.
--------------------------------------------------------------------------- */

export type ChipType =
  | "metric"
  | "filter"
  | "grain"
  | "time-range"
  | "definition"
  | "segment";

export interface Chip {
  id: string;
  type: ChipType;
  /** Canonical value — round-trips back onto the wire `Context`. */
  value: string;
  /** What the user reads. Falls back to `value`. */
  display?: string;
  /** The system guessed this — dashed border, click to confirm. */
  inferred?: boolean;
  /** Survives topic changes until explicitly removed. */
  pinned?: boolean;
  /** A ratified definition backs this value. */
  fromDefinition?: boolean;
  /** Set when the chip's value changed on the latest turn (brief pulse). */
  changed?: boolean;
}

const TYPE_LABEL: Record<ChipType, string> = {
  metric: "metric",
  filter: "filter",
  grain: "grain",
  "time-range": "time",
  definition: "definition",
  segment: "segment",
};

export const chipTypeLabel = (t: ChipType) => TYPE_LABEL[t];

function chipsFromContext(ctx: Context | undefined, inferred: boolean): Chip[] {
  if (!ctx) return [];
  const out: Chip[] = [];
  if (ctx.time_range)
    out.push({
      id: "time-range",
      type: "time-range",
      value: `${ctx.time_range.from} → ${ctx.time_range.to}`,
      display: formatRange(ctx.time_range.from, ctx.time_range.to),
      inferred,
    });
  if (ctx.grain)
    out.push({ id: "grain", type: "grain", value: ctx.grain, inferred });
  (ctx.filters ?? []).forEach((f, i) =>
    out.push({
      id: `filter-${i}`,
      type: "filter",
      value: `${f.column} ${f.operator} ${formatFilterValue(f.value)}`,
      inferred,
    }),
  );
  return out;
}

function formatFilterValue(v: ContextFilter["value"]): string {
  return Array.isArray(v) ? v.join(", ") : String(v);
}

function chipsFromAssumptions(assumptions: string[]): Chip[] {
  return assumptions.map((a, i) => {
    const colon = a.indexOf(":");
    const prefix = colon > 0 ? a.slice(0, colon) : "";
    const rest = colon > 0 ? a.slice(colon + 1) : a;
    switch (prefix) {
      case "time_range":
        {
          const [from, to] = rest.split("..");
          return {
            id: "time-range",
            type: "time-range" as const,
            value: `${from} → ${to}`,
            display: from && to ? formatRange(from, to) : rest,
            inferred: true,
          };
        }
      case "grain":
        return { id: "grain", type: "grain" as const, value: rest, inferred: true };
      case "filter":
        return {
          id: `filter-${i}`,
          type: "filter" as const,
          value: rest,
          inferred: true,
        };
      case "segment":
        return { id: `segment-${i}`, type: "segment" as const, value: rest, inferred: true };
      default:
        return { id: `assumption-${i}`, type: "segment" as const, value: a, inferred: true };
    }
  });
}

function mergeChips(explicit: Chip[], inferred: Chip[], previous: Chip[]): Chip[] {
  const byId = new Map<string, Chip>();
  for (const c of inferred) byId.set(c.id, c);
  for (const c of explicit) byId.set(c.id, { ...c, inferred: false });
  // Pinned chips survive topic changes until explicitly removed.
  for (const c of previous) {
    if (c.pinned && !byId.has(c.id)) byId.set(c.id, c);
  }
  const prevById = new Map(previous.map((c) => [c.id, c]));
  return [...byId.values()].map((c) => {
    const before = prevById.get(c.id);
    return {
      ...c,
      pinned: before?.pinned ?? c.pinned,
      changed: Boolean(before && before.value !== c.value),
    };
  });
}

/* ---------------------------------------------------------------------------
   Turns
--------------------------------------------------------------------------- */

export type StageStatus = "pending" | "active" | "done";

export interface Turn {
  id: string;
  question: string;
  /** The user's chart choices for this turn — ephemeral, view state. */
  viz?: import("@/lib/viz/resolve").VizOverride;
  status: "streaming" | "done" | "error";
  stages: Record<StageName, StageStatus>;
  stageDetail: Partial<Record<StageName, string>>;
  interpretation?: InterpretationEvent;
  chips: Chip[];
  result?: ResultEvent;
  chart?: ChartSpec;
  checks: Check[];
  /** The roster the workspace's check policy says will run. */
  expected: CheckId[];
  report?: import("@/lib/api/types").Report;
  narrative: string;
  cost?: CostEvent;
  ambiguity?: AmbiguityPayload;
  error?: ApiError;
  startedAt: number;
  elapsedMs?: number;
  /** Set while a re-run is in flight so the previous answer can dim. */
  rerunning?: boolean;
  /** Answers resolved from a fork record which reading was chosen. */
  resolvedFrom?: { candidateId: string; label: string; ratified: boolean };
}

function emptyStages(): Record<StageName, StageStatus> {
  return Object.fromEntries(STAGES.map((s) => [s, "pending"])) as Record<
    StageName,
    StageStatus
  >;
}

export function turnState(t: Turn): ConfidenceState | null {
  if (t.ambiguity) return "refused";
  if (t.report) return t.report.confidence;
  if (t.result) return "checking";
  return null;
}

export function turnTally(t: Turn): { passed: number; total: number } {
  if (t.report) return { passed: t.report.passed, total: t.report.total };
  const ran = t.checks.filter((c) => c.status !== "skipped" && c.status !== "not_applicable");
  return { passed: ran.length, total: Math.max(t.expected.length, ran.length) };
}

/** The named slow check, once verification runs long. §1.3 */
export function slowCheckOf(t: Turn): string | undefined {
  if (t.status !== "streaming" || !t.result) return undefined;
  if (Date.now() - t.startedAt < 20_000) return undefined;
  const done = new Set(t.checks.map((c) => c.id));
  const next = t.expected.find((id) => !done.has(id));
  return next ? `slow check running: ${next.replace(/_/g, " ")}` : undefined;
}

/* ---------------------------------------------------------------------------
   Store
--------------------------------------------------------------------------- */

interface AskState {
  threadId: string | null;
  title: string;
  turns: Turn[];
  context: Context;
  sourceId: string;
  expected: CheckId[];
  /** Composer text is owned here so `↑` recall and follow-ups work. */
  draft: string;
  focusedTurnId: string | null;
  abort: AbortController | null;

  setExpected: (ids: CheckId[]) => void;
  setDraft: (v: string) => void;
  setFocusedTurn: (id: string | null) => void;
  reset: () => void;
  ask: (question: string, ctxOverride?: Context) => Promise<void>;
  resolveCandidate: (
    turnId: string,
    candidateId: string,
    ratify: boolean,
    definitionName?: string,
    plainEnglish?: string,
    definitionId?: string,
  ) => Promise<void>;
  editChip: (turnId: string, chipId: string, value: string) => Promise<void>;
  removeChip: (turnId: string, chipId: string) => Promise<void>;
  togglePin: (turnId: string, chipId: string) => void;
  setViz: (turnId: string, viz: import("@/lib/viz/resolve").VizOverride) => void;
  cancel: () => void;
}

const DEFAULT_EXPECTED: CheckId[] = [
  "cross_derivation",
  "join_loss",
  "fan_out",
  "period_normalization",
  "filter_sensitivity",
  "definition_source",
  "grain",
  "coverage",
  "freshness",
];

export const useAsk = create<AskState>((set, get) => ({
  threadId: null,
  title: "",
  turns: [],
  context: {},
  // Empty means "let the server pick": the backend falls back to the first
  // healthy source, which is the right default for a single-source workspace.
  sourceId: "",
  expected: DEFAULT_EXPECTED,
  draft: "",
  focusedTurnId: null,
  abort: null,

  setExpected: (ids) => set({ expected: ids.length ? ids : DEFAULT_EXPECTED }),
  setDraft: (v) => set({ draft: v }),
  setFocusedTurn: (id) => set({ focusedTurnId: id }),

  reset: () => {
    get().abort?.abort();
    set({ threadId: null, title: "", turns: [], context: {}, draft: "", abort: null });
  },

  cancel: () => {
    get().abort?.abort();
    set((s) => ({
      abort: null,
      turns: s.turns.map((t) =>
        t.status === "streaming" ? { ...t, status: "done" as const } : t,
      ),
    }));
  },

  ask: async (question, ctxOverride) => {
    const { context, sourceId, expected, threadId, turns } = get();
    const ctx = ctxOverride ?? context;
    const previousChips = turns[turns.length - 1]?.chips ?? [];

    const turn: Turn = {
      id: `turn_${Date.now()}_${turns.length}`,
      question,
      status: "streaming",
      stages: emptyStages(),
      stageDetail: {},
      chips: mergeChips(chipsFromContext(ctx, false), [], previousChips),
      checks: [],
      expected,
      narrative: "",
      startedAt: Date.now(),
    };

    const abort = new AbortController();
    set((s) => ({
      turns: [...s.turns, turn],
      focusedTurnId: turn.id,
      title: s.title || question,
      abort,
      draft: "",
    }));

    const patch = (fn: (t: Turn) => Turn) =>
      set((s) => ({ turns: s.turns.map((t) => (t.id === turn.id ? fn(t) : t)) }));

    try {
      const req: AskRequest = {
        question,
        thread_id: threadId ?? undefined,
        context: ctx,
        source_id: sourceId || undefined,
      };
      for await (const evt of streamAsk(req, abort.signal)) {
        switch (evt.event) {
          case "thread":
            set({ threadId: evt.data.thread_id });
            break;
          case "stage":
            patch((t) => ({
              ...t,
              stages: { ...t.stages, [evt.data.stage]: evt.data.state === "done" ? "done" : "active" },
              stageDetail: evt.data.detail
                ? { ...t.stageDetail, [evt.data.stage]: evt.data.detail }
                : t.stageDetail,
            }));
            break;
          case "interpretation":
            patch((t) => {
              const inferred = chipsFromAssumptions(evt.data.assumptions);
              const metric = evt.data.definition_used?.name
                ? [
                    {
                      id: "metric",
                      type: "metric" as const,
                      value: evt.data.definition_used.name,
                      fromDefinition: Boolean(evt.data.definition_used.id),
                      inferred: !evt.data.definition_used.id,
                    },
                  ]
                : [];
              return {
                ...t,
                interpretation: evt.data,
                chips: mergeChips(
                  [...metric, ...chipsFromContext(ctx, false)],
                  inferred,
                  previousChips,
                ),
              };
            });
            break;
          case "result":
            patch((t) => ({ ...t, result: evt.data }));
            break;
          case "chart":
            patch((t) => ({ ...t, chart: evt.data }));
            break;
          case "check":
            patch((t) => ({
              ...t,
              checks: [...t.checks.filter((c) => c.id !== evt.data.id), evt.data],
            }));
            break;
          case "narrative":
            patch((t) => ({ ...t, narrative: evt.data.markdown }));
            break;
          case "ambiguity":
            patch((t) => ({ ...t, ambiguity: evt.data }));
            break;
          case "verdict":
            patch((t) => ({ ...t, report: evt.data, checks: evt.data.checks }));
            break;
          case "cost":
            patch((t) => ({ ...t, cost: evt.data, elapsedMs: evt.data.elapsed_ms }));
            break;
          case "error":
            patch((t) => ({ ...t, error: evt.data, status: "error" }));
            break;
        }
      }
      patch((t) => ({
        ...t,
        status: t.status === "error" ? t.status : "done",
        elapsedMs: t.elapsedMs ?? Date.now() - t.startedAt,
        stages: Object.fromEntries(
          STAGES.map((s) => [s, t.stages[s] === "pending" && !t.error ? "done" : t.stages[s]]),
        ) as Record<StageName, StageStatus>,
      }));
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      patch((t) => ({
        ...t,
        status: "error",
        error: {
          code: "stream_failed",
          message: (err as Error).message || "The answer stream stopped unexpectedly.",
        },
      }));
    } finally {
      set({ abort: null });
    }
  },

  resolveCandidate: async (turnId, candidateId, ratify, definitionName, plainEnglish, definitionId) => {
    const turn = get().turns.find((t) => t.id === turnId);
    if (!turn?.ambiguity) return;
    const candidate = turn.ambiguity.candidates.find((c) => c.id === candidateId);

    const abort = new AbortController();
    const next: Turn = {
      id: `turn_${Date.now()}_resolved`,
      question: turn.question,
      status: "streaming",
      stages: emptyStages(),
      stageDetail: {},
      chips: turn.chips,
      checks: [],
      expected: turn.expected,
      narrative: "",
      startedAt: Date.now(),
      resolvedFrom: {
        candidateId,
        label: candidate?.label ?? "",
        ratified: ratify,
      },
    };

    set((s) => ({
      turns: [...s.turns.filter((t) => t.id !== turnId), { ...turn, status: "done" }, next],
      focusedTurnId: next.id,
      abort,
    }));

    const patch = (fn: (t: Turn) => Turn) =>
      set((s) => ({ turns: s.turns.map((t) => (t.id === next.id ? fn(t) : t)) }));

    // When the RatifySheet ran first, the definition already exists — it
    // created it with the human's plain English. Asking the backend to ratify
    // again would mint a duplicate, so that path sends the definition's id
    // instead: the continued answer is then CREDITED with the ratified
    // definition rather than warning "chosen ad hoc" — which is what happened
    // when this sent ratify:false and nothing else, and the answer born from
    // a ratification sealed qualified. Only this call ratifies when it is the
    // one carrying the definition's content.
    const wireRatify = ratify && Boolean(plainEnglish);

    try {
      for await (const evt of streamResolve(
        {
          thread_id: get().threadId ?? "",
          candidate_id: candidateId,
          ratify: wireRatify,
          definition_name: wireRatify ? definitionName : undefined,
          plain_english: wireRatify ? plainEnglish : undefined,
          definition_id: !wireRatify ? definitionId : undefined,
        },
        abort.signal,
      )) {
        switch (evt.event) {
          case "stage":
            patch((t) => ({
              ...t,
              stages: { ...t.stages, [evt.data.stage]: evt.data.state === "done" ? "done" : "active" },
              stageDetail: evt.data.detail
                ? { ...t.stageDetail, [evt.data.stage]: evt.data.detail }
                : t.stageDetail,
            }));
            break;
          case "interpretation":
            patch((t) => ({
              ...t,
              interpretation: evt.data,
              chips: mergeChips(
                [
                  ...(evt.data.definition_used?.name
                    ? [
                        {
                          id: "metric",
                          type: "metric" as const,
                          value: evt.data.definition_used.name,
                          fromDefinition: Boolean(evt.data.definition_used.id),
                        },
                      ]
                    : []),
                ],
                chipsFromAssumptions(evt.data.assumptions),
                t.chips,
              ),
            }));
            break;
          case "result":
            patch((t) => ({ ...t, result: evt.data }));
            break;
          case "chart":
            patch((t) => ({ ...t, chart: evt.data }));
            break;
          case "check":
            patch((t) => ({
              ...t,
              checks: [...t.checks.filter((c) => c.id !== evt.data.id), evt.data],
            }));
            break;
          case "narrative":
            patch((t) => ({ ...t, narrative: evt.data.markdown }));
            break;
          case "verdict":
            patch((t) => ({ ...t, report: evt.data, checks: evt.data.checks }));
            break;
          case "cost":
            patch((t) => ({ ...t, cost: evt.data, elapsedMs: evt.data.elapsed_ms }));
            break;
          case "error":
            patch((t) => ({ ...t, error: evt.data, status: "error" }));
            break;
        }
      }
      patch((t) => ({ ...t, status: t.status === "error" ? t.status : "done" }));
    } finally {
      set({ abort: null });
    }
  },

  setViz: (turnId, viz) =>
    set((s) => ({
      turns: s.turns.map((t) => (t.id === turnId ? { ...t, viz } : t)),
    })),

  editChip: async (turnId, chipId, value) => {
    const turn = get().turns.find((t) => t.id === turnId);
    if (!turn) return;
    const chips = turn.chips.map((c) => (c.id === chipId ? { ...c, value, inferred: false } : c));
    set((s) => ({
      turns: s.turns.map((t) =>
        t.id === turnId ? { ...t, chips, rerunning: true } : t,
      ),
    }));
    await get().ask(turn.question, contextFromChips(chips));
    set((s) => ({
      turns: s.turns.map((t) => (t.id === turnId ? { ...t, rerunning: false } : t)),
    }));
  },

  removeChip: async (turnId, chipId) => {
    const turn = get().turns.find((t) => t.id === turnId);
    if (!turn) return;
    const chips = turn.chips.filter((c) => c.id !== chipId);
    set((s) => ({
      turns: s.turns.map((t) => (t.id === turnId ? { ...t, chips, rerunning: true } : t)),
    }));
    await get().ask(turn.question, contextFromChips(chips));
    set((s) => ({
      turns: s.turns.map((t) => (t.id === turnId ? { ...t, rerunning: false } : t)),
    }));
  },

  togglePin: (turnId, chipId) =>
    set((s) => ({
      turns: s.turns.map((t) =>
        t.id === turnId
          ? {
              ...t,
              chips: t.chips.map((c) =>
                c.id === chipId ? { ...c, pinned: !c.pinned } : c,
              ),
            }
          : t,
      ),
    })),
}));

/** Chips are the control surface; this maps them back onto the wire type. */
export function contextFromChips(chips: Chip[]): Context {
  const ctx: Context = {};
  for (const c of chips) {
    if (c.type === "time-range") {
      const [from, to] = c.value.split("→").map((s) => s.trim());
      if (from && to) ctx.time_range = { from, to };
    } else if (c.type === "grain") {
      ctx.grain = c.value;
    } else if (c.type === "filter") {
      const m = /^(\S+)\s+(=|!=|>|<|>=|<=|in|not in)\s+(.*)$/.exec(c.value);
      if (m) {
        ctx.filters = [
          ...(ctx.filters ?? []),
          {
            column: m[1],
            operator: m[2] as ContextFilter["operator"],
            value: m[3].includes(",") ? m[3].split(",").map((v) => v.trim()) : m[3],
          },
        ];
      }
    }
  }
  return ctx;
}

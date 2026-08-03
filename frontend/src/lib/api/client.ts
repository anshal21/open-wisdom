import { API_BASE, backendIsUp } from "./config";
import { readSSE, toAskEvent } from "./sse";
import type {
  Answer,
  AnswerFlag,
  AnswerQuery,
  AnswerSummary,
  AskEvent,
  AskRequest,
  Catalog,
  Context,
  Dashboard,
  DashboardSummary,
  Definition,
  DefinitionCoverage,
  DefinitionImpact,
  DefinitionProposal,
  Investigation,
  InvestigationSummary,
  RuleoutEvent,
  CellKind,
  CellRunResult,
  DashboardTile,
  Notebook,
  NotebookCell,
  NotebookSummary,
  ReportConfidence,
  RatifyRequest,
  RerunResponse,
  ResolveRequest,
  Settings,
  SlackRender,
  Source,
  SourceKind,
  Thread,
  ThreadSummary,
  User,
  UsageStats,
  AuditEntry,
  Watch,
  WatchCondition,
  WatchEvent,
} from "./types";

import { delay, SOURCES, USERS } from "./mock/base";
import {
  ANSWER_BY_ID,
  ANSWER_REFUSED,
  LEDGER,
} from "./mock/answers";
import {
  COVERAGE,
  DEFAULT_IMPACT,
  DEFINITIONS,
  DEFINITION_BY_ID,
  IMPACT,
  PROPOSALS,
} from "./mock/definitions";
import { DASHBOARDS, DASHBOARD_SUMMARIES } from "./mock/dashboards";
import { THREADS, THREAD_SUMMARIES } from "./mock/threads";
import { mockAskStream, mockResolveStream, scenarioFor } from "./mock/stream";
import { NOTEBOOKS, NOTEBOOK_SUMMARIES } from "./mock/notebooks";
import { INVESTIGATIONS, INVESTIGATION_SUMMARIES } from "./mock/investigations";
import { WATCHES, WATCH_EVENTS } from "./mock/watches";
import { CATALOGS } from "./mock/catalog";
import { AUDIT, SETTINGS, USAGE } from "./mock/admin";

/* ---------------------------------------------------------------------------
   Transport
--------------------------------------------------------------------------- */

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

async function live<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let code = "request_failed";
    let message = `The request to ${path} failed.`;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      if (body.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiFailure(code, message, res.status);
  }
  return (await res.json()) as T;
}

/**
 * Every read goes through here. In `auto` mode a backend that is not up falls
 * back to fixtures, so every screen is developable and demoable on its own.
 */
async function call<T>(path: string, mock: () => T | Promise<T>, init?: RequestInit): Promise<T> {
  if (await backendIsUp()) {
    try {
      return await live<T>(path, init);
    } catch (err) {
      if (err instanceof ApiFailure && err.status !== 503) throw err;
    }
  }
  await delay(60 + Math.round(80 * hash(path)));
  return mock();
}

/** Deterministic 0..1 from a string, so fixture latency does not jitter. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h / 997;
}

/* ---------------------------------------------------------------------------
   §1 Ask
--------------------------------------------------------------------------- */

/** A non-OK response from a live backend becomes a terminal error event. */
async function streamRejection(res: Response): Promise<AskEvent> {
  let code = "request_failed";
  let message = `The request failed (${res.status}).`;
  try {
    const body = await res.json();
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    /* keep defaults */
  }
  return { event: "error", data: { code, message } };
}

export async function* streamAsk(
  req: AskRequest,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  if (await backendIsUp()) {
    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(req),
        signal,
      });
      if (res.ok && res.body) {
        for await (const frame of readSSE(res.body, signal)) {
          const evt = toAskEvent(frame);
          if (evt) yield evt;
        }
        return;
      }
      // The backend answered and said no. That is a real result — surface it.
      // Falling back to fixtures would render fiction over an error.
      yield await streamRejection(res);
      return;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
    }
  }
  yield* mockAskStream(req, signal);
}

export async function* streamResolve(
  req: ResolveRequest,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  if (await backendIsUp()) {
    try {
      const res = await fetch(`${API_BASE}/ask/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(req),
        signal,
      });
      if (res.ok && res.body) {
        for await (const frame of readSSE(res.body, signal)) {
          const evt = toAskEvent(frame);
          if (evt) yield evt;
        }
        return;
      }
      // The backend answered and said no. That is a real result — surface it.
      // Falling back to fixtures would render fiction over an error.
      yield await streamRejection(res);
      return;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
    }
  }
  const ambiguity = ANSWER_REFUSED.ambiguity!;
  yield* mockResolveStream(ambiguity, req.candidate_id, req.ratify, signal);
}

export const patchTileViz = (
  dashboardId: string,
  tileId: string,
  viz: import("@/lib/viz/resolve").VizOverride,
) =>
  call<void>(`/dashboards/${dashboardId}/tiles/${tileId}`, () => undefined, {
    method: "PATCH",
    body: JSON.stringify({ viz }),
  });

export const saveDashboardLayout = (
  dashboardId: string,
  layout: Array<{ tile_id: string; x: number; y: number; w: number; h: number }>,
) =>
  call<void>(`/dashboards/${dashboardId}/layout`, () => undefined, {
    method: "PUT",
    body: JSON.stringify({ layout }),
  });

/* ---------------------------------------------------------------------------
   §3 Threads
--------------------------------------------------------------------------- */

export const getThreads = () =>
  call<ThreadSummary[]>("/threads", () => THREAD_SUMMARIES);

export const getThread = (id: string) =>
  call<Thread>(`/threads/${id}`, () => {
    const t = THREADS.find((x) => x.id === id);
    if (!t) throw new ApiFailure("not_found", "This thread no longer exists.", 404);
    return t;
  });

export const patchThreadContext = (id: string, context: Context) =>
  call<Context>(`/threads/${id}/context`, () => context, {
    method: "PATCH",
    body: JSON.stringify(context),
  });

/* ---------------------------------------------------------------------------
   §6 Answers
--------------------------------------------------------------------------- */

export function getAnswers(query: AnswerQuery = {}) {
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v != null && v !== "") as [string, string][],
  ).toString();
  return call<AnswerSummary[]>(`/answers${qs ? `?${qs}` : ""}`, () =>
    LEDGER.filter((a) => {
      if (query.confidence && a.confidence !== query.confidence) return false;
      if (query.created_by && a.created_by !== query.created_by) return false;
      if (query.definition_id && a.definition_used?.id !== query.definition_id)
        return false;
      if (query.query) {
        const q = query.query.toLowerCase();
        if (
          !a.question.toLowerCase().includes(q) &&
          !(a.definition_used?.name ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    }),
  );
}

export const getAnswer = (id: string) =>
  call<Answer & { alt_sql?: string }>(`/answers/${id}`, () => {
    const a = ANSWER_BY_ID[id];
    if (!a) throw new ApiFailure("not_found", "This answer was deleted.", 404);
    return a;
  }).then((a) => ({
    ...a,
    // The wire calls the independent derivation alt_sql; the surfaces call it
    // path B. One mapping, here.
    sql_path_b: a.sql_path_b ?? a.alt_sql,
  }));

/** Record a human correction against an answer. The flag is permanent and is
 * returned on subsequent single-answer reads as `flags`. */
export const flagAnswer = (id: string, reason: string) =>
  call<AnswerFlag>(
    `/answers/${id}/flag`,
    () => ({
      id: `flag_${Math.random().toString(36).slice(2)}`,
      answer_id: id,
      reason,
      created_at: new Date().toISOString(),
    }),
    { method: "POST", body: JSON.stringify({ reason }) },
  );

export const rerunAnswer = (id: string) =>
  call<RerunResponse>(
    `/answers/${id}/rerun`,
    () => {
      const a = ANSWER_BY_ID[id];
      const previous = a?.value ?? null;
      const current =
        previous === null ? null : Math.round(previous * 1.0211 * 100) / 100;
      return {
        answer_id: id,
        diff: {
          previous,
          current,
          delta_pct: previous && current ? ((current - previous) / previous) * 100 : null,
          checks_changed: ["period_normalization"],
        },
      };
    },
    { method: "POST" },
  );

export const getPermalink = (id: string) =>
  call<{ url: string }>(`/answers/${id}/permalink`, () => ({
    url: `${typeof window === "undefined" ? "" : window.location.origin}/a/${id}`,
  }));

/* ---------------------------------------------------------------------------
   §7 Definitions
--------------------------------------------------------------------------- */

export const getDefinitions = () =>
  call<Definition[]>("/definitions", () => DEFINITIONS);

export const getDefinition = (id: string) =>
  call<Definition>(`/definitions/${id}`, () => {
    const d = DEFINITION_BY_ID[id];
    if (!d) throw new ApiFailure("not_found", "This definition no longer exists.", 404);
    return d;
  });

export const getProposedDefinitions = () =>
  call<DefinitionProposal[]>("/definitions/proposed", () => PROPOSALS);

export const getDefinitionImpact = (id: string) =>
  call<DefinitionImpact>(`/definitions/${id}/impact`, () => {
    const base = IMPACT[id] ?? DEFAULT_IMPACT;
    return {
      ...base,
      sample: LEDGER.filter((a) => a.definition_used?.id === id).slice(0, 5),
    };
  });

export const getCoverage = () =>
  call<DefinitionCoverage>("/definitions/coverage", () => COVERAGE);

export const ratifyDefinition = (body: RatifyRequest) =>
  call<Definition>(
    "/definitions",
    () => ({
      id: `def_${body.name.toLowerCase().replace(/\W+/g, "_")}`,
      name: body.name,
      plain_english: body.plain_english,
      expression: body.expression,
      version: 1,
      status: "ratified" as const,
      ratified_by: "usr_1",
      ratified_at: new Date().toISOString(),
      source_answer_id: body.source_answer_id ?? "",
      usage_count: 0,
      confidence: "verified" as const,
      earned: true,
      precedence: body.precedence ?? "official",
      scope: body.scope ?? "workspace",
      updated_at: new Date().toISOString(),
    }),
    { method: "POST", body: JSON.stringify(body) },
  );

export const updateDefinition = (id: string, body: RatifyRequest) =>
  call<Definition>(
    `/definitions/${id}`,
    () => {
      const prev = DEFINITION_BY_ID[id];
      return {
        ...prev,
        name: body.name,
        plain_english: body.plain_english,
        expression: body.expression,
        version: (prev?.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      };
    },
    { method: "PUT", body: JSON.stringify(body) },
  );

/* ---------------------------------------------------------------------------
   §8 Investigations
--------------------------------------------------------------------------- */

/* The backend stores investigations in wire form (ruleouts as {kind, status,
   finding}, stopped_at as a rule-out name, verdict as a check Report). The
   surfaces render a presentation form (phases, verdict kinds, a synthesized
   question). This adapter is the single place that mapping lives. */

const RULEOUT_PHASE: Record<string, 1 | 2 | 3> = {
  period: 1,
  data_quality: 2,
  instrumentation: 2,
  mix: 3,
  rate: 3,
};

const RULEOUT_LABEL: Record<string, string> = {
  period: "Period lengths",
  data_quality: "Data quality",
  instrumentation: "Category coverage",
  mix: "Mix vs rate",
};

/**
 * A raw investigation payload mid-adaptation.
 *
 * This is the one `any` left in the client, and it is deliberate rather than
 * lazy. `docs/api-contract.md` does not fully pin the investigation shape, so
 * the adapter reads roughly twenty loosely-specified fields. `unknown` is the
 * correct type and would force each read to be a guarded narrowing — but that
 * refactor cannot be verified today: there are no investigations in any
 * database to render, so the only proof available would be the typechecker
 * agreeing with itself.
 *
 * Tracked as OSS-26: pin the contract, then narrow this to `unknown` with the
 * guards it deserves, with a live investigation to check against.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WireRecord = Record<string, any>;

function adaptInvestigation(raw: WireRecord): Investigation {
  const ruleouts: RuleoutEvent[] = (raw.ruleouts ?? []).map(
    (r: WireRecord, i: number) => ({
      kind: r.kind,
      phase: RULEOUT_PHASE[r.kind] ?? 2,
      id: `${raw.id}_ro_${i}`,
      label: RULEOUT_LABEL[r.kind] ?? r.kind,
      status: r.status,
      finding: r.finding ?? "",
    }),
  );
  const drivers = raw.drivers ?? [];
  const kind: Investigation["verdict"]["kind"] =
    raw.stopped_at === "period"
      ? "artifact"
      : raw.stopped_at === "data_quality" || raw.stopped_at === "instrumentation"
        ? "data_incident"
        : drivers.length || ruleouts.some((r) => r.status === "implicated")
          ? "driver_found"
          : "no_driver";
  const narrative: string = raw.narrative ?? "";
  const firstStop = narrative.indexOf(". ");
  return {
    id: raw.id,
    question: `Why did ${raw.metric} change from ${raw.comparison_period} to ${raw.period}?`,
    metric: raw.metric,
    definition_id: raw.definition_id ?? "",
    period: raw.period,
    comparison_period: raw.comparison_period,
    ruleouts,
    drivers,
    waterfall: raw.waterfall ?? null,
    narrative,
    verdict: {
      kind,
      headline: firstStop >= 0 ? narrative.slice(0, firstStop + 1) : narrative,
      detail: "",
      figures: [],
    },
    // Reaching phase 3 and naming a driver is the ladder finishing, not
    // stopping early — "stopped" is reserved for a rule-out that ended the hunt.
    stopped_at:
      kind === "driver_found" || !raw.stopped_at
        ? null
        : (RULEOUT_PHASE[raw.stopped_at] ?? null),
    report:
      raw.verdict ?? { confidence: "unverified", checks: [], passed: 0, total: 0, headline: "" },
    created_at: raw.created_at ?? "",
    created_by: raw.created_by ?? "",
  };
}

function summaryOf(inv: Investigation): InvestigationSummary {
  return {
    id: inv.id,
    question: inv.question,
    metric: inv.metric,
    verdict_kind: inv.verdict.kind,
    stopped_at: inv.stopped_at,
    created_at: inv.created_at,
    created_by: inv.created_by,
  };
}

export const getInvestigations = () =>
  call<WireRecord[]>("/investigations", () => INVESTIGATION_SUMMARIES).then(
    (rows) =>
      rows.map((r) =>
        "verdict_kind" in r
          ? (r as InvestigationSummary)
          : summaryOf(adaptInvestigation(r)),
      ),
  );

/** Re-run an investigation over the same metric and periods. Produces a NEW
 * record; the original stays on the ledger so the two can be compared. */
/**
 * Dismiss a proposal.
 *
 * Hides it durably rather than for the session. If the same ambiguity recurs
 * the pipeline raises a NEW proposal — the question genuinely came up again —
 * so the copy must promise that this one is gone, not that the term will never
 * be raised.
 */
export const dismissDefinition = (id: string) =>
  call<void>(`/definitions/${id}/dismiss`, () => undefined, { method: "POST" });

export const rerunInvestigation = (id: string) =>
  call<WireRecord>(`/investigations/${id}/rerun`, () => INVESTIGATIONS[0], {
    method: "POST",
  }).then((raw) =>
    "verdict" in raw && raw.verdict && "kind" in raw.verdict
      ? (raw as Investigation)
      : adaptInvestigation(raw),
  );

export const getInvestigation = (id: string) =>
  call<WireRecord>(`/investigations/${id}`, () => {
    const i = INVESTIGATIONS.find((x) => x.id === id);
    if (!i)
      throw new ApiFailure("not_found", "This investigation no longer exists.", 404);
    return i;
  }).then((raw) =>
    "verdict" in raw && raw.verdict && "kind" in raw.verdict
      ? (raw as Investigation)
      : adaptInvestigation(raw),
  );

/* ---------------------------------------------------------------------------
   §9 Dashboards
--------------------------------------------------------------------------- */

export const getDashboards = () =>
  call<DashboardSummary[]>("/dashboards", () => DASHBOARD_SUMMARIES);

/** Promote the /dashboards/new draft into a real dashboard. The draft page is
 * pure client state until the first tile lands — this is the write that gives
 * it a server id to reconcile against. */
export const createDashboard = (name: string) =>
  call<Dashboard>(
    "/dashboards",
    () => ({
      id: `dash_${name.toLowerCase().replace(/\W+/g, "_")}`,
      name,
      tiles: [],
      last_refreshed_at: null,
    }),
    { method: "POST", body: JSON.stringify({ name }) },
  );

export const getDashboard = (id: string) =>
  call<Dashboard>(`/dashboards/${id}`, () => {
    const d = DASHBOARDS.find((x) => x.id === id);
    if (!d) throw new ApiFailure("not_found", "This dashboard no longer exists.", 404);
    return d;
  });

/** The tile endpoint existed with no client behind it, so a tile added to a
 * dashboard lived only in React state and vanished on reload. */
export const addDashboardTile = (
  dashboardId: string,
  body: { answer_id: string; x?: number; y?: number; w?: number; h?: number },
) =>
  call<DashboardTile>(`/dashboards/${dashboardId}/tiles`, () => ({
    answer_id: body.answer_id,
    position: 0,
    size: "3x2" as const,
  }), { method: "POST", body: JSON.stringify(body) });

export const deleteDashboardTile = (dashboardId: string, tileId: string) =>
  call<void>(`/dashboards/${dashboardId}/tiles/${tileId}`, () => undefined, {
    method: "DELETE",
  });

/** Repoint a tile at a different answer — the "replace what this shows" action. */
export const replaceDashboardTile = (
  dashboardId: string,
  tileId: string,
  answerId: string,
) =>
  call<void>(`/dashboards/${dashboardId}/tiles/${tileId}`, () => undefined, {
    method: "PATCH",
    body: JSON.stringify({ answer_id: answerId }),
  });

export const refreshDashboard = (id: string) =>
  call<{ refreshed: number }>(
    `/dashboards/${id}/refresh`,
    () => ({ refreshed: DASHBOARDS.find((d) => d.id === id)?.tiles.length ?? 0 }),
    { method: "POST" },
  );

/* ---------------------------------------------------------------------------
   §10 Notebooks
--------------------------------------------------------------------------- */

export const getNotebooks = () =>
  call<NotebookSummary[]>("/notebooks", () => NOTEBOOK_SUMMARIES);

export const getNotebook = (id: string) =>
  call<Notebook>(`/notebooks/${id}`, () => {
    const n = NOTEBOOKS.find((x) => x.id === id);
    if (!n) throw new ApiFailure("not_found", "This notebook no longer exists.", 404);
    return n;
  });

/* Mutations. A notebook that cannot be written is a scratchpad, not a
   notebook — every structural change below has a server call behind it. */

export const createNotebook = (name: string, sourceId?: string) =>
  call<Notebook>("/notebooks", () => NOTEBOOKS[0], {
    method: "POST",
    body: JSON.stringify({ name, source_id: sourceId }),
  });

export const renameNotebook = (id: string, name: string) =>
  call<Notebook>(`/notebooks/${id}`, () => ({ ...NOTEBOOKS[0], name }), {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const deleteNotebook = (id: string) =>
  call<void>(`/notebooks/${id}`, () => undefined, { method: "DELETE" });

export const addNotebookCell = (
  notebookId: string,
  body: { kind: CellKind; source: string; after_cell_id?: string },
) =>
  call<NotebookCell>(`/notebooks/${notebookId}/cells`, () => ({
    id: `draft_${Math.random().toString(36).slice(2)}`,
    kind: body.kind,
    source: body.source,
    output: null,
    confidence: null,
    state: "idle" as const,
  }), { method: "POST", body: JSON.stringify(body) });

/** Patching source or kind clears the stored output server-side: a cell whose
 * source changed is no longer described by its old result. */
export const updateNotebookCell = (
  notebookId: string,
  cellId: string,
  body: {
    source?: string;
    kind?: CellKind;
    output?: NotebookCell["output"];
    confidence?: ReportConfidence | null;
  },
) =>
  call<NotebookCell>(`/notebooks/${notebookId}/cells/${cellId}`, () => ({
    id: cellId,
    kind: body.kind ?? "question",
    source: body.source ?? "",
    output: body.output ?? null,
    confidence: body.confidence ?? null,
    state: "idle" as const,
  }), { method: "PATCH", body: JSON.stringify(body) });

export const deleteNotebookCell = (notebookId: string, cellId: string) =>
  call<void>(`/notebooks/${notebookId}/cells/${cellId}`, () => undefined, {
    method: "DELETE",
  });

export const reorderNotebookCells = (notebookId: string, cellIds: string[]) =>
  call<void>(`/notebooks/${notebookId}/cells/order`, () => undefined, {
    method: "PUT",
    body: JSON.stringify({ cell_ids: cellIds }),
  });

/** Runs server-side. SQL executes against the source; Python executes in the
 * runner. A script that throws returns 200 with `error` — a broken cell is a
 * normal outcome of running a notebook, not a transport failure. */
export const runNotebookCell = (notebookId: string, cellId: string) =>
  call<CellRunResult>(
    `/notebooks/${notebookId}/cells/${cellId}/run`,
    () => ({ output: null, confidence: "unverified" as const }),
    { method: "POST" },
  );

/* ---------------------------------------------------------------------------
   §11 Watches
--------------------------------------------------------------------------- */

/* The backend serves a watch's identity (definition name, status, firing);
   display conveniences the mock carried are derived here, once. */
function adaptWatch(w: Watch & { definition_name?: string; schedule?: string }): Watch {
  return {
    ...w,
    name: w.name || w.definition_name || w.definition_id,
    definition_name: w.definition_name ?? w.name,
    grain:
      w.grain ||
      ({ daily: "day", hourly: "hour", weekly: "week", monthly: "month" }[
        w.schedule ?? ""
      ] ??
        w.schedule) ||
      "period",
    recipients: w.recipients ?? [],
    last_fired_at: w.last_fired_at ?? null,
    unit: w.unit ?? "",
    format_hint: w.format_hint ?? "number",
  };
}

/** A watch alerts on a ratified DEFINITION, not on a loose figure — that is
 * why the caller must supply one, and why surfaces gate on having it. */
export const createWatch = (body: {
  definition_id: string;
  schedule: string;
  condition: WatchCondition;
}) =>
  call<Watch>("/watches", () => ({ ...WATCHES[0], ...body }) as Watch, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getWatches = () =>
  call<Watch[]>("/watches", () => WATCHES).then((ws) => ws.map(adaptWatch));

export const getWatch = (id: string) =>
  call<Watch>(`/watches/${id}`, () => {
    const w = WATCHES.find((x) => x.id === id);
    if (!w) throw new ApiFailure("not_found", "This watch no longer exists.", 404);
    return w;
  });

/**
 * Adjust a watch's threshold, schedule, or snooze.
 *
 * Fields are optional and only what you send is written, so snoozing cannot
 * clobber a threshold somebody tuned. Pass `snoozed_until: ""` to wake a
 * snoozed watch — "" is the wake instruction, not a missing value.
 */
export const updateWatch = (
  id: string,
  body: {
    condition?: WatchCondition;
    schedule?: string;
    snoozed_until?: string;
  },
) =>
  call<Watch>(`/watches/${id}`, () => ({ ...WATCHES[0], id }) as Watch, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then(adaptWatch);

export const getWatchEvents = (id: string) =>
  call<WatchEvent[]>(`/watches/${id}/events`, () => WATCH_EVENTS[id] ?? []);

/* ---------------------------------------------------------------------------
   §12 Sources and admin
--------------------------------------------------------------------------- */

export const getSources = () => call<Source[]>("/sources", () => SOURCES);

/**
 * Which connectors this build registers.
 *
 * The connect UI offers exactly these. It used to offer a hardcoded four while
 * the binary registered one, so three of them produced a source that failed on
 * first use.
 */
export const getSourceKinds = () =>
  call<SourceKind[]>("/sources/kinds", () => ["duckdb"]);

/**
 * Registers a source. The returned source is `pending`: it exists, and nothing
 * has yet proved it can be opened. Introspection is what proves that, and what
 * moves it to `connected`.
 */
export const createSource = (body: { name: string; kind: SourceKind; dsn: string }) =>
  call<Source>("/sources", () => ({
    id: `src_${body.name}`,
    name: body.name,
    kind: body.kind,
    status: "pending" as const,
    table_count: 0,
    last_introspected_at: null,
  }), { method: "POST", body: JSON.stringify(body) });

/**
 * Opens the connection and reads the schema.
 *
 * This is the only honest connection test the product has: it connects, lists
 * tables, and profiles columns. A failure here is a real failure — a wrong
 * path, a refused login, an unreadable file — and its message is the engine's
 * own, not a guess about what might be wrong.
 */
export const introspectSource = (id: string) =>
  call<Catalog>(`/sources/${id}/introspect`, () => {
    const c = CATALOGS[id];
    if (!c) throw new ApiFailure("introspect_failed", "No catalog for this source.", 500);
    return c;
  }, { method: "POST" });

/**
 * Removes a source. Answers computed against it are deliberately kept: an
 * answer records the source it came from, and deleting a connection does not
 * un-compute the answer or make its provenance untrue.
 */
export const deleteSource = (id: string) =>
  call<void>(`/sources/${id}`, () => undefined, { method: "DELETE" });

export const getCatalog = (sourceId: string) =>
  call<Catalog>(`/sources/${sourceId}/schema`, () => {
    const c = CATALOGS[sourceId];
    if (!c)
      throw new ApiFailure("not_found", "This source has not been introspected.", 404);
    return c;
  }).then((cat) => ({
    ...cat,
    // A catalog cached before enrichment existed has holes where the browser
    // expects arrays; render empty rather than crash until re-introspection.
    tables: (cat.tables ?? []).map((t) => ({
      ...t,
      relationships: t.relationships ?? [],
      sample_rows: t.sample_rows ?? [],
      columns: (t.columns ?? []).map((c) => ({
        ...c,
        role: c.role ?? "dimension",
        null_rate: c.null_rate ?? 0,
      })),
    })),
  }));

export const getUsers = () => call<User[]>("/users", () => USERS);

export const getSettings = () => call<Settings>("/settings", () => SETTINGS);

export const getAudit = () => call<AuditEntry[]>("/audit", () => AUDIT);

export const getUsage = () => call<UsageStats>("/usage", () => USAGE);

/* ---------------------------------------------------------------------------
   §13 Share
--------------------------------------------------------------------------- */

export const shareToSlack = (answerId: string, channel: string) =>
  call<SlackRender>(
    "/share/slack",
    () => ({ channel, blocks: [], posted: false }),
    { method: "POST", body: JSON.stringify({ answer_id: answerId, channel }) },
  );

/** Exposed for the demo so the ask surface can pre-resolve a scenario. */
export { scenarioFor };

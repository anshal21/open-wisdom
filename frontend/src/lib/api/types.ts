/**
 * Wire types. Mirrors docs/api-contract.md v1 exactly.
 *
 * Rule from the contract: "neither side may invent a field that is not here."
 * Anything the UI needs that the wire does not carry lives in `view-models.ts`
 * as a client-side derivation, never as a smuggled wire field.
 */

// ---------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiErrorEnvelope {
  error: ApiError;
}

/** RFC3339 UTC. */
export type Timestamp = string;

// ---------------------------------------------------------------------------
// §4 Verification
// ---------------------------------------------------------------------------

/** Fixed set — contract §4. */
export const CHECK_IDS = [
  "cross_derivation",
  "join_loss",
  "fan_out",
  "period_normalization",
  "filter_sensitivity",
  "definition_source",
  "grain",
  "coverage",
  "freshness",
  "precedent",
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

/**
 * Contract §4 fixes the wire values to pass|warn|fail|skipped.
 * design-system.md §3.4 additionally names `not_applicable`; it renders
 * identically to `skipped` (greyed, with a reason) so it is accepted here
 * without the renderer needing a second code path.
 */
export type CheckStatus = "pass" | "warn" | "fail" | "skipped" | "not_applicable";

export interface Check {
  id: CheckId;
  label: string;
  status: CheckStatus;
  finding: string;
  /** Tier-3 expansion payload. Shape is check-specific and opaque. */
  detail?: CheckDetail;
  skip_reason?: string;
}

export interface CheckDetail {
  /** Free-form; the renderer reads only the keys it understands. */
  sql?: string;
  sql_path_a?: string;
  sql_path_b?: string;
  value_path_a?: number;
  value_path_b?: number;
  rows_in?: number;
  rows_out?: number;
  why?: string;
  [k: string]: unknown;
}

/** Terminal states the server can assert. */
export type ReportConfidence =
  | "verified"
  | "qualified"
  | "unverified"
  | "contested"
  | "refused";

export interface Report {
  confidence: ReportConfidence;
  checks: Check[];
  /** Skipped checks never count toward passed/total. */
  passed: number;
  total: number;
  headline: string;
}

// ---------------------------------------------------------------------------
// §1 / §3 Ask, threads, context
// ---------------------------------------------------------------------------

export type FilterOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "in" | "not in";

export interface ContextFilter {
  column: string;
  operator: FilterOperator;
  value: string | number | Array<string | number>;
}

export interface TimeRange {
  /** ISO date, inclusive. */
  from: string;
  /** ISO date, inclusive. */
  to: string;
}

export interface Context {
  time_range?: TimeRange;
  filters?: ContextFilter[];
  grain?: string;
  definition_id?: string;
}

export interface AskRequest {
  question: string;
  thread_id?: string;
  context?: Context;
  source_id?: string;
}

export interface ResolveRequest {
  thread_id: string;
  candidate_id: string;
  ratify: boolean;
  definition_name?: string;
  plain_english?: string;
}

export type StageName =
  | "interpret"
  | "resolve"
  | "plan"
  | "query"
  | "verify"
  | "compose";

export const STAGES: StageName[] = [
  "interpret",
  "resolve",
  "plan",
  "query",
  "verify",
  "compose",
];

export interface StageEvent {
  stage: StageName;
  state: "start" | "done";
  /** Optional one-line detail rendered under the active stage. */
  detail?: string;
}

export interface InterpretationEvent {
  restated: string;
  assumptions: string[];
  definition_used: { id: string; name: string } | null;
}

export type ColumnType = "temporal" | "quantitative" | "nominal" | "ordinal";

export interface ResultColumn {
  name: string;
  label?: string;
  type: ColumnType;
}

export type Cell = string | number | boolean | null;

export interface ResultEvent {
  answer_id: string;
  value: number | null;
  unit: string;
  format_hint: FormatHint;
  columns: ResultColumn[];
  rows: Cell[][];
  row_count: number;
  /** Rows scanned before aggregation, when the server knows it. */
  scanned_rows?: number;
}

export type FormatHint = "currency" | "number" | "percent" | "count" | "duration";

export interface NarrativeEvent {
  markdown: string;
}

export interface CostEvent {
  llm_calls: number;
  usd: number;
  elapsed_ms: number;
}

// ---------------------------------------------------------------------------
// §2 Ambiguity / refusal
// ---------------------------------------------------------------------------

export interface AmbiguityCandidate {
  id: string;
  label: string;
  description: string;
  value: number;
  sql: string;
  recommended: boolean;
  /** Non-empty ONLY when a real basis exists. Drives the RECOMMENDED eyebrow. */
  recommendation_basis: string;
  /** Row coverage for the candidate's reading, when known. */
  rows_included?: number;
  rows_total?: number;
}

export interface Spread {
  ratio: number;
  min: number;
  max: number;
  log_scaled: boolean;
}

export interface AmbiguityPayload {
  question: string;
  /** The contested word, chosen server-side — use over any client heuristic. */
  term?: string;
  reason: string;
  candidates: AmbiguityCandidate[];
  spread: Spread;
  /**
   * CONTRACT GAP (additive, optional).
   *
   * A refusal is terminal — no `result` event follows — so the candidate
   * figures have no other source of unit/format. Without these the fork
   * renders `3,820,425` where the design spec requires `$3,820,425`, and the
   * client cannot infer it without hardcoding an assumption about the
   * warehouse. Both are optional and absent degrades to a plain number.
   */
  unit?: string;
  format_hint?: FormatHint;
}

// ---------------------------------------------------------------------------
// §5 Charts
// ---------------------------------------------------------------------------

export type ChartType = "line" | "bar" | "area" | "pie" | "table" | "scalar" | "scatter";

export interface ChartField {
  field: string;
  label: string;
  type: ColumnType;
}

export interface ChartCoverage {
  included_rows: number;
  excluded_rows: number;
  reason: string;
}

export interface ChartSpec {
  type: ChartType;
  /** Absent for scalar and table specs — there is no x axis to plot. */
  x?: ChartField;
  y: ChartField[];
  /** The split dimension, a full field like x — was mistyped as string. */
  series: ChartField | null;
  coverage: ChartCoverage;
  confidence: ReportConfidence;
}

// ---------------------------------------------------------------------------
// SSE envelope
// ---------------------------------------------------------------------------

export type AskEvent =
  | { event: "thread"; data: { thread_id: string; turn_id: string } }
  | { event: "stage"; data: StageEvent }
  | { event: "interpretation"; data: InterpretationEvent }
  | { event: "ambiguity"; data: AmbiguityPayload }
  | { event: "result"; data: ResultEvent }
  | { event: "check"; data: Check }
  | { event: "verdict"; data: Report }
  | { event: "narrative"; data: NarrativeEvent }
  | { event: "chart"; data: ChartSpec }
  | { event: "cost"; data: CostEvent }
  | { event: "error"; data: ApiError };

export type AskEventName = AskEvent["event"];

// ---------------------------------------------------------------------------
// §6 Answers / ledger
// ---------------------------------------------------------------------------

export interface AnswerSummary {
  id: string;
  question: string;
  value: number | null;
  unit: string;
  format_hint: FormatHint;
  confidence: ReportConfidence;
  /** Rows in the result — lets the ledger say "26 groups" instead of "—". */
  row_count?: number;
  passed: number;
  total: number;
  created_by: string;
  created_at: Timestamp;
  definition_used?: { id: string; name: string; version: number };
  /** Semantic-dedupe key: same metric + filters + grain + range. */
  fingerprint?: string;
  /** Number of runs collapsed into this row by semantic dedupe. */
  run_count?: number;
  /** True when two runs of an equivalent question produced different numbers. */
  diverged?: boolean;
  /** Set when a definition the answer used has changed since it was recorded. */
  superseded?: boolean;
}

export interface AnswerRun {
  id: string;
  run: number;
  value: number | null;
  confidence: ReportConfidence;
  created_at: Timestamp;
  current: boolean;
}

export interface Answer {
  id: string;
  thread_id?: string;
  question: string;
  restated?: string;
  value: number | null;
  unit: string;
  format_hint: FormatHint;
  columns: ResultColumn[];
  rows: Cell[][];
  row_count: number;
  scanned_rows?: number;
  sql: string;
  sql_path_b?: string;
  /** null when the answer was refused — a refusal carries no verification
   * report, and every consumer must branch on that, not assume one. */
  report: Report | null;
  chart: ChartSpec | null;
  narrative: string;
  /** Not stored by the backend today; chips derive from the interpretation. */
  context?: Context;
  definition_used?: { id: string; name: string; version: number };
  created_by: string;
  created_at: Timestamp;
  source_id: string;
  /** null when no execution happened (refused before running). */
  cost: CostEvent | null;
  runs?: AnswerRun[];
  /** Present when a definition this answer used has since changed. */
  supersession?: {
    definition_id: string;
    definition_name: string;
    from_version: number;
    to_version: number;
    changed_at: Timestamp;
  };
  ambiguity?: AmbiguityPayload;
  /** Human corrections, populated on single-answer reads. */
  flags?: AnswerFlag[];
}

/** A human's "this is wrong" on a specific answer. Flags are never deleted:
 * a correction is part of the answer's history, and an answer that was once
 * contested by a human should say so forever. */
export interface AnswerFlag {
  id: string;
  answer_id: string;
  reason: string;
  created_by?: string;
  created_at: Timestamp;
}

export interface RerunDiff {
  previous: number | null;
  current: number | null;
  delta_pct: number | null;
  checks_changed: string[];
}

export interface RerunResponse {
  answer_id: string;
  diff: RerunDiff;
}

export interface AnswerQuery {
  query?: string;
  confidence?: ReportConfidence;
  from?: string;
  to?: string;
  definition_id?: string;
  created_by?: string;
}

// ---------------------------------------------------------------------------
// §7 Definitions
// ---------------------------------------------------------------------------

export type DefinitionStatus = "ratified" | "proposed" | "superseded";

export interface Definition {
  id: string;
  name: string;
  plain_english: string;
  expression: string;
  version: number;
  status: DefinitionStatus;
  ratified_by: string;
  ratified_at: Timestamp | null;
  source_answer_id: string;
  usage_count: number;
  /** Standing of the definition itself, rendered with an inline seal. */
  confidence: ReportConfidence;
  /** True when the definition was born from a resolved ambiguity fork. */
  earned?: boolean;
  precedence?: "official" | "preferred";
  scope?: "workspace" | "personal";
  updated_at: Timestamp;
  versions?: DefinitionVersion[];
  conflicts?: Array<{ id: string; name: string; reason: string }>;
}

export interface DefinitionVersion {
  version: number;
  expression: string;
  plain_english: string;
  ratified_by: string;
  ratified_at: Timestamp;
  summary: string;
}

/** A proposal produced by an ambiguity the checks caught. */
export interface DefinitionProposal {
  id: string;
  term: string;
  proposed_at: Timestamp;
  asked_count: number;
  answered_ways: number;
  evidence: string;
  readings: Array<{
    id: string;
    label: string;
    expression: string;
    value: number;
    unit: string;
    format_hint: FormatHint;
    period_label: string;
    used_count: number;
  }>;
  spread_label: string;
}

export interface DefinitionImpact {
  affected_answers: number;
  sample: AnswerSummary[];
  would_change: boolean;
}

export interface DefinitionCoverage {
  period: string;
  answered_from_ratified: number;
  total: number;
  pct: number;
  /** 12 weekly points for the header sparkline. */
  history: Array<{ period: string; pct: number }>;
  ratified: number;
  proposed: number;
  contested: number;
  clarification_rate_pct: number;
  clarification_target_pct: number;
  previous_pct: number;
}

export interface RatifyRequest {
  name: string;
  plain_english: string;
  expression: string;
  source_answer_id?: string;
  scope?: "workspace" | "personal";
  precedence?: "official" | "preferred";
  rerun_affected?: boolean;
}

// ---------------------------------------------------------------------------
// §8 Investigations
// ---------------------------------------------------------------------------

export type RuleoutKind = "data_quality" | "instrumentation" | "period" | "mix";
export type RuleoutStatus = "cleared" | "implicated" | "not_run";

export interface RuleoutEvent {
  kind: RuleoutKind;
  /** Phase this rule-out belongs to: 1 measurement, 2 data quality, 3 drivers. */
  phase: 1 | 2 | 3;
  id: string;
  label: string;
  status: RuleoutStatus;
  finding: string;
}

export interface DriverEvent {
  segment: string;
  /** Signed fraction of the total change. */
  contribution: number;
  kind: "mix" | "rate";
  rate_delta?: number;
  mix_delta?: number;
  /** Last 12 periods for the row sparkline. */
  history?: number[];
  normal_range?: [number, number];
}

export interface WaterfallEvent {
  bars: Array<{ label: string; value: number }>;
  unexplained: number;
}

export interface Investigation {
  id: string;
  question: string;
  metric: string;
  definition_id: string;
  period: string;
  comparison_period: string;
  ruleouts: RuleoutEvent[];
  drivers: DriverEvent[];
  waterfall: WaterfallEvent | null;
  narrative: string;
  verdict: {
    kind: "artifact" | "driver_found" | "no_driver" | "data_incident";
    headline: string;
    detail: string;
    figures: Array<{ label: string; value: string; comparison: string }>;
  };
  /** Non-null when the ladder stopped before phase 3. */
  stopped_at: 1 | 2 | 3 | null;
  report: Report;
  created_at: Timestamp;
  created_by: string;
}

export interface InvestigationSummary {
  id: string;
  question: string;
  metric: string;
  verdict_kind: Investigation["verdict"]["kind"];
  stopped_at: 1 | 2 | 3 | null;
  created_at: Timestamp;
  created_by: string;
}

// ---------------------------------------------------------------------------
// §9 Dashboards
// ---------------------------------------------------------------------------

export type TileSize = "1x1" | "2x1" | "2x2" | "3x2" | "4x2" | "6x2" | "12x2";

export interface DashboardTile {
  /** Present on the wire; older mock fixtures may omit it. */
  id?: string;
  answer_id: string;
  position: number;
  size: TileSize;
  /** Canvas geometry in 12-column grid units. -1 x/y = legacy, not yet placed. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Persisted chart override for this tile. */
  viz?: import("@/lib/viz/resolve").VizOverride;
}

export interface Dashboard {
  id: string;
  name: string;
  tiles: DashboardTile[];
  last_refreshed_at: Timestamp | null;
}

export interface DashboardSummary {
  id: string;
  name: string;
  tile_count: number;
  last_refreshed_at: Timestamp | null;
}

// ---------------------------------------------------------------------------
// §10 Notebooks
// ---------------------------------------------------------------------------

export type CellKind = "sql" | "python" | "markdown" | "question";
export type CellRunState = "idle" | "queued" | "running" | "done" | "error" | "stale";

export interface NotebookCell {
  id: string;
  kind: CellKind;
  source: string;
  /** Shape depends on kind: a table for sql, {stdout,...} for python, the
   * source for markdown, and `{answer_id}` — a REFERENCE, never a copy — for
   * question. The figure itself always comes from the answer ledger. */
  output: CellOutput | PythonOutput | QuestionOutput | string | null;
  confidence: ReportConfidence | null;
  /** Server-assigned ordering. The client never invents one. */
  seq?: number;
  updated_at?: Timestamp;
  /* --- client-side run state; not persisted ---------------------------- */
  report?: Report;
  state: CellRunState;
  elapsed_ms?: number;
  error?: string;
}

/** A question cell stores only the reference. One source of truth per datum:
 * re-running or superseding the answer is reflected everywhere at once. */
export interface QuestionOutput {
  answer_id: string;
}

export interface PythonOutput {
  stdout: string;
  stderr?: string;
  columns?: ResultColumn[];
  rows?: Cell[][];
  row_count?: number;
}

export interface CellOutput {
  columns: ResultColumn[];
  rows: Cell[][];
  row_count: number;
  value?: number | null;
  unit?: string;
  format_hint?: FormatHint;
  chart?: ChartSpec | null;
}

export interface Notebook {
  id: string;
  name: string;
  source_id?: string;
  cells: NotebookCell[];
  created_at?: Timestamp;
  updated_at: Timestamp;
}

export interface NotebookSummary {
  id: string;
  name: string;
  cell_count: number;
  created_at?: Timestamp;
  updated_at: Timestamp;
}

export interface CellRunResult {
  output: NotebookCell["output"];
  confidence: ReportConfidence | null;
  elapsed_ms?: number;
  /** A script that threw is a normal notebook outcome, not a transport error. */
  error?: string;
}

// ---------------------------------------------------------------------------
// §11 Monitoring
// ---------------------------------------------------------------------------

/** `snoozed` outranks `firing`: a watch deliberately silenced is not firing
 * now, even if it fired before the snooze was set. */
export type WatchStatus = "watching" | "firing" | "resolved" | "paused" | "snoozed";

export interface WatchCondition {
  kind: "change_pct" | "threshold" | "outside_normal_range";
  value: number;
  direction?: "above" | "below" | "either";
}

export interface Watch {
  id: string;
  name: string;
  definition_id: string;
  definition_name: string;
  schedule: string;
  /** Absent on watches created through the API — only seeded fixtures carry
   * one. Optional here so every reader must decide what to do without it;
   * typing it as required is how "per undefined" reached the header. */
  grain?: string;
  condition: WatchCondition;
  status: WatchStatus;
  /** RFC3339 instant the snooze lifts; absent when the watch is live. */
  snoozed_until?: Timestamp;
  last_fired_at: Timestamp | null;
  recipients: string[];
  unit: string;
  format_hint: FormatHint;
  /** The pre-alert check block. Same apparatus as answer verification. */
  pre_alert_checks?: Check[];
  held_reason?: string;
  held_hours?: number;
  current_value?: number;
  normal_range?: [number, number];
  /** 90 points for the watch band. */
  history?: Array<{ t: string; value: number; incomplete?: boolean }>;
  backtest_fire_count?: number;
}

export interface WatchEvent {
  id: string;
  fired_at: Timestamp;
  value: number;
  previous: number;
  investigation_id: string | null;
}

// ---------------------------------------------------------------------------
// §12 Sources and admin
// ---------------------------------------------------------------------------

/**
 * Which engines exist is a property of the BUILD, not of this file: connectors
 * self-register in Go, and `GET /sources/kinds` reports what is actually
 * registered. A closed union here would go stale the moment somebody
 * contributes a connector — which is the whole point of the registry — so it
 * stays open, and the connect UI asks the server what it can offer.
 */
export type SourceKind = string;

/**
 * Every status the server can store, including the two the UI used to omit.
 *
 * `pending` is what `POST /sources` returns: a source exists but has never been
 * introspected. `error` is set when a connection attempt fails. Leaving them
 * out did not make them not happen — it made `status === "connected"` silently
 * false for a source that was merely still connecting, which is how the ask
 * page ended up telling people to connect a warehouse they had just connected.
 */
export type SourceStatus =
  | "pending"
  | "connected"
  | "degraded"
  | "disconnected"
  | "error";

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  status: SourceStatus;
  table_count: number;
  last_introspected_at: Timestamp | null;
  host?: string;
  database?: string;
  last_query_at?: Timestamp | null;
}

export type ColumnRole = "measure" | "dimension" | "date" | "key" | "pii";

export interface CatalogColumn {
  name: string;
  type: string;
  role: ColumnRole;
  null_rate: number;
  distinct_count: number;
}

export interface CatalogRelationship {
  from_column: string;
  to_table: string;
  to_column: string;
  cardinality: "1:1" | "1:N" | "N:1" | "N:N";
}

export interface CatalogTable {
  name: string;
  row_count: number;
  columns: CatalogColumn[];
  relationships: CatalogRelationship[];
  sample_rows: Cell[][];
}

export interface Catalog {
  source_id: string;
  tables: CatalogTable[];
  introspected_at: Timestamp;
}

export type UserRole = "admin" | "analyst" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** Ratification is a permission — that is what makes definitions meaningful. */
  can_ratify: boolean;
  last_active_at: Timestamp;
  answers_asked: number;
  initials: string;
}

export interface CheckPolicy {
  id: CheckId;
  label: string;
  description: string;
  mode: "required" | "advisory" | "off";
  threshold: number | null;
  threshold_unit: string | null;
  backtest: string;
}

export interface Settings {
  workspace_name: string;
  default_source_id: string;
  timezone: string;
  theme_default: "light" | "dark" | "system";
  model_provider: string;
  model: string;
  model_speed: "fast" | "balanced" | "thorough";
  verification_strictness: "lenient" | "standard" | "strict";
  cost_ceiling_usd: number;
  check_policy: CheckPolicy[];
  pii_masked: boolean;
}

export interface AuditEntry {
  id: string;
  principal: string;
  source_id: string;
  source_name: string;
  at: Timestamp;
  row_count: number;
  elapsed_ms: number;
  answer_id: string | null;
  statement: string;
}

export interface UsageStats {
  questions_asked: number;
  answers_verified: number;
  fork_rate_pct: number;
  coverage_pct: number;
  per_person: Array<{
    user_id: string;
    name: string;
    initials: string;
    questions: number;
    ratified: number;
  }>;
  history: Array<{ period: string; questions: number; coverage_pct: number }>;
}

// ---------------------------------------------------------------------------
// §13 Share
// ---------------------------------------------------------------------------

export type SlackBlock =
  | { type: "section"; text: string }
  | { type: "context"; text: string }
  | { type: "image"; alt: string; answer_id: string }
  | { type: "actions"; buttons: Array<{ label: string; style?: "primary" }> }
  | { type: "divider" };

export interface SlackRender {
  channel: string;
  blocks: SlackBlock[];
  /** Demo mode returns the payload without posting. */
  posted: boolean;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export interface ThreadSummary {
  id: string;
  title: string;
  updated_at: Timestamp;
  answer_count: number;
}

export interface ThreadTurn {
  question: string;
  answer_id: string;
  created_at: Timestamp;
}

export interface Thread {
  id: string;
  title: string;
  turns: ThreadTurn[];
  context: Context;
}

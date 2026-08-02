import type {
  AmbiguityPayload,
  Answer,
  CellKind,
  CellOutput,
  NotebookCell,
  PythonOutput,
  QuestionOutput,
  Report,
} from "@/lib/api/types";
import { sortChecks, type ConfidenceState } from "@/lib/confidence";
import type { EvidenceSubject } from "@/state/evidence";

/**
 * Client-side view model for a notebook cell. screens.md §7.
 *
 * The wire type carries what a cell *is*; two things the UI needs are pure
 * client-side derivations and live here rather than being smuggled onto the
 * wire: an in-cell refusal payload, and whether the source has been edited
 * since the last run.
 */
export interface CellView extends NotebookCell {
  ambiguity?: AmbiguityPayload;
  /** True when the editor has changed since this cell last ran. */
  dirty?: boolean;
  /**
   * For a question cell: the answer this cell REFERENCES, hydrated from the
   * ledger. The cell persists only `{answer_id}` — so a re-run or a
   * supersession of that answer is reflected here without the notebook
   * holding a stale copy of the figure.
   */
  answer?: Answer | null;
  /** True while that hydration is in flight. */
  hydrating?: boolean;
}

/* ---------------------------------------------------------------------------
   Output discriminators.

   `output` is a union across four cell kinds, so nothing reads it directly:
   these three functions are the only places that know its shape.
--------------------------------------------------------------------------- */

/** The reference a question cell stores, if it has run. */
export function answerIdOf(cell: CellView): string | null {
  if (cell.kind !== "question") return null;
  const o = cell.output as QuestionOutput | null;
  return o && typeof o === "object" && "answer_id" in o ? o.answer_id : null;
}

/** Whatever this cell has that renders as a table — from the answer for a
 * question cell, from the output itself for sql and python. */
export function resultOf(cell: CellView): CellOutput | null {
  if (cell.kind === "question") {
    const a = cell.answer;
    if (!a) return null;
    return {
      columns: a.columns,
      rows: a.rows,
      row_count: a.row_count,
      value: a.value,
      unit: a.unit,
      format_hint: a.format_hint,
      chart: a.chart,
    };
  }
  const o = cell.output;
  if (!o || typeof o === "string") return null;
  if ("columns" in o && o.columns) {
    return {
      columns: o.columns,
      rows: (o as CellOutput).rows ?? [],
      row_count: (o as CellOutput).row_count ?? 0,
      format_hint: (o as CellOutput).format_hint,
      unit: (o as CellOutput).unit,
      chart: (o as CellOutput).chart ?? null,
    };
  }
  return null;
}

/** Console output — python only. */
export function stdoutOf(cell: CellView): { stdout: string; stderr?: string } | null {
  if (cell.kind !== "python") return null;
  const o = cell.output as PythonOutput | null;
  if (!o || typeof o !== "object" || !("stdout" in o)) return null;
  return { stdout: o.stdout, stderr: o.stderr };
}

export const CELL_KINDS: CellKind[] = ["question", "sql", "python", "markdown"];

export const KIND_LABEL: Record<CellKind, string> = {
  question: "Question",
  sql: "SQL",
  python: "Python",
  markdown: "Markdown",
};

export const KIND_PLACEHOLDER: Record<CellKind, string> = {
  question: "Ask a question in plain English. The answer arrives with its checks.",
  sql: "-- SQL runs against the source. There is no second derivation path for hand-written SQL.",
  python: "# Python runs against the previous cell's result frame.",
  markdown: "Prose. No figure, no seal.",
};

export function nextKind(kind: CellKind): CellKind {
  return CELL_KINDS[(CELL_KINDS.indexOf(kind) + 1) % CELL_KINDS.length];
}

let seq = 0;
export function newCell(kind: CellKind = "question"): CellView {
  seq += 1;
  return {
    // "draft_" is load-bearing: it is how the writer tells a cell that
    // exists only on screen from one the server has accepted. Server ids are
    // `cell_…`, so a draft must NOT share that prefix.
    id: `draft_${Date.now().toString(36)}_${seq}`,
    kind,
    source: "",
    output: null,
    confidence: null,
    state: "idle",
  };
}

/* ---------------------------------------------------------------------------
   Seals — every cell that produces a figure carries one. §3.6
--------------------------------------------------------------------------- */

/** Markdown produces no figure and therefore wears no seal. §7.2 */
export function cellSealState(cell: CellView): ConfidenceState | null {
  if (cell.kind === "markdown") return null;
  if (cell.state === "running" || cell.state === "queued") return "checking";
  if (cell.ambiguity) return "refused";
  if (!cell.confidence) return null;
  return cell.confidence;
}

/** The finding is the honest part, and it is never buried. §7.2 */
export const PYTHON_FINDING = "Python output can't be independently re-derived.";

export const SQL_SKIP_REASON =
  "Hand-written SQL has no second derivation path to check it against.";

export function pythonReport(): Report {
  return {
    confidence: "unverified",
    checks: [
      {
        id: "cross_derivation",
        label: "Computed a second way",
        status: "skipped",
        finding: PYTHON_FINDING,
        skip_reason: PYTHON_FINDING,
      },
    ],
    passed: 0,
    total: 0,
    headline: PYTHON_FINDING,
  };
}

export function sqlReport(): Report {
  return {
    confidence: "unverified",
    checks: [
      {
        id: "cross_derivation",
        label: "Computed a second way",
        status: "skipped",
        finding: "",
        skip_reason: SQL_SKIP_REASON,
      },
    ],
    passed: 0,
    total: 0,
    headline:
      "This SQL was hand-written, so nothing here could be re-derived a second way.",
  };
}

/* ---------------------------------------------------------------------------
   Promotion gating — §7.4
--------------------------------------------------------------------------- */

/** Only a verified or qualified cell may become a dashboard tile. §7.4 */
export function canPromoteToTile(cell: CellView): boolean {
  const state = cellSealState(cell);
  return state === "verified" || state === "qualified";
}

export function tileBlockReason(cell: CellView): string {
  const state = cellSealState(cell);
  if (cell.kind === "markdown") return "A markdown cell produces no figure to place.";
  if (state === "refused")
    return "This cell has more than one defensible reading. Choose one first.";
  if (state === "checking") return "Wait for the checks to finish.";
  if (state === "unverified")
    return "Only verified or qualified cells can be placed on a dashboard — this one could not be independently re-derived.";
  if (state === "contested")
    return "Two derivations of this cell disagree. Resolve the conflict first.";
  return "Run this cell first.";
}

/* ---------------------------------------------------------------------------
   Evidence — the panel shows the focused cell's checks. §7.1
--------------------------------------------------------------------------- */

export function cellEvidence(cell: CellView, index: number): EvidenceSubject | null {
  const state = cellSealState(cell);
  if (!state) return null;
  const report = cell.report;
  const result = resultOf(cell);
  const coverage = result?.chart?.coverage;
  return {
    id: cell.id,
    label: `Cell ⌗${index + 1}`,
    title: cell.kind === "question" ? cell.source : `${KIND_LABEL[cell.kind]} cell`,
    state,
    headline: cell.ambiguity?.reason ?? report?.headline,
    checks: report ? sortChecks(report.checks) : [],
    passed: report?.passed ?? 0,
    total: report?.total ?? 0,
    coverage: coverage
      ? {
          included: coverage.included_rows,
          total: coverage.included_rows + coverage.excluded_rows,
          reason: coverage.reason || undefined,
        }
      : undefined,
    derivation:
      cell.kind === "sql" && cell.source.trim()
        ? {
            paths: [{ label: "SQL", sql: cell.source }],
            rowCount: result?.row_count,
            elapsedMs: cell.elapsed_ms,
          }
        : undefined,
  };
}

/* ---------------------------------------------------------------------------
   Stack mutation
--------------------------------------------------------------------------- */

/** A cell that ran makes every completed cell after it stale. §7.3 */
export function markDownstreamStale(cells: CellView[], from: number): CellView[] {
  return cells.map((c, i) =>
    i > from && c.state === "done" && c.kind !== "markdown"
      ? { ...c, state: "stale" as const }
      : c,
  );
}

export function insertAt(cells: CellView[], index: number, cell: CellView): CellView[] {
  const next = [...cells];
  next.splice(index, 0, cell);
  return next;
}

export function removeAt(cells: CellView[], index: number): CellView[] {
  return cells.filter((_, i) => i !== index);
}

export function patchAt(
  cells: CellView[],
  index: number,
  patch: Partial<CellView>,
): CellView[] {
  return cells.map((c, i) => (i === index ? { ...c, ...patch } : c));
}

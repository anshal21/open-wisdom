import type {
  Answer,
  AnswerSummary,
  FormatHint,
  ReportConfidence,
} from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";
import { formatValue } from "@/lib/format";

/**
 * The ledger view-model. screens.md §5.2.
 *
 * Everything here is a pure derivation over `AnswerSummary` — no wire field is
 * invented, and nothing is dataset-specific.
 */

/* ---------------------------------------------------------------------------
   Filters
--------------------------------------------------------------------------- */

export type Scope = "all" | "attention" | "diverged" | "superseded";
export type TimeWindow = "7" | "30" | "90" | "all";

export interface Filters {
  scope: Scope;
  who: string | null;
  confidence: ReportConfidence | null;
  window: TimeWindow;
  definitionId: string | null;
  query: string;
}

export const DEFAULT_FILTERS: Filters = {
  scope: "all",
  who: null,
  confidence: null,
  window: "30",
  definitionId: null,
  query: "",
};

export const SCOPE_LABEL: Record<Scope, string> = {
  all: "All",
  attention: "Needs attention",
  diverged: "Answered 2 ways",
  superseded: "Superseded",
};

export const SCOPE_HINT: Record<Scope, string> = {
  all: "Every recorded answer",
  attention: "Contested, refused or superseded",
  diverged: "The same question answered two ways",
  superseded: "A definition changed after the answer",
};

export const WINDOW_LABEL: Record<TimeWindow, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  all: "All time",
};

export const CONFIDENCE_OPTIONS: ReportConfidence[] = [
  "verified",
  "qualified",
  "unverified",
  "contested",
  "refused",
];

const DAY_MS = 86_400_000;

export function windowStart(w: TimeWindow, now = Date.now()): number | null {
  return w === "all" ? null : now - Number(w) * DAY_MS;
}

/** A superseded answer reads as `superseded`, whatever it was recorded as. §3.1 */
export function rowState(a: AnswerSummary): ConfidenceState {
  return a.superseded ? "superseded" : a.confidence;
}

/** Search covers question text, answer values, and definition names. §5.2 */
export function matchesQuery(a: AnswerSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const value =
    a.value === null
      ? ""
      : `${formatValue(a.value, a.format_hint, { unit: a.unit })} ${a.value}`;
  const haystack = [a.question, value, a.unit, a.definition_used?.name ?? ""]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function applyFilters(
  rows: AnswerSummary[],
  filters: Filters,
  now = Date.now(),
): AnswerSummary[] {
  const start = windowStart(filters.window, now);
  return rows.filter((a) => {
    if (filters.who && a.created_by !== filters.who) return false;
    if (filters.confidence && a.confidence !== filters.confidence) return false;
    if (filters.definitionId && a.definition_used?.id !== filters.definitionId)
      return false;
    if (start !== null && Date.parse(a.created_at) < start) return false;
    if (filters.scope === "superseded" && !a.superseded) return false;
    if (filters.scope === "diverged" && !a.diverged) return false;
    if (
      filters.scope === "attention" &&
      !(
        a.superseded ||
        a.diverged ||
        a.confidence === "contested" ||
        a.confidence === "refused"
      )
    )
      return false;
    return matchesQuery(a, filters.query);
  });
}

export function activeFilterCount(f: Filters): number {
  return (
    (f.scope !== DEFAULT_FILTERS.scope ? 1 : 0) +
    (f.who ? 1 : 0) +
    (f.confidence ? 1 : 0) +
    (f.window !== DEFAULT_FILTERS.window ? 1 : 0) +
    (f.definitionId ? 1 : 0) +
    (f.query.trim() ? 1 : 0)
  );
}

/* ---------------------------------------------------------------------------
   Semantic dedupe. §5.2 — a ledger that lists the same question 40 times is a log.
--------------------------------------------------------------------------- */

export interface LedgerGroup {
  /** Fingerprint when the answers are semantically equivalent, else the id. */
  key: string;
  /** The most recent answer in the group — the one the row speaks for. */
  lead: AnswerSummary;
  members: AnswerSummary[];
  /** Runs collapsed into this row. Drives the `× n` badge. */
  runCount: number;
  diverged: boolean;
  state: ConfidenceState;
}

const newestFirst = (a: AnswerSummary, b: AnswerSummary) =>
  Date.parse(b.created_at) - Date.parse(a.created_at);

export function groupAnswers(rows: AnswerSummary[]): LedgerGroup[] {
  const byKey = new Map<string, AnswerSummary[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.fingerprint ?? row.id;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else {
      byKey.set(key, [row]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const members = [...(byKey.get(key) ?? [])].sort(newestFirst);
    const lead = members[0];
    const runCount = members.reduce(
      (n, m) => n + Math.max(1, m.run_count ?? 1),
      0,
    );
    const diverged = members.some((m) => m.diverged);
    return {
      key,
      lead,
      members,
      runCount,
      diverged,
      state: diverged ? ("contested" as ConfidenceState) : rowState(lead),
    };
  });
}

export type SortKey = "question" | "answer" | "when";
export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: SortState = { key: "when", dir: "desc" };

export function sortGroups(
  groups: LedgerGroup[],
  sort: SortState,
): LedgerGroup[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...groups].sort((x, y) => {
    if (sort.key === "question") {
      return dir * x.lead.question.localeCompare(y.lead.question);
    }
    if (sort.key === "answer") {
      const a = x.lead.value;
      const b = y.lead.value;
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return dir * (a - b);
    }
    return (
      dir * (Date.parse(x.lead.created_at) - Date.parse(y.lead.created_at))
    );
  });
}

/* ---------------------------------------------------------------------------
   Expanded runs — the group opens in place and shows every run.
--------------------------------------------------------------------------- */

export interface RunEntry {
  id: string;
  question: string;
  /** `Run 3` when the run is known individually. */
  runLabel?: string;
  current?: boolean;
  value: number | null;
  unit: string;
  format_hint: FormatHint;
  state: ConfidenceState;
  at: string;
  createdBy?: string;
}

export function runEntries(
  group: LedgerGroup,
  loaded: ReadonlyMap<string, Answer>,
): RunEntry[] {
  const out: RunEntry[] = [];
  for (const member of group.members) {
    const full = loaded.get(member.id);
    if (full?.runs?.length) {
      for (const run of [...full.runs].sort((a, b) => b.run - a.run)) {
        out.push({
          id: `${member.id}#${run.run}`,
          question: member.question,
          runLabel: `Run ${run.run}`,
          current: run.current,
          value: run.value,
          unit: member.unit,
          format_hint: member.format_hint,
          state: run.confidence,
          at: run.created_at,
          createdBy: member.created_by,
        });
      }
    } else {
      out.push({
        id: member.id,
        question: member.question,
        value: member.value,
        unit: member.unit,
        format_hint: member.format_hint,
        state: rowState(member),
        at: member.created_at,
        createdBy: member.created_by,
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Saved searches — `What did we say about X?` (J10, institutional memory)
--------------------------------------------------------------------------- */

export function savedSearchTerms(rows: AnswerSummary[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const name = r.definition_used?.name;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

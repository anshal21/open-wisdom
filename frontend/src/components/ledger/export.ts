import type { AnswerSummary } from "@/lib/api/types";
import { CONFIDENCE } from "@/lib/confidence";
import { formatValue } from "@/lib/format";
import { rowState } from "./model";

/**
 * §5.4 — CSV and JSON both carry the confidence state and the check summary for
 * every row. An export that strips the warrant recreates the exact failure this
 * product exists to prevent: a bare, confident, context-free number in a
 * spreadsheet. §3.6 makes the `_confidence` column and the CSV header comment
 * block mandatory.
 */

export type ExportFormat = "csv" | "json";

export interface ExportMeta {
  generatedAt: string;
  /** Human description of what is in the file: filters, scope. */
  scope: string;
  nameOf: (userId: string) => string;
}

const NOTE =
  "Every row carries the confidence state the answer was recorded with and its check summary. A figure quoted without them is not this answer.";

const COLUMNS = [
  "id",
  "question",
  "value",
  "formatted_value",
  "unit",
  "format_hint",
  "_confidence",
  "_checks",
  "definition",
  "definition_version",
  "asked_by",
  "asked_at",
] as const;

function checkSummary(a: AnswerSummary): string {
  return `${a.passed} of ${a.total} checks passed`;
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: AnswerSummary[], meta: ExportMeta): string {
  const header = [
    "# Answer ledger export",
    `# Generated ${meta.generatedAt}`,
    `# ${rows.length} answer${rows.length === 1 ? "" : "s"} · ${meta.scope}`,
    `# ${NOTE}`,
    "# Confidence states: verified | qualified | unverified | contested | refused | superseded",
  ].join("\n");

  const body = rows.map((a) =>
    [
      a.id,
      a.question,
      a.value,
      a.value === null
        ? "—"
        : formatValue(a.value, a.format_hint, { unit: a.unit }),
      a.unit,
      a.format_hint,
      CONFIDENCE[rowState(a)].label.toLowerCase(),
      checkSummary(a),
      a.definition_used?.name ?? "",
      a.definition_used?.version ?? "",
      meta.nameOf(a.created_by),
      a.created_at,
    ]
      .map((v) => csvCell(v as string | number | null))
      .join(","),
  );

  return [header, COLUMNS.join(","), ...body].join("\n") + "\n";
}

export function buildJson(rows: AnswerSummary[], meta: ExportMeta): string {
  return (
    JSON.stringify(
      {
        exported_at: meta.generatedAt,
        scope: meta.scope,
        count: rows.length,
        note: NOTE,
        answers: rows.map((a) => ({
          id: a.id,
          question: a.question,
          value: a.value,
          formatted_value:
            a.value === null
              ? "—"
              : formatValue(a.value, a.format_hint, { unit: a.unit }),
          unit: a.unit,
          format_hint: a.format_hint,
          _confidence: CONFIDENCE[rowState(a)].label.toLowerCase(),
          _checks: {
            passed: a.passed,
            total: a.total,
            summary: checkSummary(a),
          },
          definition_used: a.definition_used ?? null,
          asked_by: meta.nameOf(a.created_by),
          asked_at: a.created_at,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

export function buildExport(
  format: ExportFormat,
  rows: AnswerSummary[],
  meta: ExportMeta,
): { text: string; filename: string; mime: string } {
  const stamp = meta.generatedAt.slice(0, 10);
  return format === "csv"
    ? {
        text: buildCsv(rows, meta),
        filename: `answer-ledger-${stamp}.csv`,
        mime: "text/csv;charset=utf-8",
      }
    : {
        text: buildJson(rows, meta),
        filename: `answer-ledger-${stamp}.json`,
        mime: "application/json;charset=utf-8",
      };
}

/** Client-side download. Nothing leaves the browser. */
export function downloadFile(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** First `lines` lines, for the dialog preview. */
export function previewOf(text: string, lines = 14): string {
  return text.split("\n").slice(0, lines).join("\n");
}

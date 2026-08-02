/**
 * Explain the chart. roadmap §3.4 D3.
 *
 * `ResolvedSpec.why` already records which voice decided each field; showing
 * it as the bare word "default" beside a dropdown is a debug affordance, not
 * an explanation. This turns it into the sentence a person would say.
 *
 * The posture is the product's: an answer explains its number, so a chart
 * explains its shape. No competitor's recommender explains itself at all.
 *
 * Pure — no React, no DOM.
 */

import { getMeta, type VizTable } from "./registry";
import type { ResolvedSpec } from "./resolve";
import type { PivotResult } from "./series";

const colName = (t: VizTable, i: number) =>
  i >= 0 && i < t.columns.length ? (t.columns[i].label ?? t.columns[i].name) : "";

/**
 * One to three sentences: the form and why, the series and why, and what the
 * cap did. Returns "" when there is nothing worth saying.
 */
export function explain(
  table: VizTable,
  spec: ResolvedSpec,
  pivotResult?: Pick<PivotResult, "folded" | "seriesTotal" | "series"> | null,
): string {
  const parts: string[] = [];
  const label = getMeta(spec.type)?.label ?? spec.type;

  // ---- the form -----------------------------------------------------------
  if (spec.why.type === "user") {
    parts.push(`${label}, because you chose it.`);
  } else if (spec.why.type === "suggested") {
    parts.push(`${label}, suggested for this result.`);
  } else {
    const x = spec.xIdx >= 0 ? table.columns[spec.xIdx] : undefined;
    const reason =
      x?.type === "temporal"
        ? `because ${colName(table, spec.xIdx)} is a date`
        : x?.type === "nominal" || x?.type === "ordinal"
          ? `because ${colName(table, spec.xIdx)} is a category`
          : spec.type === "table"
            ? "because no chart form fits this shape honestly"
            : "by default for this shape";
    parts.push(`${label}, ${reason}.`);
  }

  // ---- the series ---------------------------------------------------------
  if (spec.seriesIdx >= 0) {
    const name = colName(table, spec.seriesIdx);
    if (spec.why.series === "user") parts.push(`Split by ${name} because you chose it.`);
    else if (spec.why.series === "suggested") parts.push(`Split by ${name}, as suggested.`);
    else parts.push(`${name} became the series — it was the only unclaimed dimension.`);
  }

  // ---- what the cap did ---------------------------------------------------
  if (pivotResult && pivotResult.folded > 0) {
    const kept = pivotResult.series.length - 1;
    const measure = spec.yIdxs.length ? colName(table, spec.yIdxs[0]) : "value";
    parts.push(
      `Showing the top ${kept} of ${pivotResult.seriesTotal} by ${measure}; the rest are grouped as Other.`,
    );
  }

  // ---- anything that was overruled ---------------------------------------
  if (spec.degraded) parts.push(capitalise(spec.degraded) + ".");

  return parts.join(" ");
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

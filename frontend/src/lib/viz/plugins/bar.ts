import {
  distinctCount,
  hasDimAndMeasure,
  measureValues,
  registerMeta,
  type Encoding,
  type VizTable,
} from "../registry";

/** Categories beyond which vertical bars rotate to horizontal. */
export const HORIZONTAL_AT = 12;

/** Half the rows carrying labels longer than this also forces horizontal. */
const LONG_LABEL = 14;

export function longLabels(t: VizTable, idx: number): boolean {
  const head = t.rows.slice(0, 50);
  if (!head.length) return false;
  let n = 0;
  for (const r of head) if (String(r[idx] ?? "").length > LONG_LABEL) n++;
  return n > head.length / 2;
}

/**
 * `orientation: "auto"` resolves here rather than in the resolver, so the
 * decision and the renderer live in the same file. P1-12 — where `horizontal`
 * was computed in resolve.ts and silently discarded by the renderer — stops
 * being a bug that can exist.
 */
export function barIsHorizontal(
  t: VizTable,
  enc: Encoding,
  orientation: unknown,
): boolean {
  if (orientation === "horizontal") return true;
  if (orientation === "vertical") return false;
  return (
    enc.xIdx >= 0 &&
    t.columns[enc.xIdx]?.type === "nominal" &&
    enc.seriesIdx < 0 &&
    (distinctCount(t.rows, enc.xIdx) > HORIZONTAL_AT || longLabels(t, enc.xIdx))
  );
}

/** A bar whose values span this far renders its small bars as nothing. */
const SPAN_LIMIT = 1000;

export const barMeta = registerMeta({
  id: "bar",
  label: "Bar",
  order: 30,
  channels: [
    { id: "x", label: "X", accepts: ["nominal", "ordinal", "temporal"], required: true },
    { id: "y", label: "Y", accepts: ["quantitative"], required: true, multiple: true },
    { id: "series", label: "Series", accepts: ["nominal", "ordinal"] },
  ],
  legality: (_t: VizTable, enc: Encoding) => hasDimAndMeasure(enc),
  affinity: (t: VizTable, enc: Encoding) => {
    if (enc.xIdx < 0 || !enc.yIdxs.length) return 0;
    const x = t.columns[enc.xIdx];
    if (x.type !== "nominal" && x.type !== "ordinal") return 0;
    // Affinity is about SHAPE only. Whether this particular data would make
    // the form lie is a separate question the resolver asks through
    // `barSpanReason`, so the refusal can carry its reason.
    return 80;
  },
  options: [
    {
      key: "orientation",
      kind: "select",
      label: "Orientation",
      values: [
        { value: "auto", label: "Auto" },
        { value: "vertical", label: "Columns" },
        { value: "horizontal", label: "Bars" },
      ],
      default: "auto",
    },
    {
      key: "stacking",
      kind: "select",
      label: "Stacking",
      values: [
        { value: "none", label: "Grouped" },
        { value: "stacked", label: "Stacked" },
        { value: "100%", label: "100% stacked" },
      ],
      default: "none",
    },
    {
      key: "sort",
      kind: "select",
      label: "Sort",
      values: [
        { value: "none", label: "Query order" },
        { value: "value-desc", label: "Value, high to low" },
        { value: "value-asc", label: "Value, low to high" },
      ],
      // Query order is the author's ORDER BY — intent, not accident. The
      // exception is a horizontal bar, which data-viz.md:24 requires sorted;
      // the renderer applies that when orientation resolves horizontal.
      default: "none",
    },
    { key: "valueLabels", kind: "toggle", label: "Value labels", default: false },
  ],
  capabilities: ["drill", "legendIsolate"],
});

/** Exported for the honesty note the resolver shows when bar declines. */
export function barSpanReason(t: VizTable, enc: Encoding): string | undefined {
  const values = measureValues(t, enc).filter((v) => v > 0);
  if (values.length < 2) return undefined;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (min > 0 && max / min > SPAN_LIMIT)
    return `values span ${Math.round(max / min).toLocaleString()}× — the small bars would render as zero; showing the table`;
  return undefined;
}

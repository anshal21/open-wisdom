import { measureValues, registerMeta, type Encoding, type VizTable } from "../registry";

/** One slice this dominant makes every other slice an unreadable sliver. */
const DOMINANT = 0.9;

/**
 * A pie is only honest for a categorical dimension and one NON-NEGATIVE
 * measure. It declares no `series` channel — slices ARE the x buckets — which
 * is what removes the `seriesIdx: -1` mutation the old Viz performed before
 * pivoting.
 *
 * Affinity 0: never suggested by shape (data-viz.md "Donut constraints"),
 * always honoured when the asker names the form or picks it in the switcher.
 * That is the whole resolution of the charting.md / data-viz.md conflict.
 */
export const pieMeta = registerMeta({
  id: "pie",
  label: "Pie",
  order: 40,
  channels: [
    { id: "x", label: "Slices", accepts: ["nominal", "ordinal"], required: true },
    { id: "y", label: "Value", accepts: ["quantitative"], required: true },
  ],
  legality: (t: VizTable, enc: Encoding) => {
    if (enc.xIdx < 0 || !enc.yIdxs.length)
      return { ok: false, reason: "needs one category column and one measure" };
    const negative = t.rows.some((r) => {
      const v = r[enc.yIdxs[0]];
      return typeof v === "number" && v < 0;
    });
    if (negative)
      return {
        ok: false,
        reason: "a share of a whole cannot include negative values",
      };
    return { ok: true };
  },
  affinity: () => 0,
  options: [
    {
      key: "innerRadius",
      kind: "select",
      label: "Style",
      values: [
        { value: "donut", label: "Donut" },
        { value: "pie", label: "Filled pie" },
      ],
      default: "donut",
    },
    { key: "sliceLabels", kind: "toggle", label: "Slice % labels", default: true },
  ],
  capabilities: ["drill"],
});

/** The dishonesty guard's reason, or undefined when the form is honest. */
export function pieDominanceReason(t: VizTable, enc: Encoding): string | undefined {
  const values = measureValues(t, enc).filter((v) => v > 0);
  if (values.length < 2) return undefined;
  const total = values.reduce((a, v) => a + v, 0);
  const max = Math.max(...values);
  if (total > 0 && max / total > DOMINANT)
    return `one slice is ${Math.round((max / total) * 100)}% of the whole — the remaining slivers would be unreadable; showing the table`;
  return undefined;
}

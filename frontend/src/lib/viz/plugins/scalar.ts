import { registerMeta, type Encoding, type VizTable } from "../registry";

/**
 * One figure, no comparison: no chart at all (data-viz.md §1). The answer
 * page already renders the hero number and its seal, so Viz renders nothing
 * — `frameless` tells it so, rather than a `return null` special case.
 */
export const scalarMeta = registerMeta({
  id: "scalar",
  label: "Number",
  order: 5,
  frameless: true,
  channels: [{ id: "y", label: "Value", accepts: ["quantitative"], required: true }],
  legality: (t: VizTable, enc: Encoding) =>
    t.rows.length === 1 && enc.yIdxs.length >= 1
      ? { ok: true }
      : { ok: false, reason: "needs a single row with one measure" },
  affinity: (t: VizTable) =>
    t.rows.length === 1 && t.columns.length === 1 && t.columns[0].type === "quantitative"
      ? 100
      : 0,
  options: [{ key: "abbreviate", kind: "toggle", label: "Abbreviate", default: false }],
});

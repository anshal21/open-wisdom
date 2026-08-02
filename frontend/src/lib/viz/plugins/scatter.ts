import { hasDimAndMeasure, registerMeta, type Encoding, type VizTable } from "../registry";

/**
 * Scatter's series cap is 3, not 8: with every pair of series potentially
 * adjacent, the palette only validates its first three slots at the all-pairs
 * CVD floor (data-viz.md §3).
 */
export const SCATTER_SERIES_CAP = 3;

export const scatterMeta = registerMeta({
  id: "scatter",
  label: "Scatter",
  order: 50,
  channels: [
    { id: "x", label: "X", accepts: ["quantitative", "temporal"], required: true },
    { id: "y", label: "Y", accepts: ["quantitative"], required: true },
    { id: "series", label: "Series", accepts: ["nominal", "ordinal"] },
  ],
  legality: (_t: VizTable, enc: Encoding) => hasDimAndMeasure(enc),
  affinity: (t: VizTable, enc: Encoding) => {
    if (enc.xIdx < 0 || !enc.yIdxs.length) return 0;
    // Two measures and enough points to show a shape — that is a relationship
    // question, and no other form answers it.
    return t.columns[enc.xIdx].type === "quantitative" &&
      enc.seriesIdx < 0 &&
      t.rows.length > 60
      ? 70
      : 0;
  },
  options: [
    { key: "pointSize", kind: "number", label: "Point size", default: 3, min: 2, max: 8, step: 1 },
    { key: "ring", kind: "toggle", label: "Surface ring", default: false },
  ],
  capabilities: ["brush", "drill"],
});

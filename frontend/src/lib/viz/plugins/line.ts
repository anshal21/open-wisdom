import {
  distinctCount,
  hasDimAndMeasure,
  registerMeta,
  type Encoding,
  type VizTable,
} from "../registry";

/** Beyond this many x buckets a line is noise; the table takes the default. */
export const POINT_CAP = 120;

/**
 * Time on x reads as a line — the most common story this product tells, so it
 * carries the highest affinity of any cartesian form.
 */
export const lineMeta = registerMeta({
  id: "line",
  label: "Line",
  order: 10,
  channels: [
    { id: "x", label: "X", accepts: ["temporal", "nominal", "ordinal"], required: true },
    { id: "y", label: "Y", accepts: ["quantitative"], required: true, multiple: true },
    { id: "series", label: "Series", accepts: ["nominal", "ordinal"] },
  ],
  legality: (_t: VizTable, enc: Encoding) => hasDimAndMeasure(enc),
  affinity: (t: VizTable, enc: Encoding) => {
    if (enc.xIdx < 0 || !enc.yIdxs.length) return 0;
    const x = t.columns[enc.xIdx];
    if (x.type === "temporal") {
      // Too many buckets and the line is a smear — the table wins by default
      // and the line stays one click away.
      return distinctCount(t.rows, enc.xIdx) > POINT_CAP ? 0 : 90;
    }
    if (x.type === "ordinal") return 60;
    return 40;
  },
  options: [
    {
      key: "curve",
      kind: "select",
      label: "Curve",
      values: [
        { value: "linear", label: "Straight" },
        { value: "smooth", label: "Smoothed" },
      ],
      default: "linear",
    },
    { key: "markers", kind: "toggle", label: "Point markers", default: false },
  ],
  capabilities: ["crosshair", "legendIsolate", "brush"],
});

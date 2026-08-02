import { hasDimAndMeasure, registerMeta, type Encoding, type VizTable } from "../registry";

/**
 * Area is single-series, emphasis-on-volume (data-viz.md:23). It is NEVER
 * volunteered — a reader cannot judge the upper bands of stacked areas, so
 * the form is only correct when a human asked for it. Multi-series area is
 * legal but must stack, which the option makes explicit.
 */
export const areaMeta = registerMeta({
  id: "area",
  label: "Area",
  order: 20,
  channels: [
    { id: "x", label: "X", accepts: ["temporal", "nominal", "ordinal"], required: true },
    { id: "y", label: "Y", accepts: ["quantitative"], required: true, multiple: true },
    { id: "series", label: "Series", accepts: ["nominal", "ordinal"] },
  ],
  legality: (_t: VizTable, enc: Encoding) => hasDimAndMeasure(enc),
  affinity: () => 0,
  options: [
    {
      key: "stacking",
      kind: "select",
      label: "Stacking",
      values: [
        { value: "stacked", label: "Stacked" },
        { value: "100%", label: "100% stacked" },
        { value: "none", label: "Overlaid" },
      ],
      // Multi-series overlaid areas hide the bands beneath them; stacking is
      // the honest default and the spec's own preference.
      default: "stacked",
    },
  ],
  capabilities: ["crosshair", "legendIsolate"],
});

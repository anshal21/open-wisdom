import { registerMeta, type Encoding, type VizTable } from "../registry";

/**
 * Big number with trend — the exec-weekly form (roadmap §2.5 T2).
 *
 * The figure is the last bucket; the delta is measured against the first and
 * always carries its base, because a delta without its comparison base is
 * banned (data-viz.md §10.1). A sparkline underneath gives the shape without
 * axes.
 *
 * This plugin is the registry's proof: it was added without editing the
 * resolver, Viz, or the switcher.
 */
export const bignumMeta = registerMeta({
  id: "bignum",
  label: "Big number",
  order: 6,
  channels: [
    { id: "x", label: "Period", accepts: ["temporal", "ordinal"], required: true },
    { id: "y", label: "Value", accepts: ["quantitative"], required: true },
  ],
  legality: (t: VizTable, enc: Encoding) => {
    if (enc.xIdx < 0 || !enc.yIdxs.length)
      return { ok: false, reason: "needs a period column and one measure" };
    const x = t.columns[enc.xIdx];
    if (x.type !== "temporal" && x.type !== "ordinal")
      return { ok: false, reason: "needs an ordered period on x to show a trend" };
    if (enc.seriesIdx >= 0)
      return { ok: false, reason: "shows one series — remove the series split" };
    return { ok: true };
  },
  // Never volunteered at full size: a line shows the whole shape and this
  // shows one number. It earns its keep in a tile, where the switcher (or a
  // tile-scale rule) selects it deliberately.
  affinity: () => 0,
  options: [
    { key: "sparkline", kind: "toggle", label: "Sparkline", default: true },
    {
      key: "compareTo",
      kind: "select",
      label: "Compare to",
      values: [
        { value: "first", label: "First period" },
        { value: "previous", label: "Previous period" },
      ],
      default: "first",
    },
  ],
});

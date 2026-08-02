/**
 * The one file that knows every chart form. Importing it registers them all,
 * in switcher order. Adding a form means adding its file and one line here.
 *
 * These are the PURE halves — channels, legality, affinity, options. The
 * matching renderers live in `components/viz/plugins/` and attach themselves
 * to the same registry entries. Keeping the metadata React-free is what lets
 * `resolve()` run on a dashboard tile, in a unit test, or anywhere else,
 * without loading a single renderer.
 */

export { scalarMeta } from "./scalar";
export { bignumMeta } from "./bignum";
export { lineMeta, POINT_CAP } from "./line";
export { areaMeta } from "./area";
export { barMeta, barIsHorizontal, barSpanReason, HORIZONTAL_AT } from "./bar";
export { pieMeta, pieDominanceReason } from "./pie";
export { scatterMeta, SCATTER_SERIES_CAP } from "./scatter";
export { tableMeta } from "./table";

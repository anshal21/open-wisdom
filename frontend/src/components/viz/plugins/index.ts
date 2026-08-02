/**
 * Every renderer, imported for its registration side effect. `Viz` imports
 * this file once; adding a chart form means adding its file and one line here.
 */

import "./scalar";
import "./bignum";
import "./cartesian"; // line, area, bar, scatter — one shared workhorse
import "./pie";
import "./table";

export { rendererFor, type VizRenderProps, type VizRenderer } from "./types";

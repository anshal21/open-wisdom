"use client";

/**
 * One figure, no comparison: no chart (data-viz.md §1). The host surface
 * already renders the hero number and its seal, so this renders nothing —
 * declared as `frameless` in the meta rather than special-cased in `Viz`.
 */

import { Hash } from "lucide-react";
import { defineRenderer } from "./types";

defineRenderer("scalar", {
  icon: Hash,
  render: () => null,
});

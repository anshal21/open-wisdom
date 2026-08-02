"use client";

import * as React from "react";
import type { Catalog } from "@/lib/api/types";
import { formatCount } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/keyboard";

/**
 * Introspection findings (screens.md §10.3). Every figure is derived from the
 * catalog the API returned — nothing here knows what the warehouse contains.
 */

export interface Finding {
  id: string;
  label: string;
}

export function findingsFor(catalog: Catalog): Finding[] {
  const tables = catalog.tables.length;
  const columns = catalog.tables.reduce((n, t) => n + t.columns.length, 0);
  const relationships = catalog.tables.reduce((n, t) => n + t.relationships.length, 0);
  const dates = catalog.tables.reduce(
    (n, t) => n + t.columns.filter((c) => c.role === "date").length,
    0,
  );
  return [
    { id: "tables", label: `${formatCount(tables)} tables` },
    { id: "columns", label: `${formatCount(columns)} columns` },
    { id: "relationships", label: `${formatCount(relationships)} relationships` },
    { id: "dates", label: `${formatCount(dates)} date columns` },
  ];
}

/**
 * Reveals findings one at a time as they land. The cap is 220ms; each finding
 * takes 180ms, so a four-finding introspection reads as work being done rather
 * than as a progress bar pretending to be one.
 */
export function useStagger(total: number, active: boolean, step = 180) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = React.useState(0);

  React.useEffect(() => {
    // Every branch that used to set state synchronously now does so from a
    // timer callback. The inactive and reduced-motion cases are decided
    // during render below, where they belong: they are functions of the
    // props, not events to react to.
    if (!active || reduced) return;

    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= total) window.clearInterval(id);
    }, step);
    return () => {
      window.clearInterval(id);
    };
  }, [active, total, step, reduced]);

  // Derived: nothing is revealed while inactive, everything is revealed at
  // once when the reader has asked for reduced motion, and otherwise the
  // timer's count applies — clamped, so a shrinking list cannot over-reveal.
  if (!active) return 0;
  if (reduced) return total;
  return Math.min(shown, total);
}

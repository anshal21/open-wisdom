"use client";

/**
 * The table form. Not a fallback with a chart's chrome — a first-class
 * visualization type that states the numbers, which is why it sits in the
 * switcher beside the plots and wins whenever no chart form is honest.
 */

import * as React from "react";
import { Table2 } from "lucide-react";
import { ChartTable } from "@/components/charts/chart-frame";
import { defineRenderer } from "./types";

defineRenderer("table", {
  icon: Table2,
  render: (p) => (
    <div className={p.embedded ? "max-h-full overflow-auto" : undefined}>
      <ChartTable
        columns={p.table.columns}
        rows={p.table.rows}
        formatHint={p.formatHint}
        unit={p.unit}
      />
    </div>
  ),
});

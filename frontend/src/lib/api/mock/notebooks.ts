import type { Notebook, NotebookCell, NotebookSummary } from "@/lib/api/types";
import { days, hours } from "./base";

/**
 * Fixture support. Notebooks carry the same verification apparatus as a
 * single answer, cell by cell. `sql` cells cannot get `cross_derivation`
 * (no second path for hand-written SQL) and `python` cells can never be
 * verified at all — both facts are load-bearing for the product's thesis
 * and must show up honestly here, not be smoothed over.
 */

/* ---------------------------------------------------------------------------
   nb_1 — the rich notebook. All four cell kinds, plus one stale and one
   errored cell, so every cell-chrome state in screens.md §7.3 is covered.
--------------------------------------------------------------------------- */

const NB1_CELLS: NotebookCell[] = [
  {
    id: "nb1_c1",
    kind: "markdown",
    source:
      "## Why did February look soft?\n\nFinance flagged a 5.4% revenue dip in February against January. This notebook walks the check end to end: a verified question cell, the raw SQL behind it, and a Python cut on top, before anything gets promoted to a definition or a watch.",
    output: null,
    confidence: null,
    state: "done",
  },
  {
    id: "nb1_c2",
    kind: "question",
    source: "Which categories drove the February total?",
    output: {
      columns: [
        { name: "category", label: "Category", type: "nominal" },
        { name: "revenue", label: "Revenue", type: "quantitative" },
      ],
      rows: [
        ["Outerwear & Coats", 41208],
        ["Jeans", 33914],
        ["Sweaters", 29661],
        ["Fashion Hoodies", 24107],
        ["Accessories", 18220],
      ],
      row_count: 5,
      value: 41208,
      unit: "currency",
      format_hint: "currency",
      chart: {
        type: "bar",
        x: { field: "category", label: "Category", type: "nominal" },
        y: [{ field: "revenue", label: "Revenue", type: "quantitative" }],
        series: null,
        coverage: { included_rows: 8431, excluded_rows: 0, reason: "" },
        confidence: "verified",
      },
    },
    confidence: "verified",
    report: {
      confidence: "verified",
      checks: [
        {
          id: "cross_derivation",
          label: "Computed a second way",
          status: "pass",
          finding: "Two independent queries agree: $41,208 for the top category.",
          detail: { why: "A number that only one query path produces has never been checked — it has only been produced." },
        },
        {
          id: "join_loss",
          label: "No rows silently dropped",
          status: "pass",
          finding: "All 8,431 order items in the period matched a product record.",
          detail: { rows_in: 8431, rows_out: 8431 },
        },
        {
          id: "fan_out",
          label: "No rows double-counted",
          status: "pass",
          finding: "Each order item counted once; the product join is N:1.",
        },
        {
          id: "grain",
          label: "Aggregation is valid at this grain",
          status: "pass",
          finding: "Summing a measure at its native grain.",
        },
        {
          id: "definition_source",
          label: "Uses a ratified definition",
          status: "pass",
          finding: "Revenue v3 — ratified by Priya Nair, 4 Mar.",
        },
        {
          id: "freshness",
          label: "Data is current",
          status: "pass",
          finding: "Source last loaded 2 hours ago.",
        },
      ],
      passed: 6,
      total: 6,
      headline: "Independently re-derived and structurally checked.",
    },
    state: "done",
    elapsed_ms: 4200,
  },
  {
    id: "nb1_c3",
    kind: "sql",
    source:
      "select p.category, sum(oi.sale_price) as revenue\nfrom order_items oi\njoin orders o   on o.order_id = oi.order_id\njoin products p on p.id = oi.product_id\nwhere o.status not in ('Cancelled', 'Returned')\n  and o.created_at >= date '2023-02-01'\n  and o.created_at <  date '2023-03-01'\ngroup by 1\norder by 2 desc",
    output: {
      columns: [
        { name: "category", label: "Category", type: "nominal" },
        { name: "revenue", label: "Revenue", type: "quantitative" },
      ],
      rows: [
        ["Outerwear & Coats", 41208],
        ["Jeans", 33914],
        ["Sweaters", 29661],
        ["Fashion Hoodies", 24107],
        ["Accessories", 18220],
        ["Swim", 15904],
        ["Suits & Sport Coats", 14226],
        ["Socks", 9106],
      ],
      row_count: 8,
      unit: "currency",
      format_hint: "currency",
    },
    confidence: "unverified",
    report: {
      confidence: "unverified",
      checks: [
        {
          id: "cross_derivation",
          label: "Computed a second way",
          status: "skipped",
          finding: "",
          skip_reason: "Hand-written SQL has no second derivation path to check it against.",
        },
        {
          id: "join_loss",
          label: "No rows silently dropped",
          status: "pass",
          finding: "All 8,431 order items matched a product record.",
          detail: { rows_in: 8431, rows_out: 8431 },
        },
        {
          id: "fan_out",
          label: "No rows double-counted",
          status: "pass",
          finding: "Each order item counted once; the product join is N:1.",
        },
        {
          id: "grain",
          label: "Aggregation is valid at this grain",
          status: "pass",
          finding: "Summing a measure at its native grain.",
        },
        {
          id: "freshness",
          label: "Data is current",
          status: "pass",
          finding: "Source last loaded 2 hours ago.",
        },
      ],
      passed: 4,
      total: 4,
      headline: "Structural checks passed, but this SQL was hand-written and cannot be re-derived a second way.",
    },
    state: "done",
    elapsed_ms: 340,
  },
  {
    id: "nb1_c4",
    kind: "python",
    source:
      "import pandas as pd\n\ndf = cells['nb1_c3'].to_frame()\nshare = df['revenue'] / df['revenue'].sum() * 100\ndf.assign(share_pct=share.round(1)).sort_values('revenue', ascending=False)",
    output: {
      columns: [
        { name: "category", label: "Category", type: "nominal" },
        { name: "revenue", label: "Revenue", type: "quantitative" },
        { name: "share_pct", label: "Share %", type: "quantitative" },
      ],
      rows: [
        ["Outerwear & Coats", 41208, 24.5],
        ["Jeans", 33914, 20.2],
        ["Sweaters", 29661, 17.6],
      ],
      row_count: 8,
    },
    confidence: "unverified",
    report: {
      confidence: "unverified",
      checks: [
        {
          id: "cross_derivation",
          label: "Computed a second way",
          status: "skipped",
          finding: "Python output can't be independently re-derived.",
          skip_reason: "Python output can't be independently re-derived.",
        },
        {
          id: "grain",
          label: "Aggregation is valid at this grain",
          status: "pass",
          finding: "Share is computed against the prior cell's own total; no re-aggregation of raw rows.",
        },
      ],
      passed: 1,
      total: 1,
      headline: "Python output can't be independently re-derived.",
    },
    state: "done",
    elapsed_ms: 210,
  },
  {
    id: "nb1_c5",
    kind: "question",
    source: "What was the return rate for the same period?",
    output: {
      columns: [
        { name: "category", label: "Category", type: "nominal" },
        { name: "return_rate", label: "Return rate", type: "quantitative" },
      ],
      rows: [
        ["Outerwear & Coats", 11.2],
        ["Jeans", 9.8],
        ["Sweaters", 8.1],
      ],
      row_count: 8,
      unit: "percent",
      format_hint: "percent",
    },
    confidence: "qualified",
    report: {
      confidence: "qualified",
      checks: [
        {
          id: "cross_derivation",
          label: "Computed a second way",
          status: "pass",
          finding: "Two independent queries agree: 11.2% for Outerwear & Coats.",
        },
        {
          id: "coverage",
          label: "Data covers the whole question",
          status: "warn",
          finding: "3.4% of order items have a null return timestamp and were treated as not returned.",
        },
      ],
      passed: 1,
      total: 2,
      headline: "3.4% of order items have a null return timestamp and were treated as not returned.",
    },
    state: "stale",
    elapsed_ms: 3100,
  },
  {
    id: "nb1_c6",
    kind: "sql",
    source:
      "select oi.campaing_id, sum(oi.sale_price)\nfrom order_items oi\nwhere oi.created_at >= date '2023-02-01'\ngroup by 1",
    output: null,
    confidence: null,
    state: "error",
    error: 'column "campaing_id" does not exist — did you mean "campaign_id"?',
    elapsed_ms: 118,
  },
];

export const NB1: Notebook = {
  id: "nb_1",
  name: "February revenue walkthrough",
  cells: NB1_CELLS,
  updated_at: hours(1),
};

/* ---------------------------------------------------------------------------
   nb_2 — lighter, all done
--------------------------------------------------------------------------- */

const NB2_CELLS: NotebookCell[] = [
  {
    id: "nb2_c1",
    kind: "markdown",
    source: "### AOV by channel\n\nQuick check before the Q4 review: does average order value differ meaningfully by acquisition channel.",
    output: null,
    confidence: null,
    state: "done",
  },
  {
    id: "nb2_c2",
    kind: "question",
    source: "What is average order value by traffic source in Q4 2023?",
    output: {
      columns: [
        { name: "traffic_source", label: "Traffic source", type: "nominal" },
        { name: "aov", label: "AOV", type: "quantitative" },
      ],
      rows: [
        ["Organic search", 63.1],
        ["Email", 66.8],
        ["Paid search", 58.4],
        ["Social", 55.9],
        ["Direct", 61.2],
      ],
      row_count: 5,
      value: 61.44,
      unit: "currency",
      format_hint: "currency",
    },
    confidence: "verified",
    report: {
      confidence: "verified",
      checks: [
        { id: "cross_derivation", label: "Computed a second way", status: "pass", finding: "Two independent queries agree: $61.44 overall." },
        { id: "join_loss", label: "No rows silently dropped", status: "pass", finding: "All 31,102 Q4 orders were included." },
        { id: "grain", label: "Aggregation is valid at this grain", status: "pass", finding: "Averaged at order grain, not item grain." },
        { id: "freshness", label: "Data is current", status: "pass", finding: "Source last loaded 2 hours ago." },
      ],
      passed: 4,
      total: 4,
      headline: "Independently re-derived and structurally checked.",
    },
    state: "done",
    elapsed_ms: 3800,
  },
  {
    id: "nb2_c3",
    kind: "markdown",
    source: "Email leads on AOV by $8.50 over Social. Worth a segment cut before drawing conclusions — sample sizes differ a lot by channel.",
    output: null,
    confidence: null,
    state: "done",
  },
];

export const NB2: Notebook = {
  id: "nb_2",
  name: "AOV by channel",
  cells: NB2_CELLS,
  updated_at: days(3),
};

/* ---------------------------------------------------------------------------
   nb_3 — sparse, in-progress
--------------------------------------------------------------------------- */

const NB3_CELLS: NotebookCell[] = [
  {
    id: "nb3_c1",
    kind: "markdown",
    source: "### Inventory aging notes\n\nDrafting a look at how long stock sits before it sells, ahead of the warehouse planning sync.",
    output: null,
    confidence: null,
    state: "done",
  },
  {
    id: "nb3_c2",
    kind: "question",
    source: "How many days of inventory do we hold on average, by distribution center?",
    output: {
      columns: [
        { name: "distribution_center", label: "Distribution center", type: "nominal" },
        { name: "avg_days", label: "Avg days held", type: "quantitative" },
      ],
      rows: [
        ["Memphis TN", 44],
        ["Chicago IL", 51],
        ["Houston TX", 39],
      ],
      row_count: 10,
      unit: "days",
      format_hint: "count",
    },
    confidence: "qualified",
    report: {
      confidence: "qualified",
      checks: [
        { id: "cross_derivation", label: "Computed a second way", status: "pass", finding: "Two independent queries agree: 46 days overall." },
        { id: "coverage", label: "Data covers the whole question", status: "warn", finding: "1.8% of inventory items have no sold_at and are still on hand; excluded from the average." },
      ],
      passed: 1,
      total: 2,
      headline: "1.8% of inventory items have no sold_at and are still on hand; excluded from the average.",
    },
    state: "queued",
  },
];

export const NB3: Notebook = {
  id: "nb_3",
  name: "Inventory aging notes",
  cells: NB3_CELLS,
  updated_at: hours(6),
};

export const NOTEBOOKS: Notebook[] = [NB1, NB2, NB3];

export const NOTEBOOK_SUMMARIES: NotebookSummary[] = NOTEBOOKS.map((n) => ({
  id: n.id,
  name: n.name,
  cell_count: n.cells.length,
  updated_at: n.updated_at,
}));

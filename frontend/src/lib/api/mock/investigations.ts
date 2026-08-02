import type {
  DriverEvent,
  Investigation,
  InvestigationSummary,
  Report,
  RuleoutEvent,
  WaterfallEvent,
} from "@/lib/api/types";
import { days, hours } from "./base";

/**
 * Fixture support. The rule-out ladder is the whole point of this surface:
 * phase 1 (measurement) must be fully populated before phase 2 (data
 * quality) or phase 3 (business drivers) are allowed to run, and a ladder
 * that stops early must still list the un-run phases explicitly — not omit
 * them — so the UI can render them greyed and labeled `not run`.
 */

/* ---------------------------------------------------------------------------
   inv_1 — stops at phase 1: a calendar artifact, not a real drop
--------------------------------------------------------------------------- */

const INV1_RULEOUTS: RuleoutEvent[] = [
  {
    kind: "period",
    phase: 1,
    id: "ro_period_length",
    label: "Period length",
    status: "implicated",
    finding:
      "February has 28 days against January's 31. Per-day revenue rose 4.7%, from $6,930 to $7,258, while the 28-day total fell 5.4% against the 31-day prior month.",
  },
  {
    kind: "period",
    phase: 1,
    id: "ro_calendar_shift",
    label: "Calendar shift",
    status: "cleared",
    finding: "No holiday or weekend-mix shift between the two months beyond the day-count difference already captured above.",
  },
  {
    kind: "instrumentation",
    phase: 1,
    id: "ro_definition_changed",
    label: "Definition changed",
    status: "cleared",
    finding: "Revenue v3 was unchanged across both months; no ratification event fell inside this window.",
  },
  {
    kind: "mix",
    phase: 1,
    id: "ro_mix_effect",
    label: "Mix effect",
    status: "cleared",
    finding: "Category mix moved 0.6 points between January and February — not enough to explain the headline gap on its own.",
  },
  { kind: "data_quality", phase: 2, id: "ro_row_count", label: "Row-count anomaly", status: "not_run", finding: "" },
  { kind: "data_quality", phase: 2, id: "ro_freshness", label: "Freshness", status: "not_run", finding: "" },
  { kind: "data_quality", phase: 2, id: "ro_null_rate", label: "Null-rate shift", status: "not_run", finding: "" },
  { kind: "data_quality", phase: 2, id: "ro_new_missing_values", label: "New / missing values", status: "not_run", finding: "" },
  { kind: "mix", phase: 3, id: "ro_segment_decomposition", label: "Segment decomposition", status: "not_run", finding: "" },
  { kind: "mix", phase: 3, id: "ro_rate_vs_mix", label: "Rate vs mix", status: "not_run", finding: "" },
  { kind: "mix", phase: 3, id: "ro_cohort", label: "Cohort", status: "not_run", finding: "" },
];

const INV1_REPORT: Report = {
  confidence: "qualified",
  checks: [
    {
      id: "period_normalization",
      label: "Fair time comparison",
      status: "warn",
      finding: "February has 28 days vs January's 31. Per-day revenue rose 4.7% while the total fell 5.4%.",
    },
    {
      id: "cross_derivation",
      label: "Computed a second way",
      status: "pass",
      finding: "Two independent queries agree: $203,220 for February, $214,825 for January.",
    },
    {
      id: "freshness",
      label: "Data is current",
      status: "pass",
      finding: "Source last loaded 2 hours ago.",
    },
  ],
  passed: 2,
  total: 3,
  headline: "The -5.4% headline is a calendar artifact, not a business change.",
};

export const INV_1: Investigation = {
  id: "inv_1",
  question: "Why did revenue drop in February?",
  metric: "Revenue",
  definition_id: "def_revenue",
  period: "2023-02",
  comparison_period: "2023-01",
  ruleouts: INV1_RULEOUTS,
  drivers: [],
  waterfall: null,
  narrative:
    "Revenue looked like it fell 5.4% in February versus January, but February has 28 days against January's 31. On a per-day basis revenue rose 4.7%, from $6,930 to $7,258. The investigation stopped at the measurement phase because the metric had not actually moved, so no data-quality or driver analysis was run. Treat the original -5.4% headline as a calendar artifact, not a business change.",
  verdict: {
    kind: "artifact",
    headline: "Revenue didn't drop.",
    detail:
      "February has 28 days; January had 31. Revenue per day rose 4.7% ($6,930 -> $7,258). The -5.4% headline is a calendar artifact, not a business change.",
    figures: [
      { label: "Total revenue", value: "$203,220", comparison: "-5.4% vs January" },
      { label: "Revenue per day", value: "$7,258", comparison: "+4.7% vs January" },
    ],
  },
  stopped_at: 1,
  report: INV1_REPORT,
  created_at: hours(5),
  created_by: "usr_1",
};

/* ---------------------------------------------------------------------------
   inv_2 — the null result: all three phases ran, nothing cleared threshold
--------------------------------------------------------------------------- */

const INV2_RULEOUTS: RuleoutEvent[] = [
  {
    kind: "period",
    phase: 1,
    id: "ro_period_length",
    label: "Period length",
    status: "cleared",
    finding: "June has 30 days against May's 31 — a 3.2% difference, not enough on its own to explain a 3.1% fall once normalized.",
  },
  {
    kind: "period",
    phase: 1,
    id: "ro_calendar_shift",
    label: "Calendar shift",
    status: "cleared",
    finding: "No holiday shift between the two months beyond ordinary calendar noise.",
  },
  {
    kind: "instrumentation",
    phase: 1,
    id: "ro_definition_changed",
    label: "Definition changed",
    status: "cleared",
    finding: "Revenue v3 was unchanged across both months.",
  },
  {
    kind: "mix",
    phase: 1,
    id: "ro_mix_effect",
    label: "Mix effect",
    status: "cleared",
    finding: "Category mix shifted 0.4 points between May and June, well inside normal noise.",
  },
  {
    kind: "data_quality",
    phase: 2,
    id: "ro_row_count",
    label: "Row-count anomaly",
    status: "cleared",
    finding: "10,904 June orders, within the normal range of 10.1k-11.8k for a 30-day month.",
  },
  {
    kind: "data_quality",
    phase: 2,
    id: "ro_freshness",
    label: "Freshness",
    status: "cleared",
    finding: "Source loaded 2 hours before this investigation ran.",
  },
  {
    kind: "data_quality",
    phase: 2,
    id: "ro_null_rate",
    label: "Null-rate shift",
    status: "cleared",
    finding: "0.1% null rate on the revenue measure, unchanged from May's 0.1%.",
  },
  {
    kind: "data_quality",
    phase: 2,
    id: "ro_new_missing_values",
    label: "New / missing values",
    status: "cleared",
    finding: "No new order-status values or missing category codes appeared in June.",
  },
  {
    kind: "mix",
    phase: 3,
    id: "ro_segment_decomposition",
    label: "Segment decomposition",
    status: "cleared",
    finding: "14 segments across 4 dimensions were decomposed; none exceeded its normal month-to-month range.",
  },
  {
    kind: "mix",
    phase: 3,
    id: "ro_rate_vs_mix",
    label: "Rate vs mix",
    status: "cleared",
    finding: "Both rate and mix shifts stayed within one standard deviation of their trailing 12-month averages for every segment examined.",
  },
  {
    kind: "mix",
    phase: 3,
    id: "ro_cohort",
    label: "Cohort",
    status: "cleared",
    finding: "Revenue per customer was flat across acquisition cohorts; the fall is not concentrated in any one cohort.",
  },
];

function hist(base: number, wiggle: number[]): number[] {
  return wiggle.map((w) => Math.round((base + w) * 10) / 10);
}

const INV2_DRIVERS: DriverEvent[] = [
  {
    segment: "Outerwear & Coats",
    contribution: -0.8,
    kind: "rate",
    rate_delta: -2.1,
    mix_delta: 0.4,
    history: hist(-0.3, [0, 0.8, -0.5, 0.2, -0.3, 0.7, -0.1, 0.4, -0.6, 0.6, -0.2, -0.5]),
    normal_range: [-1.4, 1.4],
  },
  {
    segment: "Jeans",
    contribution: -0.6,
    kind: "rate",
    rate_delta: -1.4,
    mix_delta: 0.3,
    history: hist(-0.2, [0.3, -0.4, 0.5, -0.3, 0.2, -0.6, 0.4, -0.2, 0.3, -0.5, 0.1, -0.4]),
    normal_range: [-1.2, 1.2],
  },
  {
    segment: "Sweaters",
    contribution: -0.5,
    kind: "mix",
    rate_delta: -0.2,
    mix_delta: -0.4,
    history: hist(-0.1, [0.2, -0.3, 0.4, -0.2, 0.3, -0.5, 0.1, -0.4, 0.2, -0.3, 0.5, -0.3]),
    normal_range: [-1.0, 1.0],
  },
  {
    segment: "Accessories",
    contribution: 0.4,
    kind: "mix",
    rate_delta: 0.1,
    mix_delta: 0.4,
    history: hist(0.1, [-0.2, 0.3, -0.4, 0.5, -0.1, 0.2, -0.3, 0.4, -0.2, 0.3, -0.5, 0.3]),
    normal_range: [-0.9, 0.9],
  },
  {
    segment: "Suits & Sport Coats",
    contribution: -0.4,
    kind: "rate",
    rate_delta: -0.9,
    mix_delta: 0.2,
    history: hist(-0.1, [0.2, -0.4, 0.3, -0.2, 0.4, -0.3, 0.1, -0.5, 0.2, -0.3, 0.4, -0.4]),
    normal_range: [-1.1, 1.1],
  },
  {
    segment: "Fashion Hoodies",
    contribution: -0.3,
    kind: "mix",
    rate_delta: 0.2,
    mix_delta: -0.5,
    history: hist(0.0, [0.2, -0.3, 0.4, -0.1, 0.3, -0.4, 0.2, -0.3, 0.1, -0.2, 0.4, -0.3]),
    normal_range: [-0.8, 0.8],
  },
  {
    segment: "Swim",
    contribution: -0.2,
    kind: "rate",
    rate_delta: -0.5,
    mix_delta: 0.1,
    history: hist(0.0, [0.1, -0.2, 0.3, -0.1, 0.2, -0.3, 0.1, -0.2, 0.3, -0.1, 0.2, -0.2]),
    normal_range: [-0.7, 0.7],
  },
  {
    segment: "Socks",
    contribution: 0.2,
    kind: "mix",
    rate_delta: 0.0,
    mix_delta: 0.2,
    history: hist(0.0, [0.1, -0.1, 0.2, -0.1, 0.1, -0.2, 0.1, -0.1, 0.2, -0.1, 0.1, 0.2]),
    normal_range: [-0.6, 0.6],
  },
];

const INV2_WATERFALL: WaterfallEvent = {
  bars: [
    { label: "Outerwear & Coats", value: -0.8 },
    { label: "Jeans", value: -0.6 },
    { label: "Sweaters", value: -0.5 },
    { label: "Accessories", value: 0.4 },
    { label: "Suits & Sport Coats", value: -0.4 },
    { label: "Fashion Hoodies", value: -0.3 },
    { label: "Swim", value: -0.2 },
    { label: "Socks", value: 0.2 },
  ],
  unexplained: -0.9,
};

const INV2_REPORT: Report = {
  confidence: "verified",
  checks: [
    { id: "cross_derivation", label: "Computed a second way", status: "pass", finding: "Two independent queries agree: $196,930 for June." },
    { id: "join_loss", label: "No rows silently dropped", status: "pass", finding: "All 6,988 June order items were included." },
    { id: "freshness", label: "Data is current", status: "pass", finding: "Source last loaded 2 hours ago." },
  ],
  passed: 3,
  total: 3,
  headline: "No significant driver found.",
};

export const INV_2: Investigation = {
  id: "inv_2",
  question: "Why did revenue fall 3.1% in June?",
  metric: "Revenue",
  definition_id: "def_revenue",
  period: "2023-06",
  comparison_period: "2023-05",
  ruleouts: INV2_RULEOUTS,
  drivers: INV2_DRIVERS,
  waterfall: INV2_WATERFALL,
  narrative:
    "Revenue fell 3.1%, from $203,220 in May to $196,930 in June. All three rule-out phases ran to completion. We examined 14 segments across 4 dimensions and the largest single contribution, Outerwear & Coats at -0.8pp, sits inside its normal month-to-month range of plus or minus 1.4 points over the last 12 months. Nothing in the decomposition exceeds its normal range. This is consistent with ordinary variation, not a driver worth chasing.",
  verdict: {
    kind: "no_driver",
    headline: "No significant driver found.",
    detail:
      "Revenue fell 3.1% ($203,220 -> $196,930). We examined 14 segments across 4 dimensions. The largest single contribution was Outerwear & Coats at -0.8pp, which is within its normal month-to-month range (±1.4pp over the last 12 months). This is consistent with ordinary variation.",
    figures: [
      { label: "Revenue", value: "$196,930", comparison: "-3.1% vs May" },
      { label: "Largest contribution", value: "-0.8pp", comparison: "Outerwear & Coats, within normal range" },
    ],
  },
  stopped_at: null,
  report: INV2_REPORT,
  created_at: days(6),
  created_by: "usr_2",
};

/* ---------------------------------------------------------------------------
   inv_3 — drivers found: full ladder, phase 3 implicates two segments
--------------------------------------------------------------------------- */

const INV3_RULEOUTS: RuleoutEvent[] = [
  {
    kind: "period",
    phase: 1,
    id: "ro_period_length",
    label: "Period length",
    status: "cleared",
    finding: "September and August both have 30 and 31 days respectively — normalized per-day figures were used throughout.",
  },
  {
    kind: "period",
    phase: 1,
    id: "ro_calendar_shift",
    label: "Calendar shift",
    status: "cleared",
    finding: "No holiday or weekend-mix shift between the two months.",
  },
  {
    kind: "instrumentation",
    phase: 1,
    id: "ro_definition_changed",
    label: "Definition changed",
    status: "cleared",
    finding: "Average order value v1 was unchanged across both months.",
  },
  {
    kind: "mix",
    phase: 1,
    id: "ro_mix_effect",
    label: "Mix effect",
    status: "cleared",
    finding: "Aggregate category mix moved 1.1 points — present, but not enough alone to explain the full fall.",
  },
  {
    kind: "data_quality",
    phase: 2,
    id: "ro_row_count",
    label: "Row-count anomaly",
    status: "cleared",
    finding: "10,441 September orders, within the normal range of 9.8k-11.2k.",
  },
  {
    kind: "data_quality",
    phase: 2,
    id: "ro_freshness",
    label: "Freshness",
    status: "cleared",
    finding: "Source loaded 2 hours before this investigation ran.",
  },
  {
    kind: "data_quality",
    phase: 2,
    id: "ro_null_rate",
    label: "Null-rate shift",
    status: "cleared",
    finding: "0.1% null rate on sale_price, unchanged from August.",
  },
  {
    kind: "data_quality",
    phase: 2,
    id: "ro_new_missing_values",
    label: "New / missing values",
    status: "cleared",
    finding: "No new order-status values appeared; one new SKU code was seen but affects under 0.1% of items.",
  },
  {
    kind: "mix",
    phase: 3,
    id: "ro_segment_decomposition",
    label: "Segment decomposition",
    status: "implicated",
    finding: "Outerwear & Coats and Jeans together account for 4.3 of the 6.2-point AOV fall.",
  },
  {
    kind: "mix",
    phase: 3,
    id: "ro_rate_vs_mix",
    label: "Rate vs mix",
    status: "implicated",
    finding: "Outerwear & Coats' average selling price fell 9.0% on a discount campaign, a rate effect, not a mix shift.",
  },
  {
    kind: "mix",
    phase: 3,
    id: "ro_cohort",
    label: "Cohort",
    status: "cleared",
    finding: "The fall is not concentrated in any single acquisition cohort; it shows up evenly across tenure bands.",
  },
];

const INV3_DRIVERS: DriverEvent[] = [
  {
    segment: "Outerwear & Coats",
    contribution: -2.9,
    kind: "rate",
    rate_delta: -9.0,
    mix_delta: 0.6,
    history: hist(-0.2, [0.3, -0.5, 0.4, -0.3, 0.2, -0.4, 0.3, -0.6, -1.1, -1.8, -2.4, -2.9]),
    normal_range: [-1.3, 1.3],
  },
  {
    segment: "Jeans",
    contribution: -1.4,
    kind: "mix",
    rate_delta: -3.1,
    mix_delta: -0.2,
    history: hist(-0.1, [0.2, -0.3, 0.4, -0.2, 0.3, -0.4, 0.2, -0.5, -0.6, -0.9, -1.1, -1.4]),
    normal_range: [-1.0, 1.0],
  },
  {
    segment: "Sweaters",
    contribution: -0.4,
    kind: "mix",
    rate_delta: -0.1,
    mix_delta: -0.3,
    history: hist(0.0, [0.2, -0.3, 0.4, -0.1, 0.3, -0.4, 0.2, -0.3, -0.2, -0.3, -0.3, -0.4]),
    normal_range: [-0.8, 0.8],
  },
  {
    segment: "Suits & Sport Coats",
    contribution: 0.3,
    kind: "rate",
    rate_delta: 0.8,
    mix_delta: -0.1,
    history: hist(0.0, [-0.2, 0.3, -0.1, 0.2, -0.3, 0.1, -0.2, 0.3, 0.1, 0.2, 0.3, 0.3]),
    normal_range: [-0.9, 0.9],
  },
  {
    segment: "Fashion Hoodies",
    contribution: -0.3,
    kind: "mix",
    rate_delta: 0.1,
    mix_delta: -0.4,
    history: hist(0.0, [0.1, -0.2, 0.3, -0.1, 0.2, -0.3, 0.1, -0.2, -0.1, -0.2, -0.3, -0.3]),
    normal_range: [-0.7, 0.7],
  },
  {
    segment: "Swim",
    contribution: 0.5,
    kind: "rate",
    rate_delta: 1.1,
    mix_delta: 0.2,
    history: hist(0.0, [-0.1, 0.2, -0.2, 0.3, -0.1, 0.2, -0.2, 0.3, 0.2, 0.3, 0.4, 0.5]),
    normal_range: [-0.8, 0.8],
  },
  {
    segment: "Accessories",
    contribution: -0.2,
    kind: "mix",
    rate_delta: -0.1,
    mix_delta: -0.2,
    history: hist(0.0, [0.1, -0.1, 0.2, -0.1, 0.1, -0.2, 0.1, -0.1, -0.1, -0.1, -0.2, -0.2]),
    normal_range: [-0.6, 0.6],
  },
  {
    segment: "Socks",
    contribution: 0.1,
    kind: "rate",
    rate_delta: 0.3,
    mix_delta: -0.1,
    history: hist(0.0, [-0.1, 0.1, -0.1, 0.2, -0.1, 0.1, -0.1, 0.1, 0.1, 0.1, 0.1, 0.1]),
    normal_range: [-0.5, 0.5],
  },
];

const INV3_WATERFALL: WaterfallEvent = {
  bars: [
    { label: "Outerwear & Coats", value: -2.9 },
    { label: "Jeans", value: -1.4 },
    { label: "Sweaters", value: -0.4 },
    { label: "Suits & Sport Coats", value: 0.3 },
    { label: "Fashion Hoodies", value: -0.3 },
    { label: "Swim", value: 0.5 },
    { label: "Accessories", value: -0.2 },
    { label: "Socks", value: 0.1 },
  ],
  unexplained: -1.9,
};

const INV3_REPORT: Report = {
  confidence: "verified",
  checks: [
    { id: "cross_derivation", label: "Computed a second way", status: "pass", finding: "Two independent queries agree: $60.79 for September." },
    { id: "join_loss", label: "No rows silently dropped", status: "pass", finding: "All 10,441 September orders were included." },
    { id: "freshness", label: "Data is current", status: "pass", finding: "Source last loaded 2 hours ago." },
  ],
  passed: 3,
  total: 3,
  headline: "Outerwear discounting drove the drop.",
};

export const INV_3: Investigation = {
  id: "inv_3",
  question: "Why did average order value fall in September 2023?",
  metric: "Average order value",
  definition_id: "def_aov",
  period: "2023-09",
  comparison_period: "2023-08",
  ruleouts: INV3_RULEOUTS,
  drivers: INV3_DRIVERS,
  waterfall: INV3_WATERFALL,
  narrative:
    "Average order value fell 6.2%, from $64.80 in August to $60.79 in September. Measurement and data-quality rule-outs all cleared, so the ladder proceeded to business drivers. Outerwear & Coats contributed -2.9pp after a discount campaign cut its average selling price 9.0%, and Jeans contributed -1.4pp on a smaller rate effect. Together the two segments explain 4.3 of the 6.2-point fall; 1.9pp remains unexplained. This is a rate effect from discounting, not a shift in what customers are buying.",
  verdict: {
    kind: "driver_found",
    headline: "Outerwear discounting drove the drop.",
    detail:
      "AOV fell 6.2% from $64.80 to $60.79. Outerwear & Coats contributed -2.9pp after a discount campaign cut its average selling price 9.0%, and Jeans contributed -1.4pp on a smaller rate effect. Together they account for 4.3 of the 6.2-point fall; 1.9pp remains unexplained.",
    figures: [
      { label: "AOV", value: "$60.79", comparison: "-6.2% vs August" },
      { label: "Outerwear contribution", value: "-2.9pp", comparison: "Largest single driver" },
    ],
  },
  stopped_at: null,
  report: INV3_REPORT,
  created_at: days(2),
  created_by: "usr_3",
};

export const INVESTIGATIONS: Investigation[] = [INV_1, INV_2, INV_3];

export const INVESTIGATION_SUMMARIES: InvestigationSummary[] = INVESTIGATIONS.map((inv) => ({
  id: inv.id,
  question: inv.question,
  metric: inv.metric,
  verdict_kind: inv.verdict.kind,
  stopped_at: inv.stopped_at,
  created_at: inv.created_at,
  created_by: inv.created_by,
}));

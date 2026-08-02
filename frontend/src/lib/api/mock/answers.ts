import type {
  AmbiguityPayload,
  Answer,
  AnswerSummary,
  Check,
  Report,
} from "@/lib/api/types";
import { days, hours, ago } from "./base";

/* ---------------------------------------------------------------------------
   Check factories
--------------------------------------------------------------------------- */

export const check = (c: Check): Check => c;

const crossDerivationPass = (formatted: string, a: string, b: string): Check => ({
  id: "cross_derivation",
  label: "Computed a second way",
  status: "pass",
  finding: `Two independent queries agree: ${formatted}`,
  detail: { sql_path_a: a, sql_path_b: b, why: "A number that only one query path produces has never been checked — it has only been produced." },
});

/* ---------------------------------------------------------------------------
   1 · Qualified — the period-normalisation trap
--------------------------------------------------------------------------- */

const FEB_SQL_A = `select sum(oi.sale_price) as revenue
from order_items oi
join orders o on o.order_id = oi.order_id
where o.status not in ('Cancelled', 'Returned')
  and o.created_at >= date '2023-02-01'
  and o.created_at <  date '2023-03-01'`;

const FEB_SQL_B = `-- independent path: aggregate per day, then sum
with daily as (
  select date_trunc('day', o.created_at) as d,
         sum(oi.sale_price) as revenue
  from orders o
  join order_items oi on oi.order_id = o.order_id
  where o.status not in ('Cancelled', 'Returned')
    and o.created_at >= date '2023-02-01'
    and o.created_at <  date '2023-03-01'
  group by 1
)
select sum(revenue) from daily`;

export const FEB_CHECKS: Check[] = [
  {
    id: "period_normalization",
    label: "Fair time comparison",
    status: "warn",
    finding:
      "February has 28 days vs January's 31. Per-day revenue rose 4.7% while the total fell 5.4%.",
    detail: {
      why: "Period-over-period comparisons across unequal-length periods are the most common way a flat metric looks like a decline.",
      rows_in: 28,
      rows_out: 31,
    },
  },
  crossDerivationPass("$203,220", FEB_SQL_A, FEB_SQL_B),
  {
    id: "join_loss",
    label: "No rows silently dropped",
    status: "pass",
    finding: "All 8,431 order items in the period were included.",
    detail: { rows_in: 8431, rows_out: 8431 },
  },
  {
    id: "fan_out",
    label: "No rows double-counted",
    status: "pass",
    finding: "Each order was counted once; the join did not multiply rows.",
    detail: { rows_in: 5892, rows_out: 5892 },
  },
  {
    id: "definition_source",
    label: "Uses a ratified definition",
    status: "pass",
    finding: "Revenue v3 — ratified by Priya Nair, 4 Mar.",
  },
  {
    id: "grain",
    label: "Aggregation is valid at this grain",
    status: "pass",
    finding: "Summing a measure at its native grain.",
  },
  {
    id: "coverage",
    label: "Data covers the whole question",
    status: "pass",
    finding: "0 nulls in the measure column.",
  },
  {
    id: "freshness",
    label: "Data is current",
    status: "pass",
    finding: "Source last loaded 2 hours ago.",
  },
  {
    id: "precedent",
    label: "Consistent with what we said before",
    status: "skipped",
    finding: "",
    skip_reason: "No equivalent question has been answered before.",
  },
];

export const FEB_REPORT: Report = {
  confidence: "qualified",
  checks: FEB_CHECKS,
  passed: 6,
  total: 7,
  headline:
    "February has 28 days vs January's 31. Per-day revenue rose 4.7% while the total fell 5.4%.",
};

const FEB_DAILY: Array<[string, number]> = [
  ["2023-02-01", 6912], ["2023-02-02", 7481], ["2023-02-03", 8104], ["2023-02-04", 9233],
  ["2023-02-05", 8870], ["2023-02-06", 6120], ["2023-02-07", 6544], ["2023-02-08", 7011],
  ["2023-02-09", 7392], ["2023-02-10", 8250], ["2023-02-11", 9014], ["2023-02-12", 8631],
  ["2023-02-13", 6288], ["2023-02-14", 9905], ["2023-02-15", 7126], ["2023-02-16", 6884],
  ["2023-02-17", 7743], ["2023-02-18", 8402], ["2023-02-19", 8118], ["2023-02-20", 6470],
  ["2023-02-21", 6255], ["2023-02-22", 6931], ["2023-02-23", 7288], ["2023-02-24", 8009],
  ["2023-02-25", 8577], ["2023-02-26", 8140], ["2023-02-27", 6349], ["2023-02-28", 6273],
];

export const ANSWER_FEB: Answer = {
  id: "ans_feb_revenue",
  thread_id: "th_1",
  question: "What was revenue in February 2023?",
  restated: "Total revenue for 1–28 February 2023, excluding cancelled and returned orders.",
  value: 203220,
  unit: "currency",
  format_hint: "currency",
  columns: [
    { name: "day", label: "Day", type: "temporal" },
    { name: "revenue", label: "Revenue", type: "quantitative" },
  ],
  rows: FEB_DAILY.map(([d, v]) => [d, v]),
  row_count: 28,
  scanned_rows: 181759,
  sql: FEB_SQL_A,
  sql_path_b: FEB_SQL_B,
  report: FEB_REPORT,
  chart: {
    type: "bar",
    x: { field: "day", label: "Day", type: "temporal" },
    y: [{ field: "revenue", label: "Revenue", type: "quantitative" }],
    series: null,
    coverage: { included_rows: 8431, excluded_rows: 0, reason: "" },
    confidence: "qualified",
  },
  narrative:
    "February revenue was $203,220, down 5.4% from January's $214,825. February has 28 days against January's 31 — on a per-day basis revenue rose 4.7%, from $6,930 to $7,258. Treat the headline decline as a calendar artifact rather than a business change.",
  context: {
    time_range: { from: "2023-02-01", to: "2023-02-28" },
    filters: [{ column: "status", operator: "not in", value: ["Cancelled", "Returned"] }],
    grain: "day",
    definition_id: "def_revenue",
  },
  definition_used: { id: "def_revenue", name: "Revenue", version: 3 },
  created_by: "usr_1",
  created_at: hours(5),
  source_id: "src_1",
  cost: { llm_calls: 3, usd: 0.09, elapsed_ms: 6400 },
  runs: [
    { id: "ans_feb_revenue", run: 3, value: 203220, confidence: "qualified", created_at: hours(5), current: true },
    { id: "ans_feb_revenue_r2", run: 2, value: 203220, confidence: "qualified", created_at: days(9), current: false },
    { id: "ans_feb_revenue_r1", run: 1, value: 198410, confidence: "unverified", created_at: days(41), current: false },
  ],
};

/* ---------------------------------------------------------------------------
   2 · Refused — the signature screen
--------------------------------------------------------------------------- */

export const AMBIGUITY_2023_REVENUE: AmbiguityPayload = {
  question: "What was 2023 revenue?",
  reason:
    'Three defensible readings of "revenue" exist in this warehouse and they differ by 4.0x.',
  candidates: [
    {
      id: "cand_excl",
      label: "Exclude cancelled and returned",
      description:
        "Counts every order that wasn't cancelled or sent back. This is what most finance teams mean by revenue.",
      value: 3820425.33,
      sql: `select sum(oi.sale_price)
from order_items oi
join orders o on o.order_id = oi.order_id
where o.status not in ('Cancelled', 'Returned')
  and o.created_at >= date '2023-01-01'
  and o.created_at <  date '2024-01-01'`,
      recommended: true,
      recommendation_basis:
        'Matches how Finance defined "revenue" when they ratified it on 4 Mar.',
      rows_included: 136437,
      rows_total: 181759,
    },
    {
      id: "cand_all",
      label: "All order items",
      description:
        "Counts every order ever placed, including ones cancelled or returned. Nothing is excluded.",
      value: 5101372.66,
      sql: `select sum(oi.sale_price)
from order_items oi
join orders o on o.order_id = oi.order_id
where o.created_at >= date '2023-01-01'
  and o.created_at <  date '2024-01-01'`,
      recommended: false,
      recommendation_basis: "",
      rows_included: 181759,
      rows_total: 181759,
    },
    {
      id: "cand_complete",
      label: "Completed orders only",
      description:
        "Counts only orders marked complete. Excludes anything still shipping or being processed.",
      value: 1278434.12,
      sql: `select sum(oi.sale_price)
from order_items oi
join orders o on o.order_id = oi.order_id
where o.status = 'Complete'
  and o.created_at >= date '2023-01-01'
  and o.created_at <  date '2024-01-01'`,
      recommended: false,
      recommendation_basis: "",
      rows_included: 45609,
      rows_total: 181759,
    },
  ],
  spread: { ratio: 3.99, min: 1278434.12, max: 5101372.66, log_scaled: false },
  unit: "currency",
  format_hint: "currency",
};

export const REFUSED_CHECKS: Check[] = [
  {
    id: "filter_sensitivity",
    label: "Answer is stable under reasonable variations",
    status: "fail",
    finding:
      "Excluding vs including cancelled orders changes this by 4.0x — $1,278,434 to $5,101,373.",
    detail: {
      why: "When a defensible change of filter moves the number by more than 20%, the question has more than one answer and the system will not pick for you.",
    },
  },
  {
    id: "definition_source",
    label: "Uses a ratified definition",
    status: "fail",
    finding:
      'No ratified definition of "revenue" applies to this range. Three readings were inferred from order status values.',
  },
  {
    id: "join_loss",
    label: "No rows silently dropped",
    status: "pass",
    finding: "All 181,759 order items were reachable from orders.",
  },
  {
    id: "fan_out",
    label: "No rows double-counted",
    status: "pass",
    finding: "Each order was counted once under every reading.",
  },
  {
    id: "freshness",
    label: "Data is current",
    status: "pass",
    finding: "Source last loaded 2 hours ago.",
  },
  {
    id: "cross_derivation",
    label: "Computed a second way",
    status: "skipped",
    finding: "",
    skip_reason: "Skipped — there is no single reading to re-derive yet.",
  },
];

export const ANSWER_REFUSED: Answer = {
  id: "ans_2023_revenue",
  thread_id: "th_2",
  question: "What was 2023 revenue?",
  value: null,
  unit: "currency",
  format_hint: "currency",
  columns: [],
  rows: [],
  row_count: 0,
  scanned_rows: 181759,
  sql: "",
  report: {
    confidence: "refused",
    checks: REFUSED_CHECKS,
    passed: 3,
    total: 5,
    headline: "This question has 3 defensible answers.",
  },
  chart: null,
  narrative: "",
  context: {
    time_range: { from: "2023-01-01", to: "2023-12-31" },
    grain: "year",
  },
  created_by: "usr_1",
  created_at: days(1),
  source_id: "src_1",
  cost: { llm_calls: 4, usd: 0.12, elapsed_ms: 8100 },
  ambiguity: AMBIGUITY_2023_REVENUE,
};

/* ---------------------------------------------------------------------------
   3 · Contested — two derivations disagree
--------------------------------------------------------------------------- */

const SHIP_SQL_A = `select count(distinct o.order_id)
from orders o
where o.status = 'Shipped'
  and o.shipped_at >= date '2023-04-01'
  and o.shipped_at <  date '2023-07-01'`;

const SHIP_SQL_B = `select count(distinct oi.order_id)
from order_items oi
where oi.shipped_at >= date '2023-04-01'
  and oi.shipped_at <  date '2023-07-01'`;

export const ANSWER_CONTESTED: Answer = {
  id: "ans_shipped_q2",
  question: "How many orders shipped in Q2 2023?",
  value: null,
  unit: "orders",
  format_hint: "count",
  columns: [],
  rows: [],
  row_count: 0,
  sql: SHIP_SQL_A,
  sql_path_b: SHIP_SQL_B,
  report: {
    confidence: "contested",
    checks: [
      {
        id: "cross_derivation",
        label: "Computed a second way",
        status: "fail",
        finding: "Two queries disagree: 31,204 vs 30,977 (0.73% apart).",
        detail: {
          sql_path_a: SHIP_SQL_A,
          sql_path_b: SHIP_SQL_B,
          value_path_a: 31204,
          value_path_b: 30977,
          why: "The difference is 227 orders that appear in the items table but have no matching order record.",
        },
      },
      {
        id: "join_loss",
        label: "No rows silently dropped",
        status: "warn",
        finding: "227 shipped items have no linked order record.",
        detail: { rows_in: 31204, rows_out: 30977 },
      },
      {
        id: "fan_out",
        label: "No rows double-counted",
        status: "pass",
        finding: "Distinct order ids were counted; no multiplication.",
      },
      {
        id: "freshness",
        label: "Data is current",
        status: "pass",
        finding: "Source last loaded 2 hours ago.",
      },
      {
        id: "grain",
        label: "Aggregation is valid at this grain",
        status: "pass",
        finding: "Counting distinct keys at order grain.",
      },
    ],
    passed: 3,
    total: 5,
    headline: "Two ways of computing this disagree.",
  },
  chart: null,
  narrative: "",
  context: { time_range: { from: "2023-04-01", to: "2023-06-30" }, grain: "quarter" },
  created_by: "usr_3",
  created_at: days(2),
  source_id: "src_1",
  cost: { llm_calls: 3, usd: 0.08, elapsed_ms: 7300 },
};

/* ---------------------------------------------------------------------------
   4 · Verified — the clean case
--------------------------------------------------------------------------- */

const CATEGORY_ROWS: Array<[string, number]> = [
  ["Outerwear & Coats", 612844],
  ["Jeans", 498120],
  ["Sweaters", 431907],
  ["Suits & Sport Coats", 388215],
  ["Fashion Hoodies", 344012],
  ["Swim", 298661],
  ["Accessories", 241338],
  ["Socks", 152904],
];

export const ANSWER_VERIFIED: Answer = {
  id: "ans_top_categories",
  question: "Which product categories made the most revenue in 2023?",
  restated: "2023 revenue by product category, excluding cancelled and returned orders.",
  value: 612844,
  unit: "currency",
  format_hint: "currency",
  columns: [
    { name: "category", label: "Category", type: "nominal" },
    { name: "revenue", label: "Revenue", type: "quantitative" },
  ],
  rows: CATEGORY_ROWS.map(([c, v]) => [c, v]),
  row_count: 8,
  scanned_rows: 136437,
  sql: `select p.category, sum(oi.sale_price) as revenue
from order_items oi
join orders o   on o.order_id = oi.order_id
join products p on p.id = oi.product_id
where o.status not in ('Cancelled', 'Returned')
  and o.created_at >= date '2023-01-01'
  and o.created_at <  date '2024-01-01'
group by 1
order by 2 desc
limit 8`,
  sql_path_b: `select category, sum(revenue) from (
  select p.category, oi.sale_price as revenue
  from order_items oi
  join orders o   on o.order_id = oi.order_id
  join products p on p.id = oi.product_id
  where o.status not in ('Cancelled', 'Returned')
    and o.created_at between date '2023-01-01' and date '2023-12-31'
) t group by 1 order by 2 desc limit 8`,
  report: {
    confidence: "verified",
    checks: [
      crossDerivationPass(
        "$612,844 for the top category",
        "-- path a",
        "-- path b",
      ),
      {
        id: "join_loss",
        label: "No rows silently dropped",
        status: "pass",
        finding: "All 136,437 order items matched a product record.",
        detail: { rows_in: 136437, rows_out: 136437 },
      },
      {
        id: "fan_out",
        label: "No rows double-counted",
        status: "pass",
        finding: "Each order item counted once; product join is N:1.",
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
        id: "coverage",
        label: "Data covers the whole question",
        status: "pass",
        finding: "0 order items have a null category.",
      },
      {
        id: "freshness",
        label: "Data is current",
        status: "pass",
        finding: "Source last loaded 2 hours ago.",
      },
    ],
    passed: 7,
    total: 7,
    headline: "Independently re-derived and structurally checked.",
  },
  chart: {
    type: "bar",
    x: { field: "category", label: "Category", type: "nominal" },
    y: [{ field: "revenue", label: "Revenue", type: "quantitative" }],
    series: null,
    coverage: { included_rows: 136437, excluded_rows: 0, reason: "" },
    confidence: "verified",
  },
  narrative:
    "Outerwear & Coats led 2023 with $612,844, 23% ahead of Jeans at $498,120. The top three categories together account for 42% of the $3,820,425 annual total. No category lost more than 4% against 2022.",
  context: {
    time_range: { from: "2023-01-01", to: "2023-12-31" },
    filters: [{ column: "status", operator: "not in", value: ["Cancelled", "Returned"] }],
    grain: "year",
    definition_id: "def_revenue",
  },
  definition_used: { id: "def_revenue", name: "Revenue", version: 3 },
  created_by: "usr_2",
  created_at: days(3),
  source_id: "src_1",
  cost: { llm_calls: 3, usd: 0.07, elapsed_ms: 5100 },
};

/* ---------------------------------------------------------------------------
   5 · Unverified — no second derivation path exists
--------------------------------------------------------------------------- */

const SESSION_ROWS: Array<[string, number]> = [
  ["2023-01", 186420], ["2023-02", 171338], ["2023-03", 204117], ["2023-04", 198006],
  ["2023-05", 211944], ["2023-06", 205331], ["2023-07", 219860], ["2023-08", 228415],
  ["2023-09", 214773], ["2023-10", 236108], ["2023-11", 268442], ["2023-12", 287209],
];

export const ANSWER_UNVERIFIED: Answer = {
  id: "ans_web_sessions",
  question: "How many web sessions did we have each month in 2023?",
  value: 2431963,
  unit: "sessions",
  format_hint: "count",
  columns: [
    { name: "month", label: "Month", type: "temporal" },
    { name: "sessions", label: "Sessions", type: "quantitative" },
  ],
  rows: SESSION_ROWS.map(([m, v]) => [m, v]),
  row_count: 12,
  scanned_rows: 2431963,
  sql: `select date_trunc('month', created_at) as month,
       count(distinct session_id) as sessions
from events
where created_at >= date '2023-01-01'
  and created_at <  date '2024-01-01'
group by 1
order by 1`,
  report: {
    confidence: "unverified",
    checks: [
      {
        id: "cross_derivation",
        label: "Computed a second way",
        status: "skipped",
        finding: "",
        skip_reason:
          "No second derivation path exists — session counts are only recorded in one place.",
      },
      {
        id: "join_loss",
        label: "No rows silently dropped",
        status: "pass",
        finding: "No joins were used; all 2,431,963 events were read.",
      },
      {
        id: "fan_out",
        label: "No rows double-counted",
        status: "pass",
        finding: "Distinct session ids were counted.",
      },
      {
        id: "grain",
        label: "Aggregation is valid at this grain",
        status: "pass",
        finding: "Counting distinct keys at event grain.",
      },
      {
        id: "coverage",
        label: "Data covers the whole question",
        status: "pass",
        finding: "0 events have a null session id.",
      },
      {
        id: "freshness",
        label: "Data is current",
        status: "pass",
        finding: "Source last loaded 2 hours ago.",
      },
      {
        id: "definition_source",
        label: "Uses a ratified definition",
        status: "skipped",
        finding: "",
        skip_reason: 'No ratified definition of "session" exists yet.',
      },
    ],
    passed: 5,
    total: 5,
    headline:
      "Every structural check passed, but nothing here could be independently re-derived.",
  },
  chart: {
    type: "line",
    x: { field: "month", label: "Month", type: "temporal" },
    y: [{ field: "sessions", label: "Sessions", type: "quantitative" }],
    series: null,
    coverage: { included_rows: 2431963, excluded_rows: 0, reason: "" },
    confidence: "unverified",
  },
  narrative:
    "Sessions grew from 186,420 in January to 287,209 in December, a 54% rise across the year. The trend is monotonic after March. This figure has not been independently re-derived — there is only one place session counts are recorded.",
  context: { time_range: { from: "2023-01-01", to: "2023-12-31" }, grain: "month" },
  created_by: "usr_3",
  created_at: days(4),
  source_id: "src_1",
  cost: { llm_calls: 2, usd: 0.05, elapsed_ms: 3900 },
};

/* ---------------------------------------------------------------------------
   6 · Qualified with silent row loss — drives the coverage bar
--------------------------------------------------------------------------- */

const CHANNEL_ROWS: Array<[string, number]> = [
  ["Organic search", 512844],
  ["Email", 331207],
  ["Paid search", 288140],
  ["Social", 106913],
  ["Direct", 67136],
];

export const ANSWER_JOIN_LOSS: Answer = {
  id: "ans_traffic_by_user",
  question: "How many identified visitors came from each channel in 2023?",
  value: 1306240,
  unit: "visitors",
  format_hint: "count",
  columns: [
    { name: "channel", label: "Channel", type: "nominal" },
    { name: "visitors", label: "Visitors", type: "quantitative" },
  ],
  rows: CHANNEL_ROWS.map(([c, v]) => [c, v]),
  row_count: 5,
  scanned_rows: 2431963,
  sql: `select e.traffic_source as channel, count(distinct e.user_id) as visitors
from events e
join users u on u.id = e.user_id
where e.created_at >= date '2023-01-01'
  and e.created_at <  date '2024-01-01'
group by 1
order by 2 desc`,
  report: {
    confidence: "qualified",
    checks: [
      {
        id: "join_loss",
        label: "No rows silently dropped",
        status: "fail",
        finding:
          "46.3% of web events have no linked user and were excluded from this answer.",
        detail: {
          rows_in: 2431963,
          rows_out: 1306240,
          why: "An inner join that drops more than 5% of the driving table is reported before any aggregate is.",
        },
      },
      crossDerivationPass("1,306,240 identified visitors", "-- path a", "-- path b"),
      {
        id: "fan_out",
        label: "No rows double-counted",
        status: "pass",
        finding: "Distinct user ids were counted; the join is N:1.",
      },
      {
        id: "coverage",
        label: "Data covers the whole question",
        status: "warn",
        finding:
          "Anonymous sessions are not represented. Channel mix may differ for logged-out traffic.",
      },
      {
        id: "freshness",
        label: "Data is current",
        status: "pass",
        finding: "Source last loaded 2 hours ago.",
      },
      {
        id: "grain",
        label: "Aggregation is valid at this grain",
        status: "pass",
        finding: "Counting distinct keys at user grain.",
      },
    ],
    passed: 4,
    total: 6,
    headline:
      "46.3% of web events have no linked user and were excluded from this answer.",
  },
  chart: {
    type: "bar",
    x: { field: "channel", label: "Channel", type: "nominal" },
    y: [{ field: "visitors", label: "Visitors", type: "quantitative" }],
    series: null,
    coverage: {
      included_rows: 1306240,
      excluded_rows: 1125723,
      reason: "rows with no linked user",
    },
    confidence: "qualified",
  },
  narrative:
    "Organic search brought 512,844 identified visitors in 2023, 55% more than Email at 331,207. Nearly half of all web events could not be attributed to a user and are absent from this split — the true channel mix may differ.",
  context: { time_range: { from: "2023-01-01", to: "2023-12-31" }, grain: "year" },
  created_by: "usr_2",
  created_at: days(6),
  source_id: "src_1",
  cost: { llm_calls: 3, usd: 0.08, elapsed_ms: 9200 },
};

/* ---------------------------------------------------------------------------
   7 · Superseded — a definition it relied on has changed
--------------------------------------------------------------------------- */

export const ANSWER_SUPERSEDED: Answer = {
  id: "ans_new_customers",
  question: "How many new customers did we get in March 2023?",
  value: 2335,
  unit: "customers",
  format_hint: "count",
  columns: [
    { name: "week", label: "Week", type: "temporal" },
    { name: "customers", label: "New customers", type: "quantitative" },
  ],
  rows: [
    ["2023-03-06", 512],
    ["2023-03-13", 604],
    ["2023-03-20", 588],
    ["2023-03-27", 631],
  ],
  row_count: 4,
  sql: `select date_trunc('week', first_order_at) as week, count(*) as customers
from (
  select user_id, min(created_at) as first_order_at
  from orders group by 1
) f
where first_order_at >= date '2023-03-01'
  and first_order_at <  date '2023-04-01'
group by 1 order by 1`,
  report: {
    confidence: "qualified",
    checks: [
      {
        id: "definition_source",
        label: "Uses a ratified definition",
        status: "warn",
        finding:
          'Answered under New customers v1 (first order date). That definition has since been replaced.',
      },
      crossDerivationPass("2,335 customers", "-- path a", "-- path b"),
      {
        id: "join_loss",
        label: "No rows silently dropped",
        status: "pass",
        finding: "All 2,335 first orders were included.",
      },
      {
        id: "fan_out",
        label: "No rows double-counted",
        status: "pass",
        finding: "One row per customer after the first-order collapse.",
      },
      {
        id: "grain",
        label: "Aggregation is valid at this grain",
        status: "pass",
        finding: "Counting distinct customers at customer grain.",
      },
      {
        id: "freshness",
        label: "Data is current",
        status: "pass",
        finding: "Source last loaded 2 hours ago.",
      },
    ],
    passed: 5,
    total: 6,
    headline: 'Answered under "New customers v1", which has since changed.',
  },
  chart: {
    type: "bar",
    x: { field: "week", label: "Week", type: "temporal" },
    y: [{ field: "customers", label: "New customers", type: "quantitative" }],
    series: null,
    coverage: { included_rows: 2335, excluded_rows: 0, reason: "" },
    confidence: "qualified",
  },
  narrative:
    "March 2023 added 2,335 new customers under the first-order-date reading, rising steadily week over week. This answer predates the current definition and should be re-run before it is quoted.",
  context: { time_range: { from: "2023-03-01", to: "2023-03-31" }, grain: "week" },
  definition_used: { id: "def_new_customers", name: "New customers", version: 1 },
  created_by: "usr_2",
  created_at: days(52),
  source_id: "src_1",
  cost: { llm_calls: 2, usd: 0.06, elapsed_ms: 4400 },
  supersession: {
    definition_id: "def_new_customers",
    definition_name: "New customers",
    from_version: 1,
    to_version: 2,
    changed_at: days(9),
  },
};

/* ---------------------------------------------------------------------------
   8 · Verified rate — used by dashboards & watches
--------------------------------------------------------------------------- */

export const ANSWER_REPEAT_RATE: Answer = {
  id: "ans_repeat_rate",
  question: "What is our repeat purchase rate?",
  value: 30.2,
  unit: "percent",
  format_hint: "percent",
  columns: [
    { name: "month", label: "Month", type: "temporal" },
    { name: "rate", label: "Repeat rate", type: "quantitative" },
  ],
  rows: [
    ["2023-07", 27.4], ["2023-08", 28.1], ["2023-09", 28.6], ["2023-10", 29.0],
    ["2023-11", 29.4], ["2023-12", 30.9], ["2024-01", 30.2],
  ],
  row_count: 7,
  sql: `select date_trunc('month', o.created_at) as month,
       count(distinct case when prior.n > 0 then o.user_id end)::float
         / nullif(count(distinct o.user_id), 0) * 100 as rate
from orders o
join lateral (
  select count(*) n from orders p
  where p.user_id = o.user_id and p.created_at < o.created_at
) prior on true
group by 1 order by 1`,
  report: {
    confidence: "verified",
    checks: [
      crossDerivationPass("30.2%", "-- path a", "-- path b"),
      { id: "grain", label: "Aggregation is valid at this grain", status: "pass", finding: "Rate computed from raw counts, not by averaging monthly rates." },
      { id: "join_loss", label: "No rows silently dropped", status: "pass", finding: "All 125,226 orders were included." },
      { id: "fan_out", label: "No rows double-counted", status: "pass", finding: "Each order contributes once." },
      { id: "coverage", label: "Data covers the whole question", status: "pass", finding: "0 orders have a null customer." },
      { id: "freshness", label: "Data is current", status: "pass", finding: "Source last loaded 2 hours ago." },
      { id: "precedent", label: "Consistent with what we said before", status: "pass", finding: "Matches the answer given on 11 Mar (30.2%)." },
    ],
    passed: 7,
    total: 7,
    headline: "Independently re-derived and structurally checked.",
  },
  chart: {
    type: "line",
    x: { field: "month", label: "Month", type: "temporal" },
    y: [{ field: "rate", label: "Repeat rate", type: "quantitative" }],
    series: null,
    coverage: { included_rows: 125226, excluded_rows: 0, reason: "" },
    confidence: "verified",
  },
  narrative:
    "The repeat purchase rate is 30.2%, up 2.8 points from 27.4% seven months ago. The rate was computed from raw customer counts rather than by averaging monthly rates, which would have overstated it at 31.1%.",
  context: { grain: "month", definition_id: "def_repeat_rate" },
  definition_used: { id: "def_repeat_rate", name: "Repeat purchase rate", version: 2 },
  created_by: "usr_3",
  created_at: days(1),
  source_id: "src_1",
  cost: { llm_calls: 2, usd: 0.05, elapsed_ms: 4100 },
};

/* ---------------------------------------------------------------------------
   Registry
--------------------------------------------------------------------------- */

export const ANSWERS: Answer[] = [
  ANSWER_FEB,
  ANSWER_REFUSED,
  ANSWER_CONTESTED,
  ANSWER_VERIFIED,
  ANSWER_UNVERIFIED,
  ANSWER_JOIN_LOSS,
  ANSWER_SUPERSEDED,
  ANSWER_REPEAT_RATE,
];

export const ANSWER_BY_ID: Record<string, Answer> = Object.fromEntries(
  ANSWERS.map((a) => [a.id, a]),
);

function summarize(a: Answer, extra: Partial<AnswerSummary> = {}): AnswerSummary {
  return {
    id: a.id,
    question: a.question,
    value: a.value,
    unit: a.unit,
    format_hint: a.format_hint,
    confidence: a.report?.confidence ?? "refused",
    passed: a.report?.passed ?? 0,
    total: a.report?.total ?? 0,
    created_by: a.created_by,
    created_at: a.created_at,
    definition_used: a.definition_used,
    superseded: Boolean(a.supersession),
    ...extra,
  };
}

/** Extra ledger rows so the surface reads like a real record, not a demo. */
const EXTRA_ROWS: AnswerSummary[] = [
  {
    id: "ans_aov_q4", question: "What was average order value in Q4 2023?",
    value: 61.44, unit: "currency", format_hint: "currency",
    confidence: "verified", passed: 7, total: 7,
    created_by: "usr_2", created_at: days(7),
    definition_used: { id: "def_aov", name: "Average order value", version: 1 },
  },
  {
    id: "ans_return_rate", question: "What is the return rate by category?",
    value: 10.4, unit: "percent", format_hint: "percent",
    confidence: "qualified", passed: 5, total: 6,
    created_by: "usr_4", created_at: days(8),
  },
  {
    id: "ans_dc_throughput", question: "Which distribution centre ships the most units?",
    value: 41208, unit: "units", format_hint: "count",
    confidence: "verified", passed: 6, total: 6,
    created_by: "usr_3", created_at: days(9),
  },
  {
    id: "ans_margin_top", question: "Top products by margin",
    value: null, unit: "currency", format_hint: "currency",
    confidence: "refused", passed: 3, total: 5,
    created_by: "usr_1", created_at: days(10),
  },
  {
    id: "ans_cohort_retention", question: "How does month-3 retention differ by acquisition channel?",
    value: 18.7, unit: "percent", format_hint: "percent",
    confidence: "unverified", passed: 4, total: 4,
    created_by: "usr_2", created_at: days(11),
  },
  {
    id: "ans_inventory_days", question: "How many days of inventory do we hold on average?",
    value: 46, unit: "days", format_hint: "count",
    confidence: "qualified", passed: 5, total: 6,
    created_by: "usr_3", created_at: days(12),
  },
  {
    id: "ans_revenue_jan", question: "What was revenue in January 2023?",
    value: 214825, unit: "currency", format_hint: "currency",
    confidence: "verified", passed: 7, total: 7,
    created_by: "usr_1", created_at: days(13),
    definition_used: { id: "def_revenue", name: "Revenue", version: 3 },
    fingerprint: "fp_revenue_month",
  },
  {
    id: "ans_discount_impact", question: "Did the March promotion increase revenue?",
    value: null, unit: "currency", format_hint: "currency",
    confidence: "contested", passed: 4, total: 6,
    created_by: "usr_2", created_at: days(14), diverged: true, run_count: 2,
  },
  {
    id: "ans_users_total", question: "How many customers do we have?",
    value: 100000, unit: "customers", format_hint: "count",
    confidence: "verified", passed: 6, total: 6,
    created_by: "usr_5", created_at: days(15),
  },
  {
    id: "ans_gender_split", question: "What is the revenue split by customer gender?",
    value: 51.3, unit: "percent", format_hint: "percent",
    confidence: "qualified", passed: 5, total: 6,
    created_by: "usr_4", created_at: days(16),
  },
  {
    id: "ans_ship_time", question: "What is our median time from order to ship?",
    value: 2.4, unit: "days", format_hint: "number",
    confidence: "verified", passed: 6, total: 6,
    created_by: "usr_3", created_at: days(17),
  },
  {
    id: "ans_brand_concentration", question: "How concentrated is revenue across brands?",
    value: 34.8, unit: "percent", format_hint: "percent",
    confidence: "unverified", passed: 4, total: 4,
    created_by: "usr_2", created_at: days(18),
  },
  {
    id: "ans_traffic_source_conv", question: "Which traffic source converts best?",
    value: 3.2, unit: "percent", format_hint: "percent",
    confidence: "qualified", passed: 5, total: 7,
    created_by: "usr_1", created_at: days(19),
  },
  {
    id: "ans_seasonality", question: "Which month is our strongest each year?",
    value: 412903, unit: "currency", format_hint: "currency",
    confidence: "verified", passed: 7, total: 7,
    created_by: "usr_2", created_at: days(21),
    definition_used: { id: "def_revenue", name: "Revenue", version: 3 },
  },
  {
    id: "ans_churn_def", question: "What is our churn rate?",
    value: null, unit: "percent", format_hint: "percent",
    confidence: "refused", passed: 2, total: 4,
    created_by: "usr_4", created_at: days(23),
  },
  {
    id: "ans_basket_size", question: "How many items are in a typical order?",
    value: 1.45, unit: "items", format_hint: "number",
    confidence: "verified", passed: 6, total: 6,
    created_by: "usr_5", created_at: days(26),
  },
  {
    id: "ans_first_purchase_lag", question: "How long after signup do customers first buy?",
    value: 11, unit: "days", format_hint: "count",
    confidence: "qualified", passed: 5, total: 6,
    created_by: "usr_3", created_at: days(28),
  },
  {
    id: "ans_revenue_2022", question: "What was revenue in 2022?",
    value: 3104882, unit: "currency", format_hint: "currency",
    confidence: "verified", passed: 7, total: 7,
    created_by: "usr_1", created_at: days(30),
    definition_used: { id: "def_revenue", name: "Revenue", version: 3 },
  },
];

export const LEDGER: AnswerSummary[] = [
  summarize(ANSWER_FEB, {
    fingerprint: "fp_revenue_month",
    run_count: 3,
  }),
  summarize(ANSWER_REPEAT_RATE),
  summarize(ANSWER_REFUSED),
  summarize(ANSWER_CONTESTED, { diverged: true, run_count: 2 }),
  summarize(ANSWER_VERIFIED),
  summarize(ANSWER_UNVERIFIED),
  summarize(ANSWER_JOIN_LOSS),
  summarize(ANSWER_SUPERSEDED, { superseded: true }),
  ...EXTRA_ROWS,
];

export const LEDGER_TOTAL = 1204;

/** Recent activity for the ask surface scrollback and the palette. */
export const RECENT_QUESTIONS = [
  "What was revenue in February 2023?",
  "Which product categories made the most revenue in 2023?",
  "What is our repeat purchase rate?",
  "How many web sessions did we have each month in 2023?",
];

export const NOW_ISO = ago(0);

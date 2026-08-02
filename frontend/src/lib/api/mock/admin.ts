import type { AuditEntry, CheckPolicy, Settings, UsageStats } from "@/lib/api/types";
import { CHECK_IDS } from "@/lib/api/types";
import { days, hours, USERS, WORKSPACE_NAME } from "./base";

/**
 * Fixture support. `check_policy` is the most product-specific admin
 * screen (screens.md §11) — every check gets a plain description, a mode,
 * a threshold where one is meaningful, and a back-test sentence stated in
 * terms of the workspace's own answer history.
 */

const CHECK_POLICY_BY_ID: Record<(typeof CHECK_IDS)[number], CheckPolicy> = {
  cross_derivation: {
    id: "cross_derivation",
    label: "Computed a second way",
    description: "Requires the number to be re-derived through an independent query path before it counts as verified.",
    mode: "required",
    threshold: null,
    threshold_unit: null,
    backtest: "This check has failed to find a second path on 41 of your last 200 answers, mostly hand-written SQL and Python cells.",
  },
  join_loss: {
    id: "join_loss",
    label: "No rows silently dropped",
    description: "Flags when a join drops more rows from the driving table than the threshold allows.",
    mode: "required",
    threshold: 5,
    threshold_unit: "%",
    backtest: "At 5%, this would have fired on 12 of your last 200 answers.",
  },
  fan_out: {
    id: "fan_out",
    label: "No rows double-counted",
    description: "Flags when a join multiplies rows beyond the tolerance, which inflates sums and counts.",
    mode: "required",
    threshold: 1,
    threshold_unit: "x",
    backtest: "At 1x tolerance, this would have fired on 4 of your last 200 answers.",
  },
  period_normalization: {
    id: "period_normalization",
    label: "Fair time comparison",
    description: "Warns when a period-over-period comparison spans unequal-length periods, such as a 28-day month against a 31-day month.",
    mode: "advisory",
    threshold: null,
    threshold_unit: null,
    backtest: "This check has fired on 9 of your last 200 answers, all month-over-month comparisons.",
  },
  filter_sensitivity: {
    id: "filter_sensitivity",
    label: "Answer is stable under reasonable variations",
    description: "Fails when a defensible change of filter (such as including or excluding cancelled orders) moves the answer beyond the threshold.",
    mode: "required",
    threshold: 20,
    threshold_unit: "%",
    backtest: "At 20%, this would have fired on 7 of your last 200 answers.",
  },
  definition_source: {
    id: "definition_source",
    label: "Uses a ratified definition",
    description: "Warns when an answer relies on a term that has no ratified definition, or on one that has since been superseded.",
    mode: "advisory",
    threshold: null,
    threshold_unit: null,
    backtest: "This check has fired on 23 of your last 200 answers.",
  },
  grain: {
    id: "grain",
    label: "Aggregation is valid at this grain",
    description: "Fails when a measure is aggregated at a grain that doesn't match how it's defined, such as averaging an already-averaged rate.",
    mode: "required",
    threshold: null,
    threshold_unit: null,
    backtest: "This check has fired on 3 of your last 200 answers.",
  },
  coverage: {
    id: "coverage",
    label: "Data covers the whole question",
    description: "Warns when the null rate on a measure or join key used in the answer exceeds the threshold.",
    mode: "advisory",
    threshold: 2,
    threshold_unit: "%",
    backtest: "At 2%, this would have fired on 15 of your last 200 answers.",
  },
  freshness: {
    id: "freshness",
    label: "Data is current",
    description: "Warns when the source used for an answer was last introspected or loaded longer ago than the threshold.",
    mode: "advisory",
    threshold: 6,
    threshold_unit: "hours",
    backtest: "At 6 hours, this would have fired on 6 of your last 200 answers.",
  },
  precedent: {
    id: "precedent",
    label: "Consistent with what we said before",
    description: "Notes when an answer diverges from an equivalent question asked previously, without blocking it.",
    mode: "off",
    threshold: null,
    threshold_unit: null,
    backtest: "This check is off. It would have fired on 5 of your last 200 answers had it been on.",
  },
};

export const SETTINGS: Settings = {
  workspace_name: WORKSPACE_NAME,
  default_source_id: "src_1",
  timezone: "America/Los_Angeles",
  theme_default: "dark",
  model_provider: "anthropic",
  model: "claude-sonnet-4.5",
  model_speed: "balanced",
  verification_strictness: "standard",
  cost_ceiling_usd: 0.25,
  check_policy: CHECK_IDS.map((id) => CHECK_POLICY_BY_ID[id]),
  pii_masked: true,
};

/* ---------------------------------------------------------------------------
   Audit
--------------------------------------------------------------------------- */

export const AUDIT: AuditEntry[] = [
  { id: "aud_1", principal: "usr_1", source_id: "src_1", source_name: "Commerce warehouse", at: hours(1), row_count: 28, elapsed_ms: 6400, answer_id: "ans_feb_revenue", statement: "select sum(oi.sale_price) as revenue from order_items oi join orders o on o.order_id = oi.order_id where o.created_at >= date '2023-02-01' and o.created_at < date '2023-03-01'" },
  { id: "aud_2", principal: "usr_2", source_id: "src_1", source_name: "Commerce warehouse", at: hours(3), row_count: 8, elapsed_ms: 5100, answer_id: "ans_top_categories", statement: "select p.category, sum(oi.sale_price) as revenue from order_items oi join orders o on o.order_id = oi.order_id join products p on p.id = oi.product_id group by 1 order by 2 desc limit 8" },
  { id: "aud_3", principal: "usr_3", source_id: "src_1", source_name: "Commerce warehouse", at: hours(5), row_count: 7, elapsed_ms: 4100, answer_id: "ans_repeat_rate", statement: "select date_trunc('month', o.created_at) as month, count(distinct case when prior.n > 0 then o.user_id end) / nullif(count(distinct o.user_id), 0) * 100 as rate from orders o group by 1" },
  { id: "aud_4", principal: "usr_1", source_id: "src_1", source_name: "Commerce warehouse", at: hours(6), row_count: 0, elapsed_ms: 8100, answer_id: "ans_2023_revenue", statement: "select sum(oi.sale_price) from order_items oi join orders o on o.order_id = oi.order_id where o.created_at >= date '2023-01-01' and o.created_at < date '2024-01-01'" },
  { id: "aud_5", principal: "usr_4", source_id: "src_1", source_name: "Commerce warehouse", at: hours(9), row_count: 5, elapsed_ms: 3200, answer_id: null, statement: "select p.category, count(*) from products p where p.retail_price > 100 group by 1" },
  { id: "aud_6", principal: "usr_2", source_id: "src_2", source_name: "Marketing replica", at: hours(12), row_count: 312, elapsed_ms: 2100, answer_id: null, statement: "select channel, count(*) from campaigns group by 1" },
  { id: "aud_7", principal: "usr_5", source_id: "src_1", source_name: "Commerce warehouse", at: hours(15), row_count: 1, elapsed_ms: 1900, answer_id: "ans_users_total", statement: "select count(*) from users" },
  { id: "aud_8", principal: "usr_3", source_id: "src_1", source_name: "Commerce warehouse", at: hours(20), row_count: 4, elapsed_ms: 4400, answer_id: "ans_new_customers", statement: "select date_trunc('week', first_order_at) as week, count(*) from (select user_id, min(created_at) as first_order_at from orders group by 1) f group by 1" },
  { id: "aud_9", principal: "usr_1", source_id: "src_1", source_name: "Commerce warehouse", at: days(1), row_count: 12, elapsed_ms: 3900, answer_id: "ans_web_sessions", statement: "select date_trunc('month', created_at) as month, count(distinct session_id) as sessions from events group by 1 order by 1" },
  { id: "aud_10", principal: "usr_2", source_id: "src_1", source_name: "Commerce warehouse", at: days(1), row_count: 5, elapsed_ms: 9200, answer_id: "ans_traffic_by_user", statement: "select e.traffic_source, count(distinct e.user_id) from events e join users u on u.id = e.user_id group by 1 order by 2 desc" },
  { id: "aud_11", principal: "usr_4", source_id: "src_2", source_name: "Marketing replica", at: days(2), row_count: 18420, elapsed_ms: 2600, answer_id: null, statement: "select date, sum(spend_usd) from ad_spend group by 1 order by 1" },
  { id: "aud_12", principal: "usr_3", source_id: "src_1", source_name: "Commerce warehouse", at: days(2), row_count: 8431, elapsed_ms: 340, answer_id: null, statement: "select p.category, sum(oi.sale_price) from order_items oi join orders o on o.order_id = oi.order_id join products p on p.id = oi.product_id where o.created_at >= date '2023-02-01' group by 1" },
  { id: "aud_13", principal: "usr_1", source_id: "src_1", source_name: "Commerce warehouse", at: days(3), row_count: 5, elapsed_ms: 3800, answer_id: null, statement: "select traffic_source, avg(order_value) from order_summary_view group by 1" },
  { id: "aud_14", principal: "usr_5", source_id: "src_1", source_name: "Commerce warehouse", at: days(4), row_count: 10, elapsed_ms: 2200, answer_id: null, statement: "select distribution_center_id, count(*) from inventory_items where sold_at is null group by 1" },
  { id: "aud_15", principal: "usr_2", source_id: "src_1", source_name: "Commerce warehouse", at: days(5), row_count: 0, elapsed_ms: 7300, answer_id: "ans_shipped_q2", statement: "select count(distinct o.order_id) from orders o where o.status = 'Shipped' and o.shipped_at >= date '2023-04-01' and o.shipped_at < date '2023-07-01'" },
  { id: "aud_16", principal: "usr_3", source_id: "src_2", source_name: "Marketing replica", at: days(6), row_count: 641200, elapsed_ms: 5100, answer_id: null, statement: "select campaign_id, count(*) filter (where opened) from email_sends group by 1" },
  { id: "aud_17", principal: "usr_1", source_id: "src_1", source_name: "Commerce warehouse", at: days(7), row_count: 1, elapsed_ms: 1400, answer_id: "ans_aov_q4", statement: "select avg(oi.sale_price * o.num_of_item) from order_items oi join orders o on o.order_id = oi.order_id where o.created_at >= date '2023-10-01' and o.created_at < date '2024-01-01'" },
  { id: "aud_18", principal: "usr_4", source_id: "src_1", source_name: "Commerce warehouse", at: days(8), row_count: 6, elapsed_ms: 2900, answer_id: "ans_return_rate", statement: "select p.category, count(*) filter (where oi.returned_at is not null)::float / count(*) * 100 from order_items oi join products p on p.id = oi.product_id group by 1" },
];

/* ---------------------------------------------------------------------------
   Usage
--------------------------------------------------------------------------- */

export const USAGE: UsageStats = {
  questions_asked: 931,
  answers_verified: 611,
  fork_rate_pct: 5.8,
  coverage_pct: 71.4,
  per_person: USERS.map((u) => ({
    user_id: u.id,
    name: u.name,
    initials: u.initials,
    questions: u.answers_asked,
    ratified: u.can_ratify
      ? Math.round(u.answers_asked * (u.role === "admin" ? 0.68 : 0.44))
      : 0,
  })),
  history: [
    { period: "2023-01", questions: 58, coverage_pct: 52.1 },
    { period: "2023-02", questions: 61, coverage_pct: 54.0 },
    { period: "2023-03", questions: 67, coverage_pct: 55.8 },
    { period: "2023-04", questions: 70, coverage_pct: 58.2 },
    { period: "2023-05", questions: 74, coverage_pct: 59.9 },
    { period: "2023-06", questions: 79, coverage_pct: 61.4 },
    { period: "2023-07", questions: 81, coverage_pct: 63.0 },
    { period: "2023-08", questions: 85, coverage_pct: 64.7 },
    { period: "2023-09", questions: 88, coverage_pct: 66.3 },
    { period: "2023-10", questions: 92, coverage_pct: 68.1 },
    { period: "2023-11", questions: 96, coverage_pct: 69.8 },
    { period: "2023-12", questions: 100, coverage_pct: 71.4 },
  ],
};

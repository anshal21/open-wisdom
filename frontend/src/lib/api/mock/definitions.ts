import type {
  Definition,
  DefinitionCoverage,
  DefinitionProposal,
} from "@/lib/api/types";
import { days, hours } from "./base";

/* ---------------------------------------------------------------------------
   The earned semantic layer. Every ratified definition here was born from a
   resolved ambiguity — `earned: true` — or imported.
--------------------------------------------------------------------------- */

export const DEFINITIONS: Definition[] = [
  {
    id: "def_revenue",
    name: "Revenue",
    plain_english:
      "Total sale price of order items, excluding cancelled and returned orders.",
    expression:
      "sum(order_items.sale_price)\nwhere orders.status not in ('Cancelled', 'Returned')",
    version: 3,
    status: "ratified",
    ratified_by: "usr_2",
    ratified_at: days(145),
    source_answer_id: "ans_2023_revenue",
    usage_count: 412,
    confidence: "verified",
    earned: true,
    precedence: "official",
    scope: "workspace",
    updated_at: days(145),
    versions: [
      {
        version: 3,
        expression:
          "sum(order_items.sale_price)\nwhere orders.status not in ('Cancelled', 'Returned')",
        plain_english:
          "Total sale price of order items, excluding cancelled and returned orders.",
        ratified_by: "usr_2",
        ratified_at: days(145),
        summary: "Now excludes Returned orders. Affected 47 recorded answers.",
      },
      {
        version: 2,
        expression:
          "sum(order_items.sale_price)\nwhere orders.status not in ('Cancelled')",
        plain_english: "Total sale price of order items, excluding cancelled orders.",
        ratified_by: "usr_1",
        ratified_at: days(240),
        summary: "Added the cancelled-order exclusion.",
      },
      {
        version: 1,
        expression: "sum(order_items.sale_price)",
        plain_english: "Total sale price of all order items.",
        ratified_by: "usr_1",
        ratified_at: days(320),
        summary: "First reading, taken from the question that forked.",
      },
    ],
  },
  {
    id: "def_new_customers",
    name: "New customers",
    plain_english:
      "Customers whose first ever order falls inside the period. Signups without an order do not count.",
    expression:
      "count(distinct user_id)\nwhere min(orders.created_at) between :from and :to",
    version: 2,
    status: "ratified",
    ratified_by: "usr_2",
    ratified_at: days(9),
    source_answer_id: "ans_new_customers",
    usage_count: 88,
    confidence: "qualified",
    earned: true,
    precedence: "preferred",
    scope: "workspace",
    updated_at: days(9),
    conflicts: [
      {
        id: "def_signups",
        name: "Signups",
        reason:
          'Both definitions are used to answer "how many new customers", and they differ by 43%.',
      },
    ],
    versions: [
      {
        version: 2,
        expression:
          "count(distinct user_id)\nwhere min(orders.created_at) between :from and :to",
        plain_english:
          "Customers whose first ever order falls inside the period. Signups without an order do not count.",
        ratified_by: "usr_2",
        ratified_at: days(9),
        summary:
          "Switched from signup date to first-order date. Affects 23 recorded answers.",
      },
      {
        version: 1,
        expression: "count(distinct users.id)\nwhere users.created_at between :from and :to",
        plain_english: "Accounts created inside the period.",
        ratified_by: "usr_1",
        ratified_at: days(210),
        summary: "First reading.",
      },
    ],
  },
  {
    id: "def_repeat_rate",
    name: "Repeat purchase rate",
    plain_english:
      "Share of customers ordering in the period who had ordered at least once before it.",
    expression:
      "count(distinct returning_user_id) / count(distinct user_id)",
    version: 2,
    status: "ratified",
    ratified_by: "usr_3",
    ratified_at: days(31),
    source_answer_id: "ans_repeat_rate",
    usage_count: 64,
    confidence: "verified",
    earned: true,
    precedence: "official",
    scope: "workspace",
    updated_at: days(31),
  },
  {
    id: "def_aov",
    name: "Average order value",
    plain_english:
      "Revenue divided by the number of orders that produced it, at order grain.",
    expression: "sum(order_items.sale_price) / count(distinct orders.order_id)",
    version: 1,
    status: "ratified",
    ratified_by: "usr_2",
    ratified_at: days(60),
    source_answer_id: "ans_aov_q4",
    usage_count: 51,
    confidence: "verified",
    earned: false,
    precedence: "official",
    scope: "workspace",
    updated_at: days(60),
  },
  {
    id: "def_signups",
    name: "Signups",
    plain_english: "Accounts created inside the period, whether or not they ordered.",
    expression: "count(distinct users.id) where users.created_at between :from and :to",
    version: 1,
    status: "ratified",
    ratified_by: "usr_1",
    ratified_at: days(74),
    source_answer_id: "",
    usage_count: 37,
    confidence: "contested",
    earned: false,
    precedence: "preferred",
    scope: "workspace",
    updated_at: days(74),
    conflicts: [
      {
        id: "def_new_customers",
        name: "New customers",
        reason: 'Both are used to answer "how many new customers".',
      },
    ],
  },
  {
    id: "def_gross_margin",
    name: "Gross margin",
    plain_english:
      "Revenue minus the cost of the items sold, as a share of revenue.",
    expression:
      "(sum(order_items.sale_price) - sum(products.cost)) / sum(order_items.sale_price)",
    version: 1,
    status: "ratified",
    ratified_by: "usr_3",
    ratified_at: days(88),
    source_answer_id: "",
    usage_count: 29,
    confidence: "verified",
    earned: false,
    precedence: "official",
    scope: "workspace",
    updated_at: days(88),
  },
  {
    id: "def_active_customer",
    name: "Active customer",
    plain_english: "",
    expression: "count(distinct user_id) where orders.created_at > now() - 90 days",
    version: 1,
    status: "proposed",
    ratified_by: "",
    ratified_at: null,
    source_answer_id: "ans_churn_def",
    usage_count: 12,
    confidence: "unverified",
    earned: true,
    updated_at: days(3),
  },
  {
    id: "def_session",
    name: "Session",
    plain_english: "",
    expression: "count(distinct events.session_id)",
    version: 1,
    status: "proposed",
    ratified_by: "",
    ratified_at: null,
    source_answer_id: "ans_web_sessions",
    usage_count: 9,
    confidence: "unverified",
    earned: true,
    updated_at: days(4),
  },
  {
    id: "def_return_rate",
    name: "Return rate",
    plain_english: "",
    expression: "count(returned_orders) / count(orders)",
    version: 1,
    status: "proposed",
    ratified_by: "",
    ratified_at: null,
    source_answer_id: "ans_return_rate",
    usage_count: 6,
    confidence: "unverified",
    earned: true,
    updated_at: days(6),
  },
  {
    id: "def_shipped_order",
    name: "Shipped order",
    plain_english: "",
    expression: "count(distinct orders.order_id) where status = 'Shipped'",
    version: 1,
    status: "proposed",
    ratified_by: "",
    ratified_at: null,
    source_answer_id: "ans_shipped_q2",
    usage_count: 4,
    confidence: "contested",
    earned: true,
    updated_at: days(2),
  },
  {
    id: "def_channel",
    name: "Channel",
    plain_english: "",
    expression: "events.traffic_source",
    version: 1,
    status: "proposed",
    ratified_by: "",
    ratified_at: null,
    source_answer_id: "ans_traffic_by_user",
    usage_count: 5,
    confidence: "unverified",
    earned: true,
    updated_at: days(6),
  },
  {
    id: "def_inventory_days",
    name: "Days of inventory",
    plain_english: "",
    expression: "avg(datediff(sold_at, created_at))",
    version: 1,
    status: "proposed",
    ratified_by: "",
    ratified_at: null,
    source_answer_id: "ans_inventory_days",
    usage_count: 3,
    confidence: "unverified",
    earned: true,
    updated_at: days(12),
  },
  {
    id: "def_cohort",
    name: "Cohort",
    plain_english: "",
    expression: "date_trunc('month', min(orders.created_at))",
    version: 1,
    status: "proposed",
    ratified_by: "",
    ratified_at: null,
    source_answer_id: "ans_cohort_retention",
    usage_count: 3,
    confidence: "unverified",
    earned: true,
    updated_at: days(11),
  },
  {
    id: "def_revenue_v2",
    name: "Revenue (net of discounts)",
    plain_english:
      "Sale price less promotional discounts, excluding cancelled and returned orders.",
    expression:
      "sum(order_items.sale_price - order_items.discount)\nwhere orders.status not in ('Cancelled', 'Returned')",
    version: 1,
    status: "ratified",
    ratified_by: "usr_1",
    ratified_at: days(20),
    source_answer_id: "",
    usage_count: 14,
    confidence: "contested",
    earned: false,
    precedence: "preferred",
    scope: "workspace",
    updated_at: days(20),
    conflicts: [
      {
        id: "def_revenue",
        name: "Revenue",
        reason: 'Both are official readings of the word "revenue" in this workspace.',
      },
    ],
  },
];

export const DEFINITION_BY_ID: Record<string, Definition> = Object.fromEntries(
  DEFINITIONS.map((d) => [d.id, d]),
);

/* ---------------------------------------------------------------------------
   The proposal queue — the heart of the wedge.
--------------------------------------------------------------------------- */

export const PROPOSALS: DefinitionProposal[] = [
  {
    id: "prop_new_customers",
    term: "New customers",
    proposed_at: days(3),
    asked_count: 6,
    answered_ways: 3,
    evidence:
      "This ambiguity was detected by the filter-sensitivity check on 4 questions. It has never been ratified.",
    readings: [
      {
        id: "read_signups",
        label: "Signups",
        expression: "count(distinct users.id) where users.created_at in period",
        value: 1632,
        unit: "customers",
        format_hint: "count",
        period_label: "Mar 2023",
        used_count: 4,
      },
      {
        id: "read_first_buyers",
        label: "First-time buyers",
        expression: "count(distinct user_id) where min(orders.created_at) in period",
        value: 2335,
        unit: "customers",
        format_hint: "count",
        period_label: "Mar 2023",
        used_count: 2,
      },
    ],
    spread_label: "43% apart",
  },
  {
    id: "prop_active_customer",
    term: "Active customer",
    proposed_at: days(5),
    asked_count: 9,
    answered_ways: 2,
    evidence:
      "The definition-source check found no ratified reading on 9 questions; the window was inferred from column names each time.",
    readings: [
      {
        id: "read_90d",
        label: "Ordered in the last 90 days",
        expression: "count(distinct user_id) where orders.created_at > now() - 90 days",
        value: 18406,
        unit: "customers",
        format_hint: "count",
        period_label: "Today",
        used_count: 6,
      },
      {
        id: "read_365d",
        label: "Ordered in the last 12 months",
        expression: "count(distinct user_id) where orders.created_at > now() - 365 days",
        value: 41288,
        unit: "customers",
        format_hint: "count",
        period_label: "Today",
        used_count: 3,
      },
    ],
    spread_label: "2.2× apart",
  },
  {
    id: "prop_return_rate",
    term: "Return rate",
    proposed_at: days(6),
    asked_count: 4,
    answered_ways: 2,
    evidence:
      "The grain check fired twice: one reading averages an already-averaged rate, the other weights by order count.",
    readings: [
      {
        id: "read_by_order",
        label: "Share of orders returned",
        expression: "count(returned_orders) / count(orders)",
        value: 10.4,
        unit: "percent",
        format_hint: "percent",
        period_label: "2023",
        used_count: 3,
      },
      {
        id: "read_by_item",
        label: "Share of items returned",
        expression: "count(returned_items) / count(order_items)",
        value: 8.6,
        unit: "percent",
        format_hint: "percent",
        period_label: "2023",
        used_count: 1,
      },
    ],
    spread_label: "21% apart",
  },
];

/* ---------------------------------------------------------------------------
   Coverage — the adoption story
--------------------------------------------------------------------------- */

export const COVERAGE: DefinitionCoverage = {
  period: "2026-07",
  answered_from_ratified: 68,
  total: 100,
  pct: 68,
  previous_pct: 41,
  ratified: 34,
  proposed: 7,
  contested: 2,
  clarification_rate_pct: 14,
  clarification_target_pct: 20,
  history: [
    { period: "W-11", pct: 22 },
    { period: "W-10", pct: 27 },
    { period: "W-9", pct: 34 },
    { period: "W-8", pct: 36 },
    { period: "W-7", pct: 41 },
    { period: "W-6", pct: 44 },
    { period: "W-5", pct: 49 },
    { period: "W-4", pct: 52 },
    { period: "W-3", pct: 58 },
    { period: "W-2", pct: 61 },
    { period: "W-1", pct: 65 },
    { period: "W-0", pct: 68 },
  ],
};

/** Impact previews, keyed by definition id. The mandatory ratify-sheet block. */
export const IMPACT: Record<string, { affected_answers: number; would_change: boolean }> = {
  def_revenue: { affected_answers: 47, would_change: true },
  def_new_customers: { affected_answers: 23, would_change: true },
  def_repeat_rate: { affected_answers: 11, would_change: false },
  def_aov: { affected_answers: 8, would_change: false },
  def_signups: { affected_answers: 19, would_change: true },
};

export const DEFAULT_IMPACT = { affected_answers: 0, would_change: false };

export const LAST_RATIFIED_AT = hours(30);

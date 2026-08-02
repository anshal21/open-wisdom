import type { Watch, WatchEvent } from "@/lib/api/types";
import { days, hours } from "./base";

/**
 * Fixture support. `wat_1` is the detail-screen hero (screens.md §9.2): a
 * firing watch that was held before notifying anyone, because the checks
 * caught an incomplete period. The 90-point history is generated with a
 * seeded PRNG (not Math.random) so the band and the breach are stable
 * across reloads.
 */

/* ---------------------------------------------------------------------------
   Seeded PRNG — deterministic, no Math.random, no new Date().
--------------------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRevenueHistory(): Array<{ t: string; value: number; incomplete?: boolean }> {
  const rand = mulberry32(20230601);
  const points: Array<{ t: string; value: number; incomplete?: boolean }> = [];
  for (let i = 0; i < 90; i++) {
    const daysAgo = 89 - i;
    const weekPhase = (i % 7) / 7;
    const seasonal = 850 * Math.sin(weekPhase * 2 * Math.PI);
    const trend = i * 3.5;
    const noise = (rand() - 0.5) * 700;
    const value = Math.round(7550 + seasonal + trend + noise);
    points.push({ t: days(daysAgo), value });
  }
  // Final 3 points: today's incomplete read and the two prior days still
  // reconciling behind it, breaching low.
  points[87] = { t: days(2), value: 6180, incomplete: true };
  points[88] = { t: days(1), value: 5240, incomplete: true };
  points[89] = { t: days(0), value: 4120, incomplete: true };
  return points;
}

const REVENUE_HISTORY = buildRevenueHistory();

/* ---------------------------------------------------------------------------
   wat_1 — Revenue, firing (the detail-screen hero)
--------------------------------------------------------------------------- */

export const WAT_1: Watch = {
  id: "wat_1",
  name: "Revenue — daily",
  definition_id: "def_revenue",
  definition_name: "Revenue",
  schedule: "daily at 09:00",
  grain: "day",
  condition: { kind: "outside_normal_range", value: 1.5, direction: "either" },
  status: "firing",
  last_fired_at: hours(2),
  recipients: ["dana@example.com", "priya@example.com"],
  unit: "currency",
  format_hint: "currency",
  pre_alert_checks: [
    {
      id: "freshness",
      label: "Data is fresh",
      status: "pass",
      finding: "Source loaded 40 minutes ago.",
    },
    {
      id: "coverage",
      label: "Row counts normal",
      status: "pass",
      finding: "12,404 rows today, within the normal range of 11.8k-13.1k.",
    },
    {
      id: "period_normalization",
      label: "Period is incomplete",
      status: "warn",
      finding: "Today is 62% elapsed.",
    },
    {
      id: "definition_source",
      label: "Definition unchanged",
      status: "pass",
      finding: "Revenue v3, unchanged since 4 Mar.",
    },
  ],
  held_reason: "today is 62% elapsed",
  held_hours: 4,
  current_value: 4120,
  normal_range: [6240, 8900],
  history: REVENUE_HISTORY,
  backtest_fire_count: 3,
};

/* ---------------------------------------------------------------------------
   wat_2 — Repeat purchase rate, watching
--------------------------------------------------------------------------- */

export const WAT_2: Watch = {
  id: "wat_2",
  name: "Repeat purchase rate — weekly",
  definition_id: "def_repeat_rate",
  definition_name: "Repeat purchase rate",
  schedule: "weekly, Monday 08:00",
  grain: "week",
  condition: { kind: "change_pct", value: 10, direction: "below" },
  status: "watching",
  last_fired_at: null,
  recipients: ["rohan@example.com"],
  unit: "percent",
  format_hint: "percent",
  current_value: 30.2,
  normal_range: [27.0, 31.5],
  backtest_fire_count: 0,
};

/* ---------------------------------------------------------------------------
   wat_3 — New customers, paused
--------------------------------------------------------------------------- */

export const WAT_3: Watch = {
  id: "wat_3",
  name: "New customers — weekly",
  definition_id: "def_new_customers",
  definition_name: "New customers",
  schedule: "weekly, Monday 08:00",
  grain: "week",
  condition: { kind: "threshold", value: 400, direction: "below" },
  status: "paused",
  last_fired_at: days(19),
  recipients: ["priya@example.com", "maya@example.com"],
  unit: "customers",
  format_hint: "count",
  backtest_fire_count: 5,
};

/* ---------------------------------------------------------------------------
   wat_4 — Average order value, resolved
--------------------------------------------------------------------------- */

export const WAT_4: Watch = {
  id: "wat_4",
  name: "Average order value — daily",
  definition_id: "def_aov",
  definition_name: "Average order value",
  schedule: "daily at 09:00",
  grain: "day",
  condition: { kind: "outside_normal_range", value: 1.5, direction: "either" },
  status: "resolved",
  last_fired_at: days(4),
  recipients: ["dana@example.com", "rohan@example.com"],
  unit: "currency",
  format_hint: "currency",
  current_value: 63.9,
  normal_range: [58.0, 68.5],
  backtest_fire_count: 2,
};

/* ---------------------------------------------------------------------------
   wat_5 — Return rate, watching
--------------------------------------------------------------------------- */

export const WAT_5: Watch = {
  id: "wat_5",
  name: "Return rate — weekly",
  definition_id: "def_return_rate",
  definition_name: "Return rate",
  schedule: "weekly, Friday 17:00",
  grain: "week",
  condition: { kind: "change_pct", value: 15, direction: "above" },
  status: "watching",
  last_fired_at: null,
  recipients: ["tom@example.com"],
  unit: "percent",
  format_hint: "percent",
  current_value: 10.4,
  normal_range: [8.6, 11.8],
  backtest_fire_count: 1,
};

/* ---------------------------------------------------------------------------
   wat_6 — Web sessions, resolved
--------------------------------------------------------------------------- */

export const WAT_6: Watch = {
  id: "wat_6",
  name: "Web sessions — daily",
  definition_id: "def_web_sessions",
  definition_name: "Web sessions",
  schedule: "daily at 09:00",
  grain: "day",
  condition: { kind: "outside_normal_range", value: 2, direction: "below" },
  status: "resolved",
  last_fired_at: days(11),
  recipients: ["dana@example.com"],
  unit: "sessions",
  format_hint: "count",
  current_value: 8920,
  normal_range: [7100, 9600],
  backtest_fire_count: 4,
};

export const WATCHES: Watch[] = [WAT_1, WAT_2, WAT_3, WAT_4, WAT_5, WAT_6];

/* ---------------------------------------------------------------------------
   Events
--------------------------------------------------------------------------- */

export const WATCH_EVENTS: Record<string, WatchEvent[]> = {
  wat_1: [
    { id: "we_1_1", fired_at: hours(2), value: 4120, previous: 7480, investigation_id: null },
    { id: "we_1_2", fired_at: days(34), value: 5910, previous: 7620, investigation_id: "inv_1" },
  ],
  wat_2: [],
  wat_3: [
    { id: "we_3_1", fired_at: days(19), value: 372, previous: 588, investigation_id: null },
  ],
  wat_4: [
    { id: "we_4_1", fired_at: days(4), value: 63.9, previous: 55.1, investigation_id: null },
  ],
  wat_5: [],
  wat_6: [
    { id: "we_6_1", fired_at: days(11), value: 8920, previous: 5340, investigation_id: null },
  ],
};

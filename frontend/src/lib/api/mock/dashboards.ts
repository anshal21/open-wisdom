import type { Dashboard, DashboardSummary } from "@/lib/api/types";
import { days, hours, ago } from "./base";

/**
 * Dashboards are compositions of ratified answers, not standalone charts.
 * Every tile is an answer id — there is deliberately no chart builder.
 */
export const DASHBOARDS: Dashboard[] = [
  {
    id: "dsh_1",
    name: "Q1 business review",
    last_refreshed_at: ago(6),
    tiles: [
      { answer_id: "ans_feb_revenue", position: 0, size: "3x2" },
      { answer_id: "ans_repeat_rate", position: 1, size: "3x2" },
      { answer_id: "ans_top_categories", position: 2, size: "6x2" },
      { answer_id: "ans_web_sessions", position: 3, size: "6x2" },
      { answer_id: "ans_traffic_by_user", position: 4, size: "6x2" },
      { answer_id: "ans_new_customers", position: 5, size: "3x2" },
    ],
  },
  {
    id: "dsh_2",
    name: "Growth weekly",
    last_refreshed_at: hours(19),
    tiles: [
      { answer_id: "ans_repeat_rate", position: 0, size: "3x2" },
      { answer_id: "ans_web_sessions", position: 1, size: "6x2" },
      { answer_id: "ans_new_customers", position: 2, size: "3x2" },
    ],
  },
  {
    id: "dsh_3",
    name: "Operations",
    last_refreshed_at: null,
    tiles: [],
  },
];

export const DASHBOARD_SUMMARIES: DashboardSummary[] = [
  { id: "dsh_1", name: "Q1 business review", tile_count: 6, last_refreshed_at: ago(6) },
  { id: "dsh_2", name: "Growth weekly", tile_count: 3, last_refreshed_at: hours(19) },
  { id: "dsh_3", name: "Operations", tile_count: 0, last_refreshed_at: null },
  { id: "dsh_4", name: "Merchandising", tile_count: 4, last_refreshed_at: days(4) },
];

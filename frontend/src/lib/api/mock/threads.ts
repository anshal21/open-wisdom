import type { Thread, ThreadSummary } from "@/lib/api/types";
import { days, hours, ago } from "./base";

export const THREADS: Thread[] = [
  {
    id: "th_1",
    title: "February revenue",
    turns: [
      { question: "What was revenue in February 2023?", answer_id: "ans_feb_revenue", created_at: hours(5) },
    ],
    context: {
      time_range: { from: "2023-02-01", to: "2023-02-28" },
      filters: [{ column: "status", operator: "not in", value: ["Cancelled", "Returned"] }],
      grain: "day",
      definition_id: "def_revenue",
    },
  },
  {
    id: "th_2",
    title: "2023 revenue",
    turns: [
      { question: "What was 2023 revenue?", answer_id: "ans_2023_revenue", created_at: days(1) },
    ],
    context: { time_range: { from: "2023-01-01", to: "2023-12-31" }, grain: "year" },
  },
  {
    id: "th_3",
    title: "Category performance",
    turns: [
      { question: "Which product categories made the most revenue in 2023?", answer_id: "ans_top_categories", created_at: days(3) },
      { question: "How does that compare to 2022?", answer_id: "ans_revenue_2022", created_at: days(3) },
    ],
    context: {
      time_range: { from: "2023-01-01", to: "2023-12-31" },
      grain: "year",
      definition_id: "def_revenue",
    },
  },
];

export const THREAD_SUMMARIES: ThreadSummary[] = [
  { id: "th_1", title: "February revenue", updated_at: hours(5), answer_count: 1 },
  { id: "th_2", title: "2023 revenue", updated_at: days(1), answer_count: 1 },
  { id: "th_3", title: "Category performance", updated_at: days(3), answer_count: 2 },
  { id: "th_4", title: "Repeat purchase behaviour", updated_at: ago(90), answer_count: 3 },
];

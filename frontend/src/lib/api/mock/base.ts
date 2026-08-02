import type { Source, User } from "@/lib/api/types";

/**
 * Fixture support. Every value here is *data* — no component may reference a
 * table, column, metric or source name that did not come through the API layer.
 * The demo warehouse happens to be an e-commerce set; nothing in the UI knows.
 */

const T0 = Date.now();

export function ago(minutes: number): string {
  return new Date(T0 - minutes * 60_000).toISOString();
}
export function days(n: number): string {
  return ago(n * 60 * 24);
}
export function hours(n: number): string {
  return ago(n * 60);
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

export const USERS: User[] = [
  {
    id: "usr_1",
    name: "Dana Okafor",
    email: "dana@example.com",
    role: "admin",
    can_ratify: true,
    last_active_at: ago(2),
    answers_asked: 412,
    initials: "AD",
  },
  {
    id: "usr_2",
    name: "Priya Nair",
    email: "priya@example.com",
    role: "analyst",
    can_ratify: true,
    last_active_at: hours(3),
    answers_asked: 288,
    initials: "PN",
  },
  {
    id: "usr_3",
    name: "Rohan Shah",
    email: "rohan@example.com",
    role: "analyst",
    can_ratify: true,
    last_active_at: hours(20),
    answers_asked: 147,
    initials: "RS",
  },
  {
    id: "usr_4",
    name: "Maya Iyer",
    email: "maya@example.com",
    role: "viewer",
    can_ratify: false,
    last_active_at: days(2),
    answers_asked: 63,
    initials: "MI",
  },
  {
    id: "usr_5",
    name: "Tom Errington",
    email: "tom@example.com",
    role: "viewer",
    can_ratify: false,
    last_active_at: days(5),
    answers_asked: 21,
    initials: "TE",
  },
];

export const USER_BY_ID = Object.fromEntries(USERS.map((u) => [u.id, u]));

export function initialsOf(userId: string): string {
  return USER_BY_ID[userId]?.initials ?? "??";
}
export function nameOf(userId: string): string {
  return USER_BY_ID[userId]?.name ?? "Unknown";
}

export const SOURCES: Source[] = [
  {
    id: "src_1",
    name: "Commerce warehouse",
    kind: "duckdb",
    status: "connected",
    table_count: 7,
    last_introspected_at: hours(2),
    host: "local",
    database: "analyst-sample.duckdb",
    last_query_at: ago(4),
  },
  {
    id: "src_2",
    name: "Marketing replica",
    kind: "postgres",
    status: "degraded",
    table_count: 12,
    last_introspected_at: days(9),
    host: "replica.internal:5432",
    database: "marketing",
    last_query_at: days(3),
  },
];

export const WORKSPACE_NAME = "Northwind Retail";

import type { SourceKind } from "@/lib/api/types";

/**
 * Presentation for the connect flow: what to call an engine, and what to ask
 * for.
 *
 * # What changed and why
 *
 * This file used to be the source of truth for which engines existed. It
 * listed four — DuckDB, Snowflake, BigQuery, Postgres — while the binary
 * registered exactly one. Choosing any of the other three walked you through a
 * wizard and produced a source that failed the first time it was used, with an
 * error naming the engine rather than the list that offered it.
 *
 * It also carried a `server` string per engine ("DuckDB 0.10.2",
 * "PostgreSQL 16.2") and inferred SQL grants from a regular expression over the
 * role name. The Test step reported both as though they had been measured.
 * Nothing had been contacted. In a product whose entire claim is that it does
 * not assert more than it knows, a screen that fabricates a server version is
 * not a rough edge — it is the claim, failing.
 *
 * Both are gone. Which engines exist now comes from `GET /sources/kinds`, which
 * reads the Go connector registry; everything reported about a connection comes
 * from actually opening it.
 *
 * # Adding a connector needs nothing here
 *
 * A kind with no entry below still works: it gets a generic connection-string
 * field and a monogram derived from its name. Register a connector in Go and it
 * appears in this UI with no frontend change at all — which is the promise the
 * registry makes, and it should not be contingent on somebody remembering to
 * edit a TypeScript file.
 */

export interface EngineField {
  name: string;
  label: string;
  placeholder: string;
  hint?: string;
  secret?: boolean;
}

export interface Engine {
  /** Matches a kind reported by `GET /sources/kinds`. */
  id: SourceKind;
  label: string;
  /** Two-letter monogram — a real mark, not a borrowed logo. */
  monogram: string;
  fields: EngineField[];
  /** Builds the connection string the API stores. */
  toDSN: (values: Record<string, string>) => string;
}

const NAME_FIELD: EngineField = {
  name: "name",
  label: "Display name",
  placeholder: "Warehouse",
};

/** Known engines. Presentation only — never a claim that one is available. */
const KNOWN: Engine[] = [
  {
    id: "duckdb",
    label: "DuckDB",
    monogram: "DD",
    fields: [
      NAME_FIELD,
      {
        name: "path",
        label: "File path",
        placeholder: "/data/warehouse.duckdb",
        hint: "Absolute path, readable by the server. Opened read-only.",
      },
    ],
    toDSN: (v) => (v.path ?? "").trim(),
  },
  {
    id: "snowflake",
    label: "Snowflake",
    monogram: "SF",
    fields: [
      NAME_FIELD,
      {
        name: "account",
        label: "Account identifier",
        placeholder: "xy12345.eu-west-1",
      },
      {
        name: "user",
        label: "User",
        placeholder: "ANALYST_RO",
        hint: "A read-only role is strongly recommended — Analyst only ever issues reads, and verification runs every query twice on a metered engine.",
      },
      {
        name: "password",
        label: "Password",
        placeholder: "${SNOWFLAKE_PASSWORD}",
        hint: "Write ${VAR} to reference a server-side environment variable. The reference is stored; the secret never is.",
        secret: true,
      },
      {
        name: "database",
        label: "Database",
        placeholder: "ANALYTICS",
      },
      {
        name: "schema",
        label: "Schema",
        placeholder: "PUBLIC",
      },
      {
        name: "warehouse",
        label: "Warehouse",
        placeholder: "QUERY_WH",
      },
      {
        name: "role",
        label: "Role",
        placeholder: "ANALYST_RO",
      },
    ],
    // gosnowflake DSN: user:password@account/database/schema?warehouse=&role=
    toDSN: (v) => {
      const user = encodeURIComponent((v.user ?? "").trim());
      const rawPass = (v.password ?? "").trim();
      // A ${VAR} reference must survive verbatim — the server resolves it at
      // connect time. A literal password gets percent-encoded so ':' or '@'
      // inside it cannot restructure the DSN.
      const pass = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(rawPass)
        ? rawPass
        : encodeURIComponent(rawPass);
      const cred = pass ? `${user}:${pass}` : user;
      let dsn = `${cred}@${(v.account ?? "").trim()}`;
      const db = (v.database ?? "").trim();
      const schema = (v.schema ?? "").trim();
      if (db) dsn += `/${db}${schema ? `/${schema}` : ""}`;
      const params = new URLSearchParams();
      const wh = (v.warehouse ?? "").trim();
      const role = (v.role ?? "").trim();
      if (wh) params.set("warehouse", wh);
      if (role) params.set("role", role);
      const qs = params.toString();
      return qs ? `${dsn}?${qs}` : dsn;
    },
  },
  {
    id: "postgres",
    label: "Postgres",
    monogram: "PG",
    fields: [
      NAME_FIELD,
      {
        name: "dsn",
        label: "Connection string",
        placeholder: "postgres://analyst_ro@replica.internal:5432/warehouse",
        hint: "A read-only role is recommended. Analyst only ever issues reads.",
      },
    ],
    toDSN: (v) => (v.dsn ?? "").trim(),
  },
  {
    id: "clickhouse",
    label: "ClickHouse",
    monogram: "CH",
    fields: [
      NAME_FIELD,
      {
        name: "dsn",
        label: "Connection string",
        placeholder: "clickhouse://analyst@clickhouse.internal:9000/warehouse",
      },
    ],
    toDSN: (v) => (v.dsn ?? "").trim(),
  },
];

const KNOWN_BY_ID = new Map(KNOWN.map((e) => [e.id, e]));

/**
 * A monogram for a kind nobody wrote metadata for: first two letters, upper
 * case. Plain is fine; wrong is not, and "??" against a connector that works
 * would be wrong.
 */
function fallbackMonogram(kind: SourceKind): string {
  const letters = kind.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || "DB").toUpperCase();
}

/** Presentation for a kind the server reports, known to this file or not. */
export function engineFor(kind: SourceKind): Engine {
  const known = KNOWN_BY_ID.get(kind);
  if (known) return known;
  return {
    id: kind,
    label: kind,
    monogram: fallbackMonogram(kind),
    fields: [
      NAME_FIELD,
      {
        name: "dsn",
        label: "Connection string",
        placeholder: "",
        hint: `Passed to the ${kind} connector as written.`,
      },
    ],
    toDSN: (v) => (v.dsn ?? "").trim(),
  };
}

/** Engines for the kinds this build registers, in the order the server lists. */
export function enginesFor(kinds: SourceKind[]): Engine[] {
  return kinds.map(engineFor);
}

export const labelFor = (kind: SourceKind): string => engineFor(kind).label;
export const monogramFor = (kind: SourceKind): string => engineFor(kind).monogram;

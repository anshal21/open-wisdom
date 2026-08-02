/**
 * Transport selection.
 *
 * `mock` — always fixtures. `live` — always the backend. `auto` (default) —
 * probe the backend once; fall back to fixtures if it is not up. The backend
 * is built in parallel against the same contract, so every screen has to be
 * fully demoable and developable without it.
 */
export type ApiMode = "mock" | "live" | "auto";

export const API_MODE: ApiMode =
  (process.env.NEXT_PUBLIC_API_MODE as ApiMode | undefined) ?? "auto";

/** Same-origin. The Next route handler at /api/v1/* forwards to the backend. */
export const API_BASE = "/api/v1";

/** Server-side only. */
export const BACKEND_ORIGIN =
  process.env.BACKEND_ORIGIN ?? "http://localhost:8080";

let probe: Promise<boolean> | null = null;

export function resetProbe() {
  probe = null;
}

export async function backendIsUp(): Promise<boolean> {
  if (API_MODE === "mock") return false;
  if (API_MODE === "live") return true;
  if (typeof window === "undefined") return false;
  if (!probe) {
    probe = (async () => {
      try {
        const ctl = new AbortController();
        const t = window.setTimeout(() => ctl.abort(), 1200);
        const res = await fetch("/api/health", { signal: ctl.signal });
        window.clearTimeout(t);
        if (!res.ok) return false;
        const body = (await res.json()) as { up?: boolean };
        return Boolean(body.up);
      } catch {
        return false;
      }
    })();
  }
  return probe;
}

/** Rendered in the shell so it is never ambiguous which data you are looking at. */
export async function transportLabel(): Promise<"live" | "demo"> {
  return (await backendIsUp()) ? "live" : "demo";
}

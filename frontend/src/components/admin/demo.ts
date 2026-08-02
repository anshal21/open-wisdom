"use client";

import * as React from "react";

/**
 * Every state in screens.md §14 is implemented for real. `?demo=` only chooses
 * which one to hold on screen — `empty` views the surface as a Viewer, which is
 * what "role-specific empty" means for admin. It adds nothing to the chrome.
 */
export type DemoState = "loading" | "error" | "empty" | null;

/**
 * Read through useSyncExternalStore rather than an effect.
 *
 * The URL is an external source, and setting state from an effect to mirror it
 * causes a cascading render: React commits `null`, then immediately re-renders
 * with the real value. The server snapshot is `null` because the query string
 * is not available during SSR, which is also what keeps hydration consistent.
 */
export function useDemoState(): DemoState {
  return React.useSyncExternalStore(subscribe, readDemoState, () => null);
}

function readDemoState(): DemoState {
  const v = new URLSearchParams(window.location.search).get("demo");
  return v === "loading" || v === "error" || v === "empty" ? v : null;
}

/** The query string only changes via navigation. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

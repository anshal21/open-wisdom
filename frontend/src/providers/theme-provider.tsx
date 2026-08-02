"use client";

import * as React from "react";

export type Theme = "light" | "dark";

interface ThemeContext {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Ctx = React.createContext<ThemeContext>({
  theme: "dark",
  setTheme: () => {},
  toggle: () => {},
});

export const useTheme = () => React.useContext(Ctx);

export const THEME_STORAGE_KEY = "theme";

/**
 * The theme is applied by a blocking script before first paint (layout.tsx) so
 * there is no flash. The document element is the source of truth; React reads
 * it through an external store rather than mirroring it into state, which is
 * what keeps SSR and the pre-paint script from fighting each other.
 */
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch {
    /* private mode */
  }
  notify();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useSyncExternalStore(
    subscribe,
    readTheme,
    () => "dark" as Theme,
  );

  const value = React.useMemo(
    () => ({
      theme,
      setTheme: applyTheme,
      toggle: () => applyTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.toggle('dark',t==='dark');}catch(e){document.documentElement.classList.add('dark');}})();`;

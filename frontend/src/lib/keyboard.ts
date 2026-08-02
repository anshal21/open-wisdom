"use client";

import * as React from "react";

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const MOD = isMac ? "⌘" : "Ctrl";
export const ALT = isMac ? "⌥" : "Alt";

export function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    node.isContentEditable === true
  );
}

export interface Hotkey {
  /** Lowercase key, or a two-key chord like "g a". */
  key: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** Fire even while a text field has focus. */
  allowInEditable?: boolean;
  run: (e: KeyboardEvent) => void;
}

const CHORD_WINDOW = 900;

/**
 * Global keyboard model. Single listener, chords supported (Linear-style
 * `g` then key). Every action reachable by mouse has a keyboard path.
 */
export function useHotkeys(hotkeys: Hotkey[], deps: React.DependencyList = []) {
  const ref = React.useRef(hotkeys);
  React.useEffect(() => {
    ref.current = hotkeys;
  });

  React.useEffect(() => {
    let pending: string | null = null;
    let timer: number | undefined;

    function onKey(e: KeyboardEvent) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const editable = isEditable(e.target);

      // chord continuation
      if (pending) {
        const chord = `${pending} ${key}`;
        pending = null;
        window.clearTimeout(timer);
        const hit = ref.current.find(
          (h) => h.key === chord && !h.mod && (h.allowInEditable || !editable),
        );
        if (hit) {
          e.preventDefault();
          hit.run(e);
          return;
        }
      }

      for (const h of ref.current) {
        if (h.key.includes(" ")) continue;
        if (Boolean(h.mod) !== (e.metaKey || e.ctrlKey)) continue;
        if (Boolean(h.alt) !== e.altKey) continue;
        if (h.shift !== undefined && Boolean(h.shift) !== e.shiftKey) continue;
        if (h.key !== key) continue;
        if (editable && !h.allowInEditable) continue;
        e.preventDefault();
        h.run(e);
        return;
      }

      // chord start
      if (
        !editable &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        ref.current.some((h) => h.key.startsWith(`${key} `))
      ) {
        pending = key;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          pending = null;
        }, CHORD_WINDOW);
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

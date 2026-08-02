"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatValue } from "@/lib/format";
import type { AnswerSummary, Definition } from "@/lib/api/types";
import { ConfidenceSeal } from "@/components/seal/confidence-seal";
import { useFocusTrap } from "@/components/ui/overlays";
import { NAV } from "./nav";
import { useUi } from "@/state/ui";
import { useTheme } from "@/providers/theme-provider";

interface Row {
  id: string;
  section: string;
  label: string;
  hint?: React.ReactNode;
  run: () => void;
}

/** Mounted only while open, so it always opens empty without a reset effect. */
export function CommandPalette(props: {
  answers: AnswerSummary[];
  definitions: Definition[];
}) {
  const paletteOpen = useUi((s) => s.paletteOpen);
  if (!paletteOpen) return null;
  return <PaletteInner {...props} />;
}

function PaletteInner({
  answers,
  definitions,
}: {
  answers: AnswerSummary[];
  definitions: Definition[];
}) {
  const { setPaletteOpen, setShortcutsOpen } = useUi();
  const { toggle: toggleTheme } = useTheme();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => setPaletteOpen(false), [setPaletteOpen]);
  useFocusTrap(true, ref, close);

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = [];
    const query = q.trim();

    // The palette is a second entry point to the core loop, not just a navigator.
    out.push({
      id: "ask",
      section: "Ask",
      label: query ? `Ask: ${query}` : "Ask a question…",
      hint: <CornerDownLeft size={12} />,
      run: () => {
        close();
        router.push(query ? `/ask?q=${encodeURIComponent(query)}` : "/ask");
      },
    });

    for (const n of NAV) {
      if (!match(n.label, query)) continue;
      out.push({
        id: `nav-${n.href}`,
        section: "Jump to",
        label: n.label,
        hint: <span className="text-ui-sm text-disabled">{n.chord}</span>,
        run: () => {
          close();
          router.push(n.href);
        },
      });
    }
    if (match("Settings", query))
      out.push({
        id: "nav-settings",
        section: "Jump to",
        label: "Settings",
        run: () => {
          close();
          router.push("/settings/workspace");
        },
      });

    for (const a of [
      { id: "act-theme", label: "Toggle theme", run: toggleTheme },
      { id: "act-keys", label: "Keyboard shortcuts", run: () => setShortcutsOpen(true) },
      {
        id: "act-def",
        label: "New definition",
        run: () => router.push("/definitions?new=1"),
      },
    ]) {
      if (!match(a.label, query)) continue;
      out.push({
        id: a.id,
        section: "Actions",
        label: a.label,
        run: () => {
          close();
          a.run();
        },
      });
    }

    for (const a of answers.slice(0, 40)) {
      if (!match(a.question, query)) continue;
      if (out.filter((r) => r.section === "Recent answers").length >= 6) break;
      out.push({
        id: `ans-${a.id}`,
        section: "Recent answers",
        label: a.question,
        hint: (
          <span className="flex items-center gap-2">
            <span className="text-ui-sm tabular text-tertiary">
              {formatValue(a.value, a.format_hint, { unit: a.unit })}
            </span>
            <ConfidenceSeal state={a.confidence} size="inline" labelHidden />
          </span>
        ),
        run: () => {
          close();
          router.push(`/a/${a.id}`);
        },
      });
    }

    for (const d of definitions) {
      if (!match(d.name, query)) continue;
      if (out.filter((r) => r.section === "Definitions").length >= 5) break;
      out.push({
        id: `def-${d.id}`,
        section: "Definitions",
        label: d.name,
        hint: <span className="text-ui-sm text-tertiary">v{d.version}</span>,
        run: () => {
          close();
          router.push(`/definitions/${d.id}`);
        },
      });
    }

    return out;
  }, [q, answers, definitions, router, close, toggleTheme, setShortcutsOpen]);

  // Clamped during render rather than corrected in an effect.
  const active = Math.min(cursor, Math.max(0, rows.length - 1));

  React.useEffect(() => {
    listRef.current
      ?.querySelectorAll("[data-row]")
      [active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastSection = "";

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-6">
      <div className="ds-fade absolute inset-0 bg-overlay-scrim" onClick={close} />
      <div
        ref={ref}
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        style={{ marginTop: "18vh", animationDuration: "220ms" }}
        className="ds-enter relative z-10 flex w-[640px] max-w-full flex-col overflow-hidden rounded-xl border border-border-default bg-surface-4 shadow-modal"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor(Math.min(rows.length - 1, active + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor(Math.max(0, active - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            rows[active]?.run();
          }
        }}
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border-subtle px-4">
          <Search size={15} className="shrink-0 text-tertiary" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search or ask a question…"
            className="h-full flex-1 bg-transparent text-body text-primary outline-none placeholder:text-tertiary"
          />
        </div>
        <div ref={listRef} className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-1.5">
          {rows.map((r, i) => {
            const header = r.section !== lastSection ? r.section : null;
            lastSection = r.section;
            return (
              <React.Fragment key={r.id}>
                {header ? (
                  <div className="px-2 pt-2.5 pb-1 text-label text-tertiary uppercase">
                    {header}
                  </div>
                ) : null}
                <button
                  data-row
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={r.run}
                  className={cn(
                    "flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left transition-colors duration-100",
                    i === active ? "bg-overlay-selected" : "hover:bg-overlay-hover",
                  )}
                >
                  {r.section === "Ask" ? (
                    <Sparkles size={14} className="shrink-0 text-accent" />
                  ) : null}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-ui",
                      i === active ? "text-primary" : "text-secondary",
                    )}
                  >
                    {r.label}
                  </span>
                  {r.hint ? <span className="shrink-0">{r.hint}</span> : null}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function match(text: string, q: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  const needle = q.toLowerCase();
  if (t.includes(needle)) return true;
  // simple subsequence fuzzy
  let i = 0;
  for (const ch of t) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

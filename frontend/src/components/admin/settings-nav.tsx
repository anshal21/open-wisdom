"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { canOpen, type SpecRole } from "./roles";
import { SECTIONS, type SectionId } from "./sections";

/** 200px sub-nav, inside the content region. screens.md §11. */
export function SettingsNav({
  active,
  role,
}: {
  active: SectionId | null;
  role: SpecRole;
}) {
  const ref = React.useRef<HTMLElement>(null);

  const move = (from: number, delta: number) => {
    const items = ref.current?.querySelectorAll<HTMLAnchorElement>("a");
    if (!items) return;
    const next = Math.max(0, Math.min(items.length - 1, from + delta));
    items[next]?.focus();
  };

  return (
    <nav
      ref={ref}
      aria-label="Settings sections"
      className="flex w-full shrink-0 flex-col gap-0.5 lg:sticky lg:top-0 lg:w-[200px]"
    >
      {SECTIONS.map((s, i) => {
        const current = s.id === active;
        const permitted = canOpen(s.id, role);
        return (
          <Link
            key={s.id}
            href={`/settings/${s.id}`}
            aria-current={current ? "page" : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "relative flex h-8 items-center rounded-sm px-2 text-ui transition-colors duration-100",
              current
                ? "bg-overlay-selected text-accent before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--c-accent-solid)] before:content-['']"
                : "text-secondary hover:bg-overlay-hover hover:text-primary",
            )}
          >
            <span className="flex-1 truncate">{s.label}</span>
            {!permitted ? (
              <span
                className="text-ui-sm text-disabled"
                title="Managed by an Owner or Admin"
              >
                view only
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

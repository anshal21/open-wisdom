"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * §0.3 — 52px, sticky. Past 40px of scroll the border strengthens and the leaf
 * shrinks from `title` to `subtitle`. No other scroll effects.
 */
export function SurfaceHeader({
  crumbs,
  actions,
  scrollRef,
  className,
}: {
  crumbs: Crumb[];
  actions?: React.ReactNode;
  scrollRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 40);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  const leaf = crumbs[crumbs.length - 1];
  const ancestors = crumbs.slice(0, -1);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-13 shrink-0 items-center gap-3 border-b bg-surface-canvas px-6 transition-colors duration-100",
        scrolled ? "border-border-strong" : "border-border-default",
        className,
      )}
      style={{ height: 52 }}
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        {ancestors.map((c) => (
          <React.Fragment key={c.label}>
            {c.href ? (
              <Link
                href={c.href}
                className="shrink-0 text-ui text-tertiary transition-colors duration-100 hover:text-primary"
              >
                {c.label}
              </Link>
            ) : (
              <span className="shrink-0 text-ui text-tertiary">{c.label}</span>
            )}
            <span aria-hidden="true" className="shrink-0 text-tertiary">
              /
            </span>
          </React.Fragment>
        ))}
        <h1
          className={cn(
            "min-w-0 truncate text-primary transition-all duration-100",
            scrolled ? "text-subtitle" : "text-title",
          )}
        >
          {leaf?.label}
        </h1>
      </nav>
      <span className="flex-1" />
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );
}

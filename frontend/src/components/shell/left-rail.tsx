"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, Diamond, Search, Settings } from "lucide-react";
import { cn } from "@/lib/cn";
import { MOD } from "@/lib/keyboard";
import { Avatar } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/overlays";
import { NAV, type NavCounts } from "./nav";
import { useUi } from "@/state/ui";

export function LeftRail({
  workspace,
  counts,
  user,
  watchFiring,
  definitionsDirty,
  transport,
}: {
  workspace: string;
  counts: NavCounts;
  user: { name: string; initials: string };
  watchFiring: boolean;
  definitionsDirty: boolean;
  transport: "live" | "demo";
}) {
  const pathname = usePathname();
  const { railCollapsed, setPaletteOpen } = useUi();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Primary"
      style={{ width: railCollapsed ? 52 : 236 }}
      className="flex h-full shrink-0 flex-col border-r border-border-default bg-surface-1 transition-[width] duration-140"
    >
      <div className="p-2">
        <button
          type="button"
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-100 hover:bg-overlay-hover",
            railCollapsed && "justify-center px-0",
          )}
        >
          <Diamond size={15} className="shrink-0 text-accent" />
          {!railCollapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
                {workspace}
              </span>
              <ChevronsUpDown size={13} className="shrink-0 text-tertiary" />
            </>
          ) : null}
        </button>
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className={cn(
            "flex h-7 w-full items-center gap-2 rounded-sm border border-border-default bg-surface-2 px-2 text-left transition-colors duration-100 hover:border-border-hover",
            railCollapsed && "justify-center px-0",
          )}
          aria-label="Search or ask"
        >
          <Search size={13} className="shrink-0 text-tertiary" />
          {!railCollapsed ? (
            <>
              <span className="flex-1 truncate text-ui-sm text-tertiary">
                Search or ask…
              </span>
              <span className="shrink-0 text-ui-sm text-disabled">{MOD}K</span>
            </>
          ) : null}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="space-y-px">
          {NAV.filter((n) => n.section === "primary").map((item) => (
            <RailItem
              key={item.href}
              item={item}
              active={isActive(item.href)}
              collapsed={railCollapsed}
              count={item.countKey ? counts[item.countKey] : undefined}
              amber={
                (item.label === "Watches" && watchFiring) ||
                (item.label === "Definitions" && definitionsDirty)
              }
            />
          ))}
        </ul>

        <div className={cn("mt-4 mb-1 px-2", railCollapsed && "sr-only")}>
          <span className="text-label text-tertiary uppercase">Data</span>
        </div>
        <ul className="space-y-px">
          {NAV.filter((n) => n.section === "data").map((item) => (
            <RailItem
              key={item.href}
              item={item}
              active={isActive(item.href)}
              collapsed={railCollapsed}
              count={item.countKey ? counts[item.countKey] : undefined}
            />
          ))}
        </ul>
      </div>

      <div className="shrink-0 border-t border-border-subtle p-2">
        {!railCollapsed ? (
          <p className="mb-2 flex items-center gap-1.5 px-2 text-ui-sm text-tertiary">
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                transport === "live" ? "bg-verified" : "bg-unverified",
              )}
            />
            {transport === "live" ? "Live warehouse" : "Demo data"}
          </p>
        ) : null}
        <Link
          href="/settings/workspace"
          className={cn(
            "flex h-[30px] items-center gap-2 rounded-sm px-2 text-ui text-secondary transition-colors duration-100 hover:bg-overlay-hover hover:text-primary",
            isActive("/settings") && "bg-overlay-selected text-accent",
            railCollapsed && "justify-center px-0",
          )}
        >
          <Settings size={16} className="shrink-0" />
          {!railCollapsed ? <span>Settings</span> : null}
        </Link>
        <button
          type="button"
          className={cn(
            "mt-px flex h-[30px] w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-100 hover:bg-overlay-hover",
            railCollapsed && "justify-center px-0",
          )}
        >
          <Avatar initials={user.initials} />
          {!railCollapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-ui text-secondary">
                {user.name}
              </span>
              <ChevronsUpDown size={13} className="shrink-0 text-tertiary" />
            </>
          ) : null}
        </button>
      </div>
    </nav>
  );
}

function RailItem({
  item,
  active,
  collapsed,
  count,
  amber,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  collapsed: boolean;
  count?: number;
  amber?: boolean;
}) {
  const Icon = item.icon;
  const body = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-[30px] items-center gap-2 rounded-sm px-2 text-ui transition-colors duration-100",
        active
          ? "bg-overlay-selected text-accent"
          : "text-secondary hover:bg-overlay-hover hover:text-primary",
        collapsed && "justify-center px-0",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 -left-1 w-0.5 rounded-full bg-[var(--c-accent-solid)]"
        />
      ) : null}
      <Icon size={16} className="shrink-0" />
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {typeof count === "number" ? (
            <span
              className={cn(
                "shrink-0 text-ui-sm tabular",
                amber ? "text-qualified" : "text-tertiary",
              )}
            >
              {count > 999 ? `${(count / 1000).toFixed(1)}k` : count}
            </span>
          ) : null}
          {amber && typeof count !== "number" ? (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-qualified"
            />
          ) : null}
        </>
      ) : amber ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-qualified"
        />
      ) : null}
    </Link>
  );

  return (
    <li>
      {collapsed ? (
        <Tooltip label={item.label} side="bottom">
          {body}
        </Tooltip>
      ) : (
        body
      )}
    </li>
  );
}

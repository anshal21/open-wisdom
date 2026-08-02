import {
  Boxes,
  Database,
  LayoutGrid,
  type LucideIcon,
  NotebookPen,
  Radar,
  Rows3,
  Sparkles,
  Telescope,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Linear-style `g` chord. */
  chord: string;
  countKey?: "ledger" | "definitions" | "dashboards" | "notebooks" | "investigations" | "watches" | "sources";
  section: "primary" | "data";
}

export const NAV: NavItem[] = [
  { href: "/ask", label: "Ask", icon: Sparkles, chord: "g a", section: "primary" },
  { href: "/ledger", label: "Ledger", icon: Rows3, chord: "g l", countKey: "ledger", section: "primary" },
  { href: "/definitions", label: "Definitions", icon: Boxes, chord: "g d", countKey: "definitions", section: "primary" },
  { href: "/dashboards", label: "Dashboards", icon: LayoutGrid, chord: "g b", countKey: "dashboards", section: "primary" },
  { href: "/notebooks", label: "Notebooks", icon: NotebookPen, chord: "g n", countKey: "notebooks", section: "primary" },
  { href: "/investigations", label: "Investigations", icon: Telescope, chord: "g i", countKey: "investigations", section: "primary" },
  { href: "/watches", label: "Watches", icon: Radar, chord: "g w", countKey: "watches", section: "primary" },
  { href: "/sources", label: "Sources", icon: Database, chord: "g s", countKey: "sources", section: "data" },
];

export type NavCounts = Partial<Record<NonNullable<NavItem["countKey"]>, number>>;

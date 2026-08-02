"use client";

import * as React from "react";
import { Download, MoreHorizontal, RotateCw, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Kbd } from "@/components/ui/primitives";
import { MenuItem, Popover } from "@/components/ui/overlays";

export interface RerunProgress {
  running: boolean;
  done: number;
  total: number;
}

/**
 * The ledger toolbar. §5.1 — search, export, `⋯`, plus the bulk re-run control
 * and its progress. Progress is a compact inline bar here and nowhere else:
 * a modal or a full-screen spinner for a background re-run is a §11 violation.
 */
export function LedgerToolbar({
  query,
  onQueryChange,
  savedSearches,
  searchRef,
  selectedCount,
  onRerun,
  progress,
  onExport,
  density,
  onToggleDensity,
  onClearFilters,
  canClearFilters,
  onShortcuts,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  savedSearches: string[];
  searchRef: React.RefObject<HTMLInputElement | null>;
  selectedCount: number;
  onRerun: () => void;
  progress: RerunProgress;
  onExport: () => void;
  density: "compact" | "comfortable";
  onToggleDensity: () => void;
  onClearFilters: () => void;
  canClearFilters: boolean;
  onShortcuts: () => void;
}) {
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);

  const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <div className="flex items-center gap-1.5">
      {progress.running ? (
        <div
          role="status"
          aria-live="polite"
          className="mr-1 flex items-center gap-2"
        >
          <span className="text-ui-sm tabular text-secondary">
            Re-running {progress.done} of {progress.total}
          </span>
          <div
            className="h-1 w-24 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <div
              className="h-full rounded-full bg-accent-solid transition-[width] duration-140"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {selectedCount > 0 && !progress.running ? (
        <Button
          size="sm"
          variant="primary"
          onClick={onRerun}
          className="mr-1"
          title="Re-run the selected answers"
        >
          <RotateCw size={13} aria-hidden="true" />
          <span className="hidden sm:inline">Re-run</span> ({selectedCount})
        </Button>
      ) : null}

      <div ref={fieldRef} className="relative">
        <Search
          size={13}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tertiary"
        />
        <Input
          ref={searchRef}
          value={query}
          role="combobox"
          aria-expanded={suggestOpen}
          aria-label="Search answers"
          placeholder="Search answers"
          className={cn("h-7 w-[152px] pl-7 sm:w-[248px]", query && "pr-7")}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setSuggestOpen(e.target.value.trim() === "");
          }}
          onFocus={() => setSuggestOpen(query.trim() === "")}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) onQueryChange("");
              else e.currentTarget.blur();
              setSuggestOpen(false);
            }
          }}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange("");
              searchRef.current?.focus();
            }}
            className="absolute top-1/2 right-1.5 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-xs text-tertiary transition-colors duration-100 hover:bg-overlay-hover hover:text-primary"
          >
            <X size={12} />
          </button>
        ) : null}

        <Popover
          open={suggestOpen && savedSearches.length > 0}
          onClose={() => setSuggestOpen(false)}
          anchorRef={fieldRef}
          width={288}
        >
          <p className="px-2 pt-1.5 pb-1 text-label text-tertiary uppercase">
            Saved searches
          </p>
          {savedSearches.map((term) => (
            <MenuItem
              key={term}
              onSelect={() => {
                onQueryChange(term);
                setSuggestOpen(false);
                searchRef.current?.focus();
              }}
            >
              What did we say about {term}?
            </MenuItem>
          ))}
          <p className="border-t border-border-subtle px-2 pt-1.5 pb-1 text-ui-sm text-tertiary">
            Search covers questions, answer values and definitions.
          </p>
        </Popover>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={onExport}
        aria-label="Export answers"
      >
        <Download size={13} aria-hidden="true" />
        <span className="hidden sm:inline">Export</span>
      </Button>

      <IconButton
        ref={moreRef}
        label="More actions"
        size="sm"
        onClick={() => setMoreOpen((v) => !v)}
      >
        <MoreHorizontal size={15} />
      </IconButton>
      <Popover
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        anchorRef={moreRef}
        align="end"
        width={244}
      >
        <div role="menu" aria-label="Ledger actions">
          <MenuItem
            onSelect={() => {
              onToggleDensity();
              setMoreOpen(false);
            }}
          >
            {density === "compact" ? "Comfortable rows" : "Compact rows"}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              onClearFilters();
              setMoreOpen(false);
            }}
            className={
              canClearFilters ? undefined : "pointer-events-none opacity-50"
            }
          >
            Clear all filters
          </MenuItem>
          <MenuItem
            onSelect={() => {
              onExport();
              setMoreOpen(false);
            }}
          >
            Export answers
          </MenuItem>
          <MenuItem
            onSelect={() => {
              onShortcuts();
              setMoreOpen(false);
            }}
            shortcut={<Kbd>?</Kbd>}
          >
            Keyboard shortcuts
          </MenuItem>
        </div>
      </Popover>
    </div>
  );
}

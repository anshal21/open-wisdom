"use client";

import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Definition, ReportConfidence, User } from "@/lib/api/types";
import { CONFIDENCE } from "@/lib/confidence";
import { formatCount } from "@/lib/format";
import { Avatar } from "@/components/ui/primitives";
import { MenuItem, Popover } from "@/components/ui/overlays";
import { ConfidenceGlyph } from "@/components/seal/glyphs";
import {
  CONFIDENCE_OPTIONS,
  SCOPE_HINT,
  SCOPE_LABEL,
  WINDOW_LABEL,
  type Filters,
  type Scope,
  type TimeWindow,
} from "./model";

/* ---------------------------------------------------------------------------
   One filter control. A button that opens a real popover; keyboard reachable.
--------------------------------------------------------------------------- */

function FilterButton({
  label,
  active,
  onClick,
  buttonRef,
  open,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border px-2.5 text-ui transition-colors duration-100",
        active
          ? "border-accent-tint-border bg-accent-tint text-accent"
          : "border-border-default bg-surface-1 text-secondary hover:border-border-hover hover:text-primary",
      )}
    >
      {label}
      <ChevronDown size={12} className="opacity-70" aria-hidden="true" />
    </button>
  );
}

/** Same control, quieter: the definition filter is a secondary affordance. */
function GhostFilterButton({
  label,
  onClick,
  buttonRef,
  open,
}: {
  label: string;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={onClick}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-ui text-tertiary transition-colors duration-100 hover:bg-overlay-hover hover:text-primary"
    >
      {label}
      <ChevronDown size={12} className="opacity-70" aria-hidden="true" />
    </button>
  );
}

function useMenu() {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  return { ref, open, setOpen };
}

/* ---------------------------------------------------------------------------
   Filter row. screens.md §5.1
--------------------------------------------------------------------------- */

export function LedgerFilterBar({
  filters,
  onChange,
  users,
  definitions,
  shown,
  total,
  className,
}: {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
  users: User[];
  definitions: Definition[];
  /** Rows after filtering — the honest denominator for what is on screen. */
  shown: number;
  /** Every answer recorded, before this view's filters. */
  total: number;
  className?: string;
}) {
  const scope = useMenu();
  const who = useMenu();
  const confidence = useMenu();
  const period = useMenu();
  const definition = useMenu();

  const whoLabel = filters.who
    ? (users.find((u) => u.id === filters.who)?.name ?? "Unknown")
    : "Anyone";
  const confidenceLabel = filters.confidence
    ? CONFIDENCE[filters.confidence].label
    : "Any confidence";
  const activeDefinition = filters.definitionId
    ? definitions.find((d) => d.id === filters.definitionId)
    : undefined;

  const filtered =
    filters.scope !== "all" ||
    Boolean(filters.who) ||
    Boolean(filters.confidence) ||
    Boolean(filters.definitionId) ||
    Boolean(filters.query.trim());

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <FilterButton
        label={SCOPE_LABEL[filters.scope]}
        active={filters.scope !== "all"}
        open={scope.open}
        buttonRef={scope.ref}
        onClick={() => scope.setOpen(!scope.open)}
      />
      <Popover
        open={scope.open}
        onClose={() => scope.setOpen(false)}
        anchorRef={scope.ref}
        width={248}
      >
        <div role="menu" aria-label="Filter answers">
          {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
            <MenuItem
              key={s}
              selected={filters.scope === s}
              onSelect={() => {
                onChange({ scope: s });
                scope.setOpen(false);
              }}
            >
              <span className="block truncate">{SCOPE_LABEL[s]}</span>
              <span className="block truncate text-ui-sm text-tertiary">
                {SCOPE_HINT[s]}
              </span>
            </MenuItem>
          ))}
        </div>
      </Popover>

      <FilterButton
        label={whoLabel}
        active={Boolean(filters.who)}
        open={who.open}
        buttonRef={who.ref}
        onClick={() => who.setOpen(!who.open)}
      />
      <Popover
        open={who.open}
        onClose={() => who.setOpen(false)}
        anchorRef={who.ref}
        width={220}
      >
        <div role="menu" aria-label="Filter by who asked">
          <MenuItem
            selected={!filters.who}
            onSelect={() => {
              onChange({ who: null });
              who.setOpen(false);
            }}
          >
            Anyone
          </MenuItem>
          {users.map((u) => (
            <MenuItem
              key={u.id}
              selected={filters.who === u.id}
              onSelect={() => {
                onChange({ who: u.id });
                who.setOpen(false);
              }}
            >
              <span className="flex items-center gap-2">
                <Avatar initials={u.initials} />
                <span className="truncate">{u.name}</span>
              </span>
            </MenuItem>
          ))}
        </div>
      </Popover>

      <FilterButton
        label={confidenceLabel}
        active={Boolean(filters.confidence)}
        open={confidence.open}
        buttonRef={confidence.ref}
        onClick={() => confidence.setOpen(!confidence.open)}
      />
      <Popover
        open={confidence.open}
        onClose={() => confidence.setOpen(false)}
        anchorRef={confidence.ref}
        width={220}
      >
        <div role="menu" aria-label="Filter by confidence">
          <MenuItem
            selected={!filters.confidence}
            onSelect={() => {
              onChange({ confidence: null });
              confidence.setOpen(false);
            }}
          >
            Any confidence
          </MenuItem>
          {CONFIDENCE_OPTIONS.map((c: ReportConfidence) => (
            <MenuItem
              key={c}
              selected={filters.confidence === c}
              onSelect={() => {
                onChange({ confidence: c });
                confidence.setOpen(false);
              }}
            >
              <span className="flex items-center gap-2">
                <ConfidenceGlyph state={c} size={13} />
                {CONFIDENCE[c].label}
              </span>
            </MenuItem>
          ))}
        </div>
      </Popover>

      <FilterButton
        label={WINDOW_LABEL[filters.window]}
        active={filters.window !== "30"}
        open={period.open}
        buttonRef={period.ref}
        onClick={() => period.setOpen(!period.open)}
      />
      <Popover
        open={period.open}
        onClose={() => period.setOpen(false)}
        anchorRef={period.ref}
        width={200}
      >
        <div role="menu" aria-label="Filter by period">
          {(Object.keys(WINDOW_LABEL) as TimeWindow[]).map((w) => (
            <MenuItem
              key={w}
              selected={filters.window === w}
              onSelect={() => {
                onChange({ window: w });
                period.setOpen(false);
              }}
            >
              {WINDOW_LABEL[w]}
            </MenuItem>
          ))}
        </div>
      </Popover>

      {/* Definition filter — the mechanism behind "what did this change invalidate?" */}
      {activeDefinition || filters.definitionId ? (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent-tint-border bg-accent-tint px-2 text-ui text-accent">
          <span className="text-label uppercase opacity-80">Definition</span>
          <span className="max-w-[220px] truncate">
            {activeDefinition
              ? `${activeDefinition.name} v${activeDefinition.version}`
              : filters.definitionId}
          </span>
          <button
            type="button"
            aria-label="Remove definition filter"
            onClick={() => onChange({ definitionId: null })}
            className="-mr-1 inline-flex h-5 w-5 items-center justify-center rounded-xs transition-colors duration-100 hover:bg-overlay-hover"
          >
            <X size={12} />
          </button>
        </span>
      ) : (
        <>
          <GhostFilterButton
            label="Filter by definition"
            buttonRef={definition.ref}
            open={definition.open}
            onClick={() => definition.setOpen(!definition.open)}
          />
          <Popover
            open={definition.open}
            onClose={() => definition.setOpen(false)}
            anchorRef={definition.ref}
            width={280}
          >
            <div
              role="menu"
              aria-label="Filter by definition"
              className="max-h-[320px] overflow-y-auto"
            >
              {definitions.length === 0 ? (
                <p className="px-2 py-2 text-ui-sm text-tertiary">
                  No definitions have been ratified yet.
                </p>
              ) : (
                definitions.map((d) => (
                  <MenuItem
                    key={d.id}
                    onSelect={() => {
                      onChange({ definitionId: d.id });
                      definition.setOpen(false);
                    }}
                    shortcut={`v${d.version}`}
                  >
                    {d.name}
                  </MenuItem>
                ))
              )}
            </div>
          </Popover>
        </>
      )}

      <span className="flex-1" />

      <span className="shrink-0 text-ui-sm tabular text-tertiary">
        {filtered ? (
          <>
            <span className="text-secondary">{formatCount(shown)}</span> of{" "}
            {formatCount(total)} answers
          </>
        ) : (
          <>{formatCount(total)} answers</>
        )}
      </span>
    </div>
  );
}

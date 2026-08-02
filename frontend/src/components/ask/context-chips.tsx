"use client";

import * as React from "react";
import {
  Calendar,
  ChevronDown,
  Filter,
  Layers,
  Percent,
  Pin,
  Ruler,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Popover, MenuItem } from "@/components/ui/overlays";
import { Input } from "@/components/ui/primitives";
import { ShieldCheckFilled } from "@/components/seal/glyphs";
import { chipTypeLabel, type Chip, type ChipType } from "@/state/ask";

const ICON: Record<ChipType, LucideIcon> = {
  metric: Percent,
  filter: Filter,
  grain: Ruler,
  "time-range": Calendar,
  definition: Layers,
  segment: Layers,
};

/**
 * The state of the conversation, made editable. §9.4.
 * Fixed 24px row height that never wraps, so the answer below it cannot jump.
 */
export function ContextChipRow({
  chips,
  onEdit,
  onRemove,
  onTogglePin,
  onAdd,
  disabled = false,
  className,
}: {
  chips: Chip[];
  onEdit: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onAdd?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [overflowAt, setOverflowAt] = React.useState(chips.length);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const measure = () => {
      const kids = Array.from(el.querySelectorAll<HTMLElement>("[data-chip]"));
      if (kids.length === 0) return;
      const top = kids[0].offsetTop;
      const firstWrapped = kids.findIndex((k) => k.offsetTop > top);
      setOverflowAt(firstWrapped === -1 ? kids.length : Math.max(1, firstWrapped - 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chips.length]);

  const visible = chips.slice(0, overflowAt);
  const hidden = chips.slice(overflowAt);

  const focusChip = (i: number) => {
    rowRef.current
      ?.querySelectorAll<HTMLElement>("[data-chip] > button")
      [Math.max(0, Math.min(chips.length - 1, i))]?.focus();
  };

  if (chips.length === 0 && !onAdd) return null;

  return (
    <div
      ref={rowRef}
      role="toolbar"
      aria-label="Answer context"
      className={cn("flex h-6 items-center gap-1.5 overflow-hidden", className)}
      onKeyDown={(e) => {
        const kids = Array.from(
          rowRef.current?.querySelectorAll<HTMLElement>("[data-chip] > button") ?? [],
        );
        const i = kids.indexOf(document.activeElement as HTMLElement);
        if (e.key === "ArrowRight") {
          e.preventDefault();
          focusChip(i + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          focusChip(i - 1);
        }
      }}
    >
      {visible.map((chip) => (
        <ContextChip
          key={chip.id}
          chip={chip}
          disabled={disabled}
          onEdit={(v) => onEdit(chip.id, v)}
          onRemove={() => onRemove(chip.id)}
          onTogglePin={() => onTogglePin(chip.id)}
        />
      ))}

      {hidden.length > 0 ? (
        <>
          <button
            ref={moreRef}
            type="button"
            data-chip
            onClick={() => setMoreOpen(true)}
            className="h-6 shrink-0 rounded-sm border border-border-subtle bg-surface-2 px-2 text-ui-sm text-tertiary transition-colors duration-100 hover:border-border-hover"
          >
            +{hidden.length} more
          </button>
          <Popover
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            anchorRef={moreRef}
            width={280}
          >
            {hidden.map((chip) => (
              <MenuItem key={chip.id} onSelect={() => setMoreOpen(false)}>
                <span className="text-tertiary">{chipTypeLabel(chip.type)}</span>{" "}
                {chip.value}
              </MenuItem>
            ))}
          </Popover>
        </>
      ) : null}

      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add context"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-dashed border-border-default text-tertiary transition-colors duration-100 hover:border-border-hover hover:text-primary"
        >
          <Plus size={12} />
        </button>
      ) : null}
    </div>
  );
}

function ContextChip({
  chip,
  onEdit,
  onRemove,
  onTogglePin,
  disabled,
}: {
  chip: Chip;
  onEdit: (v: string) => void;
  onRemove: () => void;
  onTogglePin: () => void;
  disabled: boolean;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(chip.value);
  const Icon = ICON[chip.type];

  return (
    <span data-chip className="contents">
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft(chip.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            onRemove();
          }
        }}
        title={
          chip.inferred
            ? "Inferred from your question — click to confirm"
            : `${chipTypeLabel(chip.type)}: ${chip.display ?? chip.value}`
        }
        className={cn(
          "relative flex h-6 shrink-0 items-center gap-1 rounded-sm border bg-surface-2 px-2 transition-colors duration-100",
          chip.inferred ? "border-dashed border-border-default" : "border-border-subtle",
          open ? "border-border-accent" : "hover:border-border-hover",
          chip.changed && "ds-pulse-accent",
          chip.pinned && "pl-2.5",
        )}
      >
        {chip.pinned ? (
          <span
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 left-0 w-0.5 rounded-full bg-[var(--c-accent-solid)]"
          />
        ) : null}
        <Icon size={12} className="shrink-0 text-tertiary" />
        <span className="text-label text-tertiary uppercase">
          {chipTypeLabel(chip.type)}
        </span>
        {chip.fromDefinition ? (
          <ShieldCheckFilled size={10} className="shrink-0 text-verified" />
        ) : null}
        <span className="max-w-[22ch] truncate text-ui-sm font-medium text-primary">
          {chip.display ?? chip.value}
        </span>
        <ChevronDown size={11} className="shrink-0 text-tertiary" />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={300}>
        <div className="p-2">
          <p className="mb-1.5 text-label text-tertiary uppercase">
            {chipTypeLabel(chip.type)}
          </p>
          {chip.inferred ? (
            <p className="mb-2 text-ui-sm text-tertiary">
              Inferred from your question. Confirming records it as a ratification
              candidate.
            </p>
          ) : null}
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setOpen(false);
                if (draft !== chip.value) onEdit(draft);
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onTogglePin();
                setOpen(false);
              }}
              className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-ui-sm text-secondary transition-colors duration-100 hover:bg-overlay-hover"
            >
              <Pin size={12} />
              {chip.pinned ? "Unpin" : "Pin"}
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onRemove();
                }}
                className="h-6 rounded-sm px-1.5 text-ui-sm text-secondary transition-colors duration-100 hover:bg-overlay-hover"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (draft !== chip.value) onEdit(draft);
                }}
                className="h-6 rounded-sm bg-accent-solid px-2 text-ui-sm font-medium text-white transition-colors duration-100 hover:bg-accent-solid-hover"
              >
                {chip.inferred ? "Confirm" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      </Popover>
    </span>
  );
}

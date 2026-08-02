"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

// ---------------------------------------------------------------------------
// Focus trap + escape, shared by every overlay. §8
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  active: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  React.useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    window.requestAnimationFrame(() => {
      const first = node?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node)?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [active, ref, onClose]);
}

const noopSubscribe = () => () => {};

/** Portals only exist on the client; this defers them past hydration. */
function Portal({ children }: { children: React.ReactNode }) {
  const mounted = React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(children, document.body);
}

// ---------------------------------------------------------------------------
// Dialog — §9.11. Scrim has no blur.
// ---------------------------------------------------------------------------

export type DialogWidth = "confirm" | "form" | "wide";

const DIALOG_WIDTH: Record<DialogWidth, string> = {
  confirm: "w-[480px]",
  form: "w-[640px]",
  wide: "w-[880px]",
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  width = "form",
  children,
  footer,
  destructive = false,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  width?: DialogWidth;
  children: React.ReactNode;
  footer?: React.ReactNode;
  destructive?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref, onClose);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 pt-[10vh]">
        <div
          className="ds-fade fixed inset-0 bg-overlay-scrim"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={ref}
          role={destructive ? "alertdialog" : "dialog"}
          aria-modal="true"
          aria-label={typeof title === "string" ? title : undefined}
          className={cn(
            "ds-enter relative z-10 rounded-xl border border-border-default bg-surface-4 shadow-modal",
            DIALOG_WIDTH[width],
            className,
          )}
          style={{ animationDuration: "220ms" }}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <h2 className="text-title text-primary">{title}</h2>
              {description ? (
                <p className="mt-1 text-ui-sm text-secondary">{description}</p>
              ) : null}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose} className="-mt-1 -mr-1">
              <X size={15} />
            </IconButton>
          </div>
          <div className="px-5 py-5">{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}

// ---------------------------------------------------------------------------
// Popover — anchored, overlay elevation
// ---------------------------------------------------------------------------

export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  align = "start",
  className,
  width,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
  width?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = width ?? ref.current?.offsetWidth ?? 240;
      const left = align === "start" ? r.left : r.right - w;
      setPos({
        top: Math.min(r.bottom + 6, window.innerHeight - 24),
        left: Math.max(8, Math.min(left, window.innerWidth - w - 8)),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, align, width]);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        ref.current?.contains(e.target as Node) ||
        anchorRef.current?.contains(e.target as Node)
      )
        return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        style={{
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width,
          animationDuration: "180ms",
        }}
        className={cn(
          "ds-enter fixed z-50 rounded-md border border-border-default bg-surface-3 p-1 shadow-overlay",
          className,
        )}
      >
        {children}
      </div>
    </Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  shortcut,
  danger,
  selected,
  className,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  shortcut?: React.ReactNode;
  danger?: boolean;
  selected?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-ui transition-colors duration-100",
        danger ? "text-contested" : "text-secondary",
        selected ? "bg-overlay-selected text-accent" : "hover:bg-overlay-hover",
        !danger && !selected && "hover:text-primary",
        className,
      )}
    >
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <span className="text-ui-sm text-disabled">{shortcut}</span> : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tooltip — 400ms delay, no fade-out lag
// ---------------------------------------------------------------------------

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });
  const timer = React.useRef<number | undefined>(undefined);
  const ref = React.useRef<HTMLSpanElement>(null);

  const show = () => {
    timer.current = window.setTimeout(() => {
      // The wrapper is `display: contents` (layout-neutral), so IT has no
      // box — its rect is 0×0 at the viewport origin, which anchored every
      // tooltip in the app to the top-left corner (design-audit P1-6).
      // Measure the actual child element instead.
      const el = ref.current?.firstElementChild ?? ref.current;
      const r = el?.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return;
      setPos({
        top: side === "top" ? r.top - 8 : r.bottom + 8,
        left: r.left + r.width / 2,
      });
      setOpen(true);
    }, 400);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <>
      <span
        ref={ref}
        className="contents"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open ? (
        <Portal>
          <div
            role="tooltip"
            style={{
              top: pos.top,
              left: pos.left,
              transform: `translate(-50%, ${side === "top" ? "-100%" : "0"})`,
            }}
            className="ds-fade pointer-events-none fixed z-[60] rounded-md border border-border-default bg-surface-3 px-2 py-1 text-ui-sm text-secondary shadow-overlay"
          >
            {label}
          </div>
        </Portal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Right-docked sheet (mobile / narrow evidence panel)
// ---------------------------------------------------------------------------

export function Drawer({
  open,
  onClose,
  children,
  label,
  width = 380,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  label: string;
  width?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-40">
        <div
          className="ds-fade absolute inset-0 bg-overlay-scrim"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={ref}
          role="dialog"
          aria-label={label}
          style={{ width, animationDuration: "220ms" }}
          className="ds-enter absolute top-0 right-0 h-full border-l border-border-default bg-surface-1 shadow-overlay"
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

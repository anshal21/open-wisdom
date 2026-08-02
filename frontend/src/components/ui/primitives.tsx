"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";

// ---------------------------------------------------------------------------
// Skeleton — geometry must match the loaded layout exactly. §9.13
// ---------------------------------------------------------------------------

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div aria-hidden="true" className={cn("ds-skeleton", className)} style={style} />;
}

// ---------------------------------------------------------------------------
// Card / panel — §9.7
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  padding = "standard",
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  padding?: "compact" | "standard" | "none";
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border-default bg-surface-1",
        padding === "compact" && "p-4",
        padding === "standard" && "p-5",
        interactive &&
          "transition-colors duration-100 hover:border-border-hover hover:bg-surface-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionLabel({
  children,
  className,
  count,
}: {
  children: React.ReactNode;
  className?: string;
  count?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-6 items-center justify-between text-label text-tertiary uppercase",
        className,
      )}
    >
      <span>{children}</span>
      {count !== undefined ? <span className="tabular">{count}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inputs — §9.2
// ---------------------------------------------------------------------------

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-8 w-full rounded-sm border bg-surface-1 px-2.5 text-ui text-primary transition-colors duration-100 outline-none placeholder:text-tertiary",
        invalid ? "border-contested-border" : "border-border-default",
        "focus:border-border-accent",
        "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-disabled",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-sm border border-border-default bg-surface-1 px-2.5 py-1.5 text-ui text-primary transition-colors duration-100 outline-none placeholder:text-tertiary focus:border-border-accent",
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[132px_1fr] items-start gap-4", className)}>
      <label className="pt-1.5 text-ui font-medium text-secondary">
        {label}
        {required ? <span className="ml-0.5 text-accent">*</span> : null}
      </label>
      <div className="min-w-0">
        {children}
        {hint ? <p className="mt-1.5 text-ui-sm text-tertiary">{hint}</p> : null}
      </div>
    </div>
  );
}

export function RadioRow({
  name,
  value,
  checked,
  onChange,
  label,
  description,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-sm px-1.5 py-1 transition-colors duration-100 hover:bg-overlay-hover">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--c-accent-solid)]"
      />
      <span className="min-w-0">
        <span className="block text-ui text-primary">{label}</span>
        {description ? (
          <span className="block text-ui-sm text-tertiary">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Segmented control / tabs
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "sm",
}: {
  options: Array<{ value: T; label: React.ReactNode; count?: number }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "xs" | "sm";
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xs font-medium transition-colors duration-100",
              size === "sm" ? "h-6 px-2.5 text-ui" : "h-5 px-2 text-ui-sm",
              active
                ? "bg-surface-1 text-primary shadow-raised"
                : "text-tertiary hover:text-primary",
            )}
          >
            {o.label}
            {typeof o.count === "number" ? (
              <span
                className={cn(
                  "tabular",
                  active ? "text-tertiary" : "text-disabled",
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string; count?: number; accent?: boolean }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1 border-b border-border-default", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative -mb-px flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-ui font-medium transition-colors duration-100",
              active
                ? "border-border-accent text-primary"
                : "border-transparent text-tertiary hover:text-primary",
            )}
          >
            {o.label}
            {typeof o.count === "number" ? (
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-xs px-1 text-label tabular",
                  o.accent
                    ? "bg-accent-tint text-accent"
                    : "bg-surface-2 text-tertiary",
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kbd
// ---------------------------------------------------------------------------

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-border-default bg-surface-2 px-1 font-sans text-[10.5px] leading-none font-medium text-tertiary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Disclosure — the Tier 2 → Tier 3 device
// ---------------------------------------------------------------------------

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
  contentClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (v: boolean) => {
    setUncontrolled(v);
    onOpenChange?.(v);
  };

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center gap-1.5 rounded-sm py-1 text-ui font-medium text-secondary transition-colors duration-100 hover:text-primary"
      >
        <svg
          width={12}
          height={12}
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={cn(
            "shrink-0 text-tertiary transition-transform duration-100",
            open && "rotate-90",
          )}
        >
          <path
            d="m4.5 3 3 3-3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {summary}
      </button>
      {open ? <div className={cn("ds-fade", contentClassName)}>{children}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — four parts, no illustration, never generic. §9.13
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  headline,
  body,
  action,
  secondary,
  mono,
  className,
}: {
  icon: React.ReactNode;
  headline: string;
  body: React.ReactNode;
  action?: React.ReactNode;
  secondary?: React.ReactNode;
  mono?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      <span className="mb-4 text-tertiary">{icon}</span>
      <h2 className="text-subtitle text-primary">{headline}</h2>
      <p className="mt-1.5 max-w-[46ch] text-ui-sm text-secondary">{body}</p>
      {mono ? <CopyableMono value={mono} className="mt-4" /> : null}
      {action || secondary ? (
        <div className="mt-5 flex items-center gap-3">
          {action}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

export function CopyableMono({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "rounded-sm border border-border-default bg-surface-inset px-2.5 py-1.5 font-mono text-mono-sm text-secondary transition-colors duration-100 hover:border-border-hover",
        className,
      )}
    >
      {copied ? "Copied" : value}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Provenance stamp — §9.16
// ---------------------------------------------------------------------------

export function Avatar({
  initials,
  size = 16,
  className,
}: {
  initials: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-tertiary",
        className,
      )}
    >
      {initials}
    </span>
  );
}

export function ProvenanceStamp({
  name,
  initials,
  at,
  atLabel,
  className,
}: {
  name: string;
  initials?: string;
  at?: string;
  atLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-ui-sm text-tertiary", className)}
    >
      {initials ? <Avatar initials={initials} /> : null}
      <span className="text-secondary">{name}</span>
      {atLabel ? (
        <>
          <span aria-hidden="true">·</span>
          <time dateTime={at} title={at}>
            {atLabel}
          </time>
        </>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Coverage bar — the "excluded rows are always visualised" device. data-viz §6.2
// ---------------------------------------------------------------------------

export function CoverageBar({
  included,
  total,
  reason,
  className,
  hue = "accent",
  compact = false,
}: {
  included: number;
  total: number;
  reason?: string;
  className?: string;
  hue?: "accent" | "series";
  compact?: boolean;
}) {
  const pct = total > 0 ? Math.min(100, (included / total) * 100) : 0;
  const low = pct < 95;
  const label = `${formatCount(included)} of ${formatCount(total)} ${total === 1 ? "row" : "rows"}`;

  return (
    <div className={cn("w-full", className)}>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${label}${reason ? ` — ${reason}` : ""}`}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor:
              hue === "accent" ? "var(--c-accent-solid)" : "var(--viz-1)",
          }}
        />
      </div>
      {!compact ? (
        <p
          className={cn(
            "mt-1.5 text-ui-sm tabular",
            low ? "text-qualified" : "text-tertiary",
          )}
        >
          {label}
          {reason ? <span className="font-normal"> — {reason}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

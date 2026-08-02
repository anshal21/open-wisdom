"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A native select wearing the input spec (§9.2). Native keeps the keyboard and
 * screen-reader behaviour correct for free, which a hand-rolled listbox in a
 * settings form does not earn.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
  ariaLabel,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  size?: "sm" | "md";
}) {
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          "w-full appearance-none rounded-sm border border-border-default bg-surface-1 pr-7 pl-2.5 text-ui text-primary transition-colors duration-100 outline-none",
          size === "md" ? "h-8" : "h-7",
          "focus:border-border-accent",
          "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-disabled",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute right-2 text-tertiary"
      />
    </span>
  );
}

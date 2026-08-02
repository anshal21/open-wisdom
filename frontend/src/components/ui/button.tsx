"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-solid text-white hover:bg-accent-solid-hover active:bg-accent-solid-hover",
  secondary:
    "bg-surface-2 text-primary border border-border-default hover:border-border-hover",
  ghost: "bg-transparent text-secondary hover:bg-overlay-hover hover:text-primary",
  outline:
    "bg-transparent text-primary border border-border-strong hover:bg-overlay-hover",
  danger:
    "bg-contested-bg text-contested border border-contested-border hover:border-contested",
};

const SIZE: Record<ButtonSize, string> = {
  xs: "h-6 rounded-sm px-1.5 text-ui-sm gap-1",
  sm: "h-7 rounded-sm px-2.5 text-ui gap-1.5",
  md: "h-8 rounded-md px-3 text-ui gap-1.5",
  lg: "h-10 rounded-md px-4 text-body gap-2",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  xs: "w-6 px-0",
  sm: "w-7 px-0",
  md: "w-8 px-0",
  lg: "w-10 px-0",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  /** Keeps the label and the width — a button that shrinks is a layout shift. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      iconOnly = false,
      loading = false,
      className,
      children,
      disabled,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors duration-100 select-none",
          SIZE[size],
          iconOnly && ICON_SIZE[size],
          VARIANT[variant],
          (disabled || loading) &&
            "cursor-not-allowed bg-surface-2 text-disabled hover:bg-surface-2 hover:text-disabled",
          disabled && variant === "primary" && "border border-border-default",
          className,
        )}
        {...props}
      >
        {loading ? (
          <svg
            width={14}
            height={14}
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="ds-spin shrink-0"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeWidth={2}
            />
            <path
              d="M8 2a6 6 0 0 1 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        ) : null}
        {children}
      </button>
    );
  },
);

/** Icon buttons are ghost, square, and require an accessible name. */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "iconOnly"> & { label: string }
>(function IconButton({ label, size = "sm", variant = "ghost", ...props }, ref) {
  return (
    <Button
      ref={ref}
      iconOnly
      size={size}
      variant={variant}
      aria-label={label}
      title={label}
      {...props}
    />
  );
});

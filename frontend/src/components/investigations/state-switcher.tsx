"use client";

import * as React from "react";
import { Layers } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { MenuItem, Popover } from "@/components/ui/overlays";

/**
 * Demo affordance. screens.md §14 requires all five states to be built, not
 * stubbed; this is how a reviewer reaches the four that a healthy fixture does
 * not produce on its own. It is a ghost icon button in the header actions and
 * carries no product meaning.
 */
export type DemoState = "live" | "loading" | "streaming" | "empty" | "error";

const LABEL: Record<DemoState, string> = {
  live: "Live",
  loading: "Loading",
  streaming: "Streaming",
  empty: "Empty",
  error: "Error",
};

export function StateSwitcher({
  value,
  onChange,
  options,
}: {
  value: DemoState;
  onChange: (v: DemoState) => void;
  options: DemoState[];
}) {
  const anchor = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <IconButton
        ref={anchor}
        label={`Preview state — ${LABEL[value]}`}
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className={value === "live" ? undefined : "text-accent"}
      >
        <Layers size={15} />
      </IconButton>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        align="end"
        width={180}
      >
        <p className="px-2 pt-1 pb-1.5 text-label text-tertiary uppercase">Preview state</p>
        {options.map((o) => (
          <MenuItem
            key={o}
            selected={o === value}
            onSelect={() => {
              onChange(o);
              setOpen(false);
            }}
          >
            {LABEL[o]}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

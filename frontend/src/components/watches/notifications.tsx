"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { Watch } from "@/lib/api/types";
import { formatRelative, isoTitle } from "@/lib/format";
import { TriangleAlertFilled } from "@/components/seal/glyphs";
import { IconButton } from "@/components/ui/button";
import { Popover } from "@/components/ui/overlays";
import { breachSentence } from "./model";

/**
 * In-app notification rendering. screens.md §9.4.
 *
 * A popover, never a modal. Firing watches render as `qualified`-tinted rows.
 * The badge is never red — nothing here is an emergency until a watch is
 * contested, and a watch cannot be contested.
 */
export function NotificationsButton({ watches }: { watches: Watch[] }) {
  const anchor = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const firing = watches.filter((w) => w.status === "firing");

  return (
    <>
      <span className="relative flex items-center">
        <IconButton
          ref={anchor}
          label={
            firing.length
              ? `Notifications — ${firing.length} firing`
              : "Notifications — nothing firing"
          }
          size="sm"
          onClick={() => setOpen((v) => !v)}
        >
          <Bell size={15} />
        </IconButton>
        {firing.length > 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-qualified-border bg-qualified-bg px-1 text-[10px] leading-none font-semibold text-qualified tabular"
          >
            {firing.length}
          </span>
        ) : null}
      </span>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        align="end"
        width={360}
      >
        <p className="px-2 pt-1 pb-1.5 text-label text-tertiary uppercase">
          Notifications
        </p>
        {firing.length === 0 ? (
          <p className="px-2 pb-2 text-ui-sm text-secondary">
            Nothing is firing. Watches that pass their pre-alert checks appear here.
          </p>
        ) : (
          <ul className="space-y-1">
            {firing.map((w) => {
              const sentence = breachSentence(w);
              return (
                <li key={w.id}>
                  <Link
                    href={`/watches/${w.id}`}
                    onClick={() => setOpen(false)}
                    className="block rounded-sm border border-qualified-border bg-qualified-bg px-2.5 py-2 transition-colors duration-100 hover:border-border-hover"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="shrink-0 text-qualified">
                        <TriangleAlertFilled size={13} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
                        {w.name}
                      </span>
                      {w.last_fired_at ? (
                        <time
                          dateTime={isoTitle(w.last_fired_at)}
                          className="shrink-0 text-ui-sm text-tertiary"
                        >
                          {formatRelative(w.last_fired_at)}
                        </time>
                      ) : null}
                    </span>
                    {sentence ? (
                      <span className="mt-0.5 block text-ui-sm tabular text-secondary">
                        {sentence}
                      </span>
                    ) : null}
                    {w.held_hours ? (
                      <span className="mt-0.5 block text-ui-sm text-accent">
                        Held {w.held_hours} hours before notifying.
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Popover>
    </>
  );
}

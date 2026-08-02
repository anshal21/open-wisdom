"use client";

/**
 * The notebook's name, editable in place.
 *
 * A notebook you cannot rename is stuck with "Untitled notebook" forever,
 * which makes the list surface useless the moment there are three of them.
 * Click (or focus and press Enter) to edit; Enter or blur commits, Escape
 * reverts. An empty name is refused rather than saved — a nameless row in a
 * list is worse than the placeholder.
 */

import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/cn";

export function NotebookTitle({
  name,
  onRename,
  className,
}: {
  name: string;
  onRename: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // The draft is seeded when editing STARTS rather than synced from `name` in
  // an effect. Syncing a prop into state through an effect is a cascading
  // render, and it also races: a rename landing mid-typing would overwrite
  // what the user is in the middle of writing.
  const beginEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    onRename(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label="Notebook name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(name);
            setEditing(false);
          }
        }}
        className={cn(
          "w-full max-w-[46ch] rounded-sm border border-border-accent bg-surface-1 px-1.5 py-0.5",
          "text-title-lg text-primary outline-none",
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={beginEdit}
      title="Rename this notebook"
      className={cn(
        "group/title -mx-1.5 inline-flex max-w-full items-center gap-2 rounded-sm px-1.5 py-0.5 text-left",
        "transition-colors duration-100 hover:bg-overlay-hover",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--c-border-accent)]",
        className,
      )}
    >
      <span className="min-w-0 truncate text-title-lg text-primary">{name}</span>
      <Pencil
        size={13}
        aria-hidden="true"
        className="shrink-0 text-tertiary opacity-0 transition-opacity duration-100 group-hover/title:opacity-100"
      />
    </button>
  );
}

"use client";

import { Dialog } from "@/components/ui/overlays";
import { Kbd } from "@/components/ui/primitives";
import { ALT, MOD } from "@/lib/keyboard";
import { useUi } from "@/state/ui";

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "Global",
    items: [
      [`${MOD}K`, "Command palette"],
      ["/", "Focus the ask composer"],
      [`${MOD}\\`, "Collapse or expand the rail"],
      ["E", "Toggle the evidence panel"],
      [`${ALT}E`, "Evidence, expanded to the derivation"],
      [`${MOD}↵`, "Submit"],
      ["Esc", "Close overlay, clear selection, blur composer"],
      ["?", "This sheet"],
      [`${MOD}.`, "Toggle theme"],
    ],
  },
  {
    title: "Navigate",
    items: [
      ["G then A", "Ask"],
      ["G then L", "Ledger"],
      ["G then D", "Definitions"],
      ["G then B", "Dashboards"],
      ["G then N", "Notebooks"],
      ["G then I", "Investigations"],
      ["G then W", "Watches"],
      ["G then S", "Sources"],
    ],
  },
  {
    title: "Answer",
    items: [
      ["S", "Show SQL"],
      ["C", "Copy for Slack"],
      ["R", "Re-run"],
      ["P", "Copy permalink"],
      ["F", "Follow up"],
      ["D", "Add to dashboard"],
      ["I", "Start an investigation"],
      ["1…9", "Focus the Nth context chip"],
      ["⌫", "Remove the focused chip"],
    ],
  },
  {
    title: "Lists",
    items: [
      ["↑ ↓", "Move"],
      ["↵", "Open"],
      ["Space", "Preview"],
      ["X", "Select"],
      [`${MOD}A`, "Select all"],
    ],
  },
];

export function ShortcutsSheet() {
  const { shortcutsOpen, setShortcutsOpen } = useUi();
  return (
    <Dialog
      open={shortcutsOpen}
      onClose={() => setShortcutsOpen(false)}
      title="Keyboard shortcuts"
      width="wide"
    >
      <div className="grid grid-cols-2 gap-x-8 gap-y-6">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-label text-tertiary uppercase">{g.title}</h3>
            <dl className="space-y-1">
              {g.items.map(([key, label]) => (
                <div key={key} className="flex h-6 items-center justify-between gap-4">
                  <dt className="truncate text-ui text-secondary">{label}</dt>
                  <dd className="shrink-0">
                    <Kbd>{key}</Kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

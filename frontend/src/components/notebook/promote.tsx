"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Radar, Stamp } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DashboardSummary } from "@/lib/api/types";
import { addDashboardTile, createWatch, getDashboards } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, Tooltip } from "@/components/ui/overlays";
import { Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { RatifySheet } from "@/components/definitions/ratify-sheet";
import {
  answerIdOf,
  canPromoteToTile,
  tileBlockReason,
  type CellView,
} from "./cell-model";

/**
 * §7.4 — promotion is the notebook's reason for existing, so it is one click
 * from the cell footer rather than buried behind a menu.
 */
export function PromoteBar({
  cell,
  index,
  className,
}: {
  cell: CellView;
  index: number;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [ratifyOpen, setRatifyOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const [placing, setPlacing] = React.useState(false);
  const answerId = answerIdOf(cell);
  // A tile references an answer. Without one there is nothing to place, no
  // matter how the cell's seal reads.
  const canTile = canPromoteToTile(cell) && Boolean(answerId);
  // A watch alerts on a ratified definition; a cell whose answer used none
  // has nothing to watch. Say that instead of offering a button that lies.
  const definition = cell.answer?.definition_used ?? null;
  const label = cell.kind === "question" ? cell.source.trim() : "";
  const name = label ? label.replace(/\?$/, "").slice(0, 60) : `Cell ⌗${index + 1}`;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="mr-1 text-label text-tertiary uppercase">Promote</span>

      <Button size="xs" variant="ghost" onClick={() => setRatifyOpen(true)}>
        <Stamp size={12} />
        To definition
      </Button>

      {canTile ? (
        <Button size="xs" variant="ghost" onClick={() => setPickerOpen(true)}>
          <LayoutGrid size={12} />
          To dashboard tile
        </Button>
      ) : (
        <Tooltip label={answerId ? tileBlockReason(cell) : "Run this cell first — a tile references an answer."}>
          <Button size="xs" variant="ghost" disabled>
            <LayoutGrid size={12} />
            To dashboard tile
          </Button>
        </Tooltip>
      )}

      {definition ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            void createWatch({
              definition_id: definition.id,
              schedule: "daily",
              condition: { kind: "change_pct", value: 10, direction: "either" },
            })
              .then(() =>
                toast({
                  kind: "success",
                  message: `Watching “${definition.name}” for a 10% daily change.`,
                  action: {
                    label: "Open watches",
                    onClick: () => router.push("/watches"),
                  },
                }),
              )
              .catch(() =>
                toast({ kind: "error", message: "The watch could not be created." }),
              );
          }}
        >
          <Radar size={12} />
          To watch
        </Button>
      ) : (
        <Tooltip label="A watch alerts on a ratified definition. Promote this cell to a definition first.">
          <Button size="xs" variant="ghost" disabled>
            <Radar size={12} />
            To watch
          </Button>
        </Tooltip>
      )}

      {/* One-shot form: mounted only while open, so it is seeded fresh. */}
      {ratifyOpen ? (
        <RatifySheet
          open
          onClose={() => setRatifyOpen(false)}
          name={name}
          plainEnglish={cell.report?.headline ?? ""}
          expression={cell.source}
          onRatified={() =>
            toast({
              kind: "success",
              message: `“${name}” ratified.`,
              action: {
                label: "Open definitions",
                onClick: () => router.push("/definitions"),
              },
            })
          }
        />
      ) : null}

      <DashboardPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        busy={placing}
        onPick={(d) => {
          if (!answerId) return;
          setPlacing(true);
          void addDashboardTile(d.id, { answer_id: answerId, w: 3, h: 2 })
            .then(() => {
              setPickerOpen(false);
              toast({
                kind: "success",
                message: `Tile added to ${d.name}.`,
                action: {
                  label: "Open dashboard",
                  onClick: () => router.push(`/dashboards/${d.id}`),
                },
              });
            })
            .catch(() =>
              toast({ kind: "error", message: "The tile could not be added." }),
            )
            .finally(() => setPlacing(false));
        }}
      />
    </div>
  );
}

function DashboardPicker({
  open,
  onClose,
  onPick,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (d: DashboardSummary) => void;
  busy?: boolean;
}) {
  const [rows, setRows] = React.useState<DashboardSummary[] | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    void getDashboards().then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="confirm"
      title="Place on a dashboard"
      description="The tile keeps this cell's seal and links back to its evidence."
    >
      <ul className="flex flex-col gap-0.5">
        {rows === null
          ? Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="flex h-9 items-center px-2">
                <Skeleton className="h-3 w-full max-w-[220px]" />
              </li>
            ))
          : rows.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(d)}
                  className="flex h-9 w-full items-center gap-3 rounded-sm px-2 text-left transition-colors duration-100 hover:bg-overlay-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-ui text-primary">
                    {d.name}
                  </span>
                  <span className="shrink-0 text-ui-sm tabular text-tertiary">
                    {d.tile_count} {d.tile_count === 1 ? "tile" : "tiles"}
                  </span>
                </button>
              </li>
            ))}
      </ul>
    </Dialog>
  );
}

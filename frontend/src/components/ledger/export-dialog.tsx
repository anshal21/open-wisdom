"use client";

import * as React from "react";
import { Download } from "lucide-react";
import type { AnswerSummary } from "@/lib/api/types";
import { formatCount } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { RadioRow } from "@/components/ui/primitives";
import { ShieldCheckFilled } from "@/components/seal/glyphs";
import {
  buildExport,
  downloadFile,
  previewOf,
  type ExportFormat,
} from "./export";

/**
 * §5.4 — CSV and JSON. The preview exists to prove the point: the confidence
 * state and the check summary travel with every row. An export that strips the
 * warrant recreates the exact failure this product exists to prevent.
 */
export function ExportDialog({
  onClose,
  filtered,
  selected,
  scopeLabel,
  nameOf,
  onDone,
}: {
  onClose: () => void;
  /** Everything currently on screen after filters. */
  filtered: AnswerSummary[];
  /** The rows the user has selected, if any. */
  selected: AnswerSummary[];
  scopeLabel: string;
  nameOf: (userId: string) => string;
  onDone: (filename: string, count: number) => void;
}) {
  const [format, setFormat] = React.useState<ExportFormat>("csv");
  const [onlySelected, setOnlySelected] = React.useState(selected.length > 0);

  const rows = onlySelected && selected.length > 0 ? selected : filtered;
  const meta = React.useMemo(
    () => ({
      generatedAt: new Date().toISOString(),
      scope:
        onlySelected && selected.length > 0 ? "Selected answers" : scopeLabel,
      nameOf,
    }),
    [onlySelected, selected.length, scopeLabel, nameOf],
  );

  const file = React.useMemo(
    () => buildExport(format, rows, meta),
    [format, rows, meta],
  );

  return (
    <Dialog
      open
      onClose={onClose}
      width="form"
      title="Export answers"
      description="Every row carries the confidence state it was recorded with."
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              downloadFile(file.filename, file.mime, file.text);
              onDone(file.filename, rows.length);
              onClose();
            }}
          >
            <Download size={13} aria-hidden="true" />
            Download {format.toUpperCase()}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-label text-tertiary uppercase">Format</p>
          <RadioRow
            name="export-format"
            value="csv"
            checked={format === "csv"}
            onChange={() => setFormat("csv")}
            label="CSV"
            description="Header comment block, one row per answer, a _confidence column."
          />
          <RadioRow
            name="export-format"
            value="json"
            checked={format === "json"}
            onChange={() => setFormat("json")}
            label="JSON"
            description="Same record, with the check tally as a nested object."
          />
        </div>

        <div>
          <p className="mb-1.5 text-label text-tertiary uppercase">Rows</p>
          <RadioRow
            name="export-scope"
            value="filtered"
            checked={!onlySelected}
            onChange={() => setOnlySelected(false)}
            label={`${formatCount(filtered.length)} answers in this view`}
            description={scopeLabel}
          />
          <RadioRow
            name="export-scope"
            value="selected"
            checked={onlySelected}
            onChange={() => selected.length > 0 && setOnlySelected(true)}
            label={
              selected.length > 0
                ? `${formatCount(selected.length)} selected`
                : "Selected answers"
            }
            description={
              selected.length > 0
                ? "Only the rows you selected."
                : "Nothing is selected yet."
            }
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-label text-tertiary uppercase">Preview</p>
            <span className="text-ui-sm tabular text-tertiary">
              {file.filename}
            </span>
          </div>
          <pre className="max-h-[220px] overflow-auto rounded-lg border border-border-default bg-surface-inset p-3 font-mono text-mono-sm whitespace-pre text-secondary">
            {previewOf(file.text)}
          </pre>
        </div>

        <p className="flex items-start gap-2 rounded-md border border-verified-border bg-verified-bg px-3 py-2 text-ui-sm text-secondary">
          <ShieldCheckFilled
            size={14}
            className="mt-px shrink-0 text-verified"
          />
          <span>
            The confidence state and the check summary are written for every
            row. A number that leaves here without its warrant is the failure
            this ledger exists to prevent.
          </span>
        </p>
      </div>
    </Dialog>
  );
}

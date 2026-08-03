"use client";

import * as React from "react";
import {
  ApiFailure,
  getDefinition,
  getDefinitionImpact,
  ratifyDefinition,
  updateDefinition,
} from "@/lib/api/client";
import type { DefinitionImpact } from "@/lib/api/types";
import { formatCount } from "@/lib/format";
import { useHotkeys, MOD } from "@/lib/keyboard";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import {
  Field,
  Input,
  Kbd,
  RadioRow,
  SectionLabel,
  Skeleton,
  Textarea,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export interface RatifySheetProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill. */
  name?: string;
  plainEnglish?: string;
  expression?: string;
  definitionId?: string; // when editing/versioning an existing definition
  sourceAnswerId?: string;
  /** The id is the definition the submit created or updated — callers that
   * continue a refused ask thread pass it to resolve so the answer is
   * credited with the definition instead of warning "chosen ad hoc". */
  onRatified?: (name: string, definitionId: string) => void;
}

type Scope = "workspace" | "personal";
type Precedence = "official" | "preferred";

/** 47 answers took about 40 seconds in the fixture; the rate is the constant. */
const SECONDS_PER_ANSWER = 0.85;

const NO_IMPACT: DefinitionImpact = {
  affected_answers: 0,
  sample: [],
  would_change: false,
};

function rerunEstimate(answers: number): string {
  const seconds = Math.max(5, Math.round((answers * SECONDS_PER_ANSWER) / 5) * 5);
  if (seconds < 90) return `about ${seconds} seconds`;
  const minutes = Math.round(seconds / 30) / 2;
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * screens.md §4.4 — the one-click ratify sheet, reachable from a fork card, a
 * proposal, an answer's evidence panel, or the definitions surface.
 *
 * Two things are load-bearing here: plain English comes first and is required
 * (a definition a business reader cannot read is theater), and the impact block
 * is never hidden — while it loads it is a skeleton, because telling you what a
 * change invalidates *before* you click is the whole point of the ledger.
 */
/**
 * Mount-gate. Rendering the form only while open makes every opening a fresh
 * mount, so its `useState` initialisers seed from the props of that moment.
 *
 * This replaces an effect that re-seeded eight fields on every open — the ask
 * page keeps the sheet mounted across openings, so mount-time seeding alone
 * used to trap whatever the props were at page load (an empty name, and a
 * Ratify button that could never enable). A remount says the same thing
 * without a render committed purely to overwrite state.
 */
export function RatifySheet(props: RatifySheetProps): React.ReactElement | null {
  if (!props.open) return null;
  return <RatifySheetForm {...props} />;
}

function RatifySheetForm({
  open,
  onClose,
  name: nameProp,
  plainEnglish: plainEnglishProp,
  expression: expressionProp,
  definitionId,
  sourceAnswerId,
  onRatified,
}: RatifySheetProps): React.ReactElement | null {
  const { toast } = useToast();

  const [name, setName] = React.useState(nameProp ?? "");
  const [plainEnglish, setPlainEnglish] = React.useState(plainEnglishProp ?? "");
  const [expression, setExpression] = React.useState(expressionProp ?? "");
  const [scope, setScope] = React.useState<Scope>("workspace");
  const [precedence, setPrecedence] = React.useState<Precedence>("official");
  const [rerun, setRerun] = React.useState(true);

  const [impact, setImpact] = React.useState<DefinitionImpact | null>(null);
  const [impactError, setImpactError] = React.useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = React.useState<number | null>(null);

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // The impact preview, plus the real current version for the submit label.
  React.useEffect(() => {
    if (!open || !definitionId) return;
    let live = true;

    void (async () => {
      try {
        const [next, existing] = await Promise.all([
          getDefinitionImpact(definitionId),
          getDefinition(definitionId).catch(() => null),
        ]);
        if (!live) return;
        setImpact(next);
        if (existing) {
          setCurrentVersion(existing.version);
          setName((v) => v || existing.name);
          setPlainEnglish((v) => v || existing.plain_english);
          setExpression((v) => v || existing.expression);
        }
      } catch (err) {
        if (!live) return;
        setImpactError(
          err instanceof ApiFailure
            ? err.message
            : "The impact preview didn't load.",
        );
      }
    })();

    return () => {
      live = false;
    };
  }, [open, definitionId]);

  // A definition that does not exist yet cannot have invalidated anything, so
  // the block resolves immediately rather than sitting in a skeleton forever.
  const resolvedImpact = definitionId ? impact : NO_IMPACT;

  const trimmedName = name.trim();
  const trimmedPlain = plainEnglish.trim();
  const missingPlainEnglish = trimmedPlain.length === 0;
  const missingName = trimmedName.length === 0;
  const canSubmit = !missingPlainEnglish && !missingName && !saving;

  const submit = React.useCallback(async () => {
    if (!canSubmit) return;
    setSaving(true);
    setSaveError(null);
    const body = {
      name: trimmedName,
      plain_english: trimmedPlain,
      expression: expression.trim(),
      source_answer_id: sourceAnswerId,
      scope,
      precedence,
      rerun_affected: rerun,
    };
    try {
      const saved = definitionId
        ? await updateDefinition(definitionId, body)
        : await ratifyDefinition(body);

      const version = currentVersion !== null ? currentVersion + 1 : 1;
      const affected = resolvedImpact?.affected_answers ?? 0;
      onRatified?.(trimmedName, saved.id);
      onClose();
      toast({
        kind: "success",
        message:
          affected > 0 && rerun
            ? `Ratified “${trimmedName}” as v${version}. Re-running ${formatCount(
                affected,
              )} recorded answers.`
            : affected > 0
              ? `Ratified “${trimmedName}” as v${version}. ${formatCount(
                  affected,
                )} recorded answers are now Superseded.`
              : `Ratified “${trimmedName}” as v${version}.`,
      });
    } catch (err) {
      setSaveError(
        err instanceof ApiFailure
          ? err.message
          : "The definition wasn't ratified. Nothing was changed.",
      );
    } finally {
      setSaving(false);
    }
  }, [
    canSubmit,
    trimmedName,
    trimmedPlain,
    expression,
    sourceAnswerId,
    scope,
    precedence,
    rerun,
    definitionId,
    currentVersion,
    resolvedImpact,
    onRatified,
    onClose,
    toast,
  ]);

  useHotkeys(
    [
      {
        key: "Enter",
        mod: true,
        allowInEditable: true,
        run: () => {
          if (open) void submit();
        },
      },
    ],
    [open, submit],
  );

  if (!open) return null;

  const submitLabel =
    currentVersion !== null ? `Ratify as v${currentVersion + 1}` : "Ratify";
  const term = trimmedName || nameProp || "this definition";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="form"
      title={nameProp ? `Ratify “${nameProp}”` : "Ratify a definition"}
      description={
        definitionId
          ? "A new version is recorded. Every answer that used the old reading stays in the ledger."
          : "Ratified definitions are used without asking, and every answer records which one it used."
      }
      footer={
        <>
          {missingPlainEnglish ? (
            <p className="mr-auto text-ui-sm text-tertiary">
              Plain English is required — it is what a business reader sees.
            </p>
          ) : missingName ? (
            <p className="mr-auto text-ui-sm text-tertiary">
              A definition needs a name before it can be ratified.
            </p>
          ) : saveError ? (
            <p className="mr-auto text-ui-sm text-contested">{saveError}</p>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
            loading={saving}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {nameProp ? null : (
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The word people use for it"
              autoComplete="off"
            />
          </Field>
        )}

        <Field
          label="Plain English"
          required
          hint="Two lines a non-technical reader can check."
        >
          <Textarea
            rows={2}
            value={plainEnglish}
            onChange={(e) => setPlainEnglish(e.target.value)}
            placeholder="What this counts, and what it leaves out."
          />
        </Field>

        <Field label="Expression">
          <Textarea
            rows={3}
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            spellCheck={false}
            className="font-mono text-mono"
            placeholder="The expression this resolves to."
          />
        </Field>

        <Field label="Applies to">
          <div className="-mx-1.5">
            <RadioRow
              name="ratify-scope"
              value="workspace"
              checked={scope === "workspace"}
              onChange={(v) => setScope(v as Scope)}
              label="This workspace"
            />
            <RadioRow
              name="ratify-scope"
              value="personal"
              checked={scope === "personal"}
              onChange={(v) => setScope(v as Scope)}
              label="Just me"
            />
          </div>
        </Field>

        <Field label="Precedence">
          <div className="-mx-1.5">
            <RadioRow
              name="ratify-precedence"
              value="official"
              checked={precedence === "official"}
              onChange={(v) => setPrecedence(v as Precedence)}
              label="Official"
              description="Use without asking."
            />
            <RadioRow
              name="ratify-precedence"
              value="preferred"
              checked={precedence === "preferred"}
              onChange={(v) => setPrecedence(v as Precedence)}
              label="Preferred"
              description="Use, but keep flagging alternatives."
            />
          </div>
        </Field>
      </div>

      <ImpactBlock
        impact={resolvedImpact}
        error={impactError}
        term={term}
        rerun={rerun}
        onRerunChange={setRerun}
      />

      <p className="mt-4 flex items-center gap-1.5 text-ui-sm text-tertiary">
        <Kbd>{MOD}</Kbd>
        <Kbd>↵</Kbd>
        <span>ratifies.</span>
      </p>
    </Dialog>
  );
}

/**
 * Mandatory. It is shown as a skeleton while it loads and it is never removed
 * from the layout — no competitor tells you what a definition change
 * invalidates, and hiding it while it loads would give that up.
 */
function ImpactBlock({
  impact,
  error,
  term,
  rerun,
  onRerunChange,
}: {
  impact: DefinitionImpact | null;
  error: string | null;
  term: string;
  rerun: boolean;
  onRerunChange: (v: boolean) => void;
}) {
  const affected = impact?.affected_answers ?? 0;

  return (
    <section className="mt-5 border-t border-border-subtle pt-4">
      <SectionLabel>This will affect</SectionLabel>

      {error ? (
        <p className="mt-2 text-ui text-qualified">
          {error} Ratifying is still safe — affected answers are marked
          Superseded either way.
        </p>
      ) : impact === null ? (
        <div className="mt-2 space-y-2" aria-hidden="true">
          <div className="flex h-[22px] items-center">
            <Skeleton className="h-3.5 w-[368px] max-w-full" />
          </div>
          <div className="flex h-6 items-center">
            <Skeleton className="h-3 w-[292px] max-w-full" />
          </div>
          <div className="flex h-6 items-center">
            <Skeleton className="h-3 w-[248px] max-w-full" />
          </div>
        </div>
      ) : affected === 0 ? (
        <p className="mt-2 text-ui text-secondary">
          No recorded answer used a different reading of &ldquo;{term}&rdquo;.
          Nothing in the ledger changes.
        </p>
      ) : (
        <>
          <p className="mt-2 text-body text-primary">
            <span className="tabular">{formatCount(affected)}</span> recorded{" "}
            {affected === 1 ? "answer" : "answers"} used a different reading of
            &ldquo;{term}&rdquo;.
          </p>
          <div className="mt-1 -mx-1.5">
            <RadioRow
              name="ratify-rerun"
              value="leave"
              checked={!rerun}
              onChange={() => onRerunChange(false)}
              label="Leave them as they are"
              description="They will be marked Superseded."
            />
            <RadioRow
              name="ratify-rerun"
              value="rerun"
              checked={rerun}
              onChange={() => onRerunChange(true)}
              label="Re-run them now"
              description={rerunEstimate(affected)}
            />
          </div>
        </>
      )}
    </section>
  );
}

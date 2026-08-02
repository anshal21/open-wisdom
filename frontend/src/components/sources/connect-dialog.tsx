"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { Catalog, Source, SourceKind } from "@/lib/api/types";
import { ApiFailure, createSource, deleteSource, introspectSource } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Field, Input, Skeleton } from "@/components/ui/primitives";
import { EngineTile } from "./connection-state";
import { engineFor, enginesFor, type Engine } from "./engines";
import { FindingsStrip } from "./findings-strip";
import { findingsFor, useStagger, type Finding } from "./introspection";

/* ---------------------------------------------------------------------------
   Progress rail — Credentials → Connect
--------------------------------------------------------------------------- */

/**
 * Two steps, and it used to be three.
 *
 * The middle one was "Test": a 700ms `setTimeout` that reported a latency
 * derived from hashing the form values, a hardcoded server version, and SQL
 * grants inferred from a regular expression over the role name. It contacted
 * nothing. A mistyped path passed it exactly as convincingly as a correct one,
 * and then the wizard finished without creating a source at all — the whole
 * flow was a drawing of a flow.
 *
 * There is one honest test available and it is introspection: connect, list
 * tables, profile columns. It either works, in which case the numbers on screen
 * are real, or it fails, in which case the message is the engine's own. So the
 * fabricated step is gone rather than reimplemented, and the real work is what
 * the progress rail counts.
 */
const STEPS = ["Credentials", "Connect"] as const;

function StepRail({ step }: { step: number }) {
  return (
    <div className="mb-5">
      <ol className="flex items-center gap-6">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold tabular",
                  done && "border-verified-border bg-verified-bg text-verified",
                  active && "border-border-accent bg-accent-tint text-accent",
                  !done && !active && "border-border-default text-disabled",
                )}
              >
                {done ? <Check size={10} strokeWidth={2.5} /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-ui",
                  active ? "font-medium text-primary" : done ? "text-secondary" : "text-disabled",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent-solid transition-[width] duration-180"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Dialog
--------------------------------------------------------------------------- */

/**
 * Mount-gate, same reasoning as RatifySheet: rendering the body only while
 * open makes each opening a fresh mount, so `useState` initialisers seed from
 * the props of that moment. The two effects this replaces existed purely to
 * overwrite six fields on open — a render committed to undo the previous one.
 */
export function ConnectDialog(props: ConnectDialogProps): React.ReactElement | null {
  if (!props.open) return null;
  return <ConnectDialogForm {...props} />;
}

interface ConnectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Which connectors this build registers, from `GET /sources/kinds`. */
  kinds: SourceKind[];
  engineId?: SourceKind;
  editing?: Source | null;
  /** Called once a source is created and introspected, with its name. */
  onConnected?: (name: string) => void;
}

/** The form's starting values for an engine, and for the source being edited. */
function seedValues(engine: Engine, editing?: Source | null): Record<string, string> {
  const base: Record<string, string> = {};
  for (const f of engine.fields) base[f.name] = "";
  if (editing) {
    base.name = editing.name;
    if ("path" in base) base.path = editing.database ?? "";
    if ("dsn" in base) base.dsn = editing.database ?? "";
  }
  return base;
}

function ConnectDialogForm({
  open,
  onClose,
  kinds,
  engineId,
  editing,
  onConnected,
}: ConnectDialogProps) {
  const router = useRouter();
  const available = React.useMemo(() => enginesFor(kinds), [kinds]);
  const [engine, setEngine] = React.useState<Engine>(() =>
    engineFor(engineId ?? kinds[0] ?? "duckdb"),
  );
  const [step, setStep] = React.useState(0);
  // Seeded at mount. The dialog is mount-gated on `open`, so "seed on open"
  // and "seed at mount" are now the same moment.
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    seedValues(engineFor(engineId ?? kinds[0] ?? "duckdb"), editing),
  );
  const [connecting, setConnecting] = React.useState(false);
  const [findings, setFindings] = React.useState<Finding[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // The source this dialog created, so a retry re-introspects it rather than
  // registering a second row, and abandoning the attempt can clean it up.
  const createdId = React.useRef<string | null>(null);

  const complete =
    (values.name ?? "").trim().length > 0 && engine.toDSN(values).length > 0;

  const chooseEngine = React.useCallback((e: Engine) => {
    setEngine(e);
    // Field names differ between engines; carrying the old values across would
    // leave a `path` in a form that asks for a `dsn`.
    setValues((v) => {
      const next = seedValues(e);
      if (v.name) next.name = v.name;
      return next;
    });
  }, []);

  /**
   * Create the source, then introspect it.
   *
   * Introspection is the connection test. It runs against a source that now
   * exists, which is the only way the API offers to open a connection — and
   * that is fine, because a source whose connection failed is *visible* in the
   * list with a `failed` status and can be deleted, which beats a wizard that
   * silently produced nothing at all.
   */
  const connect = React.useCallback(async () => {
    setStep(1);
    setFindings(null);
    setError(null);
    setConnecting(true);
    try {
      if (!createdId.current) {
        const src = await createSource({
          name: values.name.trim(),
          kind: engine.id,
          dsn: engine.toDSN(values),
        });
        createdId.current = src.id;
      }
      const catalog: Catalog = await introspectSource(createdId.current);
      setFindings(findingsFor(catalog));
    } catch (err) {
      setError(
        err instanceof ApiFailure
          ? err.message
          : "The connection could not be opened.",
      );
    } finally {
      setConnecting(false);
    }
  }, [engine, values]);

  /**
   * Going back to edit abandons the attempt, so the next Connect registers a
   * fresh source instead of re-introspecting the old DSN — a source row still
   * holds the connection string it was created with, and there is no way to
   * change it.
   */
  const editAgain = React.useCallback(() => {
    const id = createdId.current;
    createdId.current = null;
    setError(null);
    setFindings(null);
    setStep(0);
    if (id) void deleteSource(id).catch(() => undefined);
  }, []);

  const shown = useStagger(findings?.length ?? 0, findings !== null);
  const introspected = findings !== null && shown >= findings.length;

  const announced = React.useRef(false);
  React.useEffect(() => {
    if (!open) announced.current = false;
  }, [open]);
  React.useEffect(() => {
    if (!introspected || announced.current) return;
    announced.current = true;
    onConnected?.(values.name ?? engine.label);
  }, [introspected, onConnected, values.name, engine.label, open]);

  const title = editing ? `Edit ${editing.name}` : "Connect a warehouse";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={
        step === 0
          ? "We introspect the schema for you. There is no modeling step."
          : undefined
      }
      width="form"
      footer={
        <Footer
          step={step}
          connecting={connecting}
          complete={complete}
          error={error}
          introspected={introspected}
          onCancel={onClose}
          onBack={editAgain}
          onConnect={() => void connect()}
          onRetry={() => void connect()}
          onAsk={() => {
            onClose();
            router.push("/ask");
          }}
        />
      }
    >
      <StepRail step={step} />

      {step === 0 ? (
        <div className="space-y-4">
          <Field label="Engine">
            <div className="flex flex-wrap gap-1.5">
              {available.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => chooseEngine(e)}
                  aria-pressed={e.id === engine.id}
                  className={cn(
                    "inline-flex h-8 items-center gap-2 rounded-sm border px-2.5 text-ui transition-colors duration-100",
                    e.id === engine.id
                      ? "border-border-accent bg-accent-tint text-accent"
                      : "border-border-default bg-surface-1 text-secondary hover:border-border-hover hover:text-primary",
                  )}
                >
                  <EngineTile monogram={e.monogram} size={18} className="bg-transparent border-0" />
                  {e.label}
                </button>
              ))}
            </div>
            {available.length === 1 ? (
              <p className="mt-2 max-w-[54ch] text-ui-sm text-tertiary">
                This build registers one connector. Adding another is a single Go
                file — see CONTRIBUTING.md — and it appears here automatically.
              </p>
            ) : null}
          </Field>

          {engine.fields.map((f) => (
            <Field key={f.name} label={f.label} hint={f.hint} required={!f.secret}>
              <Input
                type={f.secret ? "password" : "text"}
                value={values[f.name] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.name]: e.target.value }))
                }
              />
            </Field>
          ))}
        </div>
      ) : null}

      {step === 1 ? (
        <div>
          {error ? (
            <div className="rounded-md border border-contested-border bg-contested-bg px-3.5 py-3">
              <p className="text-subtitle text-contested">
                The connection could not be opened
              </p>
              {/* The engine's own words. A paraphrase here would cost the one
                  piece of information that identifies the problem. */}
              <p className="mt-1 break-words text-ui-sm text-secondary">{error}</p>
            </div>
          ) : connecting || findings === null ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-40" />
            </div>
          ) : (
            <div>
              <FindingsStrip findings={findings} shown={shown} />
              <p className="mt-3 max-w-[52ch] text-ui-sm text-secondary">
                {introspected
                  ? "The connection is live, and every figure above was read from your warehouse just now. Column roles, relationships and date columns were inferred from the schema and will be refined as you use them."
                  : "Reading the schema. Nothing is copied out of the warehouse."}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

function Footer({
  step,
  connecting,
  complete,
  error,
  introspected,
  onCancel,
  onBack,
  onConnect,
  onRetry,
  onAsk,
}: {
  step: number;
  connecting: boolean;
  complete: boolean;
  error: string | null;
  introspected: boolean;
  onCancel: () => void;
  onBack: () => void;
  onConnect: () => void;
  onRetry: () => void;
  onAsk: () => void;
}) {
  if (step === 0) {
    return (
      <>
        <Button variant="ghost" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="md" disabled={!complete} onClick={onConnect}>
          Connect
        </Button>
      </>
    );
  }
  if (error) {
    return (
      <>
        <Button variant="ghost" size="md" onClick={onBack}>
          Edit connection
        </Button>
        <Button variant="primary" size="md" loading={connecting} onClick={onRetry}>
          Retry
        </Button>
      </>
    );
  }
  return (
    <>
      <Button variant="ghost" size="md" onClick={onCancel}>
        Done
      </Button>
      <Button
        variant="primary"
        size="md"
        loading={connecting}
        disabled={!introspected}
        onClick={onAsk}
      >
        Ask your first question
      </Button>
    </>
  );
}

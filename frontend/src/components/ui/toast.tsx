"use client";

import * as React from "react";
import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

export type ToastKind = "success" | "info" | "warning" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastContext {
  toast: (t: Omit<Toast, "id">) => void;
}

const Ctx = React.createContext<ToastContext>({ toast: () => {} });

export const useToast = () => React.useContext(Ctx);

/** Errors never auto-dismiss — they require dismissal or an action. §9.10 */
const TTL: Record<ToastKind, number | null> = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: null,
};

const GLYPH: Record<ToastKind, React.ReactNode> = {
  success: <Check size={14} className="text-verified" />,
  info: <Info size={14} className="text-accent" />,
  warning: <TriangleAlert size={14} className="text-qualified" />,
  error: <CircleAlert size={14} className="text-contested" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
      const ttl = TTL[t.kind];
      if (ttl) window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-6 bottom-6 z-[70] flex w-[360px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="ds-enter pointer-events-auto flex items-start gap-2 rounded-md border border-border-default bg-surface-3 p-3 shadow-overlay"
          >
            <span className="mt-px shrink-0">{GLYPH[t.kind]}</span>
            <p className="min-w-0 flex-1 text-ui text-secondary">{t.message}</p>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 text-ui font-medium text-accent hover:underline"
              >
                {t.action.label}
              </button>
            ) : null}
            <IconButton
              label="Dismiss"
              size="xs"
              onClick={() => dismiss(t.id)}
              className="-my-0.5 -mr-1"
            >
              <X size={13} />
            </IconButton>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function cnToastKind(kind: ToastKind) {
  return cn(kind);
}

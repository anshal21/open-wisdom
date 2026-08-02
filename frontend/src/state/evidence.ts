"use client";

import { create } from "zustand";
import type { Check, CheckId } from "@/lib/api/types";
import type { ConfidenceState } from "@/lib/confidence";

export interface EvidenceDefinition {
  id: string;
  name: string;
  version?: number;
  ratifiedBy?: string;
  ratifiedAt?: string;
  /** Inferred definitions offer a one-click ratify path. */
  inferred?: boolean;
}

export interface EvidenceSubject {
  id: string;
  /** What the panel is pinned to: "this answer", "tile · Revenue", … */
  label: string;
  title?: string;
  state: ConfidenceState;
  headline?: string;
  checks: Check[];
  /** Absent for a refused subject — a refusal has no check tally. */
  passed?: number;
  total?: number;
  /** During generation, the checklist is shown up front in a pending state. */
  pendingChecks?: CheckId[];
  definitions?: EvidenceDefinition[];
  coverage?: { included: number; total: number; reason?: string };
  derivation?: {
    paths: Array<{ label: string; sql: string }>;
    rowCount?: number;
    scannedRows?: number;
    elapsedMs?: number;
    model?: string;
    llmCalls?: number;
    usd?: number;
  };
}

interface EvidenceState {
  subject: EvidenceSubject | null;
  pinned: boolean;
  setSubject: (s: EvidenceSubject | null) => void;
  setPinned: (v: boolean) => void;
}

export const useEvidence = create<EvidenceState>((set, get) => ({
  subject: null,
  pinned: false,
  setSubject: (s) => {
    if (get().pinned && s && get().subject && s.id !== get().subject?.id) return;
    set({ subject: s });
  },
  setPinned: (v) => set({ pinned: v }),
}));

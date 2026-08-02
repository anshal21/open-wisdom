"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type EvidenceTier = 2 | 3;

interface UiState {
  railCollapsed: boolean;
  toggleRail: () => void;
  setRailCollapsed: (v: boolean) => void;

  evidenceOpen: boolean;
  setEvidenceOpen: (v: boolean) => void;
  toggleEvidence: () => void;

  /** Tier 3 (derivation) expanded. */
  evidenceTier: EvidenceTier;
  setEvidenceTier: (t: EvidenceTier) => void;

  evidenceWidth: number;
  setEvidenceWidth: (w: number) => void;

  density: "compact" | "comfortable";
  setDensity: (d: "compact" | "comfortable") => void;

  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
}

export const EVIDENCE_MIN = 320;
export const EVIDENCE_MAX = 560;
export const EVIDENCE_DEFAULT = 380;

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      railCollapsed: false,
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
      setRailCollapsed: (v) => set({ railCollapsed: v }),

      evidenceOpen: true,
      setEvidenceOpen: (v) => set({ evidenceOpen: v }),
      toggleEvidence: () => set((s) => ({ evidenceOpen: !s.evidenceOpen })),

      evidenceTier: 2,
      setEvidenceTier: (t) => set({ evidenceTier: t }),

      evidenceWidth: EVIDENCE_DEFAULT,
      setEvidenceWidth: (w) =>
        set({ evidenceWidth: Math.max(EVIDENCE_MIN, Math.min(EVIDENCE_MAX, w)) }),

      density: "compact",
      setDensity: (d) => set({ density: d }),

      paletteOpen: false,
      setPaletteOpen: (v) => set({ paletteOpen: v }),

      shortcutsOpen: false,
      setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
    }),
    {
      name: "analyst.ui",
      partialize: (s) => ({
        railCollapsed: s.railCollapsed,
        evidenceOpen: s.evidenceOpen,
        evidenceWidth: s.evidenceWidth,
        density: s.density,
      }),
    },
  ),
);

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { AnswerSummary, Definition } from "@/lib/api/types";
import {
  getAnswers,
  getDashboards,
  getDefinitions,
  getInvestigations,
  getNotebooks,
  getSources,
  getWatches,
} from "@/lib/api/client";
import { transportLabel } from "@/lib/api/config";
import { WORKSPACE_NAME } from "@/lib/api/mock/base";
import { useHotkeys } from "@/lib/keyboard";
import { useTheme } from "@/providers/theme-provider";
import { useUi, EVIDENCE_MAX, EVIDENCE_MIN } from "@/state/ui";
import { useEvidence } from "@/state/evidence";
import { Drawer } from "@/components/ui/overlays";
import { EvidencePanel } from "@/components/evidence/evidence-panel";
import { CommandPalette } from "./command-palette";
import { LeftRail } from "./left-rail";
import { ShortcutsSheet } from "./shortcuts-sheet";
import type { NavCounts } from "./nav";

function useViewport() {
  const [w, setW] = React.useState(1440);
  React.useEffect(() => {
    const on = () => setW(window.innerWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toggle: toggleTheme } = useTheme();
  const {
    railCollapsed,
    setRailCollapsed,
    toggleRail,
    evidenceOpen,
    setEvidenceOpen,
    toggleEvidence,
    evidenceWidth,
    setEvidenceWidth,
    setEvidenceTier,
    setPaletteOpen,
    setShortcutsOpen,
  } = useUi();
  const clearPin = useEvidence((s) => s.setPinned);

  const [counts, setCounts] = React.useState<NavCounts>({});
  const [answers, setAnswers] = React.useState<AnswerSummary[]>([]);
  const [definitions, setDefinitions] = React.useState<Definition[]>([]);
  const [watchFiring, setWatchFiring] = React.useState(false);
  const [definitionsDirty, setDefinitionsDirty] = React.useState(false);
  const [transport, setTransport] = React.useState<"live" | "demo">("demo");

  const width = useViewport();
  const overlayEvidence = width < 1280;
  const forceCollapsed = width < 1280 && width >= 768;
  const railHidden = width < 768;

  React.useEffect(() => {
    if (forceCollapsed) setRailCollapsed(true);
  }, [forceCollapsed, setRailCollapsed]);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const [defs, dashboards, notebooks, investigations, watches, sources, ledger, mode] =
        await Promise.all([
          getDefinitions(),
          getDashboards(),
          getNotebooks(),
          getInvestigations(),
          getWatches(),
          getSources(),
          getAnswers(),
          transportLabel(),
        ]);
      if (!alive) return;
      setDefinitions(defs);
      setAnswers(ledger);
      setTransport(mode);
      setWatchFiring(watches.some((w) => w.status === "firing"));
      setDefinitionsDirty(ledger.some((a) => a.superseded));
      setCounts({
        // Derived from the answers just fetched, like every other count here.
        // This used to call getAnswerCount(), which returned a fixture constant
        // (1204) in every mode — so a first run showed "Ledger 1.2k" in the
        // sidebar directly above a page reading "No answers yet".
        ledger: ledger.length,
        definitions: defs.filter((d) => d.status === "ratified").length,
        dashboards: dashboards.length,
        notebooks: notebooks.length,
        investigations: investigations.length,
        watches: watches.length,
        sources: sources.length,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  useHotkeys(
    [
      { key: "k", mod: true, allowInEditable: true, run: () => setPaletteOpen(true) },
      { key: "\\", mod: true, run: toggleRail },
      { key: ".", mod: true, allowInEditable: true, run: toggleTheme },
      { key: "e", run: toggleEvidence },
      {
        key: "e",
        alt: true,
        allowInEditable: true,
        run: () => {
          setEvidenceOpen(true);
          setEvidenceTier(3);
        },
      },
      { key: "?", run: () => setShortcutsOpen(true) },
      { key: "Escape", run: () => clearPin(false) },
      { key: "g a", run: () => router.push("/ask") },
      { key: "g l", run: () => router.push("/ledger") },
      { key: "g d", run: () => router.push("/definitions") },
      { key: "g b", run: () => router.push("/dashboards") },
      { key: "g n", run: () => router.push("/notebooks") },
      { key: "g i", run: () => router.push("/investigations") },
      { key: "g w", run: () => router.push("/watches") },
      { key: "g s", run: () => router.push("/sources") },
    ],
    [router, toggleRail, toggleTheme, toggleEvidence],
  );

  // Drag-resize the evidence panel.
  const dragging = React.useRef(false);
  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      setEvidenceWidth(window.innerWidth - e.clientX);
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setEvidenceWidth]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-canvas">
      {!railHidden ? (
        <LeftRail
          workspace={WORKSPACE_NAME}
          counts={counts}
          user={{ name: "Dana Okafor", initials: "DO" }}
          watchFiring={watchFiring}
          definitionsDirty={definitionsDirty}
          transport={transport}
        />
      ) : null}

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>

        {evidenceOpen && !overlayEvidence ? (
          <div
            className="relative flex shrink-0 border-l border-border-default"
            style={{ width: evidenceWidth }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize evidence panel"
              tabIndex={0}
              onMouseDown={() => {
                dragging.current = true;
                document.body.style.cursor = "col-resize";
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setEvidenceWidth(evidenceWidth + 16);
                if (e.key === "ArrowRight") setEvidenceWidth(evidenceWidth - 16);
              }}
              className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
              title={`${EVIDENCE_MIN}–${EVIDENCE_MAX}px`}
            />
            <EvidencePanel className="w-full" />
          </div>
        ) : null}
      </div>

      {overlayEvidence ? (
        <Drawer
          open={evidenceOpen}
          onClose={() => setEvidenceOpen(false)}
          label="Evidence"
          width={Math.min(evidenceWidth, width - 48)}
        >
          <EvidencePanel className="h-full" />
        </Drawer>
      ) : null}

      <CommandPalette answers={answers} definitions={definitions} />
      <ShortcutsSheet />
      {railCollapsed ? null : null}
    </div>
  );
}

/** Standard content scroller for every surface. */
export function SurfaceBody({
  children,
  scrollRef,
  className,
  wide = false,
}: {
  children: React.ReactNode;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      ref={scrollRef}
      className={`min-h-0 flex-1 overflow-y-auto ${className ?? ""}`}
    >
      <div
        className={`mx-auto w-full px-6 py-6 ${wide ? "max-w-[1440px]" : "max-w-[1080px]"}`}
      >
        {children}
      </div>
    </div>
  );
}

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, PanelLeft, PanelRight, X } from "lucide-react";
import { AI_TOOLS_PATH, openAIToolsWindow } from "@/lib/ai-tools/access";
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO, clampRatio, isNarrow, type Dock } from "@/lib/ai-tools/split-pane";
import { loadDock, loadRatio, saveDock, saveRatio } from "@/lib/ai-tools/split-pane";
import { cn } from "@/lib/utils";

const KEY_STEP = 0.05;

export type ManagementPaneValue = {
  available: boolean;
  open: boolean;
  dock: Dock;
  ratio: number;
  toggle: () => void;
  close: () => void;
  setDock: (dock: Dock) => void;
  setRatio: (ratio: number) => void;
};

const noop = () => {};
// Returned outside a provider (e.g. non-admin shells): inert, never opens.
const UNAVAILABLE: ManagementPaneValue = { available: false, open: false, dock: "right", ratio: DEFAULT_RATIO,
  toggle: noop, close: noop, setDock: noop, setRatio: noop };

const ManagementPaneContext = createContext<ManagementPaneValue | null>(null);

/** Holds open/dock/ratio state for the in-portal Management split pane. */
export function ManagementPaneProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dock, setDockState] = useState<Dock>(() => loadDock());
  const [ratio, setRatioState] = useState<number>(() => loadRatio());

  useEffect(() => saveDock(dock), [dock]);
  useEffect(() => saveRatio(ratio), [ratio]);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  const setDock = useCallback((d: Dock) => setDockState(d), []);
  const setRatio = useCallback((r: number) => setRatioState(clampRatio(r)), []);

  const value = useMemo<ManagementPaneValue>(
    () => ({ available: true, open, dock, ratio, toggle, close, setDock, setRatio }),
    [open, dock, ratio, toggle, close, setDock, setRatio]
  );

  return <ManagementPaneContext.Provider value={value}>{children}</ManagementPaneContext.Provider>;
}

/** Returns the pane controls, or a safe no-op object (available=false) outside a provider. */
export function useManagementPane(): ManagementPaneValue {
  return useContext(ManagementPaneContext) ?? UNAVAILABLE;
}

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => isNarrow());
  useEffect(() => {
    const onResize = () => setNarrow(isNarrow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

const toolbarButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";

function PaneToolbar({ pane, showDock }: { pane: ManagementPaneValue; showDock: boolean }) {
  const target: Dock = pane.dock === "right" ? "left" : "right";
  const dockLabel = target === "left" ? "Dock left" : "Dock right";
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
      <span className="flex-1 truncate text-xs font-semibold text-[#c2571a]">Management</span>
      {showDock && (
        <button
          type="button"
          aria-label={dockLabel}
          title={dockLabel}
          className={toolbarButton}
          onClick={() => pane.setDock(target)}
        >
          {target === "left" ? <PanelLeft className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        aria-label="Pop out"
        title="Pop out"
        className={toolbarButton}
        onClick={() => {
          openAIToolsWindow();
          pane.close();
        }}
      >
        <ExternalLink className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Close Management"
        title="Close Management"
        className={toolbarButton}
        onClick={pane.close}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function ManagementFrame({ blockPointer }: { blockPointer: boolean }) {
  return (
    <iframe
      src={AI_TOOLS_PATH}
      title="Management"
      className="h-full w-full border-0"
      style={blockPointer ? { pointerEvents: "none" } : undefined}
    />
  );
}

/**
 * Lays out portal content next to the Management pane (an iframe of
 * /ai-tools) with a draggable/keyboard-resizable divider. Renders only the
 * children while the pane is closed.
 */
export function ManagementSplit({ children }: { children: React.ReactNode }) {
  const pane = useManagementPane();
  const { open, dock, ratio, setRatio } = pane;
  const narrow = useIsNarrow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent | MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const raw = dock === "right" ? (rect.right - e.clientX) / rect.width : (e.clientX - rect.left) / rect.width;
      setRatio(raw);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, dock, setRatio]);

  useEffect(() => {
    if (!open || narrow) setDragging(false);
  }, [open, narrow]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Arrow keys move the divider; the pane grows when the divider moves away from its docked edge.
    const towardPane = dock === "right" ? KEY_STEP : -KEY_STEP;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = ratio + towardPane;
    else if (e.key === "ArrowRight") next = ratio - towardPane;
    else if (e.key === "Home") next = MIN_RATIO;
    else if (e.key === "End") next = MAX_RATIO;
    if (next === null) return;
    e.preventDefault();
    setRatio(Math.round(next * 100) / 100);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // jsdom / unsupported pointer ids: window listeners still handle the drag
    }
    setDragging(true);
  };

  // Content keeps a stable, keyed tree position so opening, closing,
  // re-docking or crossing the narrow breakpoint never remounts the portal page.
  const content = (
    <div key="content" className="flex min-w-0 flex-1 flex-col">
      {children}
    </div>
  );
  const overlay = (
    <div
      key="overlay"
      data-testid="management-pane"
      data-narrow="true"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <PaneToolbar pane={pane} showDock={false} />
      <div className="min-h-0 flex-1">
        <ManagementFrame blockPointer={false} />
      </div>
    </div>
  );
  const divider = (
    <div
      key="divider"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={25}
      aria-valuemax={75}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label="Resize Management pane"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      className={cn(
        "sticky top-0 h-[100dvh] w-1.5 shrink-0 cursor-col-resize touch-none bg-border hover:bg-[#c2571a]/60 focus-visible:bg-[#c2571a] focus-visible:outline-none",
        dragging && "bg-[#c2571a]"
      )}
    />
  );
  const managementPane = (
    <aside
      key="pane"
      data-testid="management-pane"
      style={{ width: `${ratio * 100}%` }}
      className="sticky top-0 flex h-[100dvh] shrink-0 flex-col bg-background"
    >
      <PaneToolbar pane={pane} showDock />
      <div className="min-h-0 flex-1">
        <ManagementFrame blockPointer={dragging} />
      </div>
    </aside>
  );

  const split = open && !narrow;
  let items: React.ReactNode[] = [content];
  if (split) items = dock === "left" ? [managementPane, divider, content] : [content, divider, managementPane];
  else if (open) items = [content, overlay];

  return (
    <div
      ref={containerRef}
      data-testid={split ? "management-split" : undefined}
      data-dock={split ? dock : undefined}
      className={cn("flex min-w-0 flex-1", split && "min-h-[100dvh]", dragging && "cursor-col-resize select-none")}
    >
      {items}
    </div>
  );
}

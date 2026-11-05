import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, PanelLeft, PanelRight, X } from "lucide-react";
import { AI_TOOLS_PATH, openAIToolsWindow } from "@/lib/ai-tools/access";
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO, clampRatio, isNarrow, type Dock } from "@/lib/ai-tools/split-pane";
import { loadDock, loadRatio, saveDock, saveRatio } from "@/lib/ai-tools/split-pane";
import {
  isDockManagementMessage,
  isFromOwnOrigin,
  isOpenJobMessage,
  isOwnManagementPopout
} from "@/lib/ai-tools/management-messages";
import { takeOpenPaneOnLoad } from "@/lib/ai-tools/dock";
import { jobPath } from "@/lib/ai-tools/open-job";
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
  /** Opens Management in its own window and closes the split pane. */
  popOut: () => void;
  /** Callback ref for the pane iframe; messages are only accepted from its contentWindow (or the pop-out). */
  frameRef: (el: HTMLIFrameElement | null) => void;
};

const noop = () => {};
// Returned outside a provider (e.g. non-admin shells): inert, never opens.
const UNAVAILABLE: ManagementPaneValue = { available: false, open: false, dock: "right", ratio: DEFAULT_RATIO,
  toggle: noop, close: noop, setDock: noop, setRatio: noop, popOut: noop, frameRef: noop };

const ManagementPaneContext = createContext<ManagementPaneValue | null>(null);

function defaultOpenJob(id: number) {
  window.location.assign(jobPath(id));
}

/**
 * Holds open/dock/ratio state for the in-portal Management split pane and
 * receives messages from the pane iframe / pop-out window:
 *  - humphreys-open-job (iframe or pop-out): navigate the portal to the job, pane stays open.
 *  - humphreys-dock-management (pop-out only): re-open the split pane with the saved side/width.
 * Messages are dropped unless origin, source window and exact shape all match.
 */
export function ManagementPaneProvider({
  children,
  onOpenJob = defaultOpenJob
}: {
  children: React.ReactNode;
  /** Navigates the portal to a job (ProtectedShell passes the router's navigate). */
  onOpenJob?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dock, setDockState] = useState<Dock>(() => loadDock());
  const [ratio, setRatioState] = useState<number>(() => loadRatio());
  const frameEl = useRef<HTMLIFrameElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const openJobRef = useRef(onOpenJob);
  openJobRef.current = onOpenJob;

  useEffect(() => saveDock(dock), [dock]);
  useEffect(() => saveRatio(ratio), [ratio]);

  // "Dock back" from a pop-out whose opener was gone navigates that window here with this flag set.
  useEffect(() => {
    if (takeOpenPaneOnLoad()) setOpen(true);
  }, []);

  // Never keep two copies: opening the pane in this window closes our pop-out.
  useEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    popupRef.current = null;
    try {
      if (popup && !popup.closed) popup.close();
    } catch {
      // ignore
    }
  }, [open]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isFromOwnOrigin(event)) return;
      const source = event.source;
      if (!source) return;
      const frameWindow = frameEl.current?.contentWindow ?? null;
      const fromFrame = frameWindow !== null && source === frameWindow;
      const fromPopup = (popupRef.current !== null && source === popupRef.current) || isOwnManagementPopout(source);
      if (!fromFrame && !fromPopup) return;

      if (isOpenJobMessage(event.data)) {
        // Remember a pop-out opened before a reload so opening the pane can still close it.
        if (fromPopup) popupRef.current = source as Window;
        openJobRef.current(event.data.id);
        return;
      }
      if (fromPopup && isDockManagementMessage(event.data)) {
        // The pop-out closes itself after sending this.
        popupRef.current = null;
        setOpen(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  const setDock = useCallback((d: Dock) => setDockState(d), []);
  const setRatio = useCallback((r: number) => setRatioState(clampRatio(r)), []);
  const popOut = useCallback(() => {
    popupRef.current = openAIToolsWindow();
    setOpen(false);
  }, []);
  const frameRef = useCallback((el: HTMLIFrameElement | null) => {
    frameEl.current = el;
  }, []);

  const value = useMemo<ManagementPaneValue>(
    () => ({ available: true, open, dock, ratio, toggle, close, setDock, setRatio, popOut, frameRef }),
    [open, dock, ratio, toggle, close, setDock, setRatio, popOut, frameRef]
  );

  return <ManagementPaneContext.Provider value={value}>{children}</ManagementPaneContext.Provider>;
}

/** Returns the pane controls, or a safe no-op object (available=false) outside a provider. */
export function useManagementPane(): ManagementPaneValue {
  return useContext(ManagementPaneContext) ?? UNAVAILABLE;
}

export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => isNarrow());
  useEffect(() => {
    const onResize = () => setNarrow(isNarrow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

/** True while the pane is docked beside the portal (open and not in the narrow overlay mode). */
export function useManagementDocked(): boolean {
  const pane = useManagementPane();
  const narrow = useIsNarrow();
  return pane.available && pane.open && !narrow;
}

const toolbarButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";

function PaneToolbar({ pane, showDock }: { pane: ManagementPaneValue; showDock: boolean }) {
  const target: Dock = pane.dock === "right" ? "left" : "right";
  const dockLabel = target === "left" ? "Dock left" : "Dock right";
  return (
    <div className="sticky top-0 z-10 flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
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
        onClick={pane.popOut}
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

function ManagementFrame({
  blockPointer,
  frameRef
}: {
  blockPointer: boolean;
  frameRef: (el: HTMLIFrameElement | null) => void;
}) {
  return (
    <iframe
      ref={frameRef}
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

  const split = open && !narrow;

  // While docked each side scrolls on its own; the document itself must not scroll.
  useEffect(() => {
    if (!split) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overflow, body.style.overflow];
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev[0];
      body.style.overflow = prev[1];
    };
  }, [split]);

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
    <div
      key="content"
      data-testid="management-content"
      className={cn("flex min-w-0 flex-1 flex-col", split && "h-[100dvh] min-h-0 overflow-y-auto overscroll-contain")}
    >
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
        <ManagementFrame blockPointer={false} frameRef={pane.frameRef} />
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
        "h-[100dvh] w-1.5 shrink-0 cursor-col-resize touch-none bg-border hover:bg-[#c2571a]/60 focus-visible:bg-[#c2571a] focus-visible:outline-none",
        dragging && "bg-[#c2571a]"
      )}
    />
  );
  const managementPane = (
    <aside
      key="pane"
      data-testid="management-pane"
      style={{ width: `${ratio * 100}%` }}
      className="flex h-[100dvh] min-h-0 shrink-0 flex-col overflow-y-auto overscroll-contain bg-background"
    >
      <PaneToolbar pane={pane} showDock />
      <div className="min-h-0 flex-1">
        <ManagementFrame blockPointer={dragging} frameRef={pane.frameRef} />
      </div>
    </aside>
  );

  let items: React.ReactNode[] = [content];
  if (split) items = dock === "left" ? [managementPane, divider, content] : [content, divider, managementPane];
  else if (open) items = [content, overlay];

  return (
    <div
      ref={containerRef}
      data-testid={split ? "management-split" : undefined}
      data-dock={split ? dock : undefined}
      className={cn("flex min-w-0 flex-1", split && "h-[100dvh] min-h-0 overflow-hidden", dragging && "cursor-col-resize select-none")}
    >
      {items}
    </div>
  );
}

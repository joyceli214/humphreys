"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Portal layout breakpoints, measured against the space the portal actually
 * has (beside a docked Management pane) instead of the viewport.
 *
 * - Permanent sidebar vs. hamburger: the old Tailwind `md` viewport breakpoint.
 * - Work-order two-column grid: the old `xl` (1280) viewport breakpoint minus
 *   the `w-64` sidebar, i.e. the content column width it implied.
 */
export const PORTAL_DESKTOP_SIDEBAR_MIN = 768;
export const PORTAL_WORK_ORDER_TWO_COLUMN_MIN = 1024;
const SIDEBAR_WIDTH = 256;

export type PortalWidth = {
  /** Width available to the portal (sidebar + content column) beside Management. */
  availableWidth: number;
  /** Width of the portal content column (Topbar + main). */
  contentWidth: number;
};

export function isPortalDesktopSidebar(width: PortalWidth): boolean {
  return width.availableWidth >= PORTAL_DESKTOP_SIDEBAR_MIN;
}

export function isPortalWorkOrderTwoColumn(width: PortalWidth): boolean {
  return width.contentWidth >= PORTAL_WORK_ORDER_TWO_COLUMN_MIN;
}

/** Viewport-based estimate used before the first measurement / outside a provider. */
export function portalWidthFromViewport(viewport: number): PortalWidth {
  return {
    availableWidth: viewport,
    contentWidth: viewport >= PORTAL_DESKTOP_SIDEBAR_MIN ? viewport - SIDEBAR_WIDTH : viewport
  };
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 1280 : window.innerWidth;
}

type PortalWidthContextValue = PortalWidth & {
  sidebarRef: (el: HTMLElement | null) => void;
  contentRef: (el: HTMLElement | null) => void;
};

export const PortalWidthContext = createContext<PortalWidthContextValue | null>(null);

function useViewportPortalWidth(enabled: boolean): PortalWidth {
  const [width, setWidth] = useState(() => portalWidthFromViewport(viewportWidth()));
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onResize = () => setWidth(portalWidthFromViewport(viewportWidth()));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled]);
  return width;
}

/**
 * Returns the current portal width. Outside a provider (isolated page tests,
 * standalone routes) it falls back to the viewport, matching the old behavior.
 */
export function usePortalWidth(): PortalWidth {
  const ctx = useContext(PortalWidthContext);
  const fallback = useViewportPortalWidth(ctx === null);
  return ctx ?? fallback;
}

/** Ref setters for the elements the provider measures (no-ops outside a provider). */
export function usePortalWidthRefs() {
  const ctx = useContext(PortalWidthContext);
  return { sidebarRef: ctx?.sidebarRef, contentRef: ctx?.contentRef };
}

function useObservedWidth(): [(el: HTMLElement | null) => void, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return [ref, width];
}

/**
 * Measures the sidebar wrapper and the portal content column with
 * ResizeObserver. The sidebar decision uses sidebar + content so hiding the
 * sidebar (which hands its width to the content column) never flips the
 * decision back — the sum only shrinks when the sidebar hides.
 */
export function PortalWidthProvider({ children }: { children: ReactNode }) {
  const [sidebarRef, sidebarWidth] = useObservedWidth();
  const [contentRef, contentWidth] = useObservedWidth();
  const fallback = useViewportPortalWidth(contentWidth === null);

  const value = useMemo<PortalWidthContextValue>(() => {
    const measured =
      contentWidth === null
        ? fallback
        : { availableWidth: contentWidth + (sidebarWidth ?? 0), contentWidth };
    return { ...measured, sidebarRef, contentRef };
  }, [contentWidth, sidebarWidth, fallback, sidebarRef, contentRef]);

  return <PortalWidthContext.Provider value={value}>{children}</PortalWidthContext.Provider>;
}

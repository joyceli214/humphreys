// "Dock back" from the pop-out Management window into the portal split pane.

import { DOCK_MANAGEMENT_MESSAGE, ownOrigin, sameOriginOpener } from "@/lib/ai-tools/management-messages";

/** localStorage flag the portal reads on load to open the split pane (used when the opener is gone). */
export const OPEN_PANE_ON_LOAD_KEY = "humphreys.management.open-on-load";
export const OPEN_PANE_FLAG_TTL_MS = 60 * 1000;

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageOf(storage?: FlagStorage): FlagStorage | null {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function setOpenPaneOnLoad(now: number = Date.now(), storage?: FlagStorage): void {
  try {
    storageOf(storage)?.setItem(OPEN_PANE_ON_LOAD_KEY, String(now));
  } catch {
    // best-effort
  }
}

/** Reads and clears the flag. True only if it was set within the TTL. */
export function takeOpenPaneOnLoad(now: number = Date.now(), storage?: FlagStorage): boolean {
  try {
    const s = storageOf(storage);
    const raw = s?.getItem(OPEN_PANE_ON_LOAD_KEY);
    if (raw == null) return false;
    s?.removeItem(OPEN_PANE_ON_LOAD_KEY);
    const at = Number(raw);
    return Number.isFinite(at) && now - at >= 0 && now - at <= OPEN_PANE_FLAG_TTL_MS;
  } catch {
    return false;
  }
}

export type DockBackResult = "opener" | "navigated";

/**
 * Asks the opener portal to re-open the split pane and closes this pop-out.
 * When the opener is gone, turns this window into the portal with the pane open.
 */
export function dockBack(win: Window = window): DockBackResult {
  const opener = sameOriginOpener(win);
  const origin = ownOrigin(win);
  if (opener && origin) {
    try {
      opener.postMessage({ type: DOCK_MANAGEMENT_MESSAGE }, origin);
      try {
        opener.focus();
      } catch {
        // ignore
      }
      win.close();
      return "opener";
    } catch {
      // fall through to navigating this window
    }
  }
  setOpenPaneOnLoad();
  try {
    // Drop the pop-out name so later "Pop out" clicks get a fresh window, not this portal tab.
    win.name = "";
  } catch {
    // ignore
  }
  win.location.assign("/");
  return "navigated";
}

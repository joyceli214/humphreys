// Pure helpers for the in-portal Management split pane: dock side, pane width
// ratio (fraction of the split width taken by the Management pane) and
// persistence of both in localStorage. All storage access is best-effort.

export type Dock = "left" | "right";

export type SplitPaneStorage = Pick<Storage, "getItem" | "setItem">;

export const MIN_RATIO = 0.25;
export const MAX_RATIO = 0.75;
export const DEFAULT_RATIO = 0.4;
export const NARROW_BREAKPOINT = 900;
export const DOCK_STORAGE_KEY = "humphreys.management.dock";
export const RATIO_STORAGE_KEY = "humphreys.management.ratio";

export const DEFAULT_DOCK: Dock = "right";

export function clampRatio(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, n));
}

// Resolves the storage lazily so that environments without (or with a
// blocked) localStorage never throw at call time.
function resolveStorage(storage?: SplitPaneStorage): SplitPaneStorage | null {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadDock(storage?: SplitPaneStorage): Dock {
  try {
    const raw = resolveStorage(storage)?.getItem(DOCK_STORAGE_KEY);
    return raw === "left" || raw === "right" ? raw : DEFAULT_DOCK;
  } catch {
    return DEFAULT_DOCK;
  }
}

export function saveDock(dock: Dock, storage?: SplitPaneStorage): void {
  try {
    resolveStorage(storage)?.setItem(DOCK_STORAGE_KEY, dock);
  } catch {
    // ignore: persistence is best-effort
  }
}

export function loadRatio(storage?: SplitPaneStorage): number {
  try {
    const raw = resolveStorage(storage)?.getItem(RATIO_STORAGE_KEY);
    if (raw == null || raw.trim() === "") return DEFAULT_RATIO;
    const n = Number(raw);
    return Number.isFinite(n) ? clampRatio(n) : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
}

export function saveRatio(ratio: number, storage?: SplitPaneStorage): void {
  try {
    resolveStorage(storage)?.setItem(RATIO_STORAGE_KEY, String(clampRatio(ratio)));
  } catch {
    // ignore: persistence is best-effort
  }
}

export function isNarrow(width?: number): boolean {
  const w = width ?? (typeof window !== "undefined" ? window.innerWidth : Infinity);
  return w < NARROW_BREAKPOINT;
}

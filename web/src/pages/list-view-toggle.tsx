/*
 * Page preferences: humphreys.viewMode.workOrders and
 * humphreys.viewMode.partsPurchaseRequests store "card" or "table".
 * Without a saved preference, default to cards for a coarse primary pointer,
 * navigator.maxTouchPoints > 1 (including iPadOS Safari reporting as Mac), or
 * a viewport at most 639.98px wide. Otherwise, including SSR, default to table.
 */
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

type ListViewMode = "card" | "table";

function deviceDefault(): ListViewMode {
  if (typeof window === "undefined") return "table";
  const touchPrimary =
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  const narrowViewport =
    typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639.98px)").matches;
  return touchPrimary || narrowViewport ? "card" : "table";
}

export function useListViewMode(storageKey: string) {
  const [mode, setCurrentMode] = useState<ListViewMode>(() => {
    try {
      if (typeof window !== "undefined") {
        const stored = window.localStorage.getItem(storageKey);
        if (stored === "card" || stored === "table") return stored;
      }
    } catch {
      // Storage may be unavailable; use the device default instead.
    }
    return deviceDefault();
  });

  const setMode = useCallback((nextMode: ListViewMode) => {
    setCurrentMode(nextMode);
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(storageKey, nextMode);
    } catch {
      // Keep the selected mode usable even when storage is unavailable.
    }
  }, [storageKey]);

  return [mode, setMode] as const;
}

export function ListViewToggle({ mode, onChange }: { mode: ListViewMode; onChange: (mode: ListViewMode) => void }) {
  return (
    <div role="group" aria-label="View mode" className="mb-3 inline-flex gap-1 rounded-md border border-border p-1">
      <Button
        type="button"
        size="sm"
        variant={mode === "card" ? "default" : "ghost"}
        aria-pressed={mode === "card"}
        data-testid="view-toggle-card"
        onClick={() => onChange("card")}
      >
        Card View
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === "table" ? "default" : "ghost"}
        aria-pressed={mode === "table"}
        data-testid="view-toggle-table"
        onClick={() => onChange("table")}
      >
        Table View
      </Button>
    </div>
  );
}

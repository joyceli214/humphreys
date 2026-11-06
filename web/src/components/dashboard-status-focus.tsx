import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { DashboardStatusCount } from "@/lib/api/generated/types";
import { Button } from "@/components/ui/button";
import {
  STATUS_FOCUS_PREFERENCE_KEY,
  parseStatusFocus,
  readLocalStatusFocus,
  resolveStatusFocus,
  statusFocusPresets,
  statusFocusTotal,
  writeLocalStatusFocus,
  type StatusFocusPreference
} from "@/lib/dashboard-status-focus";
import { cn } from "@/lib/utils";

type Props = {
  /** Per-status counts from GET /work-orders/dashboard; undefined on older APIs. */
  statuses: DashboardStatusCount[] | undefined;
  loading: boolean;
  /** True when the last dashboard load failed, so counts can't be trusted. */
  error?: boolean;
  /** Per-user key for the local mirror (user id). */
  userKey: string;
};

/**
 * Dashboard block: the user picks which work-order status(es) to watch (e.g.
 * Finished, waiting for pickup) and sees the job count. The choice is saved per
 * user via /user-preferences (mirrored in localStorage).
 */
export function DashboardStatusFocus({ statuses, loading, error = false, userKey }: Props) {
  const [saved, setSaved] = useState<number[] | null>(() => readLocalStatusFocus(userKey));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number[]>([]);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSaved(readLocalStatusFocus(userKey));
    Promise.resolve()
      .then(() => apiClient.getUserPreference<StatusFocusPreference>(STATUS_FOCUS_PREFERENCE_KEY))
      .then((res) => {
        if (cancelled) return;
        const ids = parseStatusFocus(res?.value);
        if (ids) {
          setSaved(ids);
          writeLocalStatusFocus(userKey, ids);
        }
      })
      .catch(() => {
        // keep the local copy / defaults
      });
    return () => {
      cancelled = true;
    };
  }, [userKey]);

  // A missing list (older API / dropped field) or a failed load is "couldn't
  // load", never a silent 0.
  const unavailable = !loading && (error || statuses === undefined);
  const list = unavailable ? [] : (statuses ?? []);
  const emptyMessage = unavailable
    ? "Couldn't load statuses. Refresh the page to try again."
    : "No statuses to count yet.";
  const focus = resolveStatusFocus(saved, list);
  const focusSet = new Set(focus);
  const focused = list.filter((s) => focusSet.has(s.status_id));
  const total = statusFocusTotal(list, focus);
  const presets = statusFocusPresets(list);

  const persist = async (ids: number[]) => {
    setSaved(ids);
    writeLocalStatusFocus(userKey, ids);
    setSaveError("");
    try {
      await apiClient.saveUserPreference<StatusFocusPreference>(STATUS_FOCUS_PREFERENCE_KEY, { status_ids: ids });
    } catch {
      setSaveError("Saved on this device only; couldn't sync your choice.");
    }
  };

  const title = focused.length === 0 ? "Status focus" : focused.map((s) => s.status).join(" + ");

  return (
    <section aria-label="Status focus" className="rounded-lg border border-border bg-white p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status Focus</p>
        <button
          type="button"
          aria-label="Choose statuses"
          aria-expanded={editing}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => {
            setDraft(focus);
            setEditing((open) => !open);
          }}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>

      {editing ? (
        <div className="space-y-2">
          {list.length === 0 && <p className="text-xs text-amber-700">{emptyMessage}</p>}
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Presets">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className="rounded-full bg-muted px-2.5 py-0.5 text-xs hover:bg-muted/70"
                  onClick={() => setDraft(preset.statusIds)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
          <fieldset className="max-h-40 space-y-1 overflow-y-auto">
            <legend className="sr-only">Statuses to count</legend>
            {list.map((status) => (
              <label key={status.status_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.includes(status.status_id)}
                    onChange={(event) =>
                      setDraft((prev) =>
                        event.target.checked ? [...prev, status.status_id] : prev.filter((id) => id !== status.status_id)
                      )
                    }
                  />
                  {status.status}
                </span>
                <span className="text-xs text-muted-foreground">{status.count}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={list.length === 0 || draft.length === 0}
              onClick={() => {
                const ordered = list.filter((s) => draft.includes(s.status_id)).map((s) => s.status_id);
                setEditing(false);
                void persist(ordered);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="truncate text-sm font-medium text-foreground" title={title}>
            {title}
          </p>
          <p className="text-2xl font-bold text-foreground" aria-live="polite">
            {loading && !statuses ? "…" : unavailable ? "—" : total}
          </p>
          {focused.length > 1 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {focused.map((s) => (
                <li key={s.status_id} className="flex justify-between gap-2">
                  <span className="truncate">{s.status}</span>
                  <span className={cn("font-medium", s.count > 0 && "text-foreground")}>{s.count}</span>
                </li>
              ))}
            </ul>
          )}
          {!loading && list.length === 0 && (
            <p
              className={cn("mt-1 text-xs", unavailable ? "text-amber-700" : "text-muted-foreground")}
              role={unavailable ? "alert" : undefined}
            >
              {emptyMessage}
            </p>
          )}
          {list.length > 0 && focused.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Choose statuses with the settings button.</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Jobs in the selected date range</p>
        </>
      )}
      {saveError && <p className="mt-1 text-xs text-amber-700">{saveError}</p>}
    </section>
  );
}

import type { DashboardStatusCount } from "@/lib/api/generated/types";

/** Server-side per-user preference key (PATCH /user-preferences/:key). */
export const STATUS_FOCUS_PREFERENCE_KEY = "dashboard_status_focus";
/** localStorage mirror so the block renders instantly and survives an offline prefs API. */
export const STATUS_FOCUS_STORAGE_PREFIX = "humphreys.dashboardStatusFocus.";

export type StatusFocusPreference = { status_ids: number[] };

/**
 * Seeded status names in this codebase are "Received", "Finished" and
 * "Picked Up" (docs/sql/humphreys_cleanup_migration.sql); shops add more via
 * Dropdown Management and the dashboard's "staged" group is "ready for pickup".
 * These patterns pick the useful defaults among whatever statuses exist.
 */
const WAITING_PICKUP_PATTERN = /\b(waiting|ready|awaiting)\b.*\bpick\s*-?\s*up\b/i;
const FINISHED_PATTERN = /^\s*finished\s*$/i;

export type StatusPreset = { key: string; label: string; statusIds: number[] };

/** Quick presets, only offered when matching statuses exist. */
export function statusFocusPresets(statuses: DashboardStatusCount[]): StatusPreset[] {
  const waiting = statuses.filter((s) => WAITING_PICKUP_PATTERN.test(s.status) || s.status_group === "staged").map((s) => s.status_id);
  const finished = statuses.filter((s) => FINISHED_PATTERN.test(s.status)).map((s) => s.status_id);
  const presets: StatusPreset[] = [];
  if (waiting.length > 0) presets.push({ key: "waiting_pickup", label: "Waiting for pickup", statusIds: waiting });
  if (finished.length > 0) presets.push({ key: "finished", label: "Finished", statusIds: finished });
  if (waiting.length > 0 && finished.length > 0) {
    presets.push({ key: "finished_or_waiting", label: "Finished + waiting for pickup", statusIds: Array.from(new Set([...finished, ...waiting])) });
  }
  return presets;
}

/** Default focus when the user hasn't chosen: waiting-for-pickup + Finished, else the first status. */
export function defaultStatusFocus(statuses: DashboardStatusCount[]): number[] {
  const presets = statusFocusPresets(statuses);
  const ids = new Set<number>();
  for (const preset of presets) {
    if (preset.key === "waiting_pickup" || preset.key === "finished") preset.statusIds.forEach((id) => ids.add(id));
  }
  if (ids.size > 0) return statuses.filter((s) => ids.has(s.status_id)).map((s) => s.status_id);
  return statuses.length > 0 ? [statuses[0].status_id] : [];
}

/** Keeps only ids that still exist (statuses can be deleted/renamed). */
export function resolveStatusFocus(saved: number[] | null, statuses: DashboardStatusCount[]): number[] {
  if (!saved) return defaultStatusFocus(statuses);
  const known = new Set(statuses.map((s) => s.status_id));
  return saved.filter((id) => known.has(id));
}

export function statusFocusTotal(statuses: DashboardStatusCount[], focus: number[]) {
  const chosen = new Set(focus);
  return statuses.reduce((sum, s) => (chosen.has(s.status_id) ? sum + s.count : sum), 0);
}

export function parseStatusFocus(value: unknown): number[] | null {
  if (!value || typeof value !== "object") return null;
  const ids = (value as { status_ids?: unknown }).status_ids;
  if (!Array.isArray(ids)) return null;
  return ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id));
}

export function readLocalStatusFocus(userKey: string): number[] | null {
  try {
    const raw = window.localStorage.getItem(STATUS_FOCUS_STORAGE_PREFIX + userKey);
    return raw ? parseStatusFocus(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeLocalStatusFocus(userKey: string, ids: number[]) {
  try {
    window.localStorage.setItem(STATUS_FOCUS_STORAGE_PREFIX + userKey, JSON.stringify({ status_ids: ids }));
  } catch {
    // storage full / disabled: the server preference still applies
  }
}

// Cross-window messages between the Management page (/ai-tools, either in the
// portal's split-pane iframe or in its own pop-out window) and the portal.
//
// Every receiver must check all three of: event.origin (same origin only),
// event.source (the exact iframe/pop-out window it expects) and the strict
// payload shape below. Anything else is ignored.

import { AI_TOOLS_WINDOW_NAME } from "@/lib/ai-tools/access";

export const OPEN_JOB_MESSAGE = "humphreys-open-job";
export const DOCK_MANAGEMENT_MESSAGE = "humphreys-dock-management";

export type OpenJobMessage = { type: typeof OPEN_JOB_MESSAGE; id: number };
export type DockManagementMessage = { type: typeof DOCK_MANAGEMENT_MESSAGE };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value).sort();
  const want = [...keys].sort();
  return own.length === want.length && own.every((key, i) => key === want[i]);
}

export function isValidJobId(id: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

/** Exactly `{ type: "humphreys-open-job", id }` with id a positive safe integer. */
export function isOpenJobMessage(data: unknown): data is OpenJobMessage {
  return (
    isPlainObject(data) && hasExactKeys(data, ["type", "id"]) && data.type === OPEN_JOB_MESSAGE && isValidJobId(data.id)
  );
}

/** Exactly `{ type: "humphreys-dock-management" }`. */
export function isDockManagementMessage(data: unknown): data is DockManagementMessage {
  return isPlainObject(data) && hasExactKeys(data, ["type"]) && data.type === DOCK_MANAGEMENT_MESSAGE;
}

/** The current window's origin, or null when it can't be read. */
export function ownOrigin(win: Window = window): string | null {
  try {
    return win.location.origin;
  } catch {
    return null;
  }
}

/** True when `other` is reachable and on the same origin as `win` (reading its location throws otherwise). */
export function isSameOriginWindow(other: Window | null | undefined, win: Window = window): other is Window {
  if (!other) return false;
  try {
    if (other.closed) return false;
    const origin = ownOrigin(win);
    return origin !== null && other.location.origin === origin;
  } catch {
    return false;
  }
}

/** The parent window when `win` is embedded in a same-origin iframe, else null. */
export function sameOriginParent(win: Window = window): Window | null {
  let parent: Window | null = null;
  try {
    parent = win.parent;
  } catch {
    return null;
  }
  if (!parent || parent === win) return null;
  return isSameOriginWindow(parent, win) ? parent : null;
}

/** The still-open, same-origin window that opened `win`, else null. */
export function sameOriginOpener(win: Window = window): Window | null {
  let opener: Window | null = null;
  try {
    opener = win.opener as Window | null;
  } catch {
    return null;
  }
  return isSameOriginWindow(opener, win) ? opener : null;
}

/**
 * True when `source` is a Management pop-out window that `win` opened: the
 * named AI Tools window whose opener is `win`. Covers pop-outs opened before
 * a reload of the portal (when the in-memory window ref is gone).
 */
export function isOwnManagementPopout(source: unknown, win: Window = window): source is Window {
  if (!source || source === win) return false;
  try {
    const candidate = source as Window;
    return candidate.name === AI_TOOLS_WINDOW_NAME && candidate.opener === win;
  } catch {
    return false;
  }
}

/** True when this page is the pop-out Management window (not embedded, opened by the portal or carrying the pop-out name). */
export function isManagementPopout(win: Window = window): boolean {
  if (sameOriginParent(win)) return false;
  try {
    if (win.parent && win.parent !== win) return false;
  } catch {
    return false;
  }
  if (sameOriginOpener(win)) return true;
  try {
    return win.name === AI_TOOLS_WINDOW_NAME;
  } catch {
    return false;
  }
}

/** Same-origin gate shared by every receiver. */
export function isFromOwnOrigin(event: Pick<MessageEvent, "origin">, win: Window = window): boolean {
  const origin = ownOrigin(win);
  return origin !== null && event.origin === origin;
}

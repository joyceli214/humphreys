// Hand-off of an AI-drafted email from the AI Tools window to the existing
// "Email Customer" dialog on the work order detail page.
//
// localStorage (not sessionStorage) is used because the AI Tools page lives in a
// separate browser window: sessionStorage is per-window, localStorage is shared
// across same-origin windows. Entries are keyed by job id, consumed once when the
// dialog opens, and expire so a stale draft never resurfaces days later.

import type { CustomerEmailTemplateKey } from "@/lib/email-templates";
import type { EmailDraftType } from "@/lib/ai-tools/types";

export const AI_EMAIL_DRAFT_KEY_PREFIX = "humphreys:ai-email-draft:";
export const AI_EMAIL_DRAFT_QUERY_PARAM = "ai_email";
export const AI_EMAIL_DRAFT_TTL_MS = 30 * 60 * 1000;

export type AIEmailDraftHandoff = {
  referenceId: number;
  template: CustomerEmailTemplateKey;
  subject: string;
  body: string;
  createdAt: number;
};

function storageKey(referenceId: number) {
  return `${AI_EMAIL_DRAFT_KEY_PREFIX}${referenceId}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The send endpoint only accepts job_started/job_completed; pick the closer one. */
export function templateForDraftType(type: EmailDraftType): CustomerEmailTemplateKey {
  return type === "ready_for_pickup" ? "job_completed" : "job_started";
}

export function saveAIEmailDraft(
  draft: Omit<AIEmailDraftHandoff, "createdAt">,
  now: number = Date.now()
): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.setItem(storageKey(draft.referenceId), JSON.stringify({ ...draft, createdAt: now }));
    return true;
  } catch {
    return false;
  }
}

/** Reads and removes the pending draft for a job. Returns null if absent, malformed or expired. */
export function takeAIEmailDraft(referenceId: number, now: number = Date.now()): AIEmailDraftHandoff | null {
  const storage = safeStorage();
  if (!storage) return null;
  const key = storageKey(referenceId);
  const raw = storage.getItem(key);
  if (raw === null) return null;
  storage.removeItem(key);
  try {
    const parsed = JSON.parse(raw) as Partial<AIEmailDraftHandoff>;
    if (
      parsed.referenceId !== referenceId ||
      typeof parsed.subject !== "string" ||
      typeof parsed.body !== "string" ||
      typeof parsed.createdAt !== "number" ||
      (parsed.template !== "job_started" && parsed.template !== "job_completed")
    ) {
      return null;
    }
    if (now - parsed.createdAt > AI_EMAIL_DRAFT_TTL_MS) return null;
    return parsed as AIEmailDraftHandoff;
  } catch {
    return null;
  }
}

export function jobEmailHandoffPath(referenceId: number) {
  return `/work-orders/${referenceId}?${AI_EMAIL_DRAFT_QUERY_PARAM}=1`;
}

/**
 * Shows the job in the main portal window (the one that opened AI Tools) so the
 * Email Customer dialog opens there with the draft prefilled. Falls back to a
 * new tab if the opener is gone or not reachable.
 */
export function openJobWithDraft(referenceId: number, win: Window = window) {
  const path = jobEmailHandoffPath(referenceId);
  const opener = win.opener as Window | null;
  if (opener && !opener.closed) {
    try {
      opener.location.assign(path);
      opener.focus();
      return;
    } catch {
      // Cross-origin or blocked opener — fall through to a new tab.
    }
  }
  win.open(path, "_blank");
}

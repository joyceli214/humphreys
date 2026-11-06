// "Draft email" from a work-order page: hands one job to the Management page's
// Customer Email Drafts tab.
//
// The portal and Management (/ai-tools, in the split-pane iframe or the
// pop-out window) share localStorage, so the handoff is two writes:
//  1. the job is added to the tab's persisted selected-jobs list, and
//  2. a short-lived, take-once "pending email draft" flag tells Management to
//     switch to the email-drafts tab and select that job.
// A Management page that is already mounted picks the flag up from the
// `storage` event; a freshly loaded one takes it on mount.

import type { WorkOrderDetail } from "@/lib/api/generated/types";
import type { EmailDraftTarget, EmailDraftType } from "@/lib/ai-tools/types";
import {
  addSelectedJob,
  loadSelectedJobs,
  saveSelectedJobs,
  type SelectedEmailJob
} from "@/lib/ai-tools/email-selection";

export const PENDING_EMAIL_DRAFT_KEY = "humphreys.management.pending-email-draft";
export const PENDING_EMAIL_DRAFT_TTL_MS = 60 * 1000;

const DRAFT_TYPES: readonly EmailDraftType[] = ["estimate", "progress_update", "ready_for_pickup", "custom"];

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageOf(storage?: FlagStorage): FlagStorage | null {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

type DetailForEmail = Pick<WorkOrderDetail, "reference_id" | "item_name" | "brand_names" | "model_number" | "status_name"> & {
  customer: Pick<WorkOrderDetail["customer"], "customer_id" | "first_name" | "last_name">;
};

/** The selected-jobs entry for a loaded work order (non-sensitive fields only, like selectedJobFromRow). */
export function selectedJobFromDetail(item: DetailForEmail): SelectedEmailJob {
  const customerName = [item.customer.first_name, item.customer.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const equipment = [(item.brand_names ?? []).join(" "), item.item_name, item.model_number]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return {
    referenceId: item.reference_id,
    customerId: item.customer.customer_id ?? null,
    customerName: customerName || "Unknown",
    equipment,
    status: item.status_name?.trim() ?? ""
  };
}

/**
 * Adds the job to the email selection and queues the pending tab switch.
 * Returns the target that Management will receive.
 */
export function queueEmailDraft(
  job: SelectedEmailJob,
  type: EmailDraftType = "progress_update",
  now: number = Date.now(),
  storage?: FlagStorage
): EmailDraftTarget {
  const target: EmailDraftTarget = { referenceId: job.referenceId, label: job.customerName, type, job };
  // Selection first so a Management page that loads on the flag already sees the job.
  saveSelectedJobs(addSelectedJob(loadSelectedJobs(), job));
  try {
    storageOf(storage)?.setItem(PENDING_EMAIL_DRAFT_KEY, JSON.stringify({ at: now, job, type }));
  } catch {
    // best-effort: the job is still in the selection list
  }
  return target;
}

function parseJob(raw: unknown): SelectedEmailJob | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = value.referenceId;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  return {
    referenceId: id,
    customerId: typeof value.customerId === "number" && Number.isSafeInteger(value.customerId) ? value.customerId : null,
    customerName: typeof value.customerName === "string" && value.customerName ? value.customerName : "Unknown",
    equipment: typeof value.equipment === "string" ? value.equipment : "",
    status: typeof value.status === "string" ? value.status : ""
  };
}

/** Reads and clears the pending draft. Returns a fresh target only if it was queued within the TTL. */
export function takePendingEmailDraft(now: number = Date.now(), storage?: FlagStorage): EmailDraftTarget | null {
  try {
    const s = storageOf(storage);
    const raw = s?.getItem(PENDING_EMAIL_DRAFT_KEY);
    if (raw == null) return null;
    s?.removeItem(PENDING_EMAIL_DRAFT_KEY);
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const at = parsed.at;
    if (typeof at !== "number" || !Number.isFinite(at) || now - at < 0 || now - at > PENDING_EMAIL_DRAFT_TTL_MS) return null;
    const job = parseJob(parsed.job);
    if (!job) return null;
    const type = DRAFT_TYPES.includes(parsed.type as EmailDraftType) ? (parsed.type as EmailDraftType) : "progress_update";
    return { referenceId: job.referenceId, label: job.customerName, type, job };
  } catch {
    return null;
  }
}

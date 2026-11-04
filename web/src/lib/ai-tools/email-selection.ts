// "Selected jobs" for the Customer Email Drafts tab. The pick persists across
// searches and page reloads via localStorage. Only non-sensitive fields are
// stored (job #, customer id + display name, equipment, status) — never email
// or phone.

import type { AISearchRow } from "@/lib/ai-tools/types";

export const EMAIL_SELECTION_STORAGE_KEY = "humphreys:ai-email-selected-jobs";
/** Matches the backend cap on jobs per email (emailDraftMaxJobs). */
export const EMAIL_MAX_JOBS = 10;

export type SelectedEmailJob = {
  referenceId: number;
  customerId: number | null;
  customerName: string;
  equipment: string;
  status: string;
};

export type CustomerGroup = {
  key: string;
  customerName: string;
  jobs: SelectedEmailJob[];
};

/** Jobs with no customer record never combine with anything else. */
export function customerKey(job: SelectedEmailJob) {
  return job.customerId != null ? `c${job.customerId}` : `job${job.referenceId}`;
}

export function equipmentLabel(row: Pick<AISearchRow, "equipment_name" | "brand_names" | "model_number">) {
  return [row.brand_names?.join(" "), row.equipment_name, row.model_number]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function selectedJobFromRow(
  row: Pick<AISearchRow, "reference_id" | "customer_id" | "customer_name" | "equipment_name" | "brand_names" | "model_number" | "status_name">
): SelectedEmailJob {
  return {
    referenceId: row.reference_id,
    customerId: row.customer_id ?? null,
    customerName: row.customer_name || "Unknown",
    equipment: equipmentLabel(row),
    status: row.status_name ?? ""
  };
}

export function addSelectedJob(list: SelectedEmailJob[], job: SelectedEmailJob) {
  if (list.some((entry) => entry.referenceId === job.referenceId)) return list;
  if (list.length >= EMAIL_MAX_JOBS) return list;
  return [...list, job];
}

export function removeSelectedJob(list: SelectedEmailJob[], referenceId: number) {
  return list.filter((entry) => entry.referenceId !== referenceId);
}

/** Groups jobs by customer, keeping first-seen order. */
export function customerGroups(list: SelectedEmailJob[]): CustomerGroup[] {
  const groups = new Map<string, CustomerGroup>();
  for (const job of list) {
    const key = customerKey(job);
    const group = groups.get(key) ?? { key, customerName: job.customerName, jobs: [] };
    group.jobs.push(job);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function sanitize(raw: unknown): SelectedEmailJob | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.referenceId !== "number" || !Number.isInteger(value.referenceId) || value.referenceId <= 0) return null;
  return {
    referenceId: value.referenceId,
    customerId: typeof value.customerId === "number" ? value.customerId : null,
    customerName: typeof value.customerName === "string" ? value.customerName : "Unknown",
    equipment: typeof value.equipment === "string" ? value.equipment : "",
    status: typeof value.status === "string" ? value.status : ""
  };
}

export function loadSelectedJobs(): SelectedEmailJob[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(EMAIL_SELECTION_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    let list: SelectedEmailJob[] = [];
    for (const entry of parsed) {
      const job = sanitize(entry);
      if (job) list = addSelectedJob(list, job);
    }
    return list;
  } catch {
    return [];
  }
}

export function saveSelectedJobs(list: SelectedEmailJob[]) {
  const store = storage();
  if (!store) return;
  try {
    const clean = list.map(sanitize).filter((job): job is SelectedEmailJob => job !== null);
    store.setItem(EMAIL_SELECTION_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Storage full or blocked: the selection still works for this page view.
  }
}

import { beforeEach, describe, expect, it } from "vitest";
import {
  PENDING_EMAIL_DRAFT_KEY,
  PENDING_EMAIL_DRAFT_TTL_MS,
  queueEmailDraft,
  selectedJobFromDetail,
  takePendingEmailDraft
} from "@/lib/ai-tools/open-email-drafts";
import { EMAIL_MAX_JOBS, loadSelectedJobs, saveSelectedJobs, type SelectedEmailJob } from "@/lib/ai-tools/email-selection";

const job: SelectedEmailJob = { referenceId: 42, customerId: 7, customerName: "Jane Doe", equipment: "Sony Receiver STR-1", status: "In Progress" };

beforeEach(() => window.localStorage.clear());

describe("selectedJobFromDetail", () => {
  it("builds a non-sensitive selection entry from the work order", () => {
    expect(
      selectedJobFromDetail({
        reference_id: 42,
        item_name: " Receiver ",
        brand_names: ["Sony"],
        model_number: "STR-1",
        status_name: "In Progress",
        customer: { customer_id: 7, first_name: "Jane", last_name: " Doe " }
      })
    ).toEqual(job);
  });

  it("falls back to Unknown / empty strings when details are missing", () => {
    expect(
      selectedJobFromDetail({
        reference_id: 3,
        item_name: null,
        brand_names: [],
        model_number: null,
        status_name: null,
        customer: { customer_id: null, first_name: null, last_name: null }
      })
    ).toEqual({ referenceId: 3, customerId: null, customerName: "Unknown", equipment: "", status: "" });
  });
});

describe("queueEmailDraft / takePendingEmailDraft", () => {
  it("adds the job to the email selection and queues a take-once target", () => {
    const target = queueEmailDraft(job, "progress_update", 1000);
    expect(target).toEqual({ referenceId: 42, label: "Jane Doe", type: "progress_update", job });
    expect(loadSelectedJobs()).toEqual([job]);

    expect(takePendingEmailDraft(1500)).toEqual(target);
    expect(window.localStorage.getItem(PENDING_EMAIL_DRAFT_KEY)).toBeNull();
    expect(takePendingEmailDraft(1500)).toBeNull();
  });

  it("is idempotent for the selection and keeps existing jobs", () => {
    const other = { ...job, referenceId: 5, equipment: "Turntable" };
    saveSelectedJobs([other]);
    queueEmailDraft(job, "progress_update", 1000);
    queueEmailDraft(job, "progress_update", 1000);
    expect(loadSelectedJobs()).toEqual([other, job]);
  });

  it("does not grow the selection past the per-email cap", () => {
    const full = Array.from({ length: EMAIL_MAX_JOBS }, (_, i) => ({ ...job, referenceId: 100 + i }));
    saveSelectedJobs(full);
    queueEmailDraft(job, "progress_update", 1000);
    expect(loadSelectedJobs()).toEqual(full);
  });

  it("expires after the TTL and ignores future timestamps", () => {
    queueEmailDraft(job, "progress_update", 1000);
    expect(takePendingEmailDraft(1000 + PENDING_EMAIL_DRAFT_TTL_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(PENDING_EMAIL_DRAFT_KEY)).toBeNull();

    queueEmailDraft(job, "progress_update", 5000);
    expect(takePendingEmailDraft(4000)).toBeNull();

    queueEmailDraft(job, "progress_update", 1000);
    expect(takePendingEmailDraft(1000 + PENDING_EMAIL_DRAFT_TTL_MS)).not.toBeNull();
  });

  it("rejects malformed payloads and clears them", () => {
    for (const raw of ["not json", "null", JSON.stringify({ at: 1000, job: { referenceId: -1 } }), JSON.stringify({ job })]) {
      window.localStorage.setItem(PENDING_EMAIL_DRAFT_KEY, raw);
      expect(takePendingEmailDraft(1000)).toBeNull();
      expect(window.localStorage.getItem(PENDING_EMAIL_DRAFT_KEY)).toBeNull();
    }
  });

  it("falls back to progress_update for an unknown draft type", () => {
    window.localStorage.setItem(PENDING_EMAIL_DRAFT_KEY, JSON.stringify({ at: 1000, job, type: "bogus" }));
    expect(takePendingEmailDraft(1000)?.type).toBe("progress_update");
  });
});

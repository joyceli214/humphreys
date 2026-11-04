import { afterEach, describe, expect, it } from "vitest";
import {
  EMAIL_SELECTION_STORAGE_KEY,
  addSelectedJob,
  customerGroups,
  loadSelectedJobs,
  removeSelectedJob,
  saveSelectedJobs,
  selectedJobFromRow,
  type SelectedEmailJob
} from "@/lib/ai-tools/email-selection";

const jane1: SelectedEmailJob = { referenceId: 5, customerId: 1, customerName: "Jane Doe", equipment: "Marantz Receiver", status: "Finished" };
const jane2: SelectedEmailJob = { referenceId: 6, customerId: 1, customerName: "Jane Doe", equipment: "Turntable", status: "In Progress" };
const bob: SelectedEmailJob = { referenceId: 7, customerId: 2, customerName: "Bob", equipment: "Amplifier", status: "Received" };

afterEach(() => window.localStorage.clear());

describe("email job selection", () => {
  it("adds without duplicates and removes by job number", () => {
    let list = addSelectedJob([], jane1);
    list = addSelectedJob(list, jane1);
    list = addSelectedJob(list, jane2);
    expect(list.map((j) => j.referenceId)).toEqual([5, 6]);
    expect(removeSelectedJob(list, 5).map((j) => j.referenceId)).toEqual([6]);
  });

  it("caps the selection at 10 jobs", () => {
    let list: SelectedEmailJob[] = [];
    for (let i = 1; i <= 12; i += 1) list = addSelectedJob(list, { ...jane1, referenceId: i });
    expect(list).toHaveLength(10);
  });

  it("persists to localStorage and survives reload", () => {
    saveSelectedJobs([jane1, bob]);
    expect(window.localStorage.getItem(EMAIL_SELECTION_STORAGE_KEY)).toContain("\"referenceId\":5");
    expect(loadSelectedJobs()).toEqual([jane1, bob]);
  });

  it("ignores corrupt or malformed storage", () => {
    window.localStorage.setItem(EMAIL_SELECTION_STORAGE_KEY, "{not json");
    expect(loadSelectedJobs()).toEqual([]);
    window.localStorage.setItem(EMAIL_SELECTION_STORAGE_KEY, JSON.stringify([{ referenceId: "x" }, jane1]));
    expect(loadSelectedJobs()).toEqual([jane1]);
  });

  it("never stores contact details", () => {
    saveSelectedJobs([{ ...jane1, email: "jane@example.com" } as SelectedEmailJob]);
    expect(window.localStorage.getItem(EMAIL_SELECTION_STORAGE_KEY)).not.toContain("jane@example.com");
  });

  it("groups jobs by customer", () => {
    const groups = customerGroups([jane1, bob, jane2]);
    expect(groups.map((g) => [g.customerName, g.jobs.map((j) => j.referenceId)])).toEqual([
      ["Jane Doe", [5, 6]],
      ["Bob", [7]]
    ]);
  });

  it("builds a selection entry from a search row", () => {
    const job = selectedJobFromRow({
      reference_id: 9,
      customer_id: 3,
      customer_name: "Nora",
      equipment_name: "Tape deck",
      brand_names: ["Teac"],
      model_number: "A-3340",
      status_name: "Finished"
    });
    expect(job).toEqual({ referenceId: 9, customerId: 3, customerName: "Nora", equipment: "Teac Tape deck A-3340", status: "Finished" });
  });
});

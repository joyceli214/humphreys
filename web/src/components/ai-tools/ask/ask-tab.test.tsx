import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const interpretAsk = vi.fn();
const previewAIMassUpdate = vi.fn();
const applyAIMassUpdate = vi.fn();
const listAllPartsPurchaseRequests = vi.fn();
const listWorkOrders = vi.fn();
const getWorkOrderDetail = vi.fn();

const { FakeAPIError } = vi.hoisted(() => ({
  FakeAPIError: class FakeAPIError extends Error {
    constructor(message: string, public readonly status: number) {
      super(message);
    }
  }
}));

vi.mock("@/lib/api/client", () => ({
  APIError: FakeAPIError,
  apiClient: {
    interpretAsk: (...a: unknown[]) => interpretAsk(...a),
    previewAIMassUpdate: (...a: unknown[]) => previewAIMassUpdate(...a),
    applyAIMassUpdate: (...a: unknown[]) => applyAIMassUpdate(...a),
    listAllPartsPurchaseRequests: (...a: unknown[]) => listAllPartsPurchaseRequests(...a),
    listWorkOrders: (...a: unknown[]) => listWorkOrders(...a),
    getWorkOrderDetail: (...a: unknown[]) => getWorkOrderDetail(...a)
  }
}));

import { AskTab } from "@/components/ai-tools/ask/ask-tab";

function intent(extra: Record<string, unknown>) {
  return { intent: "unknown", customer_query: "", reference_ids: [], parts_query: "", parts_statuses: [], reply: "", model: "m", ...extra };
}

function ask(text: string) {
  const box = screen.getByLabelText("Message");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

const previewRow = {
  operation: { reference_id: 31, op: "set_status", status_name: "Finished" },
  reference_id: 31, customer_name: "Test Customer A", field: "Status", before: "In Progress", after: "Finished",
  lower_than_before: false, valid: true, updated_at: "2026-11-01T00:00:00Z", amount_delta: 0
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("AskTab", () => {
  it("shows the empty state and starter chips that only fill the box", () => {
    render(<AskTab />);
    expect(screen.getByText("Ask me to find or change jobs.")).toBeInTheDocument();
    expect(screen.getByText("I show a preview first. Nothing is saved until you tap Apply.")).toBeInTheDocument();
    const chips = ["Jobs for a customer", "Update a job", "Parts requests", "Update many jobs", "Sum up charges"];
    for (const name of chips) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Parts requests" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toMatch(/parts requests/i);
    expect(interpretAsk).not.toHaveBeenCalled();
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
  });

  it("Shift+Enter does not send", () => {
    render(<AskTab />);
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(interpretAsk).not.toHaveBeenCalled();
  });

  it("previews job updates and only applies after Apply", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "update_jobs", reference_ids: [31] }));
    previewAIMassUpdate.mockResolvedValue({ rows: [previewRow], model: "m" });
    applyAIMassUpdate.mockResolvedValue({ results: [{ reference_id: 31, success: true, applied: ["Status → Finished"] }] });
    render(<AskTab />);
    ask("set job 31 to Finished");
    expect(await screen.findByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(previewAIMassUpdate).toHaveBeenCalledWith("set job 31 to Finished");
    expect(applyAIMassUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(applyAIMassUpdate).toHaveBeenCalledWith([previewRow.operation], { 31: "2026-11-01T00:00:00Z" })
    );
    expect(await screen.findByText(/1 job updated/)).toBeInTheDocument();
  });

  it("sends only the typed text to interpret", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "unknown", reply: "ok" }));
    render(<AskTab />);
    ask("set job 31 to Finished");
    ask("update both to Finished");
    await waitFor(() => expect(interpretAsk).toHaveBeenCalledTimes(2));
    expect(interpretAsk.mock.calls[0]).toEqual(["set job 31 to Finished"]);
    expect(interpretAsk.mock.calls[1]).toEqual(["update both to Finished"]);
  });

  it("previews the server's preview_instruction for a follow-up and applies only on Apply", async () => {
    interpretAsk.mockResolvedValue(
      intent({
        intent: "update_jobs",
        reference_ids: [275, 27501],
        context_used: true,
        preview_instruction: "Jobs #275, #27501: update both to Finished"
      })
    );
    previewAIMassUpdate.mockResolvedValue({ rows: [previewRow], model: "m" });
    applyAIMassUpdate.mockResolvedValue({ results: [{ reference_id: 31, success: true, applied: ["Status → Finished"] }] });
    render(<AskTab />);
    ask("update both to Finished");
    expect(await screen.findByText("Using jobs #275, #27501 from your last answer.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(previewAIMassUpdate).toHaveBeenCalledTimes(1);
    expect(previewAIMassUpdate).toHaveBeenCalledWith("Jobs #275, #27501: update both to Finished");
    expect(applyAIMassUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applyAIMassUpdate).toHaveBeenCalledTimes(1));
  });

  it("shows the server notice above the answer", async () => {
    interpretAsk.mockResolvedValue(
      intent({
        intent: "update_jobs",
        reference_ids: [275],
        found_ids: [275],
        missing_ids: [15],
        notice: "Found #275. No job #15.",
        preview_instruction: "Job #275: set jobs 275 and 15 to Finished"
      })
    );
    previewAIMassUpdate.mockResolvedValue({ rows: [previewRow], model: "m" });
    render(<AskTab />);
    ask("set jobs 275 and 15 to Finished");
    const notice = await screen.findByText("Found #275. No job #15.");
    expect(notice).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(previewAIMassUpdate).toHaveBeenCalledWith("Job #275: set jobs 275 and 15 to Finished");
    expect(screen.queryByText(/from your last answer/)).toBeNull();
    expect(applyAIMassUpdate).not.toHaveBeenCalled();
  });

  it("asks for job numbers when there is no recent context", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "unknown", reply: "I don't have recent jobs to refer to. Tell me the job numbers." }));
    render(<AskTab />);
    ask("update both to Finished");
    expect(await screen.findByText("I don't have recent jobs to refer to. Tell me the job numbers.")).toBeInTheDocument();
    expect(previewAIMassUpdate).not.toHaveBeenCalled();
  });

  it("Cancel discards the preview without applying", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "update_jobs", reference_ids: [31] }));
    previewAIMassUpdate.mockResolvedValue({ rows: [previewRow], model: "m" });
    render(<AskTab />);
    ask("set job 31 to Finished");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Cancelled. Nothing was changed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(applyAIMassUpdate).not.toHaveBeenCalled();
  });

  it("shows a Retry when the interpret call fails", async () => {
    interpretAsk.mockRejectedValueOnce(new FakeAPIError("boom (502 /ai-tools/ask/interpret)", 502));
    interpretAsk.mockResolvedValueOnce(intent({ intent: "unknown", reply: "I can help with jobs and parts." }));
    render(<AskTab />);
    ask("what is the weather");
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("I can help with jobs and parts.")).toBeInTheDocument();
    expect(interpretAsk).toHaveBeenCalledTimes(2);
  });

  it("explains the rate limit", async () => {
    interpretAsk.mockRejectedValue(new FakeAPIError("too many AI requests (429 /ai-tools/ask/interpret)", 429));
    render(<AskTab />);
    ask("hi");
    expect(await screen.findByText(/Too many AI requests/)).toBeInTheDocument();
  });

  it("shows a searchable parts table with job numbers", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "parts_requests" }));
    listAllPartsPurchaseRequests.mockResolvedValue({
      items: [
        { parts_purchase_request_id: 900, reference_id: 41, item_name: "Drive belt", quantity: 2, status: "ordered", source: "supplier", source_url: null },
        { parts_purchase_request_id: 901, reference_id: 42, item_name: "Fuse", quantity: 1, status: "approved", source: "online", source_url: "https://parts.test/x" }
      ]
    });
    render(<AskTab />);
    ask("show parts requests");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("#41")).toBeInTheDocument();
    expect(within(table).queryByText("900")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search parts"), { target: { value: "fuse" } });
    expect(within(table).queryByText("Drive belt")).toBeNull();
    expect(within(table).getByText("Fuse")).toBeInTheDocument();
  });

  it("says so when parts requests are not readable (403)", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "parts_requests" }));
    listAllPartsPurchaseRequests.mockRejectedValue(new FakeAPIError("forbidden (403 /parts-purchase-requests)", 403));
    render(<AskTab />);
    ask("show parts requests");
    expect(await screen.findByText("You don't have access to parts requests.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists a customer's jobs", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "customer_jobs", customer_query: "Test Customer A" }));
    listWorkOrders.mockResolvedValue({
      items: [{ reference_id: 51, customer_name: "Test Customer A", item_name: "Receiver", brand_names: [], model_number: null, status: "In Progress" }]
    });
    render(<AskTab />);
    ask("jobs for Test Customer A");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("#51")).toBeInTheDocument();
    expect(within(table).getByText("In Progress")).toBeInTheDocument();
    const params = listWorkOrders.mock.calls[0][0] as URLSearchParams;
    expect(params.get("q")).toBe("Test Customer A");
  });

  it("shows No match. when nothing is found", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "customer_jobs", customer_query: "Nobody" }));
    listWorkOrders.mockResolvedValue({ items: [] });
    render(<AskTab />);
    ask("jobs for Nobody");
    expect(await screen.findByText("No match.")).toBeInTheDocument();
  });

  it("sums up charges with a total row", async () => {
    interpretAsk.mockResolvedValue(intent({ intent: "charges_summary", reference_ids: [61] }));
    getWorkOrderDetail.mockResolvedValue({
      reference_id: 61, labour_total: 100, parts_total: 20, delivery_total: null, deposit: 10,
      labour_discount_type: null, labour_discount_value: null
    });
    render(<AskTab />);
    ask("sum up charges on 61");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("#61")).toBeInTheDocument();
    expect(within(table).getByText("Total")).toBeInTheDocument();
    // 120 + 13% HST − 10 deposit
    expect(within(table).getAllByText("$125.60")).toHaveLength(2);
  });
});

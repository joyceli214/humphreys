import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const interpretAsk = vi.fn();
const updatePartsPurchaseRequest = vi.fn();
const createRepairLog = vi.fn();
const applyAIMassUpdate = vi.fn();
const listWorkOrders = vi.fn();
const listAllPartsPurchaseRequests = vi.fn();
const getWorkOrderDetail = vi.fn();
const listRepairLogs = vi.fn();

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
    updatePartsPurchaseRequest: (...a: unknown[]) => updatePartsPurchaseRequest(...a),
    createRepairLog: (...a: unknown[]) => createRepairLog(...a),
    applyAIMassUpdate: (...a: unknown[]) => applyAIMassUpdate(...a),
    listWorkOrders: (...a: unknown[]) => listWorkOrders(...a),
    listAllPartsPurchaseRequests: (...a: unknown[]) => listAllPartsPurchaseRequests(...a),
    getWorkOrderDetail: (...a: unknown[]) => getWorkOrderDetail(...a),
    listRepairLogs: (...a: unknown[]) => listRepairLogs(...a),
    listEmailPickerContacts: vi.fn(),
    listWorkOrderCustomers: vi.fn()
  }
}));

import { AskTab } from "@/components/ai-tools/ask/ask-tab";
import { PartsAnswer } from "@/components/ai-tools/ask/ask-answers";
import { logText, partsPatchPayload, todayLocalDate } from "@/components/ai-tools/ask/ask-skill-answers";
import type { AskPartsChange } from "@/lib/ai-tools/types";

function answer(extra: Record<string, unknown>) {
  return { intent: "unknown", customer_query: "", reference_ids: [], parts_query: "", parts_statuses: [], reply: "", model: "m", ...extra };
}

function ask(text: string) {
  const box = screen.getByLabelText("Message");
  // A trailing space closes the "#" job menu, so Enter sends.
  fireEvent.change(box, { target: { value: `${text} ` } });
  fireEvent.keyDown(box, { key: "Enter" });
}

const change = (extra: Partial<AskPartsChange> = {}): AskPartsChange => ({
  parts_purchase_request_id: 480,
  reference_id: 31271,
  item_name: "10,000uF 63v",
  quantity: 4,
  source: "supplier",
  old_status: "waiting_approval",
  new_status: "approved",
  old_price: 59.62,
  new_price: 59.62,
  old_source_url: null,
  new_source_url: null,
  updated_at: "2026-11-13T06:45:00.123456Z",
  valid: true,
  ...extra
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Ask parts changes", () => {
  it("previews old → new and PATCHes only on Apply, with updated_at and the unchanged fields", async () => {
    interpretAsk.mockResolvedValue(
      answer({ intent: "parts_update", reference_ids: [31271], parts_preview: { action: "approve", changes: [change()] } })
    );
    updatePartsPurchaseRequest.mockResolvedValue({});
    render(<AskTab />);
    ask("Approve parts request #480");
    expect(await screen.findByText("Preview: change parts request 480")).toBeInTheDocument();
    expect(screen.getByText("waiting for approval")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(updatePartsPurchaseRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText(/1 parts request updated/);
    expect(updatePartsPurchaseRequest).toHaveBeenCalledWith(31271, 480, {
      updated_at: "2026-11-13T06:45:00.123456Z",
      source: "supplier",
      source_url: null,
      status: "approved",
      total_price: 59.62,
      item_name: "10,000uF 63v",
      quantity: 4
    });
  });

  it("explains an invalid transition, never applies it, and Cancel changes nothing", async () => {
    interpretAsk.mockResolvedValue(
      answer({
        intent: "parts_update",
        parts_preview: { action: "order", changes: [change({ new_status: "ordered", valid: false, error: "It is waiting for approval; it must be approved before it can be ordered." })] }
      })
    );
    render(<AskTab />);
    ask("Mark #480 as ordered");
    expect(await screen.findByText(/must be approved before it can be ordered/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Cancelled. Nothing was changed.")).toBeInTheDocument();
    expect(updatePartsPurchaseRequest).not.toHaveBeenCalled();
  });

  it("shows a conflict (409) per request after Apply", async () => {
    interpretAsk.mockResolvedValue(
      answer({ intent: "parts_update", parts_preview: { action: "set_price", changes: [change({ new_status: "waiting_approval", new_price: 61, new_source_url: "https://x.test/p" })] } })
    );
    updatePartsPurchaseRequest.mockRejectedValue(new FakeAPIError("parts request changed", 409));
    render(<AskTab />);
    ask("Set the price on request 480 to 61");
    expect(await screen.findByText("Link: https://x.test/p")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/changed after the preview/)).toBeInTheDocument();
  });

  it("lists the requests to choose from when the job has several, with no Apply", async () => {
    interpretAsk.mockResolvedValue(
      answer({
        intent: "parts_update",
        reply: "Job #31178 has 2 parts requests that can be approved. Which one?",
        reference_ids: [31178],
        parts_preview: {
          action: "",
          changes: [],
          choices: [
            { parts_purchase_request_id: 490, reference_id: 31178, item_name: "MJ15025G", quantity: 20, status: "waiting_approval", total_price: 80 },
            { parts_purchase_request_id: 491, reference_id: 31178, item_name: "MJ15024G", quantity: 20, status: "waiting_approval", total_price: 80 }
          ]
        }
      })
    );
    render(<AskTab />);
    ask("approve the transistor on #31178");
    expect(await screen.findByText(/Which one\?/)).toBeInTheDocument();
    expect(screen.getByText("490")).toBeInTheDocument();
    expect(screen.getByText("MJ15024G ×20")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("builds the PATCH body from the change", () => {
    expect(partsPatchPayload(change({ new_price: 10, new_source_url: "https://a.test" }))).toMatchObject({ total_price: 10, source_url: "https://a.test", status: "approved" });
  });
});

describe("Ask repair log and labour", () => {
  it("adds the repair log only on Apply, dated today", async () => {
    interpretAsk.mockResolvedValue(
      answer({ intent: "add_repair_log", reference_ids: [31352], repair_log_preview: { reference_id: 31352, details: "Final test: unit tested OK.", hours_used: 0.25 } })
    );
    createRepairLog.mockResolvedValue({});
    render(<AskTab />);
    ask("Add a 0.25 hr repair log to #31352: Final test: unit tested OK.");
    expect(await screen.findByText("Preview: add a repair log to job #31352")).toBeInTheDocument();
    expect(screen.getByText("0.25 hr")).toBeInTheDocument();
    expect(screen.getByText("Final test: unit tested OK.")).toBeInTheDocument();
    expect(createRepairLog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText(/Repair log added/);
    expect(createRepairLog).toHaveBeenCalledWith(31352, { repair_date: todayLocalDate(), hours_used: 0.25, details: "Final test: unit tested OK." });
  });

  it("adds labour through Mass Update apply with the preview timestamp", async () => {
    const row = {
      operation: { reference_id: 31351, op: "set_labour_total", labour_total: 110 },
      reference_id: 31351, customer_name: "", field: "Labour", before: "$0.00", after: "$110.00",
      lower_than_before: false, valid: true, updated_at: "2026-11-13T06:45:00Z", amount_delta: 124.3
    };
    interpretAsk.mockResolvedValue(
      answer({ intent: "add_labour", reference_ids: [31351], labour_preview: { reference_id: 31351, hours: 1, rate: 110, amount: 110, row, note: "At $110/hr." } })
    );
    applyAIMassUpdate.mockResolvedValue({ results: [{ reference_id: 31351, success: true, applied: ["Labour $0.00 → $110.00"] }] });
    render(<AskTab />);
    ask("Add labour to #31351 for 1 hour");
    expect(await screen.findByText("Preview: add labour to job #31351")).toBeInTheDocument();
    expect(screen.getByText("$0.00 →", { exact: false })).toBeInTheDocument();
    expect(applyAIMassUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applyAIMassUpdate).toHaveBeenCalledWith([row.operation], { 31351: "2026-11-13T06:45:00Z" }));
  });
});

describe("Ask read answers", () => {
  it("lists the jobs waiting on parts (not parts requests) with open parts counts", async () => {
    interpretAsk.mockResolvedValue(
      answer({ intent: "jobs_waiting_parts", reference_ids: [31352, 31178], waiting_parts: { status_id: 7, status_name: "Waiting on Part (s)", total: 2 } })
    );
    listWorkOrders.mockResolvedValue({
      items: [
        { reference_id: 31352, customer_name: "A", item_name: "Midi System", brand_names: ["Yamaha"], model_number: "CRX-040" },
        { reference_id: 31178, customer_name: "B", item_name: "Amplifier", brand_names: ["SAE"], model_number: "5500" }
      ]
    });
    listAllPartsPurchaseRequests.mockResolvedValue({
      items: [
        { parts_purchase_request_id: 1, reference_id: 31178, status: "waiting_approval" },
        { parts_purchase_request_id: 2, reference_id: 31178, status: "approved" },
        { parts_purchase_request_id: 3, reference_id: 31178, status: "cancelled" }
      ]
    });
    render(<AskTab />);
    ask("Which jobs are waiting on parts?");
    expect(await screen.findByText("Yamaha Midi System CRX-040")).toBeInTheDocument();
    const params = listWorkOrders.mock.calls[0][0] as URLSearchParams;
    expect(params.get("status_id")).toBe("7");
    expect(screen.getByText("Open parts")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("answers make and model from the job detail", async () => {
    interpretAsk.mockResolvedValue(answer({ intent: "job_details", reference_ids: [31178] }));
    getWorkOrderDetail.mockResolvedValue({ reference_id: 31178, item_name: "Amplifier", brand_names: ["SAE"], model_number: "5500", serial_number: "S-1", status_name: "Waiting on Part (s)" });
    render(<AskTab />);
    ask("What's the make and model on #31178?");
    expect(await screen.findByText("5500")).toBeInTheDocument();
    expect(screen.getByText("SAE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("shows the repair history", async () => {
    interpretAsk.mockResolvedValue(answer({ intent: "repair_history", reference_ids: [31165] }));
    listRepairLogs.mockResolvedValue({
      items: [{ repair_log_id: 1, reference_id: 31165, repair_date: "2026-11-05", hours_used: 1.5, details: "Serviced CD drive ![x](/img.png)" }]
    });
    render(<AskTab />);
    ask("What did we do on #31165?");
    expect(await screen.findByText("Serviced CD drive [photo]")).toBeInTheDocument();
    expect(listRepairLogs).toHaveBeenCalledWith(31165);
  });

  it("shows the Complete Job preview before any status write", async () => {
    interpretAsk.mockResolvedValue(answer({ intent: "complete_job", reference_ids: [31352], complete_job_preview: {target_status_id:20,target_status_name:"Finished",target_source:"completed_group",jobs:[{reference_id:31352,current_status_id:9,current_status_name:"Received",already:false}]} }));
    render(<AskTab />); ask("Complete job #31352");
    expect(await screen.findByText("Preview: Complete Job")).toBeInTheDocument();
    expect(screen.getByText("Received → Finished")).toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Apply"})).toBeEnabled();
  });

  it("filters the parts list by the statuses asked and the named job", async () => {
    listAllPartsPurchaseRequests.mockResolvedValue({
      items: [
        { parts_purchase_request_id: 1, reference_id: 31178, item_name: "MJ15025G", quantity: 1, status: "waiting_approval", source: "online", source_url: null },
        { parts_purchase_request_id: 2, reference_id: 31178, item_name: "1N4004", quantity: 1, status: "approved", source: "online", source_url: null },
        { parts_purchase_request_id: 3, reference_id: 31271, item_name: "Cap", quantity: 1, status: "waiting_approval", source: "online", source_url: null }
      ]
    });
    render(<PartsAnswer query="" statuses={["waiting_approval"]} referenceIds={[31178]} />);
    expect(await screen.findByText("MJ15025G")).toBeInTheDocument();
    expect(screen.queryByText("1N4004")).toBeNull();
    expect(screen.queryByText("Cap")).toBeNull();
  });

  it("strips images and caps long log text", () => {
    expect(logText("a ![p](/x.png) b")).toBe("a [photo] b");
    expect(logText("x".repeat(700)).length).toBe(601);
  });
});

it("answers labour questions with live gross labour, discount and total", async () => {
  interpretAsk.mockResolvedValue(answer({intent:"charges_summary",reference_ids:[29277],charges_focus:"labour"}));
  getWorkOrderDetail.mockResolvedValue({reference_id:29277,labour_total:110,labour_discount_type:"amount",labour_discount_value:10,parts_total:0,delivery_total:0,deposit:0});
  render(<AskTab />); ask("did we already add labour on #29277?");
  expect(await screen.findByText(/Labour on these jobs: \$100.00/)).toBeInTheDocument();
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([
    "Job #", "Labour before discount", "Labour discount", "Labour", "Parts", "Deposit", "Balance"
  ]);
  const rows = within(table).getAllByRole("row");
  expect(within(rows[1]).getAllByRole("cell").map(cell => cell.textContent)).toEqual([
    "#29277", "$110.00", "−$10.00", "$100.00", "$0.00", "$0.00", "$113.00"
  ]);
  expect(within(rows[2]).getAllByRole("cell").map(cell => cell.textContent)).toEqual([
    "Total", "$110.00", "−$10.00", "$100.00", "$0.00", "$0.00", "$113.00"
  ]);
  expect(getWorkOrderDetail).toHaveBeenCalledWith(29277);
  expect(listRepairLogs).not.toHaveBeenCalled();
  expect(screen.queryByRole("button",{name:"Apply"})).toBeNull();
});

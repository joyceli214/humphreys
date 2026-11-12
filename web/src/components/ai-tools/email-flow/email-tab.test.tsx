import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDraftTarget } from "@/lib/ai-tools/types";

const { FakeAPIError } = vi.hoisted(() => ({
  FakeAPIError: class FakeAPIError extends Error {
    constructor(message: string, public readonly status: number) {
      super(message);
    }
  }
}));

const listWorkOrders = vi.fn();
const getWorkOrderDetail = vi.fn();
const listEmailPickerContacts = vi.fn();
const listEmailTemplates = vi.fn();
const listPartsPurchaseRequests = vi.fn();
const sendWorkOrderCustomerEmail = vi.fn();
const rewriteEmail = vi.fn();
const listWorkOrderEmailPhotos = vi.fn();
const listEmailStaff = vi.fn();
const auth = { scope: ["work_orders:read", "work_orders:update", "work_orders_sensitive:read", "parts_purchase_requests:read"] as string[] };

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({ ...auth, hasPermission: (p: string) => auth.scope.includes(p) })
}));

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    listWorkOrders: (...a: unknown[]) => listWorkOrders(...a),
    getWorkOrderDetail: (...a: unknown[]) => getWorkOrderDetail(...a),
    listEmailPickerContacts: (...a: unknown[]) => listEmailPickerContacts(...a),
    listEmailTemplates: (...a: unknown[]) => listEmailTemplates(...a),
    listPartsPurchaseRequests: (...a: unknown[]) => listPartsPurchaseRequests(...a),
    sendWorkOrderCustomerEmail: (...a: unknown[]) => sendWorkOrderCustomerEmail(...a),
    rewriteEmail: (...a: unknown[]) => rewriteEmail(...a),
    listWorkOrderEmailPhotos: (...a: unknown[]) => listWorkOrderEmailPhotos(...a),
    listEmailStaff: (...a: unknown[]) => listEmailStaff(...a)
  }
}));

import { EmailTab } from "@/components/ai-tools/email-flow/email-tab";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/email-templates";

type Cust = { id: number; first: string; last: string; email: string | null };
const CUST_A: Cust = { id: 1, first: "Testa", last: "Alpha", email: "testa@customer.test" };
const CUST_B: Cust = { id: 2, first: "Testb", last: "Beta", email: "testb@customer.test" };

const JOBS: Record<number, { cust: Cust; item: string; status: string }> = {
  21: { cust: CUST_A, item: "Receiver", status: "In Progress" },
  22: { cust: CUST_A, item: "Turntable", status: "Waiting on parts" },
  23: { cust: CUST_B, item: "Amplifier", status: "Finished" }
};

function listRow(id: number) {
  const j = JOBS[id];
  return {
    reference_id: id, created_at: null, updated_at: null, status: j.status, status_group: null, job_type: "", location_id: null,
    location_code: null, location_shelf: null, location_floor: null, customer_name: `${j.cust.first} ${j.cust.last}`,
    customer_email: null, item_name: j.item, brand_names: [], model_number: null, serial_number: null, labour_total: null
  };
}

function detail(id: number) {
  const j = JOBS[id];
  return {
    labour_discount_type: null, labour_discount_value: null, labour_discount_amount: 0, reference_id: id, original_job_id: null,
    warranty_job_ids: [], created_at: null, updated_at: null, status_id: 1, status_key: null, status_name: j.status,
    status_group: null, status_updated_at: null, job_type_id: null, job_type_key: null, job_type_name: null, location_id: null,
    location_code: null, location_shelf: null, location_floor: null,
    customer: {
      customer_id: j.cust.id, first_name: j.cust.first, last_name: j.cust.last, email: j.cust.email, address_line_1: null,
      address_line_2: null, city: null, province: null, postal_code: null, home_phone: null, work_phone: null, remark: null
    },
    item_id: null, item_name: j.item, brand_ids: [], brand_names: [], model_number: null, serial_number: null, other_remarks: null,
    remote_control_qty: 0, cable_qty: 0, cord_qty: 0, dvd_vhs_qty: 0, album_cd_cassette_qty: 0, problem_description: null,
    worker_ids: [], worker_names: [], work_done: null, payment_method_ids: [], payment_method_names: [], parts_total: null,
    delivery_total: null, labour_total: null, deposit: 0, line_items: []
  };
}

function part(reference_id: number, item_name: string, quantity: number, status: string) {
  return {
    parts_purchase_request_id: reference_id * 10 + quantity, reference_id, item_name, quantity, status, source: "supplier",
    source_url: null, total_price: 0, audit_flags: []
  };
}

const SUPPLIER = { id: 90, name: "Test Supplier", email: "parts@supplier.test", role: "supplier", is_pinned: false };
const HELPER = { id: 91, name: "Front Desk", email: "desk@shop.test", role: "staff", is_pinned: false };

beforeEach(() => {
  vi.clearAllMocks();
  auth.scope = ["work_orders:read", "work_orders:update", "work_orders_sensitive:read", "parts_purchase_requests:read"];
  listWorkOrders.mockImplementation((params: URLSearchParams) => {
    const q = (params.get("q") ?? "").toLowerCase();
    const ids = Object.keys(JOBS).map(Number).filter((id) => String(id).includes(q) || `${JOBS[id].cust.first} ${JOBS[id].cust.last}`.toLowerCase().includes(q));
    return Promise.resolve({ items: ids.map(listRow) });
  });
  getWorkOrderDetail.mockImplementation((id: number) => Promise.resolve(detail(id)));
  listEmailPickerContacts.mockResolvedValue({ items: [SUPPLIER, HELPER], max_to: 10, max_cc: 10 });
  listEmailTemplates.mockResolvedValue({
    items: [
      { ...DEFAULT_EMAIL_TEMPLATES.job_started, updated_at: "" },
      { ...DEFAULT_EMAIL_TEMPLATES.job_completed, updated_at: "" }
    ]
  });
  listPartsPurchaseRequests.mockResolvedValue({ items: [] });
  sendWorkOrderCustomerEmail.mockResolvedValue({ sent: true });
  listWorkOrderEmailPhotos.mockResolvedValue({ items: [], max_photos: 10, max_total_bytes: 15_000_000 });
  listEmailStaff.mockResolvedValue({ items: [], max_cc: 10 });
});
afterEach(cleanup);

async function pick(query: string, option: RegExp) {
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: query } });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

const next = () => screen.getByRole("button", { name: "Next" });

async function pickJobs(...ids: number[]) {
  for (const id of ids) {
    await pick(String(id), new RegExp(`#${id}`));
    await screen.findByRole("button", { name: `Remove job #${id}` });
  }
  await waitFor(() => expect(screen.queryByText("Loading job…")).toBeNull());
}

function renderTab(target: EmailDraftTarget | null = null) {
  return render(<EmailTab target={target} />);
}

describe("EmailTab — customer", () => {
  it("starts on Who with Next disabled and enables it once a job is picked", async () => {
    renderTab();
    expect(screen.getByRole("heading", { name: "Pick jobs or a contact." })).toBeInTheDocument();
    expect(screen.getByText("One job or several. Jobs for the same customer go in one email.")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Name or job #");
    expect(next()).toBeDisabled();
    await pickJobs(21);
    await waitFor(() => expect(next()).toBeEnabled());
    expect(screen.getByText("from job")).toBeInTheDocument();
    expect(screen.queryByText("testa@customer.test")).toBeNull();
  });

  it("enables Next for a contact only, and never offers supplier contacts to customers", async () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "test" } });
    await screen.findAllByRole("option", { name: /#21/ });
    expect(screen.queryByRole("option", { name: /Test Supplier/ })).toBeNull();
    await pick("front", /Front Desk/);
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("warns about mixed customers and splits into one email each", async () => {
    renderTab();
    await pickJobs(21, 23);
    expect(await screen.findByText("These jobs are for 2 customers")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send one email each" }));
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole("button", { name: /Progress update/ }));
    const tabs = await screen.findByRole("tablist", { name: "Emails" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      expect.stringContaining("Email 1 of 2"),
      expect.stringContaining("Email 2 of 2")
    ]);
    expect(screen.getByRole("button", { name: /Send email 1 of 2|Fill \d+ blank/ })).toBeInTheDocument();
  });

  it("can narrow mixed jobs to one customer", async () => {
    renderTab();
    await pickJobs(21, 22, 23);
    fireEvent.click(await screen.findByRole("button", { name: "Pick one customer" }));
    fireEvent.click(screen.getByRole("radio", { name: /Testb Beta/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove job #21" })).toBeNull());
    expect(screen.getByRole("button", { name: "Remove job #23" })).toBeInTheDocument();
    expect(screen.queryByText("These jobs are for 2 customers")).toBeNull();
    expect(next()).toBeEnabled();
  });

  it("locks Send behind blanks, then confirms and sends with the live template key", async () => {
    renderTab();
    await pickJobs(21);
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    const send = await screen.findByRole("button", { name: "Fill 2 blanks" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Your receiver" } });
    const body = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: body.value.replace("{Your message}", "It is ready.") } });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(/Send to Testa Alpha/);
    expect(sendWorkOrderCustomerEmail).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendWorkOrderCustomerEmail).toHaveBeenCalledTimes(1));
    const [id, payload] = sendWorkOrderCustomerEmail.mock.calls[0];
    expect(id).toBe(21);
    expect(payload).toMatchObject({ template: "job_started", to: "", subject: "Your receiver", to_customer: true });
    expect(await screen.findByText(/Sent to/)).toBeInTheDocument();
  });

  it("keeps the draft and shows a retry error when sending fails", async () => {
    sendWorkOrderCustomerEmail.mockRejectedValueOnce(new FakeAPIError("mail server down (502 /x)", 502));
    renderTab();
    await pickJobs(21);
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(await screen.findByLabelText("Subject"), { target: { value: "Hello" } });
    const body = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Hi, all done." } });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/mail server down/)).toBeInTheDocument();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Hi, all done.");
  });

  it("AI help rewrites only when asked and Undo restores the body", async () => {
    rewriteEmail.mockResolvedValue({ body: "Hello Testa,\n\n{Your message}\n\nThanks", model: "m" });
    renderTab();
    await pickJobs(21);
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    const before = (await screen.findByLabelText("Message") as HTMLTextAreaElement).value;
    expect(screen.getByText("Nothing is written by the AI until you ask.")).toBeInTheDocument();
    expect(rewriteEmail).not.toHaveBeenCalled();
    const pen = screen.getByRole("button", { name: /AI help/ });
    fireEvent.click(pen);
    expect(pen).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Friendlier" }));
    expect(await screen.findByText("AI changed the text.")).toBeInTheDocument();
    expect(rewriteEmail).toHaveBeenCalledWith({ action: "friendlier", subject: "{Subject}", body: before });
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Hello Testa,\n\n{Your message}\n\nThanks");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(before);
  });

  it("adds the job from a work-order Draft email target", async () => {
    renderTab({ referenceId: 22, label: "Testa Alpha", type: "progress_update", job: { referenceId: 22, customerId: 1, customerName: "Testa Alpha", equipment: "Turntable", status: "" } });
    expect(await screen.findByRole("button", { name: "Remove job #22" })).toBeInTheDocument();
  });
});

describe("EmailTab — supplier", () => {
  function toSupplier() {
    fireEvent.click(screen.getByRole("radio", { name: "Supplier" }));
  }

  it("clears picked jobs when switching type", async () => {
    renderTab();
    await pickJobs(21);
    toSupplier();
    expect(screen.queryByRole("button", { name: "Remove job #21" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Pick jobs and a supplier." })).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Supplier name or job #");
  });

  it("enables Next with a supplier only, or jobs only", async () => {
    renderTab();
    toSupplier();
    expect(next()).toBeDisabled();
    expect(await screen.findByText(/No supplier yet\. Search above, or add suppliers on/)).toBeInTheDocument();
    await pick("test sup", /Test Supplier/);
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove supplier" }));
    expect(next()).toBeDisabled();
    await pickJobs(21);
    expect(next()).toBeEnabled();
  });

  it("says so honestly when no suppliers are saved", async () => {
    listEmailPickerContacts.mockResolvedValue({ items: [HELPER], max_to: 10, max_cc: 10 });
    renderTab();
    toSupplier();
    expect(await screen.findByText(/No suppliers saved yet\. Add them on/)).toBeInTheDocument();
  });

  async function toSupplierWrite(ids: number[]) {
    renderTab();
    toSupplier();
    await pick("test sup", /Test Supplier/);
    await pickJobs(...ids);
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole("button", { name: /Parts inquiry/ }));
    return (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
  }

  it("builds one merged parts table, hides names by default and warns when shown", async () => {
    listPartsPurchaseRequests.mockImplementation((id: number) =>
      Promise.resolve({
        items:
          id === 21
            ? [part(21, "Drive belt", 2, "approved"), part(21, "Fuse", 1, "arrived")]
            : [part(23, "drive belt", 1, "waiting_approval")]
      })
    );
    const body = await toSupplierWrite([21, 23]);
    await waitFor(() => expect(body.value).toContain("Drive belt | 3 | #21 ×2, #23 ×1"));
    expect(body.value).not.toMatch(/Testa|Testb|Alpha|Beta/);
    for (const bad of ["HE-2207", "555", "Justin"]) expect(body.value).not.toContain(bad);
    expect(screen.getByText("Customer names are left out of supplier emails.")).toBeInTheDocument();
    expect(screen.getByText("Includes parts that are waiting for approval or approved.")).toBeInTheDocument();
    expect(screen.getByText(/1 other part left out \(arrived\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show names" }));
    expect(screen.getByText("Customer names will be shown to the supplier.")).toBeInTheDocument();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toContain("Part | Qty | For job # | Customer");
  });

  it("does not clobber an edited body when names are toggled", async () => {
    const body = await toSupplierWrite([21]);
    await waitFor(() => expect(body.value).toContain("Part | Qty | For job #"));
    fireEvent.change(body, { target: { value: body.value + "\nExtra line" } });
    fireEvent.click(screen.getByRole("button", { name: "Show names" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toContain("Extra line");
    fireEvent.click(screen.getByRole("button", { name: /Body was edited — reset to draft to apply/ }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toContain("| Customer");
  });

  it("falls back to by-hand blanks when parts can't be read (403)", async () => {
    listPartsPurchaseRequests.mockRejectedValue(new FakeAPIError("forbidden (403 /x)", 403));
    const body = await toSupplierWrite([21]);
    expect(await screen.findByText("You can't read parts requests, so fill the parts in by hand.")).toBeInTheDocument();
    await waitFor(() => expect(body.value).toContain("{Part for #21} | {Qty} | #21"));
  });

  it("sends to the supplier contact from the first job", async () => {
    listPartsPurchaseRequests.mockResolvedValue({ items: [part(21, "Drive belt", 2, "approved")] });
    const body = await toSupplierWrite([21]);
    await waitFor(() => expect(body.value).toContain("Drive belt | 2 | #21"));
    fireEvent.change(body, { target: { value: body.value.replace("{Account #}", "A-1") } });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendWorkOrderCustomerEmail).toHaveBeenCalled());
    const [id, payload] = sendWorkOrderCustomerEmail.mock.calls[0];
    expect(id).toBe(21);
    expect(payload).toMatchObject({ template: "job_started", to: "", to_customer: false, to_contact_ids: [90] });
  });
});

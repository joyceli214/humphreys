import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AISearchRow } from "@/lib/ai-tools/types";
import { EMAIL_SELECTION_STORAGE_KEY } from "@/lib/ai-tools/email-selection";

const runAISearch = vi.fn();
const draftAICustomerEmail = vi.fn();
const sendWorkOrderCustomerEmail = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    runAISearch: (...args: unknown[]) => runAISearch(...args),
    draftAICustomerEmail: (...args: unknown[]) => draftAICustomerEmail(...args),
    sendWorkOrderCustomerEmail: (...args: unknown[]) => sendWorkOrderCustomerEmail(...args)
  }
}));

import { EmailDraftsTab } from "@/components/ai-tools/email-drafts-tab";

function row(reference_id: number, customer_id: number, customer_name: string, equipment_name: string): AISearchRow {
  return {
    reference_id, customer_id, customer_name, equipment_name, brand_names: [], model_number: "", serial_number: "",
    status_name: "Finished", status_group: "done", created_at: null, is_warranty: false, original_job_id: null,
    warranty_job_ids: [], customer_job_count: 1
  };
}

const ROWS = [row(5, 1, "Jane Doe", "Receiver"), row(6, 1, "Jane Doe", "Turntable"), row(7, 2, "Bob Ray", "Amplifier")];

function draftResponse(ids: number[], hint = "j***@example.com") {
  return {
    subject: "Update on your jobs", body: "Hi Jane", type: "progress_update", model: "m",
    work_order_ids: ids, customer_name: "Jane Doe", recipient_hint: hint, has_recipient_email: hint !== ""
  };
}

beforeEach(() => {
  runAISearch.mockResolvedValue({ filters: {}, rows: ROWS, total: 3, limit: 20, offset: 0, group_by: "none", groups: [] });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  runAISearch.mockReset();
  draftAICustomerEmail.mockReset();
  sendWorkOrderCustomerEmail.mockReset();
});

async function searchAndAdd(...ids: number[]) {
  fireEvent.change(screen.getByLabelText("Search by customer name or job #"), { target: { value: "jane" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  for (const id of ids) fireEvent.click(await screen.findByRole("button", { name: `Add job #${id}` }));
}

function selectedList() {
  return screen.getByRole("list", { name: "Selected jobs" });
}

describe("EmailDraftsTab", () => {
  it("searches via Advanced Search text filter and never shows contact details", async () => {
    render(<EmailDraftsTab target={null} />);
    await searchAndAdd();
    await screen.findByRole("button", { name: "Add job #5" });
    expect(runAISearch).toHaveBeenCalledWith({ text: "jane", limit: 20 });
    expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0);
    expect(screen.getByText("Amplifier")).toBeInTheDocument();
  });

  it("picks, saves to localStorage, survives reload and removes jobs", async () => {
    const { unmount } = render(<EmailDraftsTab target={null} />);
    await searchAndAdd(5, 6);
    expect(within(selectedList()).getByText(/#5/)).toBeInTheDocument();
    expect(window.localStorage.getItem(EMAIL_SELECTION_STORAGE_KEY)).toContain("\"referenceId\":6");
    unmount();

    render(<EmailDraftsTab target={null} />);
    expect(within(selectedList()).getByText(/#6/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove job #5" }));
    expect(within(selectedList()).queryByText(/#5/)).toBeNull();
    expect(window.localStorage.getItem(EMAIL_SELECTION_STORAGE_KEY)).not.toContain("\"referenceId\":5");
  });

  it("warns about different customers and requires choosing one", async () => {
    render(<EmailDraftsTab target={null} />);
    await searchAndAdd(5, 7);
    expect(screen.getByText(/different customers/i)).toBeInTheDocument();
    const generate = screen.getByRole("button", { name: "Generate draft" });
    expect(generate).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Jane Doe/ }));
    expect(generate).toBeEnabled();
    draftAICustomerEmail.mockResolvedValue(draftResponse([5]));
    fireEvent.click(generate);
    await waitFor(() => expect(draftAICustomerEmail).toHaveBeenCalledWith({ work_order_ids: [5], type: "estimate", notes: "" }));
  });

  it("follows the flow order and only sends after the confirm step", async () => {
    render(<EmailDraftsTab target={null} />);
    expect(screen.getByRole("button", { name: "Generate draft" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();

    await searchAndAdd(5, 6);
    fireEvent.click(screen.getByRole("radio", { name: "Progress update" }));
    fireEvent.change(screen.getByLabelText(/Extra notes for the AI/), { target: { value: "both done Friday" } });
    draftAICustomerEmail.mockResolvedValue(draftResponse([5, 6]));
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() =>
      expect(draftAICustomerEmail).toHaveBeenCalledWith({ work_order_ids: [5, 6], type: "progress_update", notes: "both done Friday" })
    );

    expect(await screen.findByText(/j\*\*\*@example.com/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Subject:"), { target: { value: "Edited subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Send to j\*\*\*@example.com for job\(s\) #5, #6\?/)).toBeInTheDocument();
    expect(sendWorkOrderCustomerEmail).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sendWorkOrderCustomerEmail).not.toHaveBeenCalled();

    sendWorkOrderCustomerEmail.mockResolvedValue({ sent: true });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Send" }));
    await screen.findByText(/Email sent/);
    expect(sendWorkOrderCustomerEmail).toHaveBeenCalledTimes(1);
    expect(sendWorkOrderCustomerEmail).toHaveBeenCalledWith(5, { template: "job_started", to: "", subject: "Edited subject", body: "Hi Jane" });
  });

  it("disables Send when the customer has no email on file", async () => {
    render(<EmailDraftsTab target={null} />);
    await searchAndAdd(5);
    draftAICustomerEmail.mockResolvedValue(draftResponse([5], ""));
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    expect(await screen.findByText(/customer has no email on file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send email" })).toBeDisabled();
  });

  it("shows the real error when sending fails", async () => {
    render(<EmailDraftsTab target={null} />);
    await searchAndAdd(5);
    draftAICustomerEmail.mockResolvedValue(draftResponse([5]));
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    sendWorkOrderCustomerEmail.mockRejectedValue(new Error("email sending is not configured"));
    fireEvent.click(await screen.findByRole("button", { name: "Send email" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Send" }));
    expect(await screen.findByText("email sending is not configured")).toBeInTheDocument();
  });
});

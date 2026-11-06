import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AISearchRow } from "@/lib/ai-tools/types";
import { EMAIL_SELECTION_STORAGE_KEY } from "@/lib/ai-tools/email-selection";

const runAISearch = vi.fn();
const draftAICustomerEmail = vi.fn();
const sendWorkOrderCustomerEmail = vi.fn();
const listWorkOrderEmailPhotos = vi.fn();
const listEmailStaff = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    runAISearch: (...args: unknown[]) => runAISearch(...args),
    draftAICustomerEmail: (...args: unknown[]) => draftAICustomerEmail(...args),
    sendWorkOrderCustomerEmail: (...args: unknown[]) => sendWorkOrderCustomerEmail(...args),
    listWorkOrderEmailPhotos: (...args: unknown[]) => listWorkOrderEmailPhotos(...args),
    listEmailStaff: (...args: unknown[]) => listEmailStaff(...args)
  }
}));

function photo(id: string, source: string, send_bytes = 400_000) {
  return {
    id, url: `https://storage.example/${id}.jpg`, name: `${id}.jpg`, source, original_bytes: send_bytes * 3, send_bytes,
    original_type: "image/jpeg", width: 1600, height: 1200, supported: true
  };
}

function photosFor(byJob: Record<number, ReturnType<typeof photo>[]>) {
  listWorkOrderEmailPhotos.mockImplementation((id: number) =>
    Promise.resolve({ items: byJob[id] ?? [], max_photos: 10, max_total_bytes: 15_000_000 })
  );
}

import { EmailDraftsTab } from "@/components/ai-tools/email-drafts-tab";
import { mailtoNavigator } from "@/lib/mailto";

function row(reference_id: number, customer_id: number, customer_name: string, equipment_name: string): AISearchRow {
  return {
    reference_id, customer_id, customer_name, equipment_name, brand_names: [], model_number: "", serial_number: "",
    status_name: "Finished", status_group: "done", created_at: null, is_warranty: false, original_job_id: null,
    warranty_job_ids: [], customer_job_count: 1
  };
}

const ROWS = [row(5, 1, "Jane Doe", "Receiver"), row(6, 1, "Jane Doe", "Turntable"), row(7, 2, "Bob Ray", "Amplifier")];

function draftResponse(ids: number[], hint = "j***@example.com", extra: Record<string, unknown> = {}) {
  return {
    subject: "Update on your jobs", body: "Hi Jane", type: "progress_update", model: "m",
    work_order_ids: ids, customer_name: "Jane Doe", recipient_hint: hint, has_recipient_email: hint !== "",
    ...extra
  };
}

const EMPTY_RECIPIENT_NOTE = "No email on file for this customer; add the recipient in your email app.";
const TOO_LONG_NOTE = "Draft is too long for the email app link; copied to clipboard";
const MIXED_NOTE = "These jobs belong to different customers; using the first customer's email.";

function mockClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

async function generateDraft(response: ReturnType<typeof draftResponse>, ...ids: number[]) {
  render(<EmailDraftsTab target={null} />);
  await searchAndAdd(...ids);
  draftAICustomerEmail.mockResolvedValue(response);
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  return screen.findByRole("button", { name: "Open in email app" });
}

beforeEach(() => {
  // shouldAdvanceTime keeps RTL's waitFor polling working alongside fake timers.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  runAISearch.mockResolvedValue({ filters: {}, rows: ROWS, total: 3, limit: 20, offset: 0, group_by: "none", groups: [] });
  photosFor({});
  listEmailStaff.mockResolvedValue({
    items: [
      { id: "u1", email: "dave@humphreys.test", full_name: "Dave Lee" },
      { id: "u2", email: "amy@humphreys.test", full_name: "Amy Chan" }
    ],
    max_cc: 10
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  runAISearch.mockReset();
  draftAICustomerEmail.mockReset();
  sendWorkOrderCustomerEmail.mockReset();
  listWorkOrderEmailPhotos.mockReset();
  listEmailStaff.mockReset();
});

async function searchAndAdd(...ids: number[]) {
  fireEvent.change(screen.getByRole("combobox", { name: "Search by customer name or job #" }), { target: { value: "jane" } });
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
  for (const id of ids) fireEvent.click(screen.getByRole("option", { name: new RegExp(`^#${id} `) }));
}

function selectedList() {
  return screen.getByRole("list", { name: "Selected jobs" });
}

describe("EmailDraftsTab", () => {
  it("suggests jobs by customer name as you type and never shows contact details", async () => {
    const leaky = ROWS.map((r) => ({ ...r, customer_email: "jane@example.com", customer_phone: "555-0100" }));
    runAISearch.mockResolvedValue({ filters: {}, rows: leaky, total: 3, limit: 20, offset: 0, group_by: "none", groups: [] });
    render(<EmailDraftsTab target={null} />);
    await searchAndAdd();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(runAISearch).toHaveBeenCalledWith({ customer_name: "jane", limit: 20 });
    expect(screen.queryByText(/jane@example\.com|555-0100/)).toBeNull();
    expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: /#7 Bob Ray Amplifier/ })).toBeInTheDocument();
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

  it("adds a target's full job (customer id) to an already-mounted tab so it groups with that customer", async () => {
    const { rerender } = render(<EmailDraftsTab target={null} />);
    await searchAndAdd(5);
    const job = { referenceId: 9, customerId: 1, customerName: "Jane Doe", equipment: "Tape deck", status: "In Progress" };
    rerender(<EmailDraftsTab target={{ referenceId: 9, label: "Jane Doe", type: "progress_update", job }} />);
    expect(within(selectedList()).getByText(/#9/)).toBeInTheDocument();
    expect(screen.queryByText(/different customers/i)).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(EMAIL_SELECTION_STORAGE_KEY) ?? "[]");
    expect(stored).toContainEqual(job);
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

  it("lets the admin pick job photos and staff Cc, and sends them with the email", async () => {
    photosFor({ 5: [photo("p1", "Problem"), photo("p2", "Repair log Jan 2")] });
    render(<EmailDraftsTab target={null} />);
    await searchAndAdd(5);
    draftAICustomerEmail.mockResolvedValue(draftResponse([5]));
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    const panel = await screen.findByRole("region", { name: "Photos from this job" });
    await waitFor(() => expect(listWorkOrderEmailPhotos).toHaveBeenCalledWith(5));
    const tile = await within(panel).findByRole("button", { name: /Photo 2 from Repair log Jan 2/ });
    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/add photos there/)).toBeNull();

    const ccSelect = await screen.findByRole("combobox", { name: "Add staff to Cc" });
    await waitFor(() => expect(ccSelect).toBeEnabled());
    fireEvent.change(ccSelect, { target: { value: "amy@humphreys.test" } });
    expect(screen.getByRole("button", { name: "Remove amy@humphreys.test from Cc" })).toBeInTheDocument();
    // Only staff from the directory can be picked: no free-text input.
    expect(screen.queryByRole("textbox", { name: /cc/i })).toBeNull();

    sendWorkOrderCustomerEmail.mockResolvedValue({ sent: true });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Cc: amy@humphreys.test")).toBeInTheDocument();
    expect(within(dialog).getByText(/1 photo attached \(0\.4 MB\)/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    await screen.findByText(/Email sent/);
    expect(sendWorkOrderCustomerEmail).toHaveBeenCalledWith(5, {
      template: "job_started", to: "", subject: "Update on your jobs", body: "Hi Jane",
      photo_ids: ["p2"], cc: ["amy@humphreys.test"]
    });
  });

  it("shows photos from all jobs of a multi-job draft, labelled by job, and allows them on send", async () => {
    photosFor({ 5: [photo("p1", "Problem")], 6: [photo("p6", "Work done")] });
    render(<EmailDraftsTab target={null} />);
    await searchAndAdd(5, 6);
    draftAICustomerEmail.mockResolvedValue(draftResponse([5, 6]));
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    const panel = await screen.findByRole("region", { name: "Photos from this job" });
    expect(screen.getByText(/Photos from all 2 jobs are shown/)).toBeInTheDocument();
    const job6Tile = await within(panel).findByRole("button", { name: /from Job #6 · Work done/ });
    expect(within(panel).getByRole("button", { name: /from Job #5 · Problem/ })).toBeInTheDocument();
    fireEvent.click(job6Tile);

    sendWorkOrderCustomerEmail.mockResolvedValue({ sent: true });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Send" }));
    await screen.findByText(/Email sent/);
    expect(sendWorkOrderCustomerEmail).toHaveBeenCalledWith(5, expect.objectContaining({ photo_ids: ["p6"], photo_work_order_ids: [6] }));
    expect(sendWorkOrderCustomerEmail.mock.calls[0][1]).not.toHaveProperty("cc");
  });

  it("only offers the send job's photos when the jobs belong to different customers", async () => {
    photosFor({ 5: [photo("p1", "Problem")], 7: [photo("p7", "Problem")] });
    await generateDraft(draftResponse([5, 7], "j***@example.com", { customer_email_mixed: true }), 5);
    await waitFor(() => expect(listWorkOrderEmailPhotos).toHaveBeenCalledWith(5));
    expect(listWorkOrderEmailPhotos).not.toHaveBeenCalledWith(7);
    expect(screen.getByText(/only photos from job #5 can be attached/)).toBeInTheDocument();
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

  describe("Open in email app", () => {
    let openSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      openSpy = vi.spyOn(mailtoNavigator, "open").mockImplementation(() => {});
    });
    afterEach(() => {
      openSpy.mockRestore();
    });

    it("replaces the old editor handoff button and opens a mailto link only on click", async () => {
      const open = await generateDraft(draftResponse([5, 6], "j***@example.com", { customer_email: "jane@example.com" }), 5, 6);
      expect(screen.queryByRole("button", { name: /Email Customer editor/ })).toBeNull();
      expect(openSpy).not.toHaveBeenCalled();

      // The edited body is what goes into the link.
      fireEvent.change(screen.getByLabelText("Email body"), { target: { value: "Hi Jane,\nParts & labour: $180\n— Humphreys" } });
      fireEvent.click(open);
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(
        "mailto:jane@example.com?subject=Update%20on%20your%20jobs&body=Hi%20Jane%2C%0D%0AParts%20%26%20labour%3A%20%24180%0D%0A%E2%80%94%20Humphreys"
      );
      expect(screen.queryByText(EMPTY_RECIPIENT_NOTE)).toBeNull();
      expect(screen.queryByText(MIXED_NOTE)).toBeNull();
      expect(sendWorkOrderCustomerEmail).not.toHaveBeenCalled();
      // Send email + confirm are still there.
      expect(screen.getByRole("button", { name: "Send email" })).toBeEnabled();
    });

    it("uses an empty recipient with a note when customer_email is absent (no sensitive permission)", async () => {
      const open = await generateDraft(draftResponse([5]), 5);
      expect(screen.getByText(EMPTY_RECIPIENT_NOTE)).toBeInTheDocument();
      fireEvent.click(open);
      expect(openSpy).toHaveBeenCalledWith("mailto:?subject=Update%20on%20your%20jobs&body=Hi%20Jane");
    });

    it("shows the mixed-customers note when the server flags it", async () => {
      await generateDraft(draftResponse([5], "j***@example.com", { customer_email: "jane@example.com", customer_email_mixed: true }), 5);
      expect(screen.getByText(MIXED_NOTE)).toBeInTheDocument();
    });

    it("copies the full draft to the clipboard when the link would be too long, without truncating", async () => {
      const writeText = mockClipboard();
      const open = await generateDraft(draftResponse([5], "j***@example.com", { customer_email: "jane@example.com" }), 5);
      const longBody = "Line of the estimate.\n".repeat(120).trim();
      fireEvent.change(screen.getByLabelText("Email body"), { target: { value: longBody } });
      expect(screen.getByRole("button", { name: "Copy draft" })).toBeInTheDocument();

      fireEvent.click(open);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(`Subject: Update on your jobs\n\n${longBody}`));
      expect(await screen.findByText(TOO_LONG_NOTE)).toBeInTheDocument();
      expect(openSpy).toHaveBeenCalledWith("mailto:jane@example.com?subject=Update%20on%20your%20jobs");
      // The editor keeps the full body.
      expect(screen.getByLabelText("Email body")).toHaveValue(longBody);

      writeText.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Copy draft" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(`Subject: Update on your jobs\n\n${longBody}`));
    });

    it("says so when the clipboard is unavailable", async () => {
      mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
      const open = await generateDraft(draftResponse([5], "j***@example.com", { customer_email: "jane@example.com" }), 5);
      fireEvent.change(screen.getByLabelText("Email body"), { target: { value: "x".repeat(2000) } });
      fireEvent.click(open);
      expect(await screen.findByText(/Couldn't copy the draft/)).toBeInTheDocument();
      expect(screen.queryByText(TOO_LONG_NOTE)).toBeNull();
    });
  });

  it("caps the description notes at the server limit (2000) with a live counter", () => {
    render(<EmailDraftsTab target={null} />);
    const notes = screen.getByLabelText(/Extra notes for the AI/);
    expect(notes).toHaveAttribute("maxLength", "2000");
    expect(screen.getByText("0 / 2000")).toBeInTheDocument();
    fireEvent.change(notes, { target: { value: "done Friday" } });
    expect(screen.getByText("11 / 2000")).toBeInTheDocument();
  });

  it("fills the pane: full-height responsive grid that stacks when narrow, no max-width centering", () => {
    const { container } = render(<EmailDraftsTab target={null} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("grid", "w-full", "flex-1", "grid-cols-1");
    expect(root.className).toMatch(/\b(?:md|lg):grid-cols-/);
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/\bmax-w-|\bmx-auto\b/);
    }
  });
});

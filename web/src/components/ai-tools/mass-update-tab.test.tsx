import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MassUpdatePreviewResponse } from "@/lib/ai-tools/types";

const previewAIMassUpdate = vi.fn();
const applyAIMassUpdate = vi.fn();
const getAILineItemCatalog = vi.fn();
const runAISearch = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    previewAIMassUpdate: (...args: unknown[]) => previewAIMassUpdate(...args),
    applyAIMassUpdate: (...args: unknown[]) => applyAIMassUpdate(...args),
    getAILineItemCatalog: (...args: unknown[]) => getAILineItemCatalog(...args),
    runAISearch: (...args: unknown[]) => runAISearch(...args),
    listWorkOrderStatuses: (...args: unknown[]) => listWorkOrderStatuses(...args)
  }
}));

const listWorkOrderStatuses = vi.fn();

beforeEach(() => {
  getAILineItemCatalog.mockResolvedValue({ items: [{ name: "Belt Kit / Shipping", unit_price: 32, quantity_text: "1" }] });
  runAISearch.mockResolvedValue({ rows: [{ reference_id: 29275, customer_name: "Alex Example", equipment_name: "Receiver", brand_names: [], model_number: "", status_name: "Received" }] });
  listWorkOrderStatuses.mockResolvedValue({ items: [{ id: 1, label: "Ready for pickup" }, { id: 2, label: "In repair" }] });
});

import { MassUpdateTab } from "@/components/ai-tools/mass-update-tab";

const PREVIEW: MassUpdatePreviewResponse = {
  model: "test",
  rows: [
    {
      operation: { reference_id: 1, op: "set_labour_total", labour_total: 80 },
      reference_id: 1,
      customer_name: "A",
      field: "Labour total",
      before: "$60.00",
      after: "$80.00",
      lower_than_before: false,
      valid: true,
      updated_at: "2026-10-01T09:30:15.123456Z"
    },
    {
      operation: { reference_id: 2, op: "set_labour_total", labour_total: 80 },
      reference_id: 2,
      customer_name: "B",
      field: "Labour total",
      before: "$90.00",
      after: "$80.00",
      lower_than_before: true,
      valid: true,
      updated_at: null
    },
    {
      operation: { reference_id: 3, op: "set_location", location_name: "Nowhere" },
      reference_id: 3,
      customer_name: "C",
      field: "Location",
      before: "",
      after: "",
      lower_than_before: false,
      valid: false,
      error: "Unknown location",
      updated_at: "2026-10-02T00:00:00Z"
    }
  ]
};

afterEach(() => {
  cleanup();
  previewAIMassUpdate.mockReset();
  applyAIMassUpdate.mockReset();
  runAISearch.mockReset();
});

describe("MassUpdateTab", () => {
  it("never shows a truncation banner, even if a stale server sends truncated", async () => {
    previewAIMassUpdate.mockResolvedValue({ ...PREVIEW, truncated: true });
    render(<MassUpdateTab />);

    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "labour to 80" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(await screen.findByText("Preview: 3 changes across 3 jobs")).toBeInTheDocument();
    expect(screen.queryByText(/Only the first .* jobs are included/)).not.toBeInTheDocument();
  });

  it("previews, then applies only the checked valid operations and shows per-job results", async () => {
    previewAIMassUpdate.mockResolvedValue(PREVIEW);
    applyAIMassUpdate.mockResolvedValue({
      results: [
        { reference_id: 1, success: true, applied: ["Labour total $60.00 → $80.00"] },
        { reference_id: 2, success: false, applied: null, error: "Job is locked." }
      ]
    });
    render(<MassUpdateTab />);

    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "labour to 80" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(await screen.findByText("Preview: 3 changes across 3 jobs")).toBeInTheDocument();
    expect(previewAIMassUpdate).toHaveBeenCalledWith("labour to 80");
    expect(screen.getByRole("button", { name: "Apply 2 selected changes" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select change 2 for job #2" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 selected change" }));

    expect(await screen.findByText(/Job is locked\./)).toBeInTheDocument();
    // Only the selected jobs' preview timestamps are sent back.
    expect(applyAIMassUpdate).toHaveBeenCalledWith([PREVIEW.rows[0].operation], { 1: "2026-10-01T09:30:15.123456Z" });
    expect(screen.getByText(/Results: 1 job updated/)).toBeInTheDocument();
  });

  it("sends each job's preview updated_at (including null) and shows a job rejected as changed since preview", async () => {
    previewAIMassUpdate.mockResolvedValue(PREVIEW);
    applyAIMassUpdate.mockResolvedValue({
      results: [
        { reference_id: 1, success: false, applied: null, error: "This job was changed after the preview was created. Preview again before applying." },
        { reference_id: 2, success: true, applied: ["Labour total set to $80.00"] }
      ]
    });
    render(<MassUpdateTab />);

    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "labour to 80" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply 2 selected changes" }));

    expect(await screen.findByText("This job was changed after the preview was created. Preview again before applying.")).toBeInTheDocument();
    expect(applyAIMassUpdate).toHaveBeenCalledWith([PREVIEW.rows[0].operation, PREVIEW.rows[1].operation], {
      1: "2026-10-01T09:30:15.123456Z",
      2: null
    });
    expect(screen.getByText(/Results: 1 job updated/)).toBeInTheDocument();
    expect(screen.getByText(/1 job could not be updated/)).toBeInTheDocument();
  });

  it("keeps the Preview button enabled (not faded) after a preview, disabled only while loading", async () => {
    let resolvePreview: (value: MassUpdatePreviewResponse) => void = () => {};
    previewAIMassUpdate.mockReturnValue(new Promise<MassUpdatePreviewResponse>((resolve) => (resolvePreview = resolve)));
    render(<MassUpdateTab />);

    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "labour to 80" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(screen.getByRole("button", { name: "Preparing preview..." })).toBeDisabled();

    resolvePreview(PREVIEW);
    expect(await screen.findByText("Preview: 3 changes across 3 jobs")).toBeInTheDocument();
    const previewButton = screen.getByRole("button", { name: "Preview changes" });
    expect(previewButton).toBeEnabled();
    // Opacity is only ever applied through the disabled: variant.
    expect(previewButton.className).not.toMatch(/(^|\s)opacity-/);
  });

  it("explains that nothing is saved until changes are applied, and offers no Apply before a preview", () => {
    render(<MassUpdateTab />);
    expect(screen.getByText(/You will see a preview of every change before anything is saved\./)).toBeInTheDocument();
    expect(screen.getByText("Nothing is saved until you apply")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Apply/ })).not.toBeInTheDocument();
  });

  it("explains invalid rows and lets the preview be discarded", async () => {
    previewAIMassUpdate.mockResolvedValue(PREVIEW);
    render(<MassUpdateTab />);
    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(await screen.findByText("1 change cannot be applied and has been left unselected.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard preview" }));
    expect(screen.queryByText(/^Preview:/)).not.toBeInTheDocument();
    expect(applyAIMassUpdate).not.toHaveBeenCalled();
  });

  it("explains when no changes were suggested", async () => {
    previewAIMassUpdate.mockResolvedValue({ model: "test", rows: [] });
    render(<MassUpdateTab />);
    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(await screen.findByText(/No changes were suggested\. Try rewording your request/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply selected changes" })).toBeDisabled();
  });

  it("shows the server error when the preview fails", async () => {
    previewAIMassUpdate.mockRejectedValue(new Error("AI did not return valid JSON (502 /ai-tools/mass-update/preview)"));
    render(<MassUpdateTab />);
    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^AI did not return valid JSON$/);
  });

  it("caps the instruction at the server limit (2000) with a live counter", () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    expect(box).toHaveAttribute("maxLength", "2000");
    expect(screen.getByText("0 / 2000")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "labour to 80" } });
    expect(screen.getByText("12 / 2000")).toBeInTheDocument();
  });

  it("shows fill-in slots (no sample numbers) when an example is clicked, replacing the instruction", () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    fireEvent.change(box, { target: { value: "old text" } });
    expect(screen.queryByRole("group", { name: "Fill in the example" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Give a labour discount" }));
    const slots = screen.getByRole("group", { name: "Fill in the example" });
    expect(within(slots).getByLabelText("Jobs")).toHaveValue("");
    expect(within(slots).getByLabelText("Discount %")).toHaveValue("");
    expect(box).toHaveValue("Give jobs a labour discount.");
    expect((box as HTMLTextAreaElement).value).not.toMatch(/\d|\[|_/);
  });

  it("composes the instruction live as slots are filled", () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    fireEvent.click(screen.getByRole("button", { name: "Give a labour discount" }));
    const slots = screen.getByRole("group", { name: "Fill in the example" });
    fireEvent.change(within(slots).getByLabelText("Jobs"), { target: { value: "101, 102" } });
    expect(box).toHaveValue("Give jobs 101 and 102 a labour discount.");
    fireEvent.change(within(slots).getByLabelText("Discount %"), { target: { value: "15" } });
    expect(box).toHaveValue("Give jobs 101 and 102 a 15% labour discount.");
    expect(screen.getByRole("button", { name: "Preview changes" })).toBeEnabled();
  });

  it("offers loaded statuses as a pick list in the status slot", async () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    fireEvent.click(screen.getByRole("button", { name: "Set jobs to a status" }));
    const slots = screen.getByRole("group", { name: "Fill in the example" });
    await waitFor(() => expect(within(slots).getByRole("option", { name: "Ready for pickup" })).toBeInTheDocument());
    const status = within(slots).getByLabelText("Status");
    expect(status.tagName).toBe("SELECT");
    fireEvent.change(within(slots).getByLabelText("Jobs"), { target: { value: "7" } });
    fireEvent.change(status, { target: { value: "Ready for pickup" } });
    expect(box).toHaveValue("Set job 7 to Ready for pickup.");
  });

  it("detaches the slots when the instruction is edited directly, keeping the text", () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    fireEvent.click(screen.getByRole("button", { name: "Generate Work Done for jobs" }));
    fireEvent.change(screen.getByLabelText("Jobs"), { target: { value: "5" } });
    fireEvent.change(box, { target: { value: "Generate Work Done for job 5 please." } });
    expect(screen.queryByRole("group", { name: "Fill in the example" })).toBeNull();
    expect(box).toHaveValue("Generate Work Done for job 5 please.");
  });

  it("catalog Insert opens the add-item template with the item slot prefilled from the catalog", async () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    fireEvent.click(await screen.findByRole("button", { name: "Insert Belt Kit / Shipping" }));
    const slots = screen.getByRole("group", { name: "Fill in the example" });
    const item = within(slots).getByLabelText("Item");
    expect(item).toHaveValue("Belt Kit / Shipping");
    const listId = item.getAttribute("list");
    expect(listId).toBeTruthy();
    expect(document.getElementById(listId!)?.querySelector('option[value="Belt Kit / Shipping"]')).not.toBeNull();
    expect(within(slots).getByLabelText("Price")).toHaveValue("32.00");
    expect(within(slots).getByLabelText("Qty")).toHaveValue("1");
    expect(within(slots).getByLabelText("Jobs")).toHaveValue("");
    expect(box).toHaveValue('Add "Belt Kit / Shipping" at $32.00 (qty 1) to jobs.');

    fireEvent.change(within(slots).getByLabelText("Jobs"), { target: { value: "42" } });
    expect(box).toHaveValue('Add "Belt Kit / Shipping" at $32.00 (qty 1) to job 42.');
  });

  it("keeps variable-price profile items out of preview until jobs and price are confirmed", async () => {
    render(<MassUpdateTab />);
    fireEvent.click(screen.getByText("Pick from product profile"));
    fireEvent.change(screen.getByLabelText("Product profile"), { target: { value: "turntable" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert Cartridge from Turntable" }));

    const slots = screen.getByRole("group", { name: "Fill in the example" });
    expect(within(slots).getByLabelText("Item")).toHaveValue("Cartridge");
    expect(within(slots).getByLabelText("Price")).toHaveValue("");
    expect(within(slots).getByLabelText("Qty")).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(screen.getByText("Enter the job numbers before previewing this profile item.")).toBeInTheDocument();
    expect(previewAIMassUpdate).not.toHaveBeenCalled();

    fireEvent.change(within(slots).getByLabelText("Jobs"), { target: { value: "29275" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(screen.getByText("Enter a valid unit price and quantity before previewing this profile item.")).toBeInTheDocument();
    expect(previewAIMassUpdate).not.toHaveBeenCalled();

    fireEvent.change(within(slots).getByLabelText("Price"), { target: { value: "169.45" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await waitFor(() => expect(previewAIMassUpdate).toHaveBeenCalledWith('Add "Cartridge" at $169.45 (qty 1) to job 29275.'));
  });

  it("adds a customer-search suggestion to the profile instruction as a job number", async () => {
    render(<MassUpdateTab />);
    fireEvent.click(screen.getByText("Pick from product profile"));
    fireEvent.change(screen.getByLabelText("Product profile"), { target: { value: "turntable" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert Audio Cable from Turntable" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Jobs" }), { target: { value: "Alex" } });
    fireEvent.click(await screen.findByRole("option", { name: /#29275 Alex Example/ }));
    expect(runAISearch).toHaveBeenCalledWith({ customer_name: "Alex", limit: 20 });
    expect(screen.getByLabelText("Describe the changes you want to make")).toHaveValue('Add "Audio Cable" at $26.99 (qty 1) to job 29275.');
  });

  it("discards an old preview when the profile job search is edited", async () => {
    previewAIMassUpdate.mockResolvedValue(PREVIEW);
    render(<MassUpdateTab />);
    fireEvent.click(screen.getByText("Pick from product profile"));
    fireEvent.change(screen.getByLabelText("Product profile"), { target: { value: "turntable" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert Audio Cable from Turntable" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Jobs" }), { target: { value: "29275" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Preview: 3 changes across 3 jobs")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Jobs" }), { target: { value: "Alex" } });
    expect(screen.queryByText("Preview: 3 changes across 3 jobs")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Apply/ })).not.toBeInTheDocument();
  });

  it("catalog Insert keeps earlier typed text and composes the new line beneath it", async () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    fireEvent.change(box, { target: { value: "Move job 9 to location B." } });
    fireEvent.click(await screen.findByRole("button", { name: "Insert Belt Kit / Shipping" }));
    fireEvent.change(screen.getByLabelText("Jobs"), { target: { value: "9" } });
    expect(box).toHaveValue('Move job 9 to location B.\nAdd "Belt Kit / Shipping" at $32.00 (qty 1) to job 9.');
  });

  it("fills the pane: no max-width centering, responsive grid columns", () => {
    const { container } = render(<MassUpdateTab />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\bgrid\b/);
    expect(root).toHaveClass("grid-cols-1", "w-full");
    expect(root.className).toMatch(/\b(?:md|lg):grid-cols-/);
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/\bmax-w-|\bmx-auto\b/);
    }
  });

  it("updates the money summary live as rows are toggled", async () => {
    const rows = PREVIEW.rows.map((row, index) => ({ ...row, amount_delta: [20, -4, 50][index] }));
    previewAIMassUpdate.mockResolvedValue({ ...PREVIEW, rows });
    render(<MassUpdateTab />);
    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    // The invalid row (job 3) never counts.
    expect(await screen.findByTestId("money-net")).toHaveTextContent("Net change: +$16.00");
    const moneyLines = () =>
      Array.from(screen.getByTestId("money-net").parentElement!.querySelectorAll("li")).map((li) => li.textContent);
    expect(moneyLines()).toContain("Job #2 (B): −$4.00");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select change 2 for job #2" }));
    expect(screen.getByTestId("money-net")).toHaveTextContent("Net change: +$20.00");
    expect(moneyLines().some((line) => line?.startsWith("Job #2 (B)"))).toBe(false);
  });

  it("sends generated Work Done operations back unchanged, including the text", async () => {
    const text = "Replaced the belt.\nCleaned the heads.";
    const operation = { reference_id: 31152, op: "generate_work_done", work_done_text: text };
    previewAIMassUpdate.mockResolvedValue({
      model: "test",
      rows: [
        {
          operation,
          reference_id: 31152,
          customer_name: "Paul",
          field: "Work done",
          before: "—",
          after: text,
          lower_than_before: false,
          valid: true,
          updated_at: null,
          amount_delta: 0
        }
      ]
    });
    applyAIMassUpdate.mockResolvedValue({ results: [{ reference_id: 31152, success: true, applied: ["Work done updated"] }] });
    render(<MassUpdateTab />);
    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "Generate Work Done for job 31152." } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect((await screen.findByTestId("work-done-after")).textContent).toBe(text);
    expect(screen.getByText("Work Done text is saved exactly as shown only when you click Apply.")).toBeInTheDocument();
    expect(screen.queryByTestId("money-net")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply 1 selected change" }));
    expect(await screen.findByText(/Results: 1 job updated/)).toBeInTheDocument();
    expect(applyAIMassUpdate).toHaveBeenCalledWith([{ reference_id: 31152, op: "generate_work_done", work_done_text: text }], { 31152: null });
  });

  it("leaves existing Work Done unticked, shows errors and the top-level message, and applies only explicit ticks", async () => {
    const base = {
      customer_name: "Paul",
      field: "Work done",
      lower_than_before: false,
      updated_at: null,
      amount_delta: 0,
      existing_work_done_has_images: false
    };
    const fresh = { reference_id: 10, op: "generate_work_done", work_done_text: "Fresh" };
    const replace = { reference_id: 11, op: "generate_work_done", work_done_text: "Replacement" };
    previewAIMassUpdate.mockResolvedValue({
      model: "test",
      message: "Work Done could not be generated for 1 of 3 jobs.",
      rows: [
        { ...base, operation: fresh, reference_id: 10, before: "—", after: "Fresh", valid: true, has_existing_work_done: false, default_selected: true },
        {
          ...base,
          operation: replace,
          reference_id: 11,
          before: "Old notes",
          after: "Replacement",
          valid: true,
          has_existing_work_done: true,
          default_selected: false,
          warning: "Has existing Work Done; applying replaces it"
        },
        {
          ...base,
          operation: { reference_id: 12, op: "generate_work_done" },
          reference_id: 12,
          before: "—",
          after: "",
          valid: false,
          has_existing_work_done: false,
          default_selected: false,
          error: "Work Done could not be generated: The AI request timed out."
        }
      ]
    });
    applyAIMassUpdate.mockResolvedValue({ results: [] });
    render(<MassUpdateTab />);
    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "Generate Work Done" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(await screen.findByTestId("preview-message")).toHaveTextContent("Work Done could not be generated for 1 of 3 jobs.");
    expect(screen.getByText("Has existing Work Done; applying replaces it")).toBeInTheDocument();
    expect(screen.getByText("Work Done could not be generated: The AI request timed out.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select change 2 for job #11" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select change 3 for job #12" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply 1 selected change" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select change 2 for job #11" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 2 selected changes" }));
    expect(await screen.findByText(/Results:/)).toBeInTheDocument();
    expect(applyAIMassUpdate).toHaveBeenCalledWith([fresh, replace], { 10: null, 11: null });
  });
});

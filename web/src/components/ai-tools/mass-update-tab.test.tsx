import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MassUpdatePreviewResponse } from "@/lib/ai-tools/types";

const previewAIMassUpdate = vi.fn();
const applyAIMassUpdate = vi.fn();
const getAILineItemCatalog = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    previewAIMassUpdate: (...args: unknown[]) => previewAIMassUpdate(...args),
    applyAIMassUpdate: (...args: unknown[]) => applyAIMassUpdate(...args),
    getAILineItemCatalog: (...args: unknown[]) => getAILineItemCatalog(...args)
  }
}));

beforeEach(() => {
  getAILineItemCatalog.mockResolvedValue({ items: [{ name: "Belt Kit / Shipping", unit_price: 32, quantity_text: "1" }] });
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

  it("replaces the instruction with an example from the capabilities panel", () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    fireEvent.change(box, { target: { value: "old text" } });
    fireEvent.click(screen.getByRole("button", { name: "Give job 31199 a 10% labour discount." }));
    expect(box).toHaveValue("Give job 31199 a 10% labour discount.");
  });

  it("appends a catalog item to the instruction on a new line", async () => {
    render(<MassUpdateTab />);
    const box = screen.getByLabelText("Describe the changes you want to make");
    fireEvent.click(await screen.findByRole("button", { name: "Insert Belt Kit / Shipping" }));
    expect(box).toHaveValue('Add "Belt Kit / Shipping" at $32.00 (qty 1) to job ');

    fireEvent.change(box, { target: { value: "Set job 31195 to Ready for pickup." } });
    fireEvent.click(screen.getByRole("button", { name: "Insert Belt Kit / Shipping" }));
    expect(box).toHaveValue('Set job 31195 to Ready for pickup.\nAdd "Belt Kit / Shipping" at $32.00 (qty 1) to job ');
  });

  it("updates the money summary live as rows are toggled", async () => {
    const rows = PREVIEW.rows.map((row, index) => ({ ...row, amount_delta: [20, -4, 50][index] }));
    previewAIMassUpdate.mockResolvedValue({ ...PREVIEW, rows });
    render(<MassUpdateTab />);
    fireEvent.change(screen.getByLabelText("Describe the changes you want to make"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    // The invalid row (job 3) never counts.
    expect(await screen.findByTestId("money-net")).toHaveTextContent("Net change: +$16.00");
    expect(screen.getByText("Job #2 (B): −$4.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select change 2 for job #2" }));
    expect(screen.getByTestId("money-net")).toHaveTextContent("Net change: +$20.00");
    expect(screen.queryByText(/Job #2 \(B\)/)).not.toBeInTheDocument();
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

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MassUpdatePreviewResponse } from "@/lib/ai-tools/types";

const previewAIMassUpdate = vi.fn();
const applyAIMassUpdate = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    previewAIMassUpdate: (...args: unknown[]) => previewAIMassUpdate(...args),
    applyAIMassUpdate: (...args: unknown[]) => applyAIMassUpdate(...args)
  }
}));

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

    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "labour to 80" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(await screen.findByText("Preview: 3 jobs, 3 changes")).toBeInTheDocument();
    expect(screen.queryByText(/Only the first .* jobs are included/)).not.toBeInTheDocument();
  });

  it("previews, then applies only the checked valid operations and shows per-job results", async () => {
    previewAIMassUpdate.mockResolvedValue(PREVIEW);
    applyAIMassUpdate.mockResolvedValue({
      results: [
        { reference_id: 1, success: true, applied: ["Labour total $60.00 → $80.00"] },
        { reference_id: 2, success: false, applied: null, error: "job is locked" }
      ]
    });
    render(<MassUpdateTab />);

    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "labour to 80" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    expect(await screen.findByText("Preview: 3 jobs, 3 changes")).toBeInTheDocument();
    expect(previewAIMassUpdate).toHaveBeenCalledWith("labour to 80");
    expect(screen.getByRole("button", { name: "Apply 2 selected changes" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select change 2 for job #2" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 selected change" }));

    expect(await screen.findByText(/job is locked/)).toBeInTheDocument();
    // Only the selected jobs' preview timestamps are sent back.
    expect(applyAIMassUpdate).toHaveBeenCalledWith([PREVIEW.rows[0].operation], { 1: "2026-10-01T09:30:15.123456Z" });
    expect(screen.getByText(/Applied: 1 job updated/)).toBeInTheDocument();
  });

  it("sends each job's preview updated_at (including null) and shows a job rejected as changed since preview", async () => {
    previewAIMassUpdate.mockResolvedValue(PREVIEW);
    applyAIMassUpdate.mockResolvedValue({
      results: [
        { reference_id: 1, success: false, applied: null, error: "job changed since preview; preview again before applying" },
        { reference_id: 2, success: true, applied: ["Labour total set to $80.00"] }
      ]
    });
    render(<MassUpdateTab />);

    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "labour to 80" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply 2 selected changes" }));

    expect(await screen.findByText("job changed since preview; preview again before applying")).toBeInTheDocument();
    expect(applyAIMassUpdate).toHaveBeenCalledWith([PREVIEW.rows[0].operation, PREVIEW.rows[1].operation], {
      1: "2026-10-01T09:30:15.123456Z",
      2: null
    });
    expect(screen.getByText(/Applied: 1 job updated/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it("keeps the Preview button enabled (not faded) after a preview, disabled only while loading", async () => {
    let resolvePreview: (value: MassUpdatePreviewResponse) => void = () => {};
    previewAIMassUpdate.mockReturnValue(new Promise<MassUpdatePreviewResponse>((resolve) => (resolvePreview = resolve)));
    render(<MassUpdateTab />);

    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "labour to 80" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(screen.getByRole("button", { name: "Building preview..." })).toBeDisabled();

    resolvePreview(PREVIEW);
    expect(await screen.findByText("Preview: 3 jobs, 3 changes")).toBeInTheDocument();
    const previewButton = screen.getByRole("button", { name: "Preview changes" });
    expect(previewButton).toBeEnabled();
    // Opacity is only ever applied through the disabled: variant.
    expect(previewButton.className).not.toMatch(/(^|\s)opacity-/);
  });

  it("shows the server error when the preview fails", async () => {
    previewAIMassUpdate.mockRejectedValue(new Error("AI did not return valid JSON (502 /ai-tools/mass-update/preview)"));
    render(<MassUpdateTab />);
    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^AI did not return valid JSON$/);
  });
});

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MassUpdatePreviewRow } from "@/lib/ai-tools/types";
import { MassUpdateMoneySummary } from "@/components/ai-tools/mass-update-money-summary";

const base = { field: "Line item", before: "—", after: "x", lower_than_before: false, valid: true, updated_at: null };
const ROWS: MassUpdatePreviewRow[] = [
  { ...base, operation: { reference_id: 31152, op: "add_line_item" }, reference_id: 31152, customer_name: "Paul", amount_delta: 32 },
  { ...base, operation: { reference_id: 31174, op: "remove_line_item" }, reference_id: 31174, customer_name: "", amount_delta: -4 },
  { ...base, operation: { reference_id: 31180, op: "set_status" }, reference_id: 31180, customer_name: "Ann", amount_delta: 0 }
];

afterEach(cleanup);

describe("MassUpdateMoneySummary", () => {
  it("shows the net change and a line per job", () => {
    render(<MassUpdateMoneySummary rows={ROWS} selected={new Set([0, 1, 2])} />);
    expect(screen.getByTestId("money-net")).toHaveTextContent("Net change: +$28.00");
    expect(screen.getByText("Job #31152 (Paul): +$32.00")).toBeInTheDocument();
    expect(screen.getByText("Job #31174 (Unknown customer): −$4.00")).toBeInTheDocument();
    expect(screen.queryByText(/Job #31180/)).not.toBeInTheDocument();
  });

  it("explains when no selected change affects the price", () => {
    render(<MassUpdateMoneySummary rows={ROWS} selected={new Set([2])} />);
    expect(screen.getByTestId("money-net")).toHaveTextContent("Net change: $0.00");
    expect(screen.getByText("None of the selected changes affect the job totals.")).toBeInTheDocument();
  });

  it("renders nothing when the preview has no price changes at all", () => {
    const { container } = render(<MassUpdateMoneySummary rows={[ROWS[2]]} selected={new Set([0])} />);
    expect(container).toBeEmptyDOMElement();
  });
});

import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MassUpdatePreviewTable, selectableRowIndexes } from "@/components/ai-tools/mass-update-preview-table";
import type { MassUpdatePreviewRow } from "@/lib/ai-tools/types";

const ROWS: MassUpdatePreviewRow[] = [
  {
    operation: { reference_id: 31201, op: "set_labour_total", labour_total: 80 },
    reference_id: 31201,
    customer_name: "Paul Gervais",
    field: "Labour total",
    before: "$60.00",
    after: "$80.00",
    lower_than_before: false,
    valid: true,
    updated_at: null
  },
  {
    operation: { reference_id: 31205, op: "set_labour_total", labour_total: 80 },
    reference_id: 31205,
    customer_name: "Mary Chen",
    field: "Labour total",
    before: "$120.00",
    after: "$80.00",
    lower_than_before: true,
    valid: true,
    updated_at: null
  },
  {
    operation: { reference_id: 31205, op: "add_line_item", item_name: "Shipping", unit_price: 15 },
    reference_id: 31205,
    customer_name: "Mary Chen",
    field: "Line item",
    before: "—",
    after: "Shipping @ $15.00",
    lower_than_before: false,
    valid: true,
    updated_at: null
  },
  {
    operation: { reference_id: 31210, op: "set_status", status_name: "Teleported" },
    reference_id: 31210,
    customer_name: "Alan Wu",
    field: "Status",
    before: "",
    after: "",
    lower_than_before: false,
    valid: false,
    error: 'Unknown status "Teleported"',
    updated_at: null
  }
];

function Harness({ rows = ROWS }: { rows?: MassUpdatePreviewRow[] }) {
  const [selected, setSelected] = useState(() => selectableRowIndexes(rows));
  return (
    <>
      <MassUpdatePreviewTable rows={rows} selected={selected} onChange={setSelected} />
      <output data-testid="selected">{[...selected].sort().join(",")}</output>
    </>
  );
}

afterEach(cleanup);

const rowCheckboxes = () => screen.getAllByRole("checkbox", { name: /^Select change/ });

describe("MassUpdatePreviewTable", () => {
  it("renders one row per change with job, customer and field", () => {
    render(<Harness />);
    const rows = screen.getAllByTestId("preview-row");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("#31201")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Paul Gervais")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Labour total")).toBeInTheDocument();
  });

  it("checks every valid row by default and leaves invalid rows unchecked and disabled", () => {
    render(<Harness />);
    const boxes = rowCheckboxes();
    expect(boxes.slice(0, 3).every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(boxes[3]).not.toBeChecked();
    expect(boxes[3]).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select all changes" })).toBeChecked();
    expect(screen.getByText('Unknown status "Teleported"')).toBeInTheDocument();
  });

  it("shows before struck through in red and after in green", () => {
    render(<Harness />);
    const before = screen.getByText("$60.00");
    const after = within(screen.getAllByTestId("preview-row")[0]).getByText("$80.00");
    expect(before).toHaveClass("line-through");
    expect(before).toHaveClass("text-red-700");
    expect(after).toHaveClass("text-green-700");
  });

  it("renders added line items as + after", () => {
    render(<Harness />);
    expect(screen.getByText(/\+ Shipping @ \$15\.00/)).toBeInTheDocument();
  });

  it("flags only rows where the value got lower", () => {
    render(<Harness />);
    const flags = screen.getAllByText("lower than before");
    expect(flags).toHaveLength(1);
    expect(within(screen.getAllByTestId("preview-row")[1]).getByText("lower than before")).toBeInTheDocument();
  });

  it("toggles individual rows and the header checkbox", () => {
    render(<Harness />);
    const header = screen.getByRole("checkbox", { name: "Select all changes" });

    fireEvent.click(rowCheckboxes()[1]);
    expect(screen.getByTestId("selected")).toHaveTextContent("0,2");
    expect(header).not.toBeChecked();
    expect((header as HTMLInputElement).indeterminate).toBe(true);

    fireEvent.click(header);
    expect(screen.getByTestId("selected")).toHaveTextContent("0,1,2");
    expect(header).toBeChecked();

    fireEvent.click(header);
    expect(screen.getByTestId("selected")).toHaveTextContent(/^$/);
    expect(rowCheckboxes().some((box) => (box as HTMLInputElement).checked)).toBe(false);
  });

  it("never selects invalid rows via select-all", () => {
    render(<Harness />);
    const header = screen.getByRole("checkbox", { name: "Select all changes" });
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.getByTestId("selected")).toHaveTextContent("0,1,2");
    expect(rowCheckboxes()[3]).not.toBeChecked();
  });
});

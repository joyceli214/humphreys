import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MassUpdatePreviewTable, defaultSelectedRowIndexes, selectableRowIndexes } from "@/components/ai-tools/mass-update-preview-table";
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
  const [selected, setSelected] = useState(() => defaultSelectedRowIndexes(rows));
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
    const flags = screen.getAllByText("Lower than current value");
    expect(flags).toHaveLength(1);
    expect(within(screen.getAllByTestId("preview-row")[1]).getByText("Lower than current value")).toBeInTheDocument();
  });

  it("uses clear column headings", () => {
    render(<Harness />);
    const headings = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headings.slice(1)).toEqual(["Job", "Customer", "Field", "Current value → New value", "Amount"]);
  });

  it("labels removals, unknown customers and unexplained invalid rows in plain English", () => {
    const rows: MassUpdatePreviewRow[] = [
      { ...ROWS[0], customer_name: "", field: "Line item", before: "Shipping @ $15.00", after: "—" },
      { ...ROWS[3], error: undefined }
    ];
    render(<Harness rows={rows} />);
    expect(screen.getByText("→ Removed")).toBeInTheDocument();
    expect(screen.getByText("Unknown customer")).toBeInTheDocument();
    expect(screen.getByText("This change cannot be applied.")).toBeInTheDocument();
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

  it("shows each row's amount, blank for non-money changes", () => {
    const rows: MassUpdatePreviewRow[] = [
      { ...ROWS[2], amount_delta: 15 },
      { ...ROWS[0], amount_delta: -40 },
      { ...ROWS[3], valid: true, error: undefined, before: "Open", after: "Closed", amount_delta: 0 }
    ];
    render(<Harness rows={rows} />);
    const amounts = screen.getAllByTestId("preview-amount").map((cell) => cell.textContent);
    expect(amounts).toEqual(["+$15.00", "−$40.00", ""]);
  });

  it("shows generated Work Done text as readable multi-line blocks", () => {
    const generated = "Replaced the drive belt.\nCleaned the heads.\nTested playback.";
    const rows: MassUpdatePreviewRow[] = [
      {
        operation: { reference_id: 31152, op: "generate_work_done", work_done_text: generated },
        reference_id: 31152,
        customer_name: "Paul Gervais",
        field: "Work done",
        before: "—",
        after: generated,
        lower_than_before: false,
        valid: true,
        updated_at: null,
        amount_delta: 0
      }
    ];
    render(<Harness rows={rows} />);
    const after = screen.getByTestId("work-done-after");
    expect(after.textContent).toBe(generated);
    expect(after).toHaveClass("whitespace-pre-wrap");
    expect(after).toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("work-done-before")).toHaveTextContent("No Work Done text yet");
    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(screen.getByTestId("preview-amount")).toHaveTextContent(/^$/);

    fireEvent.click(rowCheckboxes()[0]);
    expect(screen.getByTestId("selected")).toHaveTextContent(/^$/);
  });

  describe("existing Work Done", () => {
    const wd = (id: number, extra: Partial<MassUpdatePreviewRow>): MassUpdatePreviewRow => ({
      operation: { reference_id: id, op: "generate_work_done", work_done_text: "New text" },
      reference_id: id,
      customer_name: "Paul Gervais",
      field: "Work done",
      before: "—",
      after: "New text",
      lower_than_before: false,
      valid: true,
      updated_at: null,
      amount_delta: 0,
      has_existing_work_done: false,
      existing_work_done_has_images: false,
      default_selected: true,
      ...extra
    });

    it("leaves rows with existing Work Done unticked and warns that applying replaces it", () => {
      const rows = [
        wd(1, {}),
        wd(2, { before: "Old notes", has_existing_work_done: true, default_selected: false, warning: "Has existing Work Done; applying replaces it" })
      ];
      expect([...defaultSelectedRowIndexes(rows)]).toEqual([0]);
      expect([...selectableRowIndexes(rows)]).toEqual([0, 1]);
      render(<Harness rows={rows} />);
      const boxes = rowCheckboxes();
      expect(boxes[0]).toBeChecked();
      expect(boxes[1]).not.toBeChecked();
      expect(boxes[1]).toBeEnabled();
      const [plainRow, warnRow] = screen.getAllByTestId("preview-row");
      expect(within(warnRow).getByText("Has existing Work Done; applying replaces it")).toBeInTheDocument();
      expect(within(plainRow).queryByText(/Has existing Work Done/)).not.toBeInTheDocument();
      expect(screen.queryByTestId("work-done-images-warning")).not.toBeInTheDocument();

      fireEvent.click(boxes[1]);
      expect(screen.getByTestId("selected")).toHaveTextContent("0,1");
    });

    it("still warns and leaves the row unticked when the server omits warning/default_selected", () => {
      const rows = [wd(3, { before: "Old", has_existing_work_done: true, default_selected: undefined, warning: undefined })];
      expect(defaultSelectedRowIndexes(rows).size).toBe(0);
      render(<Harness rows={rows} />);
      expect(screen.getByText("Has existing Work Done; applying replaces it")).toBeInTheDocument();
      expect(rowCheckboxes()[0]).not.toBeChecked();
    });

    it("adds an extra warning when the existing Work Done contains images", () => {
      const rows = [
        wd(4, {
          before: "See ![p](x.png)",
          has_existing_work_done: true,
          existing_work_done_has_images: true,
          default_selected: false,
          warning: "Has existing Work Done; applying replaces it (contains images)"
        })
      ];
      render(<Harness rows={rows} />);
      const row = screen.getByTestId("preview-row");
      expect(within(row).getByText(/^Has existing Work Done; applying replaces it/)).toBeInTheDocument();
      expect(within(row).getByTestId("work-done-images-warning")).toHaveTextContent(
        "The current Work Done contains images; they will be removed when it is replaced."
      );
      expect(rowCheckboxes()[0]).not.toBeChecked();
    });

    it("shows a failed Work Done generation as an error row that cannot be selected", () => {
      const rows = [
        wd(5, {}),
        wd(6, { valid: false, default_selected: false, after: "", error: "Work Done could not be generated: The AI request timed out." })
      ];
      render(<Harness rows={rows} />);
      const errorRow = screen.getAllByTestId("preview-row")[1];
      expect(errorRow).toHaveAttribute("data-error", "true");
      expect(within(errorRow).getByText("Work Done could not be generated: The AI request timed out.")).toBeInTheDocument();
      expect(within(errorRow).queryByTestId("work-done-after")).not.toBeInTheDocument();
      const boxes = rowCheckboxes();
      expect(boxes[1]).toBeDisabled();
      expect(boxes[1]).not.toBeChecked();
      const header = screen.getByRole("checkbox", { name: "Select all changes" });
      fireEvent.click(header);
      fireEvent.click(header);
      expect(screen.getByTestId("selected")).toHaveTextContent(/^0$/);
    });
  });
});

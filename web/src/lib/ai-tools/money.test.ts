import { describe, expect, it } from "vitest";
import type { MassUpdatePreviewRow } from "@/lib/ai-tools/types";
import { formatMoney, formatMoneyDelta, isMoneyOp, rowAmountLabel, summarizeMoney } from "@/lib/ai-tools/money";

function row(referenceId: number, op: string, delta: number | undefined, extra: Partial<MassUpdatePreviewRow> = {}): MassUpdatePreviewRow {
  return {
    operation: { reference_id: referenceId, op },
    reference_id: referenceId,
    customer_name: `Customer ${referenceId}`,
    field: "Field",
    before: "",
    after: "",
    lower_than_before: false,
    valid: true,
    updated_at: null,
    amount_delta: delta,
    ...extra
  };
}

describe("formatMoney", () => {
  it("formats dollars with two decimals and thousands separators", () => {
    expect(formatMoney(32)).toBe("$32.00");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
  });
});

describe("formatMoneyDelta", () => {
  it("signs positive and negative amounts", () => {
    expect(formatMoneyDelta(12.5)).toBe("+$12.50");
    expect(formatMoneyDelta(-4)).toBe("−$4.00");
    expect(formatMoneyDelta(0)).toBe("$0.00");
  });

  it("rounds to the nearest cent and never shows a signed zero", () => {
    expect(formatMoneyDelta(0.004)).toBe("$0.00");
    expect(formatMoneyDelta(-0.004)).toBe("$0.00");
    expect(formatMoneyDelta(1.005 + 0.001)).toBe("+$1.01");
    expect(formatMoneyDelta(-1234.567)).toBe("−$1,234.57");
  });
});

describe("isMoneyOp", () => {
  it("knows which operations change the job total", () => {
    expect(isMoneyOp("add_line_item")).toBe(true);
    expect(isMoneyOp("set_labour_discount")).toBe(true);
    expect(isMoneyOp("set_status")).toBe(false);
    expect(isMoneyOp("generate_work_done")).toBe(false);
  });
});

describe("rowAmountLabel", () => {
  it("shows the delta for money rows, even when it is zero", () => {
    expect(rowAmountLabel(row(1, "add_line_item", 32))).toBe("+$32.00");
    expect(rowAmountLabel(row(1, "set_labour_total", 0))).toBe("$0.00");
  });

  it("is blank for non-money rows with no delta and for invalid rows", () => {
    expect(rowAmountLabel(row(1, "set_status", 0))).toBe("");
    expect(rowAmountLabel(row(1, "generate_work_done", undefined))).toBe("");
    expect(rowAmountLabel(row(1, "add_line_item", 32, { valid: false }))).toBe("");
  });
});

describe("summarizeMoney", () => {
  const rows = [
    row(31152, "add_line_item", 32),
    row(31152, "remove_line_item", -12.5),
    row(31174, "set_labour_total", -4),
    row(31180, "set_status", 0),
    row(31190, "add_line_item", 99, { valid: false })
  ];

  it("sums selected valid rows per job and overall, in preview order", () => {
    const summary = summarizeMoney(rows, new Set([0, 1, 2, 3, 4]));
    expect(summary.net).toBe(15.5);
    expect(summary.jobs).toEqual([
      { reference_id: 31152, customer_name: "Customer 31152", delta: 19.5 },
      { reference_id: 31174, customer_name: "Customer 31174", delta: -4 }
    ]);
  });

  it("updates when rows are unselected", () => {
    const summary = summarizeMoney(rows, new Set([1, 2]));
    expect(summary.net).toBe(-16.5);
    expect(summary.jobs.map((job) => job.delta)).toEqual([-12.5, -4]);
    expect(summarizeMoney(rows, new Set()).net).toBe(0);
    expect(summarizeMoney(rows, new Set()).jobs).toEqual([]);
  });

  it("adds in whole cents to avoid floating point drift", () => {
    const cents = [row(1, "add_line_item", 0.1), row(1, "add_line_item", 0.2)];
    const summary = summarizeMoney(cents, new Set([0, 1]));
    expect(summary.net).toBe(0.3);
    expect(summary.jobs[0].delta).toBe(0.3);
  });

  it("treats a missing amount_delta as zero", () => {
    const summary = summarizeMoney([row(1, "set_labour_total", undefined)], new Set([0]));
    expect(summary.net).toBe(0);
    expect(summary.jobs).toEqual([{ reference_id: 1, customer_name: "Customer 1", delta: 0 }]);
  });
});

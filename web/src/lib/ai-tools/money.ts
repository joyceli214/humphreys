import type { MassUpdatePreviewRow } from "@/lib/ai-tools/types";

// Pure helpers for the Mass Update money summary. All sums are done in whole
// cents so that, for example, 0.1 + 0.2 shows as $0.30.

const MONEY_OPS = new Set([
  "set_labour_total",
  "set_labour_discount",
  "set_line_item_price",
  "add_line_item",
  "remove_line_item"
]);

/** True for operations that can change a job's total. */
export function isMoneyOp(op: string): boolean {
  return MONEY_OPS.has(op);
}

function toCents(dollars: number | undefined): number {
  return Number.isFinite(dollars) ? Math.round((dollars as number) * 100) : 0;
}

function formatCents(cents: number): string {
  return `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$1,234.50" */
export function formatMoney(dollars: number): string {
  return formatCents(toCents(dollars));
}

/** "+$12.50", "−$4.00" (true minus sign) or "$0.00". */
export function formatMoneyDelta(dollars: number): string {
  const cents = toCents(dollars);
  if (cents === 0) return "$0.00";
  return `${cents > 0 ? "+" : "−"}${formatCents(cents)}`;
}

function isMoneyRow(row: MassUpdatePreviewRow): boolean {
  return isMoneyOp(row.operation.op) || toCents(row.amount_delta) !== 0;
}

/** Amount column text: blank for invalid rows and for non-money rows with no change. */
export function rowAmountLabel(row: MassUpdatePreviewRow): string {
  if (!row.valid || !isMoneyRow(row)) return "";
  return formatMoneyDelta(row.amount_delta ?? 0);
}

/** True when any row in the preview can change a job total. */
export function hasMoneyRows(rows: MassUpdatePreviewRow[]): boolean {
  return rows.some((row) => row.valid && isMoneyRow(row));
}

export type JobMoneyChange = {
  reference_id: number;
  customer_name: string;
  /** Dollars, rounded to the cent. */
  delta: number;
};

export type MoneySummary = {
  /** Overall change in dollars across the selected rows, rounded to the cent. */
  net: number;
  /** One entry per job with a selected money change, in preview order. */
  jobs: JobMoneyChange[];
};

/** Totals the amount_delta of every selected, valid money row, per job and overall. */
export function summarizeMoney(rows: MassUpdatePreviewRow[], selected: ReadonlySet<number>): MoneySummary {
  const perJob = new Map<number, { customer_name: string; cents: number }>();
  let netCents = 0;
  rows.forEach((row, index) => {
    if (!row.valid || !selected.has(index) || !isMoneyRow(row)) return;
    const cents = toCents(row.amount_delta);
    netCents += cents;
    const job = perJob.get(row.reference_id) ?? { customer_name: row.customer_name, cents: 0 };
    job.cents += cents;
    perJob.set(row.reference_id, job);
  });
  return {
    net: netCents / 100,
    jobs: [...perJob].map(([reference_id, job]) => ({ reference_id, customer_name: job.customer_name, delta: job.cents / 100 }))
  };
}

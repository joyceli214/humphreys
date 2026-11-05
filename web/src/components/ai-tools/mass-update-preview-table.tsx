import { useEffect, useRef } from "react";
import type { MassUpdatePreviewRow } from "@/lib/ai-tools/types";
import { rowAmountLabel } from "@/lib/ai-tools/money";
import { AIPill } from "@/components/ai-tools/ai-ui";
import { JobLink } from "@/components/ai-tools/job-link";

const EMPTY = "—";

type Props = {
  rows: MassUpdatePreviewRow[];
  /** Indexes into `rows` that are checked. Invalid rows are never selectable. */
  selected: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  disabled?: boolean;
};

/** Indexes of every row the server marked valid — what select-all can tick. */
export function selectableRowIndexes(rows: MassUpdatePreviewRow[]): Set<number> {
  const out = new Set<number>();
  rows.forEach((row, index) => {
    if (row.valid) out.add(index);
  });
  return out;
}

/**
 * Rows ticked when a preview first loads: valid rows, except those that would
 * replace existing Work Done (the admin must tick those explicitly). Falls back
 * to has_existing_work_done when the server omits default_selected.
 */
export function defaultSelectedRowIndexes(rows: MassUpdatePreviewRow[]): Set<number> {
  const out = new Set<number>();
  rows.forEach((row, index) => {
    if (row.valid && (row.default_selected ?? !row.has_existing_work_done)) out.add(index);
  });
  return out;
}

const REPLACES_WORK_DONE = "Has existing Work Done; applying replaces it";

/** Warning for a valid Work Done row that would overwrite existing text (and images). */
function ExistingWorkDoneWarning({ row }: { row: MassUpdatePreviewRow }) {
  if (!row.has_existing_work_done) return null;
  return (
    <div data-testid="work-done-replace-warning" className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      <div className="font-semibold">{row.warning || REPLACES_WORK_DONE}</div>
      {row.existing_work_done_has_images && (
        <div data-testid="work-done-images-warning" className="mt-0.5">
          The current Work Done contains images; they will be removed when it is replaced.
        </div>
      )}
    </div>
  );
}

export function BeforeAfter({ before, after }: { before: string; after: string }) {
  if (before === EMPTY && after !== EMPTY) {
    return <span className="font-semibold text-green-700">+ {after}</span>;
  }
  if (after === EMPTY && before !== EMPTY) {
    return (
      <span>
        <span className="text-red-700 line-through">{before}</span> <span className="text-neutral-500">→ Removed</span>
      </span>
    );
  }
  return (
    <span>
      <span className="text-red-700 line-through">{before}</span>
      <span className="text-neutral-500"> → </span>
      <span className="font-semibold text-green-700">{after}</span>
    </span>
  );
}

const TEXT_BLOCK = "max-h-40 overflow-y-auto whitespace-pre-wrap rounded border px-2 py-1.5 text-xs leading-relaxed";

/** Generated Work Done: current and new text as readable, scrollable blocks. */
export function WorkDoneBeforeAfter({ before, after }: { before: string; after: string }) {
  const hasBefore = before.trim() !== "" && before !== EMPTY;
  return (
    <div className="grid min-w-[16rem] gap-2">
      <div>
        <div className="text-[11px] font-semibold text-neutral-500">Current</div>
        <div data-testid="work-done-before" className={`${TEXT_BLOCK} border-[#efeae4] bg-[#faf8f6] text-neutral-600`}>
          {hasBefore ? before : "No Work Done text yet."}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-green-700">Generated</div>
        <div data-testid="work-done-after" className={`${TEXT_BLOCK} border-green-200 bg-green-50 text-neutral-800`}>
          {after}
        </div>
      </div>
    </div>
  );
}

export function MassUpdatePreviewTable({ rows, selected, onChange, disabled = false }: Props) {
  const selectable = selectableRowIndexes(rows);
  const selectedCount = [...selected].filter((index) => selectable.has(index)).length;
  const allChecked = selectable.size > 0 && selectedCount === selectable.size;
  const someChecked = selectedCount > 0 && !allChecked;
  const headerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someChecked;
  }, [someChecked]);

  const toggleAll = () => onChange(allChecked ? new Set() : new Set(selectable));
  const toggleRow = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onChange(next);
  };

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[#e8e2db] text-left text-xs font-semibold text-neutral-500">
          <th className="w-10 px-3 py-2">
            <input
              ref={headerRef}
              type="checkbox"
              aria-label="Select all changes"
              className="h-4 w-4 accent-[#2563eb]"
              checked={allChecked}
              disabled={disabled || selectable.size === 0}
              onChange={toggleAll}
            />
          </th>
          <th className="px-3 py-2">Job</th>
          <th className="px-3 py-2">Customer</th>
          <th className="px-3 py-2">Field</th>
          <th className="px-3 py-2">Current value → New value</th>
          <th className="px-3 py-2 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={`${row.reference_id}-${index}`}
            className={`border-b border-[#efeae4] align-top ${row.valid ? "" : "bg-red-50"}`}
            data-testid="preview-row"
            data-error={row.valid ? undefined : "true"}
          >
            <td className="px-3 py-2.5">
              <input
                type="checkbox"
                aria-label={`Select change ${index + 1} for job #${row.reference_id}`}
                className="h-4 w-4 accent-[#2563eb]"
                checked={row.valid && selected.has(index)}
                disabled={disabled || !row.valid}
                onChange={() => toggleRow(index)}
              />
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap">
              <JobLink referenceId={row.reference_id} />
            </td>
            <td className="px-3 py-2.5">{row.customer_name || "Unknown customer"}</td>
            <td className="px-3 py-2.5">{row.field}</td>
            <td className="px-3 py-2.5">
              {row.valid && row.operation.op === "generate_work_done" ? (
                <>
                  <ExistingWorkDoneWarning row={row} />
                  <WorkDoneBeforeAfter before={row.before} after={row.after} />
                </>
              ) : row.valid ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <BeforeAfter before={row.before} after={row.after} />
                  {row.lower_than_before && <AIPill tone="amber">Lower than current value</AIPill>}
                </span>
              ) : (
                <span className="font-medium text-red-700">{row.error || "This change cannot be applied."}</span>
              )}
            </td>
            <td data-testid="preview-amount" className="px-3 py-2.5 whitespace-nowrap text-right text-xs tabular-nums text-neutral-600">
              {rowAmountLabel(row)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useEffect, useRef } from "react";
import type { MassUpdatePreviewRow } from "@/lib/ai-tools/types";
import { AIPill } from "@/components/ai-tools/ai-ui";

const EMPTY = "—";

type Props = {
  rows: MassUpdatePreviewRow[];
  /** Indexes into `rows` that are checked. Invalid rows are never selectable. */
  selected: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  disabled?: boolean;
};

/** Indexes of every row the server marked valid — the default selection. */
export function selectableRowIndexes(rows: MassUpdatePreviewRow[]): Set<number> {
  const out = new Set<number>();
  rows.forEach((row, index) => {
    if (row.valid) out.add(index);
  });
  return out;
}

export function BeforeAfter({ before, after }: { before: string; after: string }) {
  if (before === EMPTY && after !== EMPTY) {
    return <span className="font-semibold text-green-700">+ {after}</span>;
  }
  if (after === EMPTY && before !== EMPTY) {
    return (
      <span>
        <span className="text-red-700 line-through">{before}</span> <span className="text-neutral-500">→ removed</span>
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
          <th className="px-3 py-2">Before → After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.reference_id}-${index}`} className="border-b border-[#efeae4] align-top" data-testid="preview-row">
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
            <td className="px-3 py-2.5 whitespace-nowrap">#{row.reference_id}</td>
            <td className="px-3 py-2.5">{row.customer_name || "Unknown"}</td>
            <td className="px-3 py-2.5">{row.field}</td>
            <td className="px-3 py-2.5">
              {row.valid ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <BeforeAfter before={row.before} after={row.after} />
                  {row.lower_than_before && <AIPill tone="amber">lower than before</AIPill>}
                </span>
              ) : (
                <span className="text-red-700">{row.error || "This change can't be applied."}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

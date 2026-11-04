import type { MouseEvent } from "react";
import type { AISearchRow } from "@/lib/ai-tools/types";
import { jobPath, openJobInPortal } from "@/lib/ai-tools/open-job";
import { AIPill } from "@/components/ai-tools/ai-ui";

function formatDate(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-CA");
}

function equipmentLabel(row: AISearchRow) {
  return [row.brand_names.join(" / "), row.equipment_name].filter((part) => part && part.trim()).join(" ");
}

/** Plain clicks go to the opener (main portal) window; modified clicks keep browser behaviour. */
function handleJobClick(event: MouseEvent<HTMLAnchorElement>, referenceId: number) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openJobInPortal(referenceId);
}

function WarrantyCell({ row }: { row: AISearchRow }) {
  if (row.is_warranty) {
    return (
      <AIPill tone="orange">
        Warranty{row.original_job_id ? ` of #${row.original_job_id}` : ""}
      </AIPill>
    );
  }
  if (row.warranty_job_ids.length > 0) {
    return <AIPill>Follow-up: {row.warranty_job_ids.map((id) => `#${id}`).join(", ")}</AIPill>;
  }
  return null;
}

// Customer email/phone are never part of AISearchRow and never rendered here.
export function SearchResultsTable({ rows }: { rows: AISearchRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[#e8e2db] text-left text-xs font-semibold text-neutral-500">
          <th className="px-2 py-2">Job</th>
          <th className="px-2 py-2">Customer</th>
          <th className="px-2 py-2">Equipment</th>
          <th className="px-2 py-2">Model</th>
          <th className="px-2 py-2">Serial</th>
          <th className="px-2 py-2">Status</th>
          <th className="px-2 py-2">Created</th>
          <th className="px-2 py-2">Warranty</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.reference_id} className="border-b border-[#efeae4]">
            <td className="px-2 py-2 whitespace-nowrap">
              <a
                href={jobPath(row.reference_id)}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => handleJobClick(event, row.reference_id)}
                className="hover:text-[#c2571a] hover:underline"
              >
                #{row.reference_id}
              </a>
            </td>
            <td className="px-2 py-2">{row.customer_name}</td>
            <td className="px-2 py-2">{equipmentLabel(row)}</td>
            <td className="px-2 py-2">{row.model_number}</td>
            <td className="px-2 py-2">{row.serial_number}</td>
            <td className="px-2 py-2">{row.status_name}</td>
            <td className="px-2 py-2 whitespace-nowrap">{formatDate(row.created_at)}</td>
            <td className="px-2 py-2">
              <WarrantyCell row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

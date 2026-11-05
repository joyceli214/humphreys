import type { EmailDraftTarget, EmailDraftType, StaleJobRow } from "@/lib/ai-tools/types";
import { AIButton } from "@/components/ai-tools/ai-ui";
import { JobLink } from "@/components/ai-tools/job-link";

/** Finished jobs get a pickup reminder; everything else a progress update. */
export function draftTypeForRow(row: StaleJobRow): EmailDraftType {
  return row.bucket === "finished_not_picked_up" ? "ready_for_pickup" : "progress_update";
}

export function staleRowLabel(row: Pick<StaleJobRow, "reference_id" | "customer_name" | "item_name">) {
  return [`#${row.reference_id}`, row.customer_name, row.item_name].filter((part) => part && part.trim()).join(" – ");
}

function formatDaysIdle(days: number) {
  // The API reports 9999 when a job has no activity on record at all.
  return days >= 9999 ? "No activity" : String(days);
}

export function StaleJobsTable({ rows, onDraftEmail }: { rows: StaleJobRow[]; onDraftEmail: (target: EmailDraftTarget) => void }) {
  const showNextStep = rows.some((row) => row.suggested_next_step);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[#e8e2db] text-left text-xs font-semibold text-neutral-500">
          <th className="px-2 py-2">Job</th>
          <th className="px-2 py-2">Customer</th>
          <th className="px-2 py-2">Status</th>
          <th className="px-2 py-2">Days idle</th>
          {showNextStep && <th className="px-2 py-2">Suggested next step</th>}
          <th className="px-2 py-2">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.reference_id} className="border-b border-[#efeae4]">
            <td className="px-2 py-2 whitespace-nowrap">
              <JobLink referenceId={row.reference_id} />
            </td>
            <td className="px-2 py-2">{row.customer_name}</td>
            <td className="px-2 py-2">{row.status_name}</td>
            <td className="px-2 py-2">{formatDaysIdle(row.days_idle)}</td>
            {showNextStep && <td className="px-2 py-2">{row.suggested_next_step ?? ""}</td>}
            <td className="px-2 py-2 text-right">
              <AIButton
                variant="outline"
                aria-label={`Draft email for job #${row.reference_id}`}
                onClick={() =>
                  onDraftEmail({ referenceId: row.reference_id, label: staleRowLabel(row), type: draftTypeForRow(row) })
                }
              >
                Draft email
              </AIButton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import type { CustomerGroup, SelectedEmailJob } from "@/lib/ai-tools/email-selection";
import { EMAIL_MAX_JOBS } from "@/lib/ai-tools/email-selection";
import { AINotice } from "@/components/ai-tools/ai-ui";
import { cn } from "@/lib/utils";

type Props = {
  jobs: SelectedEmailJob[];
  groups: CustomerGroup[];
  customerKey: string | null;
  onCustomerChange: (key: string) => void;
  onRemove: (referenceId: number) => void;
  disabled?: boolean;
};

/**
 * Step 2: the saved pick. Jobs for one customer combine into one email; when
 * the pick spans customers the admin must choose which customer this email is for.
 */
export function EmailSelectedJobs({ jobs, groups, customerKey, onCustomerChange, onRemove, disabled }: Props) {
  if (jobs.length === 0) {
    return <p className="text-sm text-neutral-500">No jobs selected yet. Search above and pick a job from the list.</p>;
  }
  const mixed = groups.length > 1;

  return (
    <div className="space-y-2">
      <ul aria-label="Selected jobs" className="flex flex-wrap gap-1.5">
        {jobs.map((job) => {
          const included = !mixed || groups.find((g) => g.key === customerKey)?.jobs.includes(job);
          return (
            <li
              key={job.referenceId}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                included ? "border-[#c2571a] bg-[#fbf1ea]" : "border-[#ddd5cc] bg-white text-neutral-500"
              )}
            >
              <span>
                <span className="font-semibold">#{job.referenceId}</span> · {job.customerName}
                {job.equipment && <> · {job.equipment}</>}
                {job.status && <> · {job.status}</>}
              </span>
              <button
                type="button"
                aria-label={`Remove job #${job.referenceId}`}
                className="rounded px-1 text-neutral-500 hover:bg-[#efebe7] hover:text-neutral-800"
                onClick={() => onRemove(job.referenceId)}
                disabled={disabled}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-neutral-500">
        {jobs.length}/{EMAIL_MAX_JOBS} jobs. Saved in this browser until you remove them.
      </p>

      {mixed && (
        <AINotice>
          <p className="font-semibold">These jobs belong to different customers. One email goes to one customer — choose who this email is for:</p>
          <div role="radiogroup" aria-label="Customer for this email" className="mt-2 space-y-1">
            {groups.map((group) => (
              <label key={group.key} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="ai-email-customer"
                  checked={customerKey === group.key}
                  onChange={() => onCustomerChange(group.key)}
                  disabled={disabled}
                />
                {group.customerName} ({group.jobs.map((j) => `#${j.referenceId}`).join(", ")})
              </label>
            ))}
          </div>
        </AINotice>
      )}
    </div>
  );
}

import type { MassUpdatePreviewRow } from "@/lib/ai-tools/types";
import { formatMoneyDelta, hasMoneyRows, summarizeMoney } from "@/lib/ai-tools/money";

type Props = {
  rows: MassUpdatePreviewRow[];
  /** The same selection the preview table and Apply use. */
  selected: ReadonlySet<number>;
};

function toneFor(dollars: number) {
  if (dollars > 0) return "text-green-700";
  if (dollars < 0) return "text-red-700";
  return "text-neutral-700";
}

/** Net and per-job change to job totals for the selected rows. Hidden when nothing touches money. */
export function MassUpdateMoneySummary({ rows, selected }: Props) {
  if (!hasMoneyRows(rows)) return null;
  const { net, jobs } = summarizeMoney(rows, selected);

  return (
    <div className="rounded-md border border-[#e8e2db] bg-[#faf8f6] px-3 py-2.5" aria-live="polite">
      <p className="text-base font-semibold text-neutral-800" data-testid="money-net">
        Net change: <span className={toneFor(net)}>{formatMoneyDelta(net)}</span>
      </p>
      {jobs.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-500">None of the selected changes affect the job totals.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm text-neutral-700">
          {jobs.map((job) => (
            <li key={job.reference_id}>
              Job #{job.reference_id} ({job.customer_name || "Unknown customer"}): {formatMoneyDelta(job.delta)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

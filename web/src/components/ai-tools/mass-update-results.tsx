import type { MassUpdateApplyResult } from "@/lib/ai-tools/types";
import { AICard, AICardTitle } from "@/components/ai-tools/ai-ui";
import { JobLink } from "@/components/ai-tools/job-link";

/** "1 job", "2 jobs". Pluralises the last word of `noun` with a trailing "s". */
export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Per-job outcome of an apply call. Each job is its own transaction server-side. */
export function MassUpdateResults({ results, onDismiss }: { results: MassUpdateApplyResult[]; onDismiss: () => void }) {
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return (
    <AICard>
      <div className="flex items-start justify-between gap-3">
        <AICardTitle>
          Results: {plural(succeeded, "job")} updated
          {failed > 0 && (
            <span className="text-red-700">
              , {plural(failed, "job")} could not be updated
            </span>
          )}
        </AICardTitle>
        <button type="button" className="text-xs text-neutral-500 hover:text-neutral-800" onClick={onDismiss}>
          Close
        </button>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {results.map((result) => (
          <li key={result.reference_id} className="flex flex-wrap items-baseline gap-x-2">
            <span className={result.success ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
              {result.success ? "✓" : "✕"} Job <JobLink referenceId={result.reference_id} />
            </span>
            <span className="text-neutral-600">
              {result.success
                ? (result.applied ?? []).join("; ") || "Updated successfully."
                : result.error || "This job could not be updated."}
            </span>
          </li>
        ))}
      </ul>
    </AICard>
  );
}

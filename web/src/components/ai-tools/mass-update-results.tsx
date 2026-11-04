import type { MassUpdateApplyResult } from "@/lib/ai-tools/types";
import { AICard, AICardTitle } from "@/components/ai-tools/ai-ui";

/** Per-job outcome of an apply call. Each job is its own transaction server-side. */
export function MassUpdateResults({ results, onDismiss }: { results: MassUpdateApplyResult[]; onDismiss: () => void }) {
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return (
    <AICard>
      <div className="flex items-start justify-between gap-3">
        <AICardTitle>
          Applied: {succeeded} job{succeeded === 1 ? "" : "s"} updated
          {failed > 0 && <span className="text-red-700">, {failed} failed</span>}
        </AICardTitle>
        <button type="button" className="text-xs text-neutral-500 hover:text-neutral-800" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {results.map((result) => (
          <li key={result.reference_id} className="flex flex-wrap items-baseline gap-x-2">
            <span className={result.success ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
              {result.success ? "✓" : "✕"} #{result.reference_id}
            </span>
            <span className="text-neutral-600">
              {result.success ? (result.applied ?? []).join("; ") || "Updated" : result.error || "Failed"}
            </span>
          </li>
        ))}
      </ul>
    </AICard>
  );
}

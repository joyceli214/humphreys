import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { apiClient } from "@/lib/api/client";
import type { EmailDraftTarget, JobSummaryResponse, JobSummaryStaleResponse } from "@/lib/ai-tools/types";
import { AIButton, AICard, AICardTitle, AIErrorBox, AINotice, AIPill, errorMessage } from "@/components/ai-tools/ai-ui";
import { StaleJobsTable } from "@/components/ai-tools/stale-jobs-table";

const SUMMARY_JOB_CAP = 60;

function CountCard({ title, hint, count, tone }: { title: string; hint: string; count: number | null; tone: "red" | "amber" }) {
  return (
    <AICard>
      <AICardTitle>{title}</AICardTitle>
      <p className="mt-0.5 text-sm text-neutral-500">{hint}</p>
      <div className="mt-1.5">
        <AIPill tone={tone}>{count === null ? "…" : `${count} job${count === 1 ? "" : "s"}`}</AIPill>
      </div>
    </AICard>
  );
}

export function JobSummaryTab({ onDraftEmail }: { onDraftEmail: (target: EmailDraftTarget) => void }) {
  const [stale, setStale] = useState<JobSummaryStaleResponse | null>(null);
  const [summary, setSummary] = useState<JobSummaryResponse | null>(null);
  const [loadingStale, setLoadingStale] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const loadStale = useCallback(async () => {
    setLoadingStale(true);
    try {
      setStale(await apiClient.getAIStaleJobs());
    } catch (err) {
      setError(errorMessage(err, "Could not load idle jobs."));
    } finally {
      setLoadingStale(false);
    }
  }, []);

  useEffect(() => {
    void loadStale();
  }, [loadStale]);

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await apiClient.generateAIJobSummary();
      setSummary(res);
      setStale(res);
    } catch (err) {
      setError(errorMessage(err, "Could not generate a summary."));
    } finally {
      setGenerating(false);
    }
  };

  const data = summary ?? stale;
  const threshold = data?.threshold_workdays ?? 5;
  const rows = data?.rows ?? [];
  const totalJobs = rows.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <CountCard
          title="Unhandled"
          hint={`No update for ${threshold}+ workdays, not finished`}
          count={data ? data.unhandled_count : null}
          tone="red"
        />
        <CountCard
          title="Finished, not picked up"
          hint={`In a finished status for ${threshold}+ workdays`}
          count={data ? data.finished_not_picked_up_count : null}
          tone="amber"
        />
      </div>

      {error && <AIErrorBox>{error}</AIErrorBox>}

      <AICard>
        <div className="flex items-start justify-between gap-3">
          <AICardTitle>Summary</AICardTitle>
          <AIButton onClick={() => void generate()} disabled={generating || loadingStale || totalJobs === 0}>
            {generating ? "Generating..." : "Generate summary"}
          </AIButton>
        </div>
        {summary ? (
          <div className="mt-3 space-y-3">
            <AINotice>
              Generated just now from the repair logs and statuses of {Math.min(totalJobs, SUMMARY_JOB_CAP)} job
              {totalJobs === 1 ? "" : "s"}.
              {summary.truncated && ` Only the ${SUMMARY_JOB_CAP} most idle jobs were sent to the AI.`}
            </AINotice>
            <div className="space-y-2 text-sm leading-relaxed text-neutral-800 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown>{summary.summary}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">
            {totalJobs === 0 && !loadingStale
              ? "No idle jobs right now. Nothing to summarize."
              : "Generate a short summary with a suggested next step for each idle job."}
          </p>
        )}
      </AICard>

      <AICard>
        {loadingStale && !data ? (
          <p className="text-sm text-neutral-500">Loading idle jobs...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No jobs have been idle for {threshold}+ workdays.</p>
        ) : (
          <div className="overflow-x-auto">
            <StaleJobsTable rows={rows} onDraftEmail={onDraftEmail} />
          </div>
        )}
      </AICard>
    </div>
  );
}

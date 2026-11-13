import { useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { PartsPurchaseRequest, WorkOrderDetail, WorkOrderListItem } from "@/lib/api/generated/types";
import type { AskLabourPreview, AskPartsChange, AskPartsPreview, AskRepairLogPreview, AskWaitingParts, MassUpdateApplyResult } from "@/lib/ai-tools/types";
import { partsStatusWord } from "@/lib/ai-tools/email-flow";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { JobLink } from "@/components/ai-tools/job-link";
import { MassUpdateResults, plural } from "@/components/ai-tools/mass-update-results";
import { MgmtButton, MgmtError, MgmtLoading, StatusPill, TABLE_CLASS, errorStatus, statusTone } from "@/components/ai-tools/mgmt-ui";
import { ROW_CAP, itemLabel, money, useLoad } from "@/components/ai-tools/ask/ask-answers";

// Ask skill answers. Every change is a preview: nothing is written until Apply,
// which calls the same endpoints the job page uses (their permission, status
// transition and updated_at checks still apply).

/** Today in the browser's time zone as YYYY-MM-DD (the job page's repair log default). */
export function todayLocalDate(now: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const hoursLabel = (h: number) => `${h} hr`;

type Phase = "preview" | "applying" | "done" | "cancelled";

/** The Mass Update preview card frame: title, "Nothing is saved…", body, Apply / Cancel. */
function PreviewCard(props: {
  title: string;
  children: React.ReactNode;
  phase: Phase;
  canApply: boolean;
  applyError: string;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-[12px] border-2 border-[#1a7f94] bg-[#fbfeff] p-3">
      <h3 className="text-[17px] font-bold">{props.title}</h3>
      <p className="mb-2 text-[15px] text-[#4a5260]">Nothing is saved until you tap Apply.</p>
      {props.children}
      {props.applyError && (
        <div className="mt-2">
          <MgmtError>{props.applyError}</MgmtError>
        </div>
      )}
      <div className="mt-3 flex gap-2.5">
        <MgmtButton className="flex-1" onClick={props.onApply} disabled={props.phase === "applying" || !props.canApply}>
          {props.phase === "applying" ? "Applying…" : "Apply"}
        </MgmtButton>
        <MgmtButton variant="ghost" className="flex-1" onClick={props.onCancel} disabled={props.phase === "applying"}>
          Cancel
        </MgmtButton>
      </div>
    </div>
  );
}

const CANCELLED = (
  <p className="text-[#4a5260]">
    <b>Cancelled. Nothing was changed.</b>
  </p>
);

function applyErrorText(err: unknown, fallback: string) {
  const status = errorStatus(err);
  if (status === 409) return "It changed after the preview. Ask again for a fresh preview.";
  if (status === 403) return "You don't have permission for this change.";
  return errorMessage(err, fallback);
}

// ---------------------------------------------------------------------------
// Parts request changes
// ---------------------------------------------------------------------------

function StatusChange({ from, to }: { from: string; to: string }) {
  if (from === to) return <StatusPill tone={statusTone(from)}>{partsStatusWord(from)}</StatusPill>;
  return (
    <span className="whitespace-nowrap">
      <StatusPill tone={statusTone(from)}>{partsStatusWord(from)}</StatusPill> → <StatusPill tone={statusTone(to)}>{partsStatusWord(to)}</StatusPill>
    </span>
  );
}

function PriceChange({ from, to }: { from: number; to: number }) {
  if (from === to) return <>{money(from)}</>;
  return (
    <span className="whitespace-nowrap">
      {money(from)} → <b>{money(to)}</b>
    </span>
  );
}

type PartsResult = { id: number; ok: boolean; message: string };

/** The PATCH body: the request as previewed, with only status / price / link changed. */
export function partsPatchPayload(ch: AskPartsChange) {
  return {
    updated_at: ch.updated_at ?? "",
    source: ch.source,
    source_url: ch.new_source_url,
    status: ch.new_status,
    total_price: ch.new_price,
    item_name: ch.item_name,
    quantity: ch.quantity
  };
}

export function PartsChangeAnswer({ preview, reply }: { preview: AskPartsPreview; reply: string }) {
  const [phase, setPhase] = useState<Phase>("preview");
  const [applyError, setApplyError] = useState("");
  const [results, setResults] = useState<PartsResult[] | null>(null);
  const changes = preview.changes ?? [];
  const choices = preview.choices ?? [];

  if (changes.length === 0) {
    return (
      <div>
        {reply && <p className="mb-2">{reply}</p>}
        {choices.length > 0 && (
          <div className="-mx-1 overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Job #</th>
                  <th>Part</th>
                  <th>Status</th>
                  <th className="text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {choices.map((c) => (
                  <tr key={c.parts_purchase_request_id}>
                    <td className="whitespace-nowrap font-semibold">{c.parts_purchase_request_id}</td>
                    <td className="whitespace-nowrap font-semibold text-[#135f6f]">
                      <JobLink referenceId={c.reference_id} />
                    </td>
                    <td>
                      {c.item_name}
                      {c.quantity > 1 ? ` ×${c.quantity}` : ""}
                    </td>
                    <td>
                      <StatusPill tone={statusTone(c.status)}>{partsStatusWord(c.status)}</StatusPill>
                    </td>
                    <td className="text-right">{money(c.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const valid = changes.filter((c) => c.valid);
  const apply = async () => {
    if (valid.length === 0) return;
    setPhase("applying");
    setApplyError("");
    const out: PartsResult[] = [];
    for (const ch of valid) {
      try {
        await apiClient.updatePartsPurchaseRequest(ch.reference_id, ch.parts_purchase_request_id, partsPatchPayload(ch));
        out.push({ id: ch.parts_purchase_request_id, ok: true, message: partsStatusWord(ch.new_status) });
      } catch (err) {
        out.push({ id: ch.parts_purchase_request_id, ok: false, message: applyErrorText(err, "Could not update this request.") });
      }
    }
    setResults(out);
    setPhase("done");
  };

  if (phase === "cancelled") return CANCELLED;
  if (phase === "done" && results) {
    const okCount = results.filter((r) => r.ok).length;
    return (
      <div>
        <p className="mb-2 font-semibold">
          {plural(okCount, "parts request")} updated
          {okCount < results.length && <span className="text-red-700">, {results.length - okCount} could not be updated</span>}.
        </p>
        <ul className="space-y-1 text-[15px]">
          {results.map((r) => (
            <li key={r.id} className={r.ok ? "text-green-800" : "text-red-700"}>
              {r.ok ? "✓" : "✕"} Request {r.id}: {r.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const title = changes.length === 1 ? `Preview: change parts request ${changes[0].parts_purchase_request_id}` : `Preview: change ${changes.length} parts requests`;
  const showLink = changes.some((c) => (c.new_source_url ?? "") !== (c.old_source_url ?? ""));
  const invalid = changes.length - valid.length;
  return (
    <PreviewCard title={title} phase={phase} canApply={valid.length > 0} applyError={applyError} onApply={() => void apply()} onCancel={() => setPhase("cancelled")}>
      {invalid > 0 && (
        <p className="mb-2 text-[15px] text-red-700">
          {plural(invalid, "change")} can't be applied.
        </p>
      )}
      <div className="-mx-1 overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th>Request</th>
              <th>Job #</th>
              <th>Part</th>
              <th>Status</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((ch) => (
              <tr key={ch.parts_purchase_request_id} className={ch.valid ? "" : "text-[#4a5260]"}>
                <td className="whitespace-nowrap font-semibold">{ch.parts_purchase_request_id}</td>
                <td className="whitespace-nowrap font-semibold text-[#135f6f]">
                  <JobLink referenceId={ch.reference_id} />
                </td>
                <td>
                  {ch.item_name}
                  {ch.quantity > 1 ? ` ×${ch.quantity}` : ""}
                  {showLink && ch.new_source_url && <div className="break-all text-[14px] text-[#4a5260]">Link: {ch.new_source_url}</div>}
                  {!ch.valid && ch.error && <div className="text-[15px] font-semibold text-red-700">{ch.error}</div>}
                </td>
                <td>
                  <StatusChange from={ch.old_status} to={ch.new_status} />
                </td>
                <td>
                  <PriceChange from={ch.old_price} to={ch.new_price} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PreviewCard>
  );
}

// ---------------------------------------------------------------------------
// Repair log
// ---------------------------------------------------------------------------

export function RepairLogPreviewAnswer({ preview }: { preview: AskRepairLogPreview }) {
  const [phase, setPhase] = useState<Phase>("preview");
  const [applyError, setApplyError] = useState("");
  const date = todayLocalDate();
  if (phase === "cancelled") return CANCELLED;
  if (phase === "done") {
    return (
      <p className="font-semibold text-green-800">
        ✓ Repair log added to job <JobLink referenceId={preview.reference_id} />.
      </p>
    );
  }
  const apply = async () => {
    setPhase("applying");
    setApplyError("");
    try {
      await apiClient.createRepairLog(preview.reference_id, { repair_date: date, hours_used: preview.hours_used, details: preview.details });
      setPhase("done");
    } catch (err) {
      setApplyError(applyErrorText(err, "The repair log could not be added."));
      setPhase("preview");
    }
  };
  return (
    <PreviewCard
      title={`Preview: add a repair log to job #${preview.reference_id}`}
      phase={phase}
      canApply
      applyError={applyError}
      onApply={() => void apply()}
      onCancel={() => setPhase("cancelled")}
    >
      <table className={TABLE_CLASS}>
        <tbody>
          <tr>
            <th>Job #</th>
            <td className="font-semibold text-[#135f6f]">
              <JobLink referenceId={preview.reference_id} />
            </td>
          </tr>
          <tr>
            <th>Date</th>
            <td>{date}</td>
          </tr>
          <tr>
            <th>Hours</th>
            <td>{hoursLabel(preview.hours_used)}</td>
          </tr>
          <tr>
            <th>Log</th>
            <td className="whitespace-pre-wrap">{preview.details}</td>
          </tr>
        </tbody>
      </table>
    </PreviewCard>
  );
}

// ---------------------------------------------------------------------------
// Labour (Mass Update set_labour_total)
// ---------------------------------------------------------------------------

export function LabourPreviewAnswer({ preview }: { preview: AskLabourPreview }) {
  const [phase, setPhase] = useState<Phase>("preview");
  const [applyError, setApplyError] = useState("");
  const [results, setResults] = useState<MassUpdateApplyResult[] | null>(null);
  const { row } = preview;
  if (phase === "cancelled") return CANCELLED;
  if (phase === "done" && results) return <MassUpdateResults results={results} onDismiss={() => setResults([])} />;
  const apply = async () => {
    setPhase("applying");
    setApplyError("");
    try {
      const res = await apiClient.applyAIMassUpdate([row.operation], { [row.reference_id]: row.updated_at ?? null });
      setResults(res.results);
      setPhase("done");
    } catch (err) {
      setApplyError(applyErrorText(err, "The labour could not be added."));
      setPhase("preview");
    }
  };
  return (
    <PreviewCard
      title={`Preview: add labour to job #${preview.reference_id}`}
      phase={phase}
      canApply={row.valid}
      applyError={applyError}
      onApply={() => void apply()}
      onCancel={() => setPhase("cancelled")}
    >
      <table className={TABLE_CLASS}>
        <tbody>
          <tr>
            <th>Job #</th>
            <td className="font-semibold text-[#135f6f]">
              <JobLink referenceId={preview.reference_id} />
            </td>
          </tr>
          <tr>
            <th>Hours</th>
            <td>
              {hoursLabel(preview.hours)} × {money(preview.rate)}/hr = <b>{money(preview.amount)}</b>
            </td>
          </tr>
          <tr>
            <th>Labour</th>
            <td>
              {row.before} → <b>{row.after}</b>
            </td>
          </tr>
        </tbody>
      </table>
      {!row.valid && row.error && <p className="mt-2 text-[15px] text-red-700">{row.error}</p>}
      {preview.note && <p className="mt-2 text-[15px] text-[#4a5260]">{preview.note}</p>}
    </PreviewCard>
  );
}

// ---------------------------------------------------------------------------
// Job questions: make / model / serial, repair history
// ---------------------------------------------------------------------------

const DETAIL_CAP = 10;

export function JobDetailsAnswer({ referenceIds }: { referenceIds: number[] }) {
  const ids = referenceIds.slice(0, DETAIL_CAP);
  const load = useLoad(() => Promise.all(ids.map((id) => apiClient.getWorkOrderDetail(id))));
  if (ids.length === 0) return <p>Tell me the job number.</p>;
  if (load.status === "loading") return <MgmtLoading>Looking up the job…</MgmtLoading>;
  if (load.status === "error") return <MgmtError onRetry={load.retry}>{errorMessage(load.error, "Couldn't load the job.")}</MgmtError>;
  const rows: WorkOrderDetail[] = load.data ?? [];
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className={TABLE_CLASS}>
        <thead>
          <tr>
            <th>Job #</th>
            <th>Item</th>
            <th>Make</th>
            <th>Model</th>
            <th>Serial</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.reference_id}>
              <td className="whitespace-nowrap font-semibold text-[#135f6f]">
                <JobLink referenceId={d.reference_id} />
              </td>
              <td>{d.item_name || "—"}</td>
              <td>{d.brand_names?.join(", ") || "—"}</td>
              <td>{d.model_number || "—"}</td>
              <td>{d.serial_number || "—"}</td>
              <td>{d.status_name ? <StatusPill tone={statusTone(d.status_name)}>{d.status_name}</StatusPill> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LOG_TEXT_CAP = 600;

/** Repair log text without markdown image syntax, capped for the chat. */
export function logText(details: string) {
  const text = details.replace(/!\[[^\]]*\]\([^)]*\)/g, "[photo]").trim();
  return text.length > LOG_TEXT_CAP ? `${text.slice(0, LOG_TEXT_CAP)}…` : text;
}

export function RepairHistoryAnswer({ referenceIds }: { referenceIds: number[] }) {
  const ids = referenceIds.slice(0, DETAIL_CAP);
  const load = useLoad(() => Promise.all(ids.map((id) => apiClient.listRepairLogs(id).then((r) => ({ id, items: r.items ?? [] })))));
  if (ids.length === 0) return <p>Tell me the job number.</p>;
  if (load.status === "loading") return <MgmtLoading>Loading repair logs…</MgmtLoading>;
  if (load.status === "error") {
    if (errorStatus(load.error) === 403) return <p>You don't have access to repair logs.</p>;
    return <MgmtError onRetry={load.retry}>{errorMessage(load.error, "Couldn't load repair logs.")}</MgmtError>;
  }
  return (
    <div className="space-y-3">
      {(load.data ?? []).map(({ id, items }) => {
        const sorted = [...items].sort((a, b) => (a.repair_date ?? "").localeCompare(b.repair_date ?? ""));
        const hours = items.reduce((acc, l) => acc + (l.hours_used ?? 0), 0);
        return (
          <div key={id}>
            <p className="mb-1">
              <b>
                Job <JobLink referenceId={id} />
              </b>
              : {items.length === 0 ? "no repair logs yet." : `${plural(items.length, "repair log")}, ${Math.round(hours * 100) / 100} hr in total.`}
            </p>
            {items.length > 0 && (
              <div className="-mx-1 overflow-x-auto">
                <table className={TABLE_CLASS}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="text-right">Hours</th>
                      <th>What was done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((l) => (
                      <tr key={l.repair_log_id}>
                        <td className="whitespace-nowrap">{l.repair_date ? l.repair_date.slice(0, 10) : "—"}</td>
                        <td className="text-right">{l.hours_used}</td>
                        <td className="whitespace-pre-wrap">{logText(l.details) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jobs waiting on parts
// ---------------------------------------------------------------------------

const OPEN_PARTS = new Set(["draft", "waiting_approval", "approved", "ordered"]);
const WAITING_FETCH = 100;

async function loadWaiting(statusId: number) {
  const params = new URLSearchParams({ status_id: String(statusId), page_size: String(WAITING_FETCH) });
  const [jobs, parts] = await Promise.all([
    apiClient.listWorkOrders(params).then((r) => r.items ?? []),
    // Open parts counts are extra: without parts access the column is hidden.
    apiClient.listAllPartsPurchaseRequests().then(
      (r) => r.items ?? [],
      () => null
    )
  ]);
  return { jobs, parts };
}

export function WaitingPartsAnswer({ waiting }: { waiting: AskWaitingParts }) {
  const load = useLoad(() => loadWaiting(waiting.status_id));
  if (load.status === "loading") return <MgmtLoading>Looking up jobs waiting on parts…</MgmtLoading>;
  if (load.status === "error") return <MgmtError onRetry={load.retry}>{errorMessage(load.error, "Couldn't load jobs.")}</MgmtError>;
  const { jobs, parts } = load.data as { jobs: WorkOrderListItem[]; parts: PartsPurchaseRequest[] | null };
  if (jobs.length === 0) return <p>No jobs are in “{waiting.status_name}”.</p>;
  const open = new Map<number, number>();
  for (const p of parts ?? []) if (OPEN_PARTS.has(p.status)) open.set(p.reference_id, (open.get(p.reference_id) ?? 0) + 1);
  const total = waiting.total >= 0 ? waiting.total : jobs.length;
  const shown = jobs.slice(0, ROW_CAP);
  return (
    <div>
      <p className="mb-2">
        <b>{plural(total, "job")}</b> in “{waiting.status_name}”.
      </p>
      <div className="-mx-1 overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th>Job #</th>
              <th>Item</th>
              <th>Customer</th>
              {parts && <th className="text-right">Open parts</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.reference_id}>
                <td className="whitespace-nowrap font-semibold text-[#135f6f]">
                  <JobLink referenceId={row.reference_id} />
                </td>
                <td>{itemLabel(row) || "—"}</td>
                <td>{row.customer_name || "—"}</td>
                {parts && <td className="text-right">{open.get(row.reference_id) ?? 0}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > shown.length && (
        <p className="mt-2 text-[15px] text-[#4a5260]">
          Showing {shown.length} of {total}. The list is capped at {ROW_CAP}.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complete Job
// ---------------------------------------------------------------------------

export function CompleteJobAnswer({ reply, referenceIds }: { reply: string; referenceIds: number[] }) {
  return (
    <div>
      <p className="mb-2">{reply}</p>
      {referenceIds.length > 0 && (
        <p className="flex flex-wrap gap-x-3 font-semibold text-[#135f6f]">
          {referenceIds.slice(0, DETAIL_CAP).map((id) => (
            <JobLink key={id} referenceId={id}>
              Open job #{id}
            </JobLink>
          ))}
        </p>
      )}
    </div>
  );
}

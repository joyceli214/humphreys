import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { PartsPurchaseRequest, WorkOrderDetail, WorkOrderListItem } from "@/lib/api/generated/types";
import type { MassUpdateApplyResult, MassUpdateExpectedUpdatedAt, MassUpdatePreviewResponse } from "@/lib/ai-tools/types";
import { workOrderTotals } from "@/lib/work-order-totals";
import { partsStatusWord } from "@/lib/ai-tools/email-flow";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { JobLink } from "@/components/ai-tools/job-link";
import { MassUpdatePreviewTable, defaultSelectedRowIndexes } from "@/components/ai-tools/mass-update-preview-table";
import { MassUpdateResults, plural } from "@/components/ai-tools/mass-update-results";
import { INPUT_CLASS, MgmtButton, MgmtError, MgmtLoading, StatusPill, TABLE_CLASS, errorStatus, statusTone } from "@/components/ai-tools/mgmt-ui";

export const ROW_CAP = 20;
export const CHARGES_JOB_CAP = 10;
const LIST_FETCH_SIZE = 100;

/** Loads with honest loading / error-with-retry state. */
function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ status: "loading" | "ok" | "error"; data?: T; error?: unknown }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    load().then(
      (data) => !cancelled && setState({ status: "ok", data }),
      (error) => !cancelled && setState({ status: "error", error })
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

const itemLabel = (row: Pick<WorkOrderListItem, "brand_names" | "item_name" | "model_number">) =>
  [row.brand_names?.join(" "), row.item_name, row.model_number].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");

async function searchJobs(query: string): Promise<WorkOrderListItem[]> {
  const params = new URLSearchParams({ q: query, page_size: String(LIST_FETCH_SIZE) });
  return (await apiClient.listWorkOrders(params)).items ?? [];
}

/** Jobs by exact job number (each searched separately, exact match kept). */
async function jobsByIds(ids: number[]): Promise<WorkOrderListItem[]> {
  const lists = await Promise.all(ids.map((id) => searchJobs(String(id))));
  return ids.flatMap((id, i) => lists[i].filter((row) => row.reference_id === id).slice(0, 1));
}

// ---------------------------------------------------------------------------
// 1. Jobs for a customer
// ---------------------------------------------------------------------------

export function CustomerJobsAnswer({ customerQuery, referenceIds }: { customerQuery: string; referenceIds: number[] }) {
  const load = useLoad(() => (referenceIds.length > 0 ? jobsByIds(referenceIds) : customerQuery ? searchJobs(customerQuery) : Promise.resolve([])));
  if (!customerQuery && referenceIds.length === 0) return <p>Tell me a customer name or job number to look up.</p>;
  if (load.status === "loading") return <MgmtLoading>Looking up jobs…</MgmtLoading>;
  if (load.status === "error") return <MgmtError onRetry={load.retry}>{errorMessage(load.error, "Couldn't load jobs.")}</MgmtError>;
  const rows = load.data ?? [];
  if (rows.length === 0) return <p>No match.</p>;
  const shown = rows.slice(0, ROW_CAP);
  const more = rows.length >= LIST_FETCH_SIZE ? `${LIST_FETCH_SIZE}+` : String(rows.length);
  return (
    <div>
      <p className="mb-2">
        {customerQuery ? (
          <>
            <b>{plural(rows.length, "job")}</b> found for “{customerQuery}”.
          </>
        ) : (
          <>{plural(rows.length, "job")} found.</>
        )}
      </p>
      <div className="-mx-1 overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th>Job #</th>
              <th>Item</th>
              <th>Customer</th>
              <th>Status</th>
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
                <td>
                  <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > ROW_CAP && (
        <p className="mt-2 text-[15px] text-[#4a5260]">
          Showing {ROW_CAP} of {more}.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Update jobs: Mass Update preview → Apply / Cancel
// ---------------------------------------------------------------------------

export function UpdatePreviewAnswer({ message }: { message: string }) {
  const load = useLoad<MassUpdatePreviewResponse>(() => apiClient.previewAIMassUpdate(message));
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [phase, setPhase] = useState<"preview" | "applying" | "done" | "cancelled">("preview");
  const [applyError, setApplyError] = useState("");
  const [results, setResults] = useState<MassUpdateApplyResult[] | null>(null);

  if (load.status === "loading") return <MgmtLoading>Preparing a preview…</MgmtLoading>;
  if (load.status === "error") return <MgmtError onRetry={load.retry}>{errorMessage(load.error, "The preview could not be created.")}</MgmtError>;
  const preview = load.data!;
  const rows = preview.rows ?? [];
  const sel = selected ?? defaultSelectedRowIndexes(rows);
  const chosen = rows.filter((row, i) => row.valid && sel.has(i));
  const jobCount = new Set(rows.map((r) => r.reference_id)).size;
  const invalid = rows.filter((r) => !r.valid).length;

  const apply = async () => {
    if (chosen.length === 0) return;
    const expected: MassUpdateExpectedUpdatedAt = {};
    for (const row of chosen) expected[row.reference_id] = row.updated_at ?? null;
    setPhase("applying");
    setApplyError("");
    try {
      const res = await apiClient.applyAIMassUpdate(chosen.map((r) => r.operation), expected);
      setResults(res.results);
      setPhase("done");
    } catch (err) {
      setApplyError(errorMessage(err, "The changes could not be applied."));
      setPhase("preview");
    }
  };

  if (phase === "cancelled") return <p className="text-[#4a5260]"><b>Cancelled. Nothing was changed.</b></p>;
  if (phase === "done" && results) return <MassUpdateResults results={results} onDismiss={() => setResults([])} />;

  if (rows.length === 0) {
    return <p>No changes were suggested. Try again with the job numbers and what to change.</p>;
  }
  return (
    <div className="rounded-[12px] border-2 border-[#1a7f94] bg-[#fbfeff] p-3">
      <h3 className="text-[17px] font-bold">
        Preview: {jobCount === 1 ? `change job #${rows[0].reference_id}` : `change ${jobCount} jobs`}
      </h3>
      <p className="mb-2 text-[15px] text-[#4a5260]">Nothing is saved until you tap Apply.</p>
      {preview.message && <p role="status" className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[15px] text-amber-900">{preview.message}</p>}
      {invalid > 0 && <p className="mb-2 text-[15px] text-red-700">{plural(invalid, "change")} can't be applied and {invalid === 1 ? "is" : "are"} unticked.</p>}
      <div className="-mx-1 overflow-x-auto">
        <MassUpdatePreviewTable rows={rows} selected={sel} onChange={setSelected} disabled={phase === "applying"} />
      </div>
      {applyError && (
        <div className="mt-2">
          <MgmtError>{applyError}</MgmtError>
        </div>
      )}
      <div className="mt-3 flex gap-2.5">
        <MgmtButton className="flex-1" onClick={() => void apply()} disabled={phase === "applying" || chosen.length === 0}>
          {phase === "applying" ? "Applying…" : "Apply"}
        </MgmtButton>
        <MgmtButton variant="ghost" className="flex-1" onClick={() => setPhase("cancelled")} disabled={phase === "applying"}>
          Cancel
        </MgmtButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Parts requests: one searchable table
// ---------------------------------------------------------------------------

function sourceLabel(p: Pick<PartsPurchaseRequest, "source" | "source_url">) {
  const base = p.source === "online" ? "Online" : "Supplier";
  if (!p.source_url) return base;
  try {
    return `${base} · ${new URL(p.source_url).hostname}`;
  } catch {
    return base;
  }
}

export function PartsAnswer({ query, statuses }: { query: string; statuses: string[] }) {
  const load = useLoad(() => apiClient.listAllPartsPurchaseRequests());
  const [search, setSearch] = useState(query);
  const [statusFilter, setStatusFilter] = useState<string[]>(statuses);
  const items = useMemo(() => (load.data?.items ?? []).filter((p) => statusFilter.length === 0 || statusFilter.includes(p.status)), [load.data, statusFilter]);
  const q = search.trim().toLowerCase().replace(/^#/, "");
  const shown = q
    ? items.filter((p) => [p.item_name, String(p.reference_id), p.status, partsStatusWord(p.status), sourceLabel(p)].join(" ").toLowerCase().includes(q))
    : items;

  if (load.status === "loading") return <MgmtLoading>Loading parts requests…</MgmtLoading>;
  if (load.status === "error") {
    if (errorStatus(load.error) === 403) return <p>You don't have access to parts requests.</p>;
    return <MgmtError onRetry={load.retry}>{errorMessage(load.error, "Couldn't load parts requests.")}</MgmtError>;
  }
  const jobs = new Set(items.map((p) => p.reference_id)).size;
  if ((load.data?.items ?? []).length === 0) return <p>No parts requests yet.</p>;
  return (
    <div>
      <p className="mb-2">
        <b>{plural(items.length, "parts request")}</b> across {plural(jobs, "job")}.
      </p>
      {statusFilter.length > 0 && (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-[15px] text-[#4a5260]">
          Only {statusFilter.map(partsStatusWord).join(", ")}.
          <button type="button" className="min-h-[44px] font-bold text-[#135f6f] underline" onClick={() => setStatusFilter([])}>
            Show all
          </button>
        </p>
      )}
      <input
        aria-label="Search parts"
        className={`${INPUT_CLASS} mb-2`}
        placeholder="Search part, job #, status or source"
        value={search}
        maxLength={200}
        onChange={(e) => setSearch(e.target.value)}
      />
      {shown.length === 0 ? (
        <p>No match.</p>
      ) : (
        <div className="-mx-1 max-w-full overflow-x-auto">
          <table className={TABLE_CLASS}>
            <thead>
              <tr>
                <th>Job #</th>
                <th>Part</th>
                <th className="text-right">Qty</th>
                <th>Status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.parts_purchase_request_id}>
                  <td className="whitespace-nowrap font-semibold text-[#135f6f]">
                    <JobLink referenceId={p.reference_id} />
                  </td>
                  <td>{p.item_name}</td>
                  <td className="text-right">{p.quantity}</td>
                  <td>
                    <StatusPill tone={statusTone(p.status)}>{partsStatusWord(p.status)}</StatusPill>
                  </td>
                  <td className="text-[15px] text-[#4a5260]">{sourceLabel(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Sum up charges
// ---------------------------------------------------------------------------

const money = (value: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
const round2 = (v: number) => Math.round(v * 100) / 100;

async function loadCharges(referenceIds: number[], customerQuery: string) {
  let ids = referenceIds;
  if (ids.length === 0 && customerQuery) ids = (await searchJobs(customerQuery)).map((r) => r.reference_id);
  const capped = ids.slice(0, CHARGES_JOB_CAP);
  const details = await Promise.all(capped.map((id) => apiClient.getWorkOrderDetail(id)));
  return { details, total: ids.length };
}

export function ChargesAnswer({ referenceIds, customerQuery }: { referenceIds: number[]; customerQuery: string }) {
  const load = useLoad(() => loadCharges(referenceIds, customerQuery));
  if (referenceIds.length === 0 && !customerQuery) return <p>Tell me the job numbers or the customer to sum up.</p>;
  if (load.status === "loading") return <MgmtLoading>Adding up charges…</MgmtLoading>;
  if (load.status === "error") return <MgmtError onRetry={load.retry}>{errorMessage(load.error, "Couldn't load the jobs.")}</MgmtError>;
  const { details, total } = load.data!;
  if (details.length === 0) return <p>No match.</p>;
  const rows = details.map((d: WorkOrderDetail) => {
    const t = workOrderTotals(d);
    return { id: d.reference_id, labour: t.netLabour, parts: round2((d.parts_total ?? 0) + (d.delivery_total ?? 0)), deposit: d.deposit ?? 0, balance: t.payable };
  });
  const sum = (key: "labour" | "parts" | "deposit" | "balance") => round2(rows.reduce((acc, r) => acc + r[key], 0));
  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th>Job #</th>
              <th className="text-right">Labour</th>
              <th className="text-right">Parts</th>
              <th className="text-right">Deposit</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-semibold text-[#135f6f]">
                  <JobLink referenceId={r.id} />
                </td>
                <td className="text-right">{money(r.labour)}</td>
                <td className="text-right">{money(r.parts)}</td>
                <td className="text-right">{r.deposit ? `−${money(r.deposit)}` : money(0)}</td>
                <td className="text-right">{money(r.balance)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td>Total</td>
              <td className="text-right">{money(sum("labour"))}</td>
              <td className="text-right">{money(sum("parts"))}</td>
              <td className="text-right">{sum("deposit") ? `−${money(sum("deposit"))}` : money(0)}</td>
              <td className="text-right">{money(sum("balance"))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[15px] text-[#4a5260]">
        Labour is after any discount. Parts includes delivery. Balance includes 13% HST, minus the deposit.
        {total > rows.length ? ` Showing ${rows.length} of ${total} jobs.` : ""}
      </p>
    </div>
  );
}

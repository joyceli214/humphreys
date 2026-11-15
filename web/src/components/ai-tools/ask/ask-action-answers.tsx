import { useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { WorkOrderDetail } from "@/lib/api/generated/types";
import type { AskCompleteJobPreview, AskCreateJobPreview, AskInvoicePreview, AskPartsCreatePreview } from "@/lib/ai-tools/types";
import { JobLink } from "@/components/ai-tools/job-link";
import { TABLE_CLASS } from "@/components/ai-tools/mgmt-ui";
import { money } from "./ask-answers";
import { applyErrorText, applyPartsChange, PreviewCard, type Phase } from "./ask-skill-answers";

const cancelled = <p><b>Cancelled. Nothing was changed.</b></p>;
type Result = { label: string; ok: boolean; message: string };
function Results({ rows }: { rows: Result[] }) {
  return <ul className="space-y-2">{rows.map((r, i) => <li key={i} className={r.ok ? "text-green-800" : "text-red-700"}>{r.label}: {r.message}</li>)}</ul>;
}

export function InvoiceAnswer({ preview }: { preview: AskInvoicePreview }) {
  const [phase, setPhase] = useState<Phase>("preview");
  const [selected, setSelected] = useState(() => new Set(preview.lines.flatMap((l, i) => l.match === "matched" && l.change?.valid ? [i] : [])));
  const [results, setResults] = useState<Result[]>([]);
  const busy = useRef(false);
  const valid = preview.lines.filter((l, i) => selected.has(i) && l.match === "matched" && l.change?.valid);
  const apply = async () => {
    if (busy.current || !valid.length) return;
    busy.current = true; setPhase("applying");
    const out: Result[] = [];
    for (const l of valid) {
      const ch = l.change!;
      try { await applyPartsChange(ch); out.push({ label: `Request ${ch.parts_purchase_request_id}`, ok: true, message: "updated" }); }
      catch (e) { out.push({ label: `Request ${ch.parts_purchase_request_id}`, ok: false, message: applyErrorText(e, "Could not update this request.") }); }
    }
    setResults(out); setPhase("done");
  };
  if (phase === "cancelled") return cancelled;
  if (phase === "done") return <Results rows={results} />;
  return <PreviewCard title={`Preview: invoice ${preview.invoice_number || "(no number)"}`} phase={phase} canApply={valid.length > 0} applyError="" onApply={() => void apply()} onCancel={() => setPhase("cancelled")}>
    <p className="mb-2">Select the matched requests to mark ordered. Ambiguous and invalid rows need clarification. The invoice number is shown for reference.</p>
    <div className="overflow-x-auto"><table className={TABLE_CLASS}><thead><tr><th>Apply</th><th>Invoice part</th><th>Request / job</th><th>Status</th><th>Price</th><th>Match</th></tr></thead><tbody>
      {preview.lines.map((l, i) => <tr key={i}>
        <td><input type="checkbox" aria-label={`Apply invoice line ${i + 1}`} checked={selected.has(i)} disabled={phase === "applying" || l.match !== "matched" || !l.change?.valid} onChange={() => setSelected(s => { const next = new Set(s); if (next.has(i)) next.delete(i); else next.add(i); return next; })} /></td>
        <td>{l.text}</td><td>{l.change ? <>Request {l.change.parts_purchase_request_id}, <JobLink referenceId={l.change.reference_id} /></> : l.candidates?.map(c => <div key={c.parts_purchase_request_id}>Request {c.parts_purchase_request_id}, <JobLink referenceId={c.reference_id} /></div>) || "—"}</td>
        <td>{l.change ? `${l.change.old_status} → ${l.change.new_status}` : "—"}</td><td>{l.change ? `${money(l.change.old_price)} → ${money(l.change.new_price)}` : l.price === null ? "Unchanged" : money(l.price)}</td><td>{l.match}{l.change?.error && <p className="text-red-700">{l.change.error}</p>}</td>
      </tr>)}
    </tbody></table></div>
  </PreviewCard>;
}

export function PartsCreateAnswer({ preview: p }: { preview: AskPartsCreatePreview }) {
  const [phase, setPhase] = useState<Phase>("preview"); const [error, setError] = useState(""); const [id, setID] = useState<number>(); const busy = useRef(false);
  const apply = async () => {
    if (busy.current) return; busy.current = true; setPhase("applying"); setError("");
    try {
      const created = await apiClient.createPartsPurchaseRequest(p.reference_id, { item_name: p.item_name, quantity: p.quantity, total_price: p.total_price, source: p.source, source_url: p.source_url, status: p.status });
      setID(created.parts_purchase_request_id); setPhase("done");
    } catch (e) { setError(applyErrorText(e, "Could not create the parts request.")); setPhase("preview"); }
    finally { busy.current = false; }
  };
  if (phase === "cancelled") return cancelled;
  if (phase === "done") return <p>Request {id} created on <JobLink referenceId={p.reference_id} />.</p>;
  return <PreviewCard title="Preview: create parts request" phase={phase} canApply={true} applyError={error} onApply={() => void apply()} onCancel={() => setPhase("cancelled")}>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1"><dt>Job</dt><dd><JobLink referenceId={p.reference_id} /></dd><dt>Item</dt><dd>{p.item_name}</dd><dt>Quantity</dt><dd>{p.quantity}</dd><dt>Total price</dt><dd>{money(p.total_price)}</dd><dt>Source</dt><dd>{p.source}</dd><dt>Link</dt><dd>{p.source_url || "—"}</dd><dt>Status</dt><dd>{p.status}</dd></dl>
    {p.preset_match && <p className="mt-2">Matches a saved parts item preset.</p>}
  </PreviewCard>;
}

/** Same target selection as the job-page button. No balance or PDF checks. */
async function completeTarget() {
  const target = await apiClient.getCompleteJobStatusTarget().catch(() => ({ status_id: null }));
  if (target.status_id) return target.status_id;
  const { items } = await apiClient.listWorkOrderStatuses("");
  const status = items.find(s => s.status_group === "completed") ?? items.find(s => s.label.trim().toLowerCase() === "finished") ?? items.find(s => s.label.trim().toLowerCase().includes("finish"));
  if (!status) throw new Error("No status is configured in the completed group");
  return status.id;
}
export function CompleteJobAnswer({ preview: p }: { preview: AskCompleteJobPreview }) {
  const [phase, setPhase] = useState<Phase>("preview"); const [error, setError] = useState(""); const [results, setResults] = useState<Result[]>([]); const busy = useRef(false);
  const apply = async () => {
    if (busy.current) return; busy.current = true; setPhase("applying"); setError("");
    try {
      const target = await completeTarget();
      if (target !== p.target_status_id) throw new Error("The Complete Job target changed. Ask again for a fresh preview.");
      const out: Result[] = [];
      for (const j of p.jobs.filter(j => !j.already)) {
        try { await apiClient.updateWorkOrderStatus(j.reference_id, {status_id: target}); out.push({label: `Job #${j.reference_id} completed`, ok: true, message: p.target_status_name}); }
        catch (e) { out.push({label: `Job #${j.reference_id}`, ok: false, message: applyErrorText(e, "Could not complete the job.")}); }
      }
      setResults(out); setPhase("done");
    } catch (e) { setError(applyErrorText(e, "Could not complete the job.")); setPhase("preview"); }
    finally { busy.current = false; }
  };
  if (phase === "cancelled") return cancelled;
  if (phase === "done") return <Results rows={results} />;
  return <PreviewCard title="Preview: Complete Job" phase={phase} canApply={p.jobs.some(j => !j.already)} applyError={error} onApply={() => void apply()} onCancel={() => setPhase("cancelled")}>
    <p className="mb-2">This is the same as the Complete Job button.</p>
    <table className={TABLE_CLASS}><thead><tr><th>Job</th><th>Current → target</th></tr></thead><tbody>{p.jobs.map(j => <tr key={j.reference_id}><td><JobLink referenceId={j.reference_id} /></td><td>{j.current_status_name || "No status"} → {p.target_status_name}{j.already ? " (already there)" : ""}</td></tr>)}</tbody></table>
  </PreviewCard>;
}

export function CreateJobAnswer({ preview: p }: { preview: AskCreateJobPreview }) {
  const [phase, setPhase] = useState<Phase>("preview"); const [error, setError] = useState(""); const [createdID, setCreatedID] = useState<number>();
  const busy = useRef(false);
  // Save progress across retries: once POST succeeds, only unfinished PATCHes retry.
  const progress = useRef<{ job?: WorkOrderDetail; brandID?: number; itemID?: number; notesDone?: boolean }>({brandID:p.brand_id ?? undefined,itemID:p.item_id ?? undefined});
  const apply = async () => {
    if (busy.current) return; busy.current = true; setPhase("applying"); setError("");
    try {
      const saved = progress.current;
      if (!saved.job) {
        if ((p.brand_new && !saved.brandID) || (p.item_new && !saved.itemID)) {
          const {items} = await apiClient.listDropdownManagement();
          if (items.some(d => d.is_frozen && ((d.key === "brands" && p.brand_new && !saved.brandID) || (d.key === "items" && p.item_new && !saved.itemID)))) throw new Error("A required catalog dropdown is frozen. Choose an existing option on the create page.");
          if (p.brand_new && !saved.brandID) saved.brandID = (await apiClient.createBrand(p.brand_name)).id;
          if (p.item_new && !saved.itemID) saved.itemID = (await apiClient.createItem(p.item_name)).id;
        }
        saved.job = await apiClient.createWorkOrder({
          creation_mode:"new_job", customer_id:p.customer_mode === "existing" ? p.customer_id ?? undefined : undefined,
          new_customer:p.customer_mode === "new" ? p.customer : undefined,
          item_id:saved.itemID, brand_ids:saved.brandID ? [saved.brandID] : [], job_type_id:p.job_type_id ?? undefined,
          model_number:p.model_number || undefined,serial_number:p.serial_number || undefined,
          remote_control_qty:0,cable_qty:0,cord_qty:0,dvd_vhs_qty:0,album_cd_cassette_qty:0,
          deposit:p.deposit,deposit_payment_method_id:p.deposit_payment_method_id ?? undefined
        });
        setCreatedID(saved.job.reference_id);
      }
      if (p.problem_description && !saved.notesDone) {
        await apiClient.updateWorkOrderWorkNotes(saved.job.reference_id, {problem_description:p.problem_description,worker_ids:[],work_done:null,payment_method_ids:saved.job.payment_method_ids}); saved.notesDone = true;
      }
      // POST defaults to Received; explicit statuses reuse the status PATCH.
      if (p.status_id && saved.job.status_id !== p.status_id) {
        await apiClient.updateWorkOrderStatus(saved.job.reference_id,{status_id:p.status_id}); saved.job.status_id = p.status_id;
      }
      setPhase("done");
    } catch (e) {
      const prefix = progress.current.job ? `Job #${progress.current.job.reference_id} was created. Remaining details could not be saved; Apply retries only those details. ` : "";
      setError(prefix + applyErrorText(e,"Could not create the job.")); setPhase("preview");
    } finally { busy.current = false; }
  };
  if (phase === "cancelled") return cancelled;
  if (phase === "done") return <p><b>Job #{createdID} created.</b> <JobLink referenceId={createdID!}>Open job #{createdID}</JobLink></p>;
  const fields: [string, string | number][] = [
    ["Customer",`${p.customer_mode === "existing" ? `Existing #${p.customer_id}` : "New"}: ${p.customer.name}`],
    ...p.customer_mode === "new" ? [["Home phone",p.customer.home_phone],["Work phone",p.customer.work_phone],["Email",p.customer.email],["Address line 1",p.customer.address_line_1],["Address line 2",p.customer.address_line_2],["City",p.customer.city],["Province",p.customer.province],["Postal code",p.customer.postal_code]] as [string,string][] : [],
    ["Brand",`${p.brand_name}${p.brand_new ? " (new catalog option)" : ""}`],["Item",`${p.item_name}${p.item_new ? " (new catalog option)" : ""}`],
    ["Model",p.model_number],["Serial",p.serial_number],["Problem description",p.problem_description],
    ["Status",`${p.status_name}${p.status_is_default ? " (default)" : ""}`],["Job type",p.job_type_name || "Default"],
    ["Remote controls / cables / cords / DVD-VHS / albums-CD-cassettes","0 / 0 / 0 / 0 / 0"],
    ["Deposit",money(p.deposit)],["Deposit payment method",p.deposit_payment_method_name || "—"]
  ];
  return <PreviewCard title="Preview: create job" phase={phase} canApply={true} applyError={error} onApply={() => void apply()} onCancel={() => { if (createdID) { setError(`Job #${createdID} already exists. Open it to finish saving the remaining details.`); return; } setPhase("cancelled"); }}>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">{fields.map(([label,value]) => <div className="contents" key={label}><dt className="font-semibold">{label}</dt><dd>{value || "—"}</dd></div>)}</dl>
    {p.quote !== null && <p className="mt-2">Quote before tax: {money(p.quote)} (reference only).</p>}
    {p.notes?.map((n,i) => <p key={i} className="mt-2">{n}</p>)}
  </PreviewCard>;
}

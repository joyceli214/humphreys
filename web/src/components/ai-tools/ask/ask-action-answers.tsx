import { useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { WorkOrderDetail } from "@/lib/api/generated/types";
import type { AskCompleteJobPreview, AskInvoicePreview, AskPartsCreatePreview } from "@/lib/ai-tools/types";
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

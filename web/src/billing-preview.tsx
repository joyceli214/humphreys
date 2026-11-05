import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { BillingProfilePicker } from "@/components/billing-profile-picker";
import { MassUpdateJobSearch } from "@/components/ai-tools/mass-update-job-search";
import type { BillingProfileItem } from "@/lib/billing-profiles";
import type { AISearchFilters, AISearchRow } from "@/lib/ai-tools/types";
import "@/styles/globals.css";

type Draft = { name: string; price: string; quantity: string };

const demoJobs: AISearchRow[] = [
  { reference_id: 29275, customer_id: 1, customer_name: "Sample Customer", equipment_name: "Receiver", brand_names: ["Kenwood"], model_number: "KR-9340", serial_number: "", status_name: "Received", status_group: "to_do", created_at: null, is_warranty: false, original_job_id: null, warranty_job_ids: [], customer_job_count: 1 },
  { reference_id: 31221, customer_id: 2, customer_name: "Alex Example", equipment_name: "Reel to Reel", brand_names: ["Sony"], model_number: "TC-399", serial_number: "", status_name: "Received", status_group: "to_do", created_at: null, is_warranty: false, original_job_id: null, warranty_job_ids: [], customer_job_count: 1 },
  { reference_id: 31121, customer_id: 3, customer_name: "Taylor Sample", equipment_name: "Speaker", brand_names: ["Bose"], model_number: "", serial_number: "", status_name: "Waiting on Part", status_group: "in_progress", created_at: null, is_warranty: false, original_job_id: null, warranty_job_ids: [], customer_job_count: 1 }
];

async function searchDemoJobs(filters: AISearchFilters): Promise<AISearchRow[]> {
  const name = filters.customer_name?.toLowerCase();
  const suffix = filters.job_suffix;
  return demoJobs.filter((job) => (name ? job.customer_name.toLowerCase().includes(name) : suffix ? String(job.reference_id).endsWith(suffix) : false));
}

function App() {
  const [workDraft, setWorkDraft] = useState<Draft | null>(null);
  const [partsItems, setPartsItems] = useState<Draft[]>([]);
  const [labour, setLabour] = useState("0");
  const [editingPayment, setEditingPayment] = useState(false);
  const [massDraft, setMassDraft] = useState<Draft | null>(null);
  const [jobs, setJobs] = useState("");
  const [massPreview, setMassPreview] = useState<(Draft & { jobs: string }) | null>(null);
  const useWorkItem = (item: BillingProfileItem) => setWorkDraft({ name: item.name, price: item.price ?? "", quantity: item.quantity ?? "" });
  const useMassItem = (item: BillingProfileItem) => { setMassDraft({ name: item.name, price: item.price ?? "", quantity: item.quantity ?? "" }); setMassPreview(null); };
  const validWorkDraft = workDraft && workDraft.name.trim() && Number.isFinite(Number(workDraft.price)) && Number(workDraft.price) >= 0 && Number.isFinite(Number(workDraft.quantity)) && Number(workDraft.quantity) > 0 && workDraft.price.trim() && workDraft.quantity.trim();
  const addWorkItem = () => {
    if (!workDraft || !validWorkDraft) return;
    setPartsItems((items) => [...items, workDraft]);
    setWorkDraft(null);
  };
  const partsTotal = partsItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
  const labourTotal = Number(labour) || 0;
  const subtotal = partsTotal + labourTotal;
  const tax = subtotal * 0.13;
  const validMassDraft = massDraft && massDraft.price.trim() && Number.isFinite(Number(massDraft.price)) && Number(massDraft.price) >= 0 && massDraft.quantity.trim() && Number.isFinite(Number(massDraft.quantity)) && Number(massDraft.quantity) > 0 && /\d/.test(jobs);

  return (
    <div className="min-h-screen bg-[#faf8f4] text-slate-800">
      <header className="border-b border-[#e8e2db] bg-white px-5 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div><p className="text-xs uppercase text-slate-500">Admin panel</p><h1 className="font-semibold">Humphrey's · Billing profile preview</h1></div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Local preview · no changes saved</span>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-2">
        <section className="min-w-0 space-y-4">
          <div><p className="text-xs text-slate-500">Work Order #29275 · Receiver</p><h2 className="text-xl font-semibold">Payment Breakdown</h2></div>
          <article className="space-y-3 rounded-lg border border-[#e8e2db] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Payment Breakdown</h3>
              <div className="flex gap-2"><button className="rounded border px-2 py-1 text-xs" onClick={() => setWorkDraft({ name: "", price: "", quantity: "1" })}>New Parts Item</button><button className="rounded border px-2 py-1 text-xs" onClick={() => setEditingPayment((open) => !open)}>Edit Payment</button></div>
            </div>
            <BillingProfilePicker equipmentName="Receiver" onPick={useWorkItem} />
            <p className="text-xs text-slate-500">Parts Items</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[400px] text-left text-xs"><thead className="border-b bg-slate-50 text-slate-500"><tr><th className="p-2">Parts Item</th><th>Unit Price</th><th>Qty</th><th>Subtotal</th></tr></thead><tbody>{partsItems.length === 0 ? <tr><td className="p-2" colSpan={4}>No parts items.</td></tr> : partsItems.map((part, index) => <tr key={`${part.name}-${index}`} className="border-b"><td className="p-2">{part.name}</td><td>${Number(part.price).toFixed(2)}</td><td>{part.quantity}</td><td>${(Number(part.price) * Number(part.quantity)).toFixed(2)}</td></tr>)}</tbody></table></div>
            {editingPayment && <label className="block text-xs">Labour<input className="ml-2 w-24 rounded border p-1" type="number" min="0" value={labour} onChange={(event) => setLabour(event.target.value)} /></label>}
            <div className="space-y-1 border-t pt-3 text-xs text-slate-600"><p>Parts <span className="float-right">${partsTotal.toFixed(2)}</span></p><p>Labour <span className="float-right">${labourTotal.toFixed(2)}</span></p><p>HST (13%) <span className="float-right">${tax.toFixed(2)}</span></p><p className="font-semibold">Total <span className="float-right">${(subtotal + tax).toFixed(2)}</span></p></div>
          </article>
          {workDraft && <div role="dialog" className="rounded-lg border-2 border-[#c2571a] bg-white p-4 shadow-lg">
            <div className="flex justify-between"><h3 className="font-semibold">New Parts Item</h3><button onClick={() => setWorkDraft(null)} aria-label="Close item editor">×</button></div>
            <p className="mt-1 text-xs text-slate-500">Confirm the price and quantity before saving to this work order.</p>
            <label className="mt-3 block text-xs">Parts Item<input className="mt-1 w-full rounded border p-2" value={workDraft.name} onChange={e => setWorkDraft({ ...workDraft, name: e.target.value })} /></label>
            <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs">Unit Price<input className="mt-1 w-full rounded border p-2" value={workDraft.price} onChange={e => setWorkDraft({ ...workDraft, price: e.target.value })} /></label><label className="text-xs">Qty<input className="mt-1 w-full rounded border p-2" value={workDraft.quantity} onChange={e => setWorkDraft({ ...workDraft, quantity: e.target.value })} /></label></div>
            <button className="mt-3 rounded bg-[#c2571a] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" disabled={!validWorkDraft} onClick={addWorkItem}>Add Parts Item</button>
          </div>}
        </section>
        <section className="min-w-0 space-y-4">
          <div><p className="text-xs text-[#c2571a]">Management · Mass Update</p><h2 className="text-xl font-semibold">Product pick list</h2></div>
          <article className="space-y-3 rounded-lg border border-[#e8e2db] bg-white p-4 shadow-sm">
            <h3 className="font-semibold">Describe the changes you want to make</h3>
            <p className="text-xs text-slate-500">Include job numbers. Preview each change before applying it.</p>
            {massDraft && <div className="space-y-2 rounded border border-dashed border-[#e2c9b6] bg-[#fdf9f6] p-3 text-xs">
              <p className="font-semibold">Selected: {massDraft.name}</p>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(11rem,2fr)]"><label>Price<input className="mt-1 w-full rounded border p-1.5" value={massDraft.price} onChange={e => { setMassDraft({ ...massDraft, price: e.target.value }); setMassPreview(null); }} /></label><label>Qty<input className="mt-1 w-full rounded border p-1.5" value={massDraft.quantity} onChange={e => { setMassDraft({ ...massDraft, quantity: e.target.value }); setMassPreview(null); }} /></label><div><p className="mb-1">Jobs</p><MassUpdateJobSearch value={jobs} onChange={(value) => { setJobs(value); setMassPreview(null); }} onInputChange={() => setMassPreview(null)} searchJobs={searchDemoJobs} /></div></div>
            </div>}
            <textarea className="min-h-24 w-full rounded border p-2 text-sm" readOnly value={massDraft ? `Add "${massDraft.name}"${massDraft.price ? ` at $${massDraft.price}` : ""}${massDraft.quantity ? ` (qty ${massDraft.quantity})` : ""} to ${jobs ? `job ${jobs}` : "jobs"}.` : ""} placeholder="Describe changes or pick a profile item below" />
            <button className="rounded bg-[#c2571a] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" disabled={!validMassDraft} onClick={() => massDraft && setMassPreview({ ...massDraft, jobs })}>Preview changes</button>
          </article>
          {massPreview && <article role="status" className="space-y-2 rounded-lg border border-[#e8e2db] bg-white p-4 text-xs shadow-sm">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Preview: {massPreview.jobs.split(/[\s,]+/).filter(Boolean).length} job change(s)</h3><button className="text-[#c2571a]" onClick={() => setMassPreview(null)}>Discard preview</button></div>
            <p>Add <strong>{massPreview.name}</strong> at ${Number(massPreview.price).toFixed(2)} × {massPreview.quantity} to {massPreview.jobs.split(/[\s,]+/).filter(Boolean).map((id) => `#${id}`).join(", ")}.</p>
            <p>Line total per job: <strong>${(Number(massPreview.price) * Number(massPreview.quantity)).toFixed(2)}</strong></p>
            <p className="text-slate-500">Local preview only. Nothing is applied to real work orders here.</p>
          </article>}
          <article className="space-y-3 rounded-lg border border-[#e8e2db] bg-white p-4 shadow-sm">
            <h3 className="font-semibold">Typical line item prices</h3>
            <p className="text-xs text-slate-500">Choose a product to see its optional bill items.</p>
            <BillingProfilePicker onPick={useMassItem} actionLabel="Insert" />
            <p className="text-xs text-slate-500">Existing general price catalog remains below the profile list.</p>
          </article>
        </section>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Draft bodies for the Management Email flow (Who → Draft → Write). Built from
// portal data without AI; anything missing becomes a yellow {blank} the user
// fills in before Send unlocks (see email-blanks.ts).

import type { PartsPurchaseRequest, WorkOrderDetail } from "@/lib/api/generated/types";
import type { EmailDraftType } from "@/lib/ai-tools/types";
import {
  renderEmailTemplate,
  type EmailTemplate,
  type ShopEmailTemplateKey,
  type SupplierEmailTemplateKey
} from "@/lib/email-templates";
import { workOrderTotals } from "@/lib/work-order-totals";

/** Existing portal pages linked from Management (email config, common contacts). */
export const EMAIL_TEMPLATES_PATH = "/email-templates";
export const COMMON_CONTACTS_PATH = "/email-common-contacts";

export type TemplateText = Pick<EmailTemplate, "subject_template" | "body_template">;
export type CustomerTemplates = { job_started: TemplateText; job_completed: TemplateText };

/** A picked job. `detail` is null while loading or when it could not be loaded. */
export type EmailJob = {
  referenceId: number;
  customerName: string;
  equipment: string;
  status: string;
  detail: WorkOrderDetail | null;
};

/** "jane@gmail.com" → "j***@gmail.com" (mirrors maskEmailHint on the server); "" when not an address. */
export function maskEmailHint(raw: string | null | undefined): string {
  const email = (raw ?? "").trim();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email)) return "";
  return `${email[0]}***${email.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Draft choices
// ---------------------------------------------------------------------------

/** The four live Management customer drafts (labels unchanged from the old tab). */
export const CUSTOMER_DRAFTS: Array<{ value: EmailDraftType; label: string; hint: string }> = [
  { value: "estimate", label: "Estimate", hint: "Price for the repair" },
  { value: "progress_update", label: "Progress update", hint: "How the job is going" },
  { value: "ready_for_pickup", label: "Ready for pickup reminder", hint: "Come and collect" },
  { value: "custom", label: "Custom", hint: "Start blank" }
];

export type SupplierDraftType = "parts_inquiry" | "order_followup" | "custom";

/** Labels are the fallback; the Draft step shows the Email Templates page label. */
export const SUPPLIER_DRAFTS: Array<{ value: SupplierDraftType; label: string; hint: string }> = [
  { value: "parts_inquiry", label: "Parts inquiry", hint: "Price and stock for parts" },
  { value: "order_followup", label: "Order follow-up", hint: "Where is my order?" },
  { value: "custom", label: "Custom", hint: "Start blank" }
];

export const SUPPLIER_TEMPLATE_KEYS: Record<Exclude<SupplierDraftType, "custom">, SupplierEmailTemplateKey> = {
  parts_inquiry: "supplier_parts_inquiry",
  order_followup: "supplier_order_followup"
};

export type ShopDraftType = "approval" | "update" | "custom";

export const SHOP_DRAFTS: Array<{ value: ShopDraftType; label: string; hint: string }> = [
  { value: "approval", label: "Ask for approval", hint: "Parts or work that need a yes." },
  { value: "update", label: "Ask for an update", hint: "How are these jobs going?" },
  { value: "custom", label: "Custom", hint: "Start blank" }
];

export const SHOP_TEMPLATE_KEYS: Record<Exclude<ShopDraftType, "custom">, ShopEmailTemplateKey> = {
  approval: "shop_approval",
  update: "shop_update"
};

type PartsStatus = PartsPurchaseRequest["status"];

/**
 * REVIEW DEFAULT (plan §9.1 left this open): which parts-request statuses go
 * into a supplier email. Parts inquiry asks about parts not ordered yet
 * (waiting for approval, approved); Order follow-up asks about approved and
 * ordered parts. draft, arrived, used and cancelled are always left out, and
 * the Write step says how many were left out so nothing is skipped silently.
 */
export const SUPPLIER_PART_STATUSES: Record<Exclude<SupplierDraftType, "custom">, PartsStatus[]> = {
  parts_inquiry: ["waiting_approval", "approved"],
  order_followup: ["approved", "ordered"]
};

const STATUS_WORDS: Record<PartsStatus, string> = {
  draft: "draft",
  waiting_approval: "waiting for approval",
  approved: "approved",
  ordered: "ordered",
  arrived: "arrived",
  used: "used",
  cancelled: "cancelled"
};

export function partsStatusWord(status: string) {
  return STATUS_WORDS[status as PartsStatus] ?? status;
}

/** "Includes parts that are waiting for approval or approved." */
export function supplierStatusHint(type: SupplierDraftType): string {
  if (type === "custom") return "";
  return partsStatusHint(SUPPLIER_PART_STATUSES[type]);
}

/** Ask for approval lists parts that still need a yes; not ordered / arrived / used / cancelled. */
export const SHOP_APPROVAL_PART_STATUSES: PartsStatus[] = ["draft", "waiting_approval"];

export function partsStatusHint(statuses: readonly string[]): string {
  return `Includes parts that are ${statuses.map(partsStatusWord).join(" or ")}.`;
}

// ---------------------------------------------------------------------------
// Sign-off (derived from the live job_started template, never hardcoded)
// ---------------------------------------------------------------------------

/** Closing paragraph after the template's last `{{…}}` line, e.g. "Thank you,\nShop". */
export function signOffFromTemplate(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let last = -1;
  lines.forEach((line, i) => {
    if (/\{\{[^{}]+\}\}/.test(line)) last = i;
  });
  const tail = lines.slice(last + 1).join("\n").trim();
  if (!tail) return "Thank you";
  const paragraphs = tail.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paragraphs[paragraphs.length - 1] ?? "Thank you";
}

/** The shop name is the last line of a multi-line sign-off; null when there is none. */
export function shopNameFromSignOff(signOff: string): string | null {
  const lines = signOff.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length >= 2 ? lines[lines.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Customer drafts
// ---------------------------------------------------------------------------

const BLANK_LABELS: Record<string, string> = {
  work_done: "Work done",
  serial_number: "Serial",
  model_number: "Model",
  problem_description: "Problem",
  total_payable: "Amount",
  total_before_deposit: "Total",
  parts_total: "Parts total",
  delivery_total: "Delivery",
  labour_total: "Labour",
  labour_net_total: "Labour",
  status_name: "Status",
  location_code: "Location",
  job_type_name: "Job type",
  worker_names: "Workers",
  payment_method_names: "Payment method",
  brand_names: "Brand",
  item_name: "Item"
};

function blankLabel(key: string) {
  if (BLANK_LABELS[key]) return BLANK_LABELS[key];
  const last = key.split(".").pop() ?? key;
  const words = last.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Value";
}

/** Values that are known to be zero/none rather than missing. */
function zeroValue(key: string, item: WorkOrderDetail): string | null {
  if (key === "deposit" && (item.deposit ?? 0) === 0) return "$0.00";
  if (key === "labour_discount" && !item.labour_discount_type) return "$0.00";
  return null;
}

function renderValue(key: string, item: WorkOrderDetail): string {
  return renderEmailTemplate({ subject_template: "", body_template: `{{${key}}}` }, item).body;
}

function renderWithBlanks(template: string, item: WorkOrderDetail): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, raw: string) => {
    const key = raw.trim().replace(/\\/g, "");
    const zero = zeroValue(key, item);
    if (zero !== null) return zero;
    const value = renderValue(key, item);
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return `{${blankLabel(key)} for #${item.reference_id}}`;
    return value;
  });
}

/** Like renderEmailTemplate, but empty/"-"/missing values become `{Label for #N}` blanks. */
export function renderTemplateWithBlanks(template: TemplateText, item: WorkOrderDetail) {
  return {
    subject: renderWithBlanks(template.subject_template, item),
    body: renderWithBlanks(template.body_template, item)
  };
}

const money = (value: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);

function hasTotals(item: WorkOrderDetail) {
  return item.parts_total !== null || item.delivery_total !== null || item.labour_total !== null;
}

/** Amount for a job per draft type (tax included), or null when the job has no totals yet. */
function jobAmount(type: EmailDraftType, job: EmailJob): number | null {
  if (!job.detail || !hasTotals(job.detail)) return null;
  const totals = workOrderTotals(job.detail);
  return type === "ready_for_pickup" ? totals.payable : totals.total;
}

function workDone(job: EmailJob): string | null {
  if (!job.detail) return null;
  const text = renderValue("work_done", job.detail).trim();
  return text && text !== "-" ? text : null;
}

function firstName(jobs: EmailJob[]): string {
  const name = jobs.find((j) => j.detail)?.detail?.customer.first_name?.trim();
  return name || "{Name}";
}

function jobItem(job: EmailJob) {
  const fromDetail = job.detail
    ? [job.detail.brand_names.join(" ").trim(), job.detail.item_name?.trim(), job.detail.model_number?.trim()].filter(Boolean).join(" ")
    : "";
  return fromDetail || job.equipment || `{Item for #${job.referenceId}}`;
}

const jobNos = (jobs: Array<{ referenceId: number }>) => jobs.map((j) => `#${j.referenceId}`).join(", ");

export function customerSubject(type: EmailDraftType, jobs: EmailJob[]): string {
  if (type === "custom") return "{Subject}";
  const one = jobs.length === 1 ? jobs[0].referenceId : null;
  if (type === "estimate") return one !== null ? `Estimate for job #${one}` : `Estimate for jobs ${jobNos(jobs)}`;
  if (type === "progress_update") return one !== null ? `Job #${one} update` : `Update on jobs ${jobNos(jobs)}`;
  return one !== null ? `Job #${one} ready for pickup` : `Jobs ${jobNos(jobs)} ready for pickup`;
}

const AMOUNT_LABEL: Record<Exclude<EmailDraftType, "custom">, string> = {
  estimate: "Estimate",
  progress_update: "Amount so far",
  ready_for_pickup: "Balance due"
};

const TOTAL_LABEL: Record<Exclude<EmailDraftType, "custom">, string> = {
  estimate: "Combined estimate",
  progress_update: "Total so far",
  ready_for_pickup: "Balance due"
};

function intro(type: Exclude<EmailDraftType, "custom">, jobs: EmailJob[]): string {
  if (jobs.length > 1) {
    if (type === "estimate") return `We checked your ${jobs.length} items. Here is what we found.`;
    if (type === "progress_update") return `Here is an update on your ${jobs.length} repairs with us.`;
    return `Here is where your ${jobs.length} repairs stand.`;
  }
  const item = jobs[0] ? jobItem(jobs[0]) : "{Item}";
  if (type === "estimate") return `We checked your ${item}.`;
  if (type === "progress_update") return `Quick update on your ${item}.`;
  return `Good news: your ${item} is ready.`;
}

/**
 * Customer draft for the picked jobs (one customer). One-job progress / pickup
 * use the live email config template; everything else is one block per job.
 */
export function buildCustomerDraft({
  type,
  jobs,
  templates
}: {
  type: EmailDraftType;
  jobs: EmailJob[];
  templates: CustomerTemplates;
}): { subject: string; body: string } {
  const signOff = signOffFromTemplate(templates.job_started.body_template);
  const subject = customerSubject(type, jobs);
  const greeting = `Hi ${firstName(jobs)},`;
  if (type === "custom" || jobs.length === 0) {
    return { subject, body: `${greeting}\n\n{Your message}\n\n${signOff}` };
  }
  if (jobs.length === 1 && jobs[0].detail && (type === "progress_update" || type === "ready_for_pickup")) {
    const template = type === "progress_update" ? templates.job_started : templates.job_completed;
    return { subject, body: renderTemplateWithBlanks(template, jobs[0].detail).body };
  }

  const lines: string[] = [greeting, "", intro(type, jobs), ""];
  for (const job of jobs) {
    const amount = jobAmount(type, job);
    lines.push(`Job #${job.referenceId} · ${jobItem(job)}`);
    lines.push(`Status: ${job.detail?.status_name?.trim() || job.status || `{Status for #${job.referenceId}}`}`);
    lines.push(`Work done: ${workDone(job) ?? `{Work done for #${job.referenceId}}`}`);
    lines.push(`${AMOUNT_LABEL[type]}: ${amount !== null ? money(amount) : `{Amount for #${job.referenceId}}`}`);
    lines.push("");
  }
  if (jobs.length > 1) {
    const known = jobs.map((j) => jobAmount(type, j));
    // Any missing job amount makes the total one blank (filled once), rather than
    // repeating each job's {Amount for #N} blank a second time.
    const anyMissing = known.some((v) => v === null);
    const sum = known.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    lines.push(`${TOTAL_LABEL[type]}: ${anyMissing ? `{${TOTAL_LABEL[type]}}` : money(Math.round(sum * 100) / 100)}`);
    lines.push("");
  }
  lines.push("Amounts include tax.", "", signOff);
  return { subject, body: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Supplier drafts
// ---------------------------------------------------------------------------

/** A picked job's parts requests; `parts` is null when they can't be read (403). */
export type JobParts = { referenceId: number; customerName: string; parts: PartsPurchaseRequest[] | null };

export type SupplierPartRow = {
  /** null → `{Part for #N}` blank (no part data for the job). */
  part: string | null;
  qty: number | null;
  /** "#21 ×2, #22 ×1" when merged across jobs, "#21" for one job. */
  forJob: string;
  jobIds: number[];
  customers: string[];
};

const partKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Same part (case/space-insensitive) on several jobs = one row with qty summed. */
export function mergeSupplierParts(
  jobs: JobParts[],
  statuses: readonly string[]
): { rows: SupplierPartRow[]; excluded: number; excludedStatuses: string[] } {
  type Acc = { part: string; qty: number; per: Array<{ id: number; qty: number }>; customers: string[] };
  const merged = new Map<string, Acc>();
  const order: Array<{ key: string } | { emptyJob: JobParts }> = [];
  let excluded = 0;
  const excludedStatuses = new Set<string>();

  for (const job of jobs) {
    const included = (job.parts ?? []).filter((p) => {
      if (statuses.includes(p.status)) return true;
      excluded++;
      excludedStatuses.add(p.status);
      return false;
    });
    if (included.length === 0) {
      order.push({ emptyJob: job });
      continue;
    }
    for (const p of included) {
      const key = partKey(p.item_name);
      let acc = merged.get(key);
      if (!acc) {
        acc = { part: p.item_name.trim().replace(/\s+/g, " "), qty: 0, per: [], customers: [] };
        merged.set(key, acc);
        order.push({ key });
      }
      acc.qty += p.quantity;
      const per = acc.per.find((entry) => entry.id === job.referenceId);
      if (per) per.qty += p.quantity;
      else acc.per.push({ id: job.referenceId, qty: p.quantity });
      if (!acc.customers.includes(job.customerName)) acc.customers.push(job.customerName);
    }
  }

  const rows: SupplierPartRow[] = order.map((entry) => {
    if ("emptyJob" in entry) {
      const job = entry.emptyJob;
      return { part: null, qty: null, forJob: `#${job.referenceId}`, jobIds: [job.referenceId], customers: [job.customerName] };
    }
    const acc = merged.get(entry.key)!;
    const forJob = acc.per.length > 1 ? acc.per.map((p) => `#${p.id} ×${p.qty}`).join(", ") : `#${acc.per[0].id}`;
    return { part: acc.part, qty: acc.qty, forJob, jobIds: acc.per.map((p) => p.id), customers: acc.customers };
  });
  const statusOrder = Object.keys(STATUS_WORDS);
  return {
    rows,
    excluded,
    excludedStatuses: [...excludedStatuses].sort((a, b) => statusOrder.indexOf(a) - statusOrder.indexOf(b))
  };
}

export function partsTableText(rows: SupplierPartRow[], showNames: boolean): string {
  const header = showNames ? "Part | Qty | For job # | Customer" : "Part | Qty | For job #";
  const body = rows.map((row) => {
    const firstJob = row.jobIds[0];
    const cells = [row.part ?? `{Part for #${firstJob}}`, row.qty !== null ? String(row.qty) : "{Qty}", row.forJob];
    if (showNames) cells.push(row.customers.join(", "));
    return cells.join(" | ");
  });
  if (rows.length === 0) body.push(showNames ? "{Part} | {Qty} | {Job #} | {Customer}" : "{Part} | {Qty} | {Job #}");
  return [header, ...body].join("\n");
}

// ---------------------------------------------------------------------------
// Supplier / Shop drafts from the Email Templates page
// ---------------------------------------------------------------------------

/** Values for Supplier / Shop template fields. `job_cards` is the expanded slot. */
export type GroupTemplateValues = {
  job_numbers: string;
  recipient_name: string;
  supplier_name: string;
  /** No bill-to / account setting exists in the portal, so this is a blank. */
  account_number: string;
  job_cards: string;
};

/** Undo MDXEditor markdown escapes (e.g. `\_`, `\*`) in a saved template; keep the text plain. */
function unescapeTemplate(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/\\([\\`*_[\]()#+\-.!>])/g, "$1");
}

/** Renders `{{token}}`s; unknown fields (e.g. a per-job customer field) become a `{Label}` blank. */
export function renderGroupTemplate(text: string, values: GroupTemplateValues): string {
  return unescapeTemplate(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, raw: string) => {
    const key = raw.trim().replace(/\\/g, "");
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key as keyof GroupTemplateValues];
    return `{${blankLabel(key)}}`;
  });
}

const groupJobNos = (jobs: Array<{ referenceId: number }>) => (jobs.length > 0 ? jobNos(jobs) : "{Job #}");

/**
 * Supplier email from the supplier template. `{{job_cards}}` becomes the merged
 * Part / Qty / For job # table; customer names are left out unless showNames.
 */
export function buildSupplierDraft({
  type,
  template,
  supplierName,
  jobs,
  showNames,
  signOff
}: {
  type: SupplierDraftType;
  template: TemplateText | null;
  /** One name or the To contact names (joined "A, B" for the greeting). */
  supplierName: string | readonly string[] | null;
  jobs: JobParts[];
  showNames: boolean;
  signOff: string;
}): { subject: string; body: string; excluded: number; excludedStatuses: string[] } {
  const name = joinRecipientNames(supplierName) || "team";
  if (type === "custom" || !template) {
    return { subject: "{Subject}", body: `Hello ${name},\n\n{Your message}\n\n${signOff}`, excluded: 0, excludedStatuses: [] };
  }
  const merged = mergeSupplierParts(jobs, SUPPLIER_PART_STATUSES[type]);
  const values: GroupTemplateValues = {
    job_numbers: groupJobNos(jobs),
    recipient_name: name,
    supplier_name: name,
    account_number: "{Account #}",
    job_cards: partsTableText(merged.rows, showNames)
  };
  return {
    subject: renderGroupTemplate(template.subject_template, values),
    body: renderGroupTemplate(template.body_template, values),
    excluded: merged.excluded,
    excludedStatuses: merged.excludedStatuses
  };
}

/** A picked job for a Shop email; customer names are shown (internal email). */
export type ShopJob = {
  referenceId: number;
  customerName: string;
  equipment: string;
  status: string;
  /** null when parts could not be read (403 / error): cards fall back to blanks. */
  parts: PartsPurchaseRequest[] | null;
};

function shopCardHead(job: ShopJob) {
  return [`#${job.referenceId} · ${job.equipment.trim() || `{Item for #${job.referenceId}}`}`, job.customerName.trim() || "{Customer}"];
}

/**
 * Ask for approval: one card per part waiting for a yes (draft / waiting for
 * approval). Cost is the part's price only when the job has exactly one such
 * part and it has a price; otherwise a {Cost} blank. No parts → one card of blanks.
 */
export function shopApprovalCards(jobs: ShopJob[]): { text: string; excluded: number; excludedStatuses: string[] } {
  let excluded = 0;
  const excludedStatuses = new Set<string>();
  const cards: string[] = [];
  for (const job of jobs) {
    const included = (job.parts ?? []).filter((p) => {
      if (SHOP_APPROVAL_PART_STATUSES.includes(p.status)) return true;
      excluded++;
      excludedStatuses.add(p.status);
      return false;
    });
    if (included.length === 0) {
      cards.push([...shopCardHead(job), "Part: {Part}", "Qty: {Qty}", "Cost: {Cost}"].join("\n"));
      continue;
    }
    for (const p of included) {
      const price = included.length === 1 && Number.isFinite(p.total_price) && p.total_price > 0 ? money(p.total_price) : "{Cost}";
      const partName = p.item_name.trim().replace(/\s+/g, " ") || "{Part}";
      cards.push([...shopCardHead(job), `Part: ${partName}`, `Qty: ${p.quantity > 0 ? p.quantity : "{Qty}"}`, `Cost: ${price}`].join("\n"));
    }
  }
  if (cards.length === 0) cards.push("{Jobs and parts}");
  const statusOrder = Object.keys(STATUS_WORDS);
  return {
    text: cards.join("\n\n"),
    excluded,
    excludedStatuses: [...excludedStatuses].sort((a, b) => statusOrder.indexOf(a) - statusOrder.indexOf(b))
  };
}

/** Ask for an update: one card per job with its status and an {Update} blank. */
export function shopUpdateCards(jobs: ShopJob[]): string {
  if (jobs.length === 0) return ["{Job #} · {Item}", "Status: {Status}", "Update: {Update}"].join("\n");
  return jobs
    .map((job) => [...shopCardHead(job), `Status: ${job.status.trim() || "{Status}"}`, "Update: {Update}"].join("\n"))
    .join("\n\n");
}

const DEFAULT_SIGN_OFF = /(^|\n)(Thanks,\n)(Justin|Dave)(\nHumphreys Electronics)(?=\s*$)/;

/** Names of the To contacts, from one name or a list; blanks dropped. */
function recipientNameList(names: string | readonly string[] | null | undefined): string[] {
  const list = typeof names === "string" ? [names] : names ?? [];
  return list.map((n) => n.trim()).filter(Boolean);
}

/** Display name for several To contacts: "Dave, Justin" in pick order; null when none. */
export function joinRecipientNames(names: string | readonly string[] | null | undefined): string | null {
  const list = recipientNameList(names);
  return list.length > 0 ? list.join(", ") : null;
}

/**
 * Who signs a Shop email: if any To is Justin, Dave signs; otherwise Justin.
 * Takes one name or the list of To names (each tested on its own, never the
 * joined string). Only swaps the name line of the default sign-off
 * ("Thanks,\nJustin|Dave\nHumphreys Electronics"); a customised sign-off is left alone.
 */
export function applyShopSignature(body: string, toNames: string | readonly string[] | null | undefined): string {
  const signer = recipientNameList(toNames).some((n) => /^\s*justin\b/i.test(n)) ? "Dave" : "Justin";
  return body.replace(DEFAULT_SIGN_OFF, (_m, lead: string, thanks: string, _name: string, shop: string) => `${lead}${thanks}${signer}${shop}`);
}

export function buildShopDraft({
  type,
  template,
  recipientName,
  jobs,
  signOff
}: {
  type: ShopDraftType;
  template: TemplateText | null;
  /** One name or the To contact names: joined "A, B" for the greeting; each checked for the signer. */
  recipientName: string | readonly string[] | null;
  jobs: ShopJob[];
  signOff: string;
}): { subject: string; body: string; excluded: number; excludedStatuses: string[] } {
  const name = joinRecipientNames(recipientName) || "{Name}";
  if (type === "custom" || !template) {
    return { subject: "{Subject}", body: `Hi ${name},\n\n{Your message}\n\n${signOff}`, excluded: 0, excludedStatuses: [] };
  }
  const approval = type === "approval" ? shopApprovalCards(jobs) : null;
  const values: GroupTemplateValues = {
    job_numbers: groupJobNos(jobs),
    recipient_name: name,
    supplier_name: name,
    account_number: "{Account #}",
    job_cards: approval ? approval.text : shopUpdateCards(jobs)
  };
  return {
    subject: renderGroupTemplate(template.subject_template, values),
    body: applyShopSignature(renderGroupTemplate(template.body_template, values), recipientName),
    excluded: approval?.excluded ?? 0,
    excludedStatuses: approval?.excludedStatuses ?? []
  };
}

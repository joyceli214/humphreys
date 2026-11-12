import { workOrderTotals } from "./work-order-totals";
import type { WorkOrderDetail } from "@/lib/api/generated/types";
import { normalizeMarkdownInput } from "@/lib/markdown";

export type CustomerEmailTemplateKey = "job_started" | "job_completed";
export type SupplierEmailTemplateKey = "supplier_parts_inquiry" | "supplier_order_followup";
export type ShopEmailTemplateKey = "shop_approval" | "shop_update";
export type EmailTemplateKey = CustomerEmailTemplateKey | SupplierEmailTemplateKey | ShopEmailTemplateKey;
export type EmailTemplateKind = "customer" | "supplier" | "shop";

export type EmailTemplate = {
  key: EmailTemplateKey;
  kind?: EmailTemplateKind;
  label: string;
  subject_template: string;
  body_template: string;
  updated_at: string;
};

export type EmailTemplateVariable = {
  token: string;
  label: string;
};

export type DefaultEmailTemplate = Pick<EmailTemplate, "key" | "label" | "subject_template" | "body_template"> & { kind: EmailTemplateKind };

/** The job-card slot in Supplier / Shop bodies, on its own paragraph; filled from the picked jobs on Write. */
export const JOB_CARDS_TOKEN = "{{job_cards}}";

// Default copy for every built-in template. Supplier / Shop text is the same as
// migration 044 (used for Reset Default and when the templates API fails).
export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, DefaultEmailTemplate> = {
  job_started: {
    key: "job_started",
    kind: "customer",
    label: "Job Started Email",
    subject_template: "Job #{{reference_id}} started - {{equipment_name}}",
    body_template: [
      "Hi {{customer_name}},",
      "",
      "We have started work on your {{equipment_name}}.",
      "",
      "Job details:",
      "Job ID: {{reference_id}}",
      "Item: {{equipment_name}}",
      "Status: {{status_name}}",
      "Serial: {{serial_number}}",
      "Problem: {{problem_description}}",
      "Work done: {{work_done}}",
      "Estimated total before deposit: {{total_before_deposit}}",
      "Deposit: {{deposit}}",
      "Total payable: {{total_payable}}",
      "",
      "We will contact you if we need approval for parts or additional work.",
      "",
      "Thank you,",
      "Humphreys Electronics"
    ].join("\n")
  },
  job_completed: {
    key: "job_completed",
    kind: "customer",
    label: "Job Completed Email",
    subject_template: "Job #{{reference_id}} completed - {{equipment_name}}",
    body_template: [
      "Hi {{customer_name}},",
      "",
      "Your repair job for {{equipment_name}} is complete.",
      "",
      "Job details:",
      "Job ID: {{reference_id}}",
      "Item: {{equipment_name}}",
      "Status: {{status_name}}",
      "Serial: {{serial_number}}",
      "Problem: {{problem_description}}",
      "Work done: {{work_done}}",
      "Estimated total before deposit: {{total_before_deposit}}",
      "Deposit: {{deposit}}",
      "Total payable: {{total_payable}}",
      "",
      "Please contact us if you have any questions or would like to arrange pickup or delivery.",
      "",
      "Thank you,",
      "Humphreys Electronics"
    ].join("\n")
  },
  supplier_parts_inquiry: {
    key: "supplier_parts_inquiry",
    kind: "supplier",
    label: "Parts inquiry",
    subject_template: "Parts inquiry – Jobs {{job_numbers}} (Acct {{account_number}})",
    body_template: [
      "Hi {{supplier_name}},",
      "",
      "Could you please confirm price and stock for these parts?",
      "",
      JOB_CARDS_TOKEN,
      "",
      "Please reply with price and lead time.",
      "",
      "Thanks,",
      "Justin",
      "Humphreys Electronics"
    ].join("\n")
  },
  supplier_order_followup: {
    key: "supplier_order_followup",
    kind: "supplier",
    label: "Order follow-up",
    subject_template: "Order follow-up – Jobs {{job_numbers}} (Acct {{account_number}})",
    body_template: [
      "Hi {{supplier_name}},",
      "",
      "Could you let us know where these parts are and when they will ship?",
      "",
      JOB_CARDS_TOKEN,
      "",
      "Thanks,",
      "Justin",
      "Humphreys Electronics"
    ].join("\n")
  },
  shop_approval: {
    key: "shop_approval",
    kind: "shop",
    label: "Ask for approval",
    subject_template: "Approval needed – Jobs {{job_numbers}}",
    body_template: [
      "Hi {{recipient_name}},",
      "",
      "Please approve the parts and work below.",
      "",
      JOB_CARDS_TOKEN,
      "",
      "Reply “yes” and we can order / start.",
      "",
      "Thanks,",
      "Justin",
      "Humphreys Electronics"
    ].join("\n")
  },
  shop_update: {
    key: "shop_update",
    kind: "shop",
    label: "Ask for an update",
    subject_template: "Please update – Jobs {{job_numbers}}",
    body_template: [
      "Hi {{recipient_name}},",
      "",
      "Please send a short update on these jobs.",
      "",
      JOB_CARDS_TOKEN,
      "",
      "A few lines on each job is enough.",
      "",
      "Thanks,",
      "Dave",
      "Humphreys Electronics"
    ].join("\n")
  }
};

/** Left-list groups on the Email Templates page, in order. No Custom row (Custom = "start blank" on Draft). */
export const EMAIL_TEMPLATE_GROUPS: Array<{ kind: EmailTemplateKind; label: string; keys: EmailTemplateKey[] }> = [
  { kind: "customer", label: "Customer", keys: ["job_started", "job_completed"] },
  { kind: "supplier", label: "Supplier", keys: ["supplier_parts_inquiry", "supplier_order_followup"] },
  { kind: "shop", label: "Shop", keys: ["shop_approval", "shop_update"] }
];

export function isEmailTemplateKey(value: string | null | undefined): value is EmailTemplateKey {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(DEFAULT_EMAIL_TEMPLATES, value as string);
}

export function emailTemplateKind(template: Pick<EmailTemplate, "key" | "kind">): EmailTemplateKind {
  return template.kind ?? DEFAULT_EMAIL_TEMPLATES[template.key]?.kind ?? "customer";
}

/** First template of a kind, for "Edit templates" deep links. */
export function firstTemplateKey(kind: EmailTemplateKind): EmailTemplateKey {
  return EMAIL_TEMPLATE_GROUPS.find((g) => g.kind === kind)!.keys[0];
}

export function emailTemplatesHref(key: EmailTemplateKey) {
  return `/email-templates?key=${encodeURIComponent(key)}`;
}

/** Hint inside the locked job-card slot on the Email Templates page. */
export const JOB_CARDS_HINTS: Partial<Record<EmailTemplateKey, string>> = {
  supplier_parts_inquiry: "Part and Qty for each job",
  supplier_order_followup: "Part and Qty for each job",
  shop_approval: "Part, Qty, and Cost",
  shop_update: "An Update blank for each job"
};

/** Help line under the editor for templates with a job-card slot. */
export const JOB_CARDS_NOTES: Partial<Record<EmailTemplateKey, string>> = {
  supplier_parts_inquiry: "The parts list fills in from the jobs you pick when you write the email.",
  supplier_order_followup: "The parts list fills in from the jobs you pick when you write the email.",
  shop_approval: "A card for each job (Part, Qty, Cost) is added when you write the email. You only edit the words around them.",
  shop_update: "A card for each job with an Update blank is added when you write the email."
};

export const EDITOR_HINTS: Record<EmailTemplateKind, string> = {
  customer: "Type @ to search and insert work order fields.",
  supplier: "Type @ to insert supplier and part fields.",
  shop: "Type @ to insert shop fields. Job cards are added automatically."
};

const jobCardsPattern = /\{\{\s*job\\*_cards\s*\}\}/g;

/** Text before / after the job-card slot. A body without a slot is all "before" (the slot is re-added on join). */
export function splitJobCards(body: string): { before: string; after: string } {
  const matches = [...body.matchAll(jobCardsPattern)];
  if (matches.length === 0) return { before: body.trim(), after: "" };
  const first = matches[0];
  const start = first.index ?? 0;
  const before = body.slice(0, start);
  // Any extra slots are dropped: there is exactly one.
  const after = body.slice(start + first[0].length).replace(jobCardsPattern, "");
  return { before: before.trim(), after: after.trim() };
}

/** Before + `{{job_cards}}` on its own paragraph + after. */
export function joinJobCards(before: string, after: string): string {
  return [before.replace(jobCardsPattern, "").trim(), JOB_CARDS_TOKEN, after.replace(jobCardsPattern, "").trim()].filter(Boolean).join("\n\n");
}

export const EMAIL_TEMPLATE_VARIABLES: EmailTemplateVariable[] = [
  { token: "{{reference_id}}", label: "Job ID" },
  { token: "{{customer_name}}", label: "Customer Name" },
  { token: "{{customer.first_name}}", label: "Customer First Name" },
  { token: "{{customer.last_name}}", label: "Customer Last Name" },
  { token: "{{customer.email}}", label: "Customer Email" },
  { token: "{{customer.home_phone}}", label: "Home Phone" },
  { token: "{{customer.work_phone}}", label: "Work Phone" },
  { token: "{{equipment_name}}", label: "Equipment Name" },
  { token: "{{item_name}}", label: "Item" },
  { token: "{{brand_names}}", label: "Brands" },
  { token: "{{model_number}}", label: "Model Number" },
  { token: "{{serial_number}}", label: "Serial Number" },
  { token: "{{status_name}}", label: "Status" },
  { token: "{{job_type_name}}", label: "Job Type" },
  { token: "{{location_code}}", label: "Location" },
  { token: "{{problem_description}}", label: "Problem" },
  { token: "{{work_done}}", label: "Work Done" },
  { token: "{{parts_total}}", label: "Parts Total" },
  { token: "{{delivery_total}}", label: "Delivery Total" },
  { token: "{{labour_total}}", label: "Labour Total" },
  { token: "{{labour_discount}}", label: "Labour Discount" },
  { token: "{{labour_net_total}}", label: "Labour Net Total" },
  { token: "{{total_before_deposit}}", label: "Total Before Deposit" },
  { token: "{{deposit}}", label: "Deposit" },
  { token: "{{total_payable}}", label: "Total Payable" },
  { token: "{{payment_method_names}}", label: "Payment Methods" },
  { token: "{{worker_names}}", label: "Workers" }
];

/** Fields for Supplier / Shop templates (several jobs, so no per-job fields). */
export const SUPPLIER_TEMPLATE_VARIABLES: EmailTemplateVariable[] = [
  { token: "{{supplier_name}}", label: "Supplier Name" },
  { token: "{{recipient_name}}", label: "Recipient Name" },
  { token: "{{job_numbers}}", label: "Jobs" },
  { token: "{{account_number}}", label: "Account" }
];

export const SHOP_TEMPLATE_VARIABLES: EmailTemplateVariable[] = [
  { token: "{{recipient_name}}", label: "Recipient Name" },
  { token: "{{job_numbers}}", label: "Jobs" }
];

export const TEMPLATE_VARIABLES_BY_KIND: Record<EmailTemplateKind, EmailTemplateVariable[]> = {
  customer: EMAIL_TEMPLATE_VARIABLES,
  supplier: SUPPLIER_TEMPLATE_VARIABLES,
  shop: SHOP_TEMPLATE_VARIABLES
};

/** All known fields, so a pill from another kind still shows its label. */
export const ALL_TEMPLATE_VARIABLES: EmailTemplateVariable[] = [
  ...EMAIL_TEMPLATE_VARIABLES,
  ...SUPPLIER_TEMPLATE_VARIABLES.filter((v) => !EMAIL_TEMPLATE_VARIABLES.some((c) => c.token === v.token))
];

export function renderEmailTemplate(
  template: Pick<EmailTemplate, "subject_template" | "body_template">,
  item: WorkOrderDetail
) {
  return {
    subject: renderTemplateString(template.subject_template, item),
    body: renderTemplateString(template.body_template, item)
  };
}

function renderTemplateString(template: string, item: WorkOrderDetail) {
  return template.replace(templateTokenPattern, (_match, key: string) => resolveTemplateValue(item, normalizeTemplateTokenKey(key)));
}

const templateTokenPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

function normalizeTemplateTokenKey(value: string) {
  return value.trim().replace(/\\/g, "");
}

function resolveTemplateValue(item: WorkOrderDetail, key: string) {
  const derived = derivedTemplateValues(item);
  if (Object.prototype.hasOwnProperty.call(derived, key)) return derived[key];
  return formatTemplateValue(getPathValue(item, key));
}

function derivedTemplateValues(item: WorkOrderDetail): Record<string, string> {
  const totals = workOrderTotals(item);
  const hasTotal = item.parts_total !== null || item.delivery_total !== null || item.labour_total !== null;
  const totalBeforeDeposit = totals.total;
  const totalPayable = totals.payable;
  return {
    customer_name: emailCustomerName(item),
    equipment_name: emailEquipmentName(item),
    job_details: emailJobDetails(item),
    total_before_deposit: hasTotal ? formatCurrency(totalBeforeDeposit) : "",
    parts_total: item.parts_total !== null ? formatCurrency(item.parts_total) : "",
    delivery_total: item.delivery_total !== null ? formatCurrency(item.delivery_total) : "",
    labour_discount: item.labour_discount_type ? `-${formatCurrency(totals.labourDiscount)}` : "",
    labour_net_total: item.labour_total !== null ? formatCurrency(totals.netLabour) : "",
    labour_total: item.labour_total !== null ? formatCurrency(item.labour_total) : "",
    deposit: item.deposit > 0 ? formatCurrency(item.deposit) : "",
    total_payable: hasTotal ? formatCurrency(totalPayable) : ""
  };
}

function getPathValue(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function formatTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(formatTemplateValue).filter(Boolean).join(", ");
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = stripMarkdownForEmail(String(value));
  // Lists start on their own line so "Work done: {{work_done}}" renders as a heading + bullet list.
  return /^(?:• |\d+\. )/.test(text) ? `\n${text}` : text;
}

function emailCustomerName(item: WorkOrderDetail) {
  const name = [item.customer.first_name, item.customer.last_name].filter(Boolean).join(" ").trim();
  return name || "there";
}

function emailEquipmentName(item: WorkOrderDetail) {
  const parts = [item.brand_names.join(" ").trim(), item.item_name?.trim(), item.model_number?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "your item";
}

function emailJobDetails(item: WorkOrderDetail) {
  const details = [
    `Job ID: ${item.reference_id}`,
    `Item: ${emailEquipmentName(item)}`,
    `Status: ${item.status_name ?? "-"}`,
    `Serial: ${item.serial_number ?? "-"}`,
    `Problem: ${stripMarkdownForEmail(item.problem_description) || "-"}`
  ];

  const workDone = stripMarkdownForEmail(item.work_done);
  if (workDone) details.push(`Work done: ${workDone}`);

  const totals = workOrderTotals(item);
  if (item.parts_total !== null || item.delivery_total !== null || item.labour_total !== null) {
    details.push(`Estimated total before deposit: ${formatCurrency(totals.total)}`);
  }

  if (item.labour_discount_type) details.push(`Labour discount: -${formatCurrency(totals.labourDiscount)}`);
  if (item.deposit > 0) details.push(`Deposit: ${formatCurrency(item.deposit)}`);

  return details.join("\n");
}

function stripMarkdownForEmail(value: string | null) {
  const text = normalizeMarkdownInput(value)
    // Photos are attached from the photo panel, so drop inline images (and their alt text) from the email text.
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // List markers first, so "* item" bullets are not mistaken for *italic* pairs across lines.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*(\d+)\.\s+/gm, "$1. ")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/gm, "$1$2")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "-" ? "" : text;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

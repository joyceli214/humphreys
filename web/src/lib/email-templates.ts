import type { WorkOrderDetail } from "@/lib/api/generated/types";
import { normalizeMarkdownInput } from "@/lib/markdown";

export type CustomerEmailTemplateKey = "job_started" | "job_completed";

export type EmailTemplate = {
  key: CustomerEmailTemplateKey;
  label: string;
  subject_template: string;
  body_template: string;
  updated_at: string;
};

export type EmailTemplateVariable = {
  token: string;
  label: string;
};

export const DEFAULT_EMAIL_TEMPLATES: Record<CustomerEmailTemplateKey, Pick<EmailTemplate, "key" | "label" | "subject_template" | "body_template">> = {
  job_started: {
    key: "job_started",
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
      "",
      "We will contact you if we need approval for parts or additional work.",
      "",
      "Thank you,",
      "Humphreys Electronics"
    ].join("\n")
  },
  job_completed: {
    key: "job_completed",
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
      "",
      "Please contact us if you have any questions or would like to arrange pickup or delivery.",
      "",
      "Thank you,",
      "Humphreys Electronics"
    ].join("\n")
  }
};

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
  { token: "{{total_before_deposit}}", label: "Total Before Deposit" },
  { token: "{{deposit}}", label: "Deposit" },
  { token: "{{payment_method_names}}", label: "Payment Methods" },
  { token: "{{worker_names}}", label: "Workers" }
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
  return template.replace(templateTokenPattern, (_match, key: string) => resolveTemplateValue(item, key));
}

const templateTokenPattern = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function resolveTemplateValue(item: WorkOrderDetail, key: string) {
  const derived = derivedTemplateValues(item);
  if (Object.prototype.hasOwnProperty.call(derived, key)) return derived[key];
  return formatTemplateValue(getPathValue(item, key));
}

function derivedTemplateValues(item: WorkOrderDetail): Record<string, string> {
  const subtotal = (item.parts_total ?? 0) + (item.delivery_total ?? 0) + (item.labour_total ?? 0);
  return {
    customer_name: emailCustomerName(item),
    equipment_name: emailEquipmentName(item),
    job_details: emailJobDetails(item),
    total_before_deposit: item.parts_total !== null || item.delivery_total !== null || item.labour_total !== null ? formatCurrency(subtotal * 1.13) : "",
    parts_total: item.parts_total !== null ? formatCurrency(item.parts_total) : "",
    delivery_total: item.delivery_total !== null ? formatCurrency(item.delivery_total) : "",
    labour_total: item.labour_total !== null ? formatCurrency(item.labour_total) : "",
    deposit: item.deposit > 0 ? formatCurrency(item.deposit) : ""
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
  return stripMarkdownForEmail(String(value));
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

  const subtotal = (item.parts_total ?? 0) + (item.delivery_total ?? 0) + (item.labour_total ?? 0);
  if (item.parts_total !== null || item.delivery_total !== null || item.labour_total !== null) {
    details.push(`Estimated total before deposit: ${formatCurrency(subtotal * 1.13)}`);
  }

  if (item.deposit > 0) details.push(`Deposit: ${formatCurrency(item.deposit)}`);

  return details.join("\n");
}

function stripMarkdownForEmail(value: string | null) {
  const text = normalizeMarkdownInput(value)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, "$1")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "• ")
    .replace(/^\s{0,3}(\d+)\.\s+/gm, "$1. ")
    .replace(/<[^>]+>/g, "")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "-" ? "" : text;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

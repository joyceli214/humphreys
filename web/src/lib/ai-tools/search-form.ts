// Editable form state for the Advanced Search "Adjustable filters" card and its
// conversion to/from the API filter object (AISearchFilters).

import type { AISearchFilters, AISearchGroupBy } from "@/lib/ai-tools/types";

/** "linked" = only warranty jobs, shown together with their original job. */
export type SearchWarrantyChoice = "any" | "only" | "exclude" | "linked";

export type SearchFormState = {
  text: string;
  customerName: string;
  model: string;
  serial: string;
  brand: string;
  equipment: string;
  statuses: string[];
  warranty: SearchWarrantyChoice;
  minUnits: string;
  createdFrom: string;
  createdTo: string;
  groupBy: AISearchGroupBy;
  // Not shown as controls, but kept so an AI interpretation isn't silently dropped.
  minModelJobs: number;
  minSerialJobs: number;
};

/** Page size sent with every search (the API caps it at 200). */
export const SEARCH_LIMIT = 200;

export const EMPTY_SEARCH_FORM: SearchFormState = {
  text: "",
  customerName: "",
  model: "",
  serial: "",
  brand: "",
  equipment: "",
  statuses: [],
  warranty: "any",
  minUnits: "",
  createdFrom: "",
  createdTo: "",
  groupBy: "none",
  minModelJobs: 0,
  minSerialJobs: 0
};

export const WARRANTY_CHOICES: Array<{ value: SearchWarrantyChoice; label: string }> = [
  { value: "any", label: "Any" },
  { value: "only", label: "Only warranty jobs" },
  { value: "exclude", label: "Only non-warranty jobs" },
  { value: "linked", label: "Show original with follow-ups" }
];

export const GROUP_BY_CHOICES: Array<{ value: AISearchGroupBy; label: string }> = [
  { value: "none", label: "None" },
  { value: "customer", label: "Customer" },
  { value: "model", label: "Model" },
  { value: "serial", label: "Serial" }
];

function positiveInt(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Builds the request filters, omitting empty fields. */
export function formToFilters(form: SearchFormState): AISearchFilters {
  const filters: AISearchFilters = {};
  const texts: Array<[keyof AISearchFilters, string]> = [
    ["text", form.text],
    ["customer_name", form.customerName],
    ["model", form.model],
    ["serial", form.serial],
    ["brand", form.brand],
    ["equipment", form.equipment]
  ];
  for (const [key, value] of texts) {
    const trimmed = value.trim();
    if (trimmed) (filters as Record<string, unknown>)[key] = trimmed;
  }
  if (form.statuses.length > 0) filters.statuses = [...form.statuses];
  if (form.warranty === "linked") {
    filters.warranty = "only";
    filters.include_linked = true;
  } else if (form.warranty !== "any") {
    filters.warranty = form.warranty;
  }
  const minUnits = positiveInt(form.minUnits);
  if (minUnits > 0) filters.min_units = minUnits;
  if (form.minModelJobs > 0) filters.min_model_jobs = form.minModelJobs;
  if (form.minSerialJobs > 0) filters.min_serial_jobs = form.minSerialJobs;
  if (form.createdFrom) filters.created_from = form.createdFrom;
  if (form.createdTo) filters.created_to = form.createdTo;
  if (form.groupBy !== "none") filters.group_by = form.groupBy;
  filters.limit = SEARCH_LIMIT;
  return filters;
}

/** Fills the form from AI-interpreted (or server-normalized) filters. */
export function filtersToForm(filters: AISearchFilters): SearchFormState {
  let warranty: SearchWarrantyChoice = filters.warranty ?? "any";
  if (filters.include_linked) warranty = "linked";
  return {
    text: filters.text ?? "",
    customerName: filters.customer_name ?? "",
    model: filters.model ?? "",
    serial: filters.serial ?? "",
    brand: filters.brand ?? "",
    equipment: filters.equipment ?? "",
    statuses: filters.statuses ?? [],
    warranty,
    minUnits: filters.min_units ? String(filters.min_units) : "",
    createdFrom: filters.created_from ?? "",
    createdTo: filters.created_to ?? "",
    groupBy: filters.group_by ?? "none",
    minModelJobs: filters.min_model_jobs ?? 0,
    minSerialJobs: filters.min_serial_jobs ?? 0
  };
}

/** Human labels for AI filters that have no dedicated control. */
export function extraFilterLabels(form: SearchFormState): string[] {
  const labels: string[] = [];
  if (form.minModelJobs > 0) labels.push(`models seen on at least ${form.minModelJobs} jobs`);
  if (form.minSerialJobs > 0) labels.push(`serials seen on at least ${form.minSerialJobs} jobs`);
  return labels;
}

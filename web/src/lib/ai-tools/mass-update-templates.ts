import type { LineItemCatalogItem } from "@/lib/ai-tools/types";

// Fill-in templates for the Mass Update examples. Clicking an example shows
// small inputs ("slots") above the instruction box; their values compose the
// instruction text live. Templates carry no sample job numbers or values, and
// empty slots compose to plain words (no placeholder markers).

export type SlotKind = "jobs" | "status" | "item" | "money" | "qty" | "percent" | "text";

export type TemplateSlot = { key: string; label: string; kind: SlotKind };

export type TemplateValues = Record<string, string>;

export type TemplateId = "status" | "add-item" | "remove-item" | "labour-total" | "labour-discount" | "location" | "work-done";

export type MassUpdateTemplate = {
  /** Example button text (no numbers). */
  label: string;
  slots: TemplateSlot[];
  compose: (v: TemplateValues) => string;
};

const JOBS: TemplateSlot = { key: "jobs", label: "Jobs", kind: "jobs" };

/** "jobs" when blank, "job 5" for one, "jobs 5, 6 and 7" for several. */
export function jobsPhrase(raw: string): string {
  const ids = raw.split(/[\s,]+/).filter(Boolean);
  if (ids.length === 0) return "jobs";
  if (ids.length === 1) return `job ${ids[0]}`;
  return `jobs ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

function money(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return s.startsWith("$") ? s : `$${s}`;
}

function quoted(raw: string): string {
  const s = raw.trim();
  return s ? `"${s}"` : "";
}

/** Joins words, dropping blanks, and tidies spaces before punctuation. */
function sentence(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([.,%)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".");
}

export const TEMPLATES: Record<TemplateId, MassUpdateTemplate> = {
  status: {
    label: "Set jobs to a status",
    slots: [JOBS, { key: "status", label: "Status", kind: "status" }],
    compose: (v) => sentence("Set", jobsPhrase(v.jobs ?? ""), "to", (v.status ?? "").trim() || "status", ".")
  },
  "add-item": {
    label: "Add a line item to jobs",
    slots: [
      { key: "item", label: "Item", kind: "item" },
      { key: "price", label: "Price", kind: "money" },
      { key: "qty", label: "Qty", kind: "qty" },
      JOBS
    ],
    compose: (v) => {
      const price = money(v.price ?? "");
      const qty = (v.qty ?? "").trim();
      return sentence(
        "Add",
        quoted(v.item ?? "") || "a line item",
        price ? `at ${price}` : "",
        qty ? `(qty ${qty})` : "",
        "to",
        jobsPhrase(v.jobs ?? ""),
        "."
      );
    }
  },
  "remove-item": {
    label: "Remove a line item from jobs",
    slots: [{ key: "item", label: "Item", kind: "item" }, JOBS],
    compose: (v) => sentence("Remove the", quoted(v.item ?? ""), "line from", jobsPhrase(v.jobs ?? ""), ".")
  },
  "labour-total": {
    label: "Set the labour total",
    slots: [JOBS, { key: "amount", label: "Labour total", kind: "money" }],
    compose: (v) => {
      const amount = money(v.amount ?? "");
      return sentence("Set the labour total on", jobsPhrase(v.jobs ?? ""), amount ? `to ${amount}` : "", ".");
    }
  },
  "labour-discount": {
    label: "Give a labour discount",
    slots: [JOBS, { key: "percent", label: "Discount %", kind: "percent" }],
    compose: (v) => {
      const pct = (v.percent ?? "").trim().replace(/%$/, "");
      return sentence("Give", jobsPhrase(v.jobs ?? ""), pct ? `a ${pct}%` : "a", "labour discount", ".");
    }
  },
  location: {
    label: "Move jobs to a location",
    slots: [JOBS, { key: "location", label: "Location", kind: "text" }],
    compose: (v) => sentence("Move", jobsPhrase(v.jobs ?? ""), "to location", (v.location ?? "").trim(), ".")
  },
  "work-done": {
    label: "Generate Work Done for jobs",
    slots: [JOBS],
    compose: (v) => sentence("Generate Work Done for", jobsPhrase(v.jobs ?? ""), ".")
  }
};

export type Capability = { title: string; detail?: string; isNew?: boolean; templates: TemplateId[] };

export const CAPABILITIES: Capability[] = [
  { title: "Change status", templates: ["status"] },
  { title: "Add, change or remove line items", templates: ["add-item", "remove-item"] },
  { title: "Change the labour total or discount", templates: ["labour-total", "labour-discount"] },
  { title: "Change the location", templates: ["location"] },
  {
    title: "Generate Work Done",
    detail: "Written from each job's repair logs, for up to 10 jobs per request.",
    isNew: true,
    templates: ["work-done"]
  }
];

export function getTemplate(id: TemplateId): MassUpdateTemplate {
  return TEMPLATES[id];
}

export function emptyValues(id: TemplateId): TemplateValues {
  return Object.fromEntries(TEMPLATES[id].slots.map((slot) => [slot.key, ""]));
}

export function composeTemplate(id: TemplateId, values: TemplateValues): string {
  return TEMPLATES[id].compose(values);
}

/** Add-item slot values prefilled from a catalog row (jobs left for the user). */
export function catalogTemplateValues(item: LineItemCatalogItem): TemplateValues {
  return {
    item: item.name,
    price: Number.isFinite(item.unit_price) ? item.unit_price.toFixed(2) : "",
    qty: item.quantity_text.trim() || "1",
    jobs: ""
  };
}

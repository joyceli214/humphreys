import type { ReactNode } from "react";
import type { AISearchGroupBy } from "@/lib/ai-tools/types";
import {
  EMPTY_SEARCH_FORM,
  GROUP_BY_CHOICES,
  WARRANTY_CHOICES,
  extraFilterLabels,
  type SearchFormState,
  type SearchWarrantyChoice
} from "@/lib/ai-tools/search-form";
import { AIButton, AICard, AICardTitle } from "@/components/ai-tools/ai-ui";
import { SearchStatusPicker } from "@/components/ai-tools/search-status-picker";

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-[#ddd5cc] bg-white px-2.5 text-sm text-neutral-800 outline-none focus:border-[#c2571a] focus:ring-1 focus:ring-[#c2571a] disabled:opacity-60";

type Props = {
  form: SearchFormState;
  onChange: (next: SearchFormState) => void;
  statusOptions: string[];
  onSearch: () => void;
  searching: boolean;
  disabled?: boolean;
};

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
      </label>
      {children}
    </div>
  );
}

export function SearchFiltersCard({ form, onChange, statusOptions, onSearch, searching, disabled }: Props) {
  const off = searching || disabled;
  const set = <K extends keyof SearchFormState>(key: K, value: SearchFormState[K]) => onChange({ ...form, [key]: value });
  const extras = extraFilterLabels(form);

  const text = (id: string, label: string, key: "text" | "customerName" | "model" | "serial" | "brand" | "equipment") => (
    <Field id={id} label={label}>
      <input id={id} className={INPUT_CLASS} value={form[key]} disabled={off} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <AICard>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <AICardTitle>Adjustable filters</AICardTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {text("ai-search-customer", "Customer name", "customerName")}
          {text("ai-search-model", "Model number", "model")}
          {text("ai-search-serial", "Serial number", "serial")}
          {text("ai-search-brand", "Brand", "brand")}
          {text("ai-search-equipment", "Equipment", "equipment")}
          {text("ai-search-text", "Keyword (job #, any field)", "text")}
        </div>

        <div className="mt-3">
          <span className="mb-1 block text-xs font-medium text-neutral-600">Status</span>
          <SearchStatusPicker options={statusOptions} selected={form.statuses} onChange={(v) => set("statuses", v)} disabled={off} />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="ai-search-warranty" label="Warranty">
            <select
              id="ai-search-warranty"
              className={INPUT_CLASS}
              value={form.warranty}
              disabled={off}
              onChange={(e) => set("warranty", e.target.value as SearchWarrantyChoice)}
            >
              {WARRANTY_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ai-search-min-units" label="Customers with at least N units">
            <input
              id="ai-search-min-units"
              type="number"
              min={0}
              max={1000}
              placeholder="off"
              className={INPUT_CLASS}
              value={form.minUnits}
              disabled={off}
              onChange={(e) => set("minUnits", e.target.value)}
            />
          </Field>
          <Field id="ai-search-group-by" label="Group by">
            <select
              id="ai-search-group-by"
              className={INPUT_CLASS}
              value={form.groupBy}
              disabled={off}
              onChange={(e) => set("groupBy", e.target.value as AISearchGroupBy)}
            >
              {GROUP_BY_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ai-search-created-from" label="Created from">
            <input
              id="ai-search-created-from"
              type="date"
              className={INPUT_CLASS}
              value={form.createdFrom}
              disabled={off}
              onChange={(e) => set("createdFrom", e.target.value)}
            />
          </Field>
          <Field id="ai-search-created-to" label="Created to">
            <input
              id="ai-search-created-to"
              type="date"
              className={INPUT_CLASS}
              value={form.createdTo}
              disabled={off}
              onChange={(e) => set("createdTo", e.target.value)}
            />
          </Field>
        </div>

        {extras.length > 0 && (
          <p className="mt-3 text-xs text-neutral-600">
            Also applied: {extras.join(", ")}.{" "}
            <button
              type="button"
              className="text-[#c2571a] hover:underline"
              disabled={off}
              onClick={() => onChange({ ...form, minModelJobs: 0, minSerialJobs: 0 })}
            >
              Remove
            </button>
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <AIButton type="submit" disabled={off}>
            {searching ? "Searching..." : "Search"}
          </AIButton>
          <AIButton variant="outline" disabled={off} onClick={() => onChange(EMPTY_SEARCH_FORM)}>
            Clear filters
          </AIButton>
        </div>
      </form>
    </AICard>
  );
}

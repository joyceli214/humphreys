import type { ReactNode } from "react";
import type { AISearchGroupBy } from "@/lib/ai-tools/types";
import {
  EMPTY_SEARCH_FORM,
  GROUP_BY_CHOICES,
  WARRANTY_CHOICES,
  extraFilterLabels,
  searchFormErrors,
  type SearchFormState,
  type SearchWarrantyChoice
} from "@/lib/ai-tools/search-form";
import { SEARCH_JOB_IDS_INPUT_MAX, SEARCH_JOB_SUFFIX_MAX, SEARCH_TEXT_MAX } from "@/lib/ai-tools/limits";
import { AIButton, AICard, AICardTitle } from "@/components/ai-tools/ai-ui";
import { CharCounterInput } from "@/components/ai-tools/char-counter-input";
import { StatusPickList } from "@/components/ai-tools/status-pick-list";

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

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-0.5 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

type TextKey = "jobIds" | "jobSuffix" | "text" | "customerName" | "model" | "serial" | "brand" | "equipment";

export function SearchFiltersCard({ form, onChange, statusOptions, onSearch, searching, disabled }: Props) {
  const off = searching || disabled;
  const set = <K extends keyof SearchFormState>(key: K, value: SearchFormState[K]) => onChange({ ...form, [key]: value });
  const extras = extraFilterLabels(form);
  const errors = searchFormErrors(form);
  const invalid = Boolean(errors.jobIds || errors.jobSuffix);

  const text = (id: string, label: string, key: TextKey, limit = SEARCH_TEXT_MAX, error = "", placeholder?: string) => (
    <Field id={id} label={label} error={error}>
      <CharCounterInput
        id={id}
        limit={limit}
        className={INPUT_CLASS}
        value={form[key]}
        disabled={off}
        placeholder={placeholder}
        inputMode={key === "jobSuffix" ? "numeric" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onValueChange={(v) => set(key, v)}
      />
    </Field>
  );

  return (
    <AICard>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) onSearch();
        }}
      >
        <AICardTitle>Adjustable filters</AICardTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {text("ai-search-job-ids", "Job number(s)", "jobIds", SEARCH_JOB_IDS_INPUT_MAX, errors.jobIds, "e.g. 31201, 31205")}
          {text("ai-search-job-suffix", "Job number ends with", "jobSuffix", SEARCH_JOB_SUFFIX_MAX, errors.jobSuffix, "e.g. 07")}
          {text("ai-search-text", "Keyword (any field)", "text")}
          {text("ai-search-customer", "Customer name", "customerName")}
          {text("ai-search-model", "Model number", "model")}
          {text("ai-search-serial", "Serial number", "serial")}
          {text("ai-search-brand", "Brand", "brand")}
          {text("ai-search-equipment", "Equipment", "equipment")}
        </div>

        <div className="mt-3">
          <StatusPickList options={statusOptions} selected={form.statuses} onChange={(v) => set("statuses", v)} disabled={off} />
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
          <AIButton type="submit" disabled={off || invalid}>
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

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { apiClient } from "@/lib/api/client";
import type { EmailPickerContact, WorkOrderListItem } from "@/lib/api/generated/types";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { INPUT_CLASS, LINK_BUTTON } from "@/components/ai-tools/mgmt-ui";
import { cn } from "@/lib/utils";

export const WHO_SEARCH_DEBOUNCE_MS = 300;
const JOB_RESULTS = 8;

export function jobItemLabel(row: Pick<WorkOrderListItem, "brand_names" | "item_name" | "model_number">) {
  return [row.brand_names?.join(" "), row.item_name, row.model_number].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
}

type Option = { kind: "contact"; contact: EmailPickerContact } | { kind: "job"; row: WorkOrderListItem };

type Props = {
  placeholder: string;
  /** "Contacts" (customer) or "Suppliers" (supplier). Already filtered by role. */
  contactsLabel: string;
  contacts: EmailPickerContact[];
  contactsLoading: boolean;
  contactsError: string;
  onRetryContacts: () => void;
  pickedContactIds: number[];
  pickedJobIds: number[];
  canAddJob: boolean;
  onPickJob: (row: WorkOrderListItem) => void;
  onPickContact: (contact: EmailPickerContact) => void;
};

/**
 * One box that searches common contacts (client-side) and jobs
 * (debounced GET /work-orders?q=). Results are 44px+ rows, keyboard navigable.
 */
export function WhoSearch(props: Props) {
  const { placeholder, contactsLabel, contacts, pickedContactIds, pickedJobIds, canAddJob, onPickJob, onPickContact } = props;
  const listId = useId();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [jobs, setJobs] = useState<WorkOrderListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const q = query.trim();

  useEffect(() => {
    const id = ++requestId.current;
    if (!q) {
      setJobs(null);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: q.replace(/^#/, ""), page_size: String(JOB_RESULTS + pickedJobIds.length) });
        const res = await apiClient.listWorkOrders(params);
        if (id !== requestId.current) return;
        setJobs(res.items ?? []);
        setActive(-1);
      } catch (err) {
        if (id !== requestId.current) return;
        setJobs(null);
        setError(errorMessage(err, "Search failed."));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, WHO_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // pickedJobIds.length only widens the page; it shouldn't re-run a search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, attempt]);

  const needle = q.toLowerCase();
  const contactMatches = needle
    ? contacts.filter((c) => !pickedContactIds.includes(c.id) && `${c.name} ${c.email}`.toLowerCase().includes(needle))
    : [];
  const jobMatches = (jobs ?? []).filter((row) => !pickedJobIds.includes(row.reference_id)).slice(0, JOB_RESULTS);
  const options: Option[] = [
    ...contactMatches.map((contact) => ({ kind: "contact" as const, contact })),
    ...(canAddJob ? jobMatches.map((row) => ({ kind: "job" as const, row })) : [])
  ];
  const showList = open && q !== "";

  const choose = (option: Option) => {
    if (option.kind === "contact") onPickContact(option.contact);
    else onPickJob(option.row);
    setQuery("");
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i < 0 && step < 0 ? options.length - 1 : (i + step + options.length) % options.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (showList && active >= 0 && options[active]) choose(options[active]);
    }
  };

  const optionId = (i: number) => `${listId}-o${i}`;
  const rowClass = (i: number) =>
    cn(
      "flex min-h-[56px] w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-[#d5d9de] bg-white px-3 py-2 text-left",
      i === active && "border-[#1a7f94] bg-[#e6f3f6]"
    );

  let index = -1;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 mt-3 block text-[16px] font-semibold">
        Search
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        maxLength={200}
        className={INPUT_CLASS}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div className="mt-2 space-y-1.5" id={listId} role="listbox" aria-label="Search results">
          {props.contactsLoading && <p className="text-[15px] text-[#4a5260]">Loading {contactsLabel.toLowerCase()}…</p>}
          {props.contactsError && (
            <p className="flex flex-wrap items-center gap-2 text-[15px] text-red-700">
              {props.contactsError}
              <button type="button" className={LINK_BUTTON} onClick={props.onRetryContacts}>
                Retry
              </button>
            </p>
          )}
          {contactMatches.length > 0 && (
            <div role="group" aria-label={contactsLabel} className="space-y-1.5">
              <p className="text-[14px] font-semibold uppercase tracking-wide text-[#4a5260]">{contactsLabel}</p>
              {contactMatches.map((contact) => {
                index++;
                const i = index;
                return (
                  <div
                    key={`c${contact.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    aria-label={`${contact.name} ${contact.email}`}
                    tabIndex={-1}
                    className={rowClass(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose({ kind: "contact", contact })}
                  >
                    <span className="min-w-0">
                      <b className="block truncate">{contact.name}</b>
                      <small className="block truncate text-[15px] text-[#4a5260]">{contact.email}</small>
                    </span>
                    <span className="flex-none text-[14px] font-semibold text-[#4a5260]">{contactsLabel === "Suppliers" ? "Supplier" : "Contact"}</span>
                  </div>
                );
              })}
            </div>
          )}
          {!canAddJob && jobMatches.length > 0 && <p className="text-[15px] text-amber-800">Job limit reached. Remove a job to add another.</p>}
          {canAddJob && jobMatches.length > 0 && (
            <div role="group" aria-label="Jobs" className="space-y-1.5">
              <p className="text-[14px] font-semibold uppercase tracking-wide text-[#4a5260]">Jobs</p>
              {jobMatches.map((row) => {
                index++;
                const i = index;
                const item = jobItemLabel(row);
                return (
                  <div
                    key={`j${row.reference_id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    aria-label={`#${row.reference_id} ${item} · ${row.customer_name ?? ""} · ${row.status}`}
                    tabIndex={-1}
                    className={rowClass(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose({ kind: "job", row })}
                  >
                    <span className="min-w-0">
                      <b className="block">
                        <span className="text-[#135f6f]">#{row.reference_id}</span> {item}
                      </b>
                      <small className="block text-[15px] text-[#4a5260]">
                        {row.customer_name || "No customer"} · {row.status}
                      </small>
                    </span>
                    <span className="flex-none text-[14px] font-semibold text-[#4a5260]">+ Job</span>
                  </div>
                );
              })}
            </div>
          )}
          {loading && (
            <p role="status" className="text-[15px] text-[#4a5260]">
              Searching…
            </p>
          )}
          {error && (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[15px] text-red-700">
              {error}
              <button type="button" className={LINK_BUTTON} onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
            </p>
          )}
          {!loading && !error && options.length === 0 && jobs !== null && <p className="text-[16px] text-[#4a5260]">No match.</p>}
        </div>
      )}
    </div>
  );
}

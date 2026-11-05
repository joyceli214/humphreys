import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { apiClient } from "@/lib/api/client";
import type { AISearchFilters, AISearchRow } from "@/lib/ai-tools/types";
import { emailJobQuery } from "@/lib/ai-tools/email-job-query";
import { equipmentLabel } from "@/lib/ai-tools/email-selection";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onInputChange?: () => void;
  disabled?: boolean;
  /** Local preview can supply example results without contacting the portal. */
  searchJobs?: (filters: AISearchFilters) => Promise<AISearchRow[]>;
};

const idsFrom = (value: string) => value.split(/[\s,]+/).filter((part) => /^\d+$/.test(part));

/** Search by customer or job number while keeping only selected job IDs in the instruction. */
export function MassUpdateJobSearch({ value, onChange, onInputChange, disabled = false, searchJobs }: Props) {
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [rows, setRows] = useState<AISearchRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const requestId = useRef(0);
  const parsed = emailJobQuery(query);
  const searchKey = parsed ? JSON.stringify(parsed.filters) : "";
  const ids = idsFrom(value);

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    const id = ++requestId.current;
    if (!open || !searchKey) {
      setRows(null);
      setLoading(false);
      setError("");
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const filters = JSON.parse(searchKey) as AISearchFilters;
        const result = searchJobs ? await searchJobs(filters) : (await apiClient.runAISearch(filters)).rows;
        if (id !== requestId.current) return;
        setRows(result);
        setActive(-1);
      } catch (err) {
        if (id !== requestId.current) return;
        setRows(null);
        setError(errorMessage(err, "Search failed."));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, searchJobs, searchKey]);

  const choose = (row: AISearchRow) => {
    const id = String(row.reference_id);
    if (ids.includes(id)) return;
    const next = [...ids, id].join(", ");
    onChange(next);
    setQuery(next);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setQuery(value);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!rows?.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i < 0 && step < 0 ? rows.length - 1 : (i + step + rows.length) % rows.length));
    } else if (event.key === "Enter" && active >= 0 && rows?.[active]) {
      event.preventDefault();
      choose(rows[active]);
    }
  };

  const showList = open && parsed !== null;
  return (
    <div className="relative min-w-48 max-w-full flex-1">
      <input
        type="text"
        role="combobox"
        aria-label="Jobs"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        maxLength={200}
        value={query}
        disabled={disabled}
        placeholder="Job # or customer name"
        className="h-8 w-full rounded-md border border-[#ddd5cc] bg-white px-2 text-sm text-neutral-800 outline-none focus:border-[#c2571a] focus:ring-1 focus:ring-[#c2571a] disabled:opacity-60"
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setQuery(value); }}
        onChange={(event) => {
          const text = event.target.value;
          onInputChange?.();
          setQuery(text);
          setOpen(true);
          setActive(-1);
          if (/^[\d\s,#]*$/.test(text)) onChange(text.replace(/#/g, ""));
        }}
        onKeyDown={onKeyDown}
      />
      {ids.length > 0 && <p className="mt-1 text-[11px] text-neutral-500">Selected: {ids.map((id) => `#${id}`).join(", ")}</p>}
      {showList && (
        <div className="absolute z-30 mt-1 w-full min-w-64 overflow-hidden rounded-md border border-[#ddd5cc] bg-white shadow-lg">
          {parsed.shortDigits && <p className="px-3 py-1.5 text-xs text-neutral-500">Type at least 3 digits to narrow it down.</p>}
          {loading && <p className="px-3 py-1.5 text-xs text-neutral-500">Searching...</p>}
          {error && <p className="px-3 py-1.5 text-xs text-red-700">{error}</p>}
          {!loading && !error && rows?.length === 0 && <p className="px-3 py-1.5 text-xs text-neutral-500">No matching jobs.</p>}
          <ul id={listId} role="listbox" aria-label="Matching jobs" className="max-h-64 overflow-auto">
            {(rows ?? []).map((row, index) => {
              const picked = ids.includes(String(row.reference_id));
              const equipment = equipmentLabel(row);
              return (
                <li
                  key={row.reference_id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={picked}
                  aria-label={`#${row.reference_id} ${row.customer_name} ${equipment} ${row.status_name}${picked ? " (added)" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(row)}
                  className={cn("flex cursor-pointer items-center gap-2 border-t border-[#efeae4] px-3 py-1.5 text-xs first:border-t-0", index === active && "bg-[#f6e3d6]", picked && "cursor-default opacity-60")}
                >
                  <span className="font-semibold">#{row.reference_id}</span>
                  <span className="min-w-0 flex-1 truncate">{row.customer_name}{equipment && <span className="text-neutral-500"> · {equipment}</span>}</span>
                  <span className="text-neutral-500">{picked ? "Added" : row.status_name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

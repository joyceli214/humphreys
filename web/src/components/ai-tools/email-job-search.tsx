import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { apiClient } from "@/lib/api/client";
import type { AISearchRow } from "@/lib/ai-tools/types";
import { EMAIL_MAX_JOBS, equipmentLabel } from "@/lib/ai-tools/email-selection";
import { emailJobQuery } from "@/lib/ai-tools/email-job-query";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { cn } from "@/lib/utils";

export const EMAIL_SEARCH_DEBOUNCE_MS = 250;

type Props = {
  selectedIds: number[];
  canAddMore: boolean;
  onAdd: (row: AISearchRow) => void;
};

/**
 * Step 1: suggest-as-you-type search for customer name or job #. Uses the
 * owner-only Advanced Search endpoint and renders display fields only (job #,
 * customer name, equipment, status) — never email or phone.
 */
export function EmailJobSearch({ selectedIds, canAddMore, onAdd }: Props) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AISearchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const requestId = useRef(0);

  const parsed = emailJobQuery(query);
  const searchKey = parsed ? JSON.stringify(parsed.filters) : "";

  useEffect(() => {
    const id = ++requestId.current; // invalidates any in-flight request
    if (!searchKey) {
      setRows(null);
      setLoading(false);
      setError("");
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiClient.runAISearch(JSON.parse(searchKey));
        if (id !== requestId.current) return;
        setRows(res.rows);
        setActive(-1);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(errorMessage(err, "Search failed."));
        setRows(null);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, EMAIL_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchKey]);

  const canPick = (row: AISearchRow) => canAddMore && !selectedIds.includes(row.reference_id);
  const pick = (row: AISearchRow) => {
    if (canPick(row)) onAdd(row);
  };

  const showList = open && parsed !== null;
  const list = rows ?? [];
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (list.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i < 0 && step < 0 ? list.length - 1 : (i + step + list.length) % list.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (showList && active >= 0 && list[active]) pick(list[active]);
    }
  };

  return (
    <div className="relative">
      <label htmlFor="ai-email-search" className="sr-only">
        Search by customer name or job #
      </label>
      <input
        id="ai-email-search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        maxLength={200}
        className="h-9 w-full rounded-md border border-[#ddd5cc] bg-white px-3 text-sm outline-none focus:ring-1 focus:ring-[#c2571a]"
        placeholder="Start typing a customer name or job #"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-[#ddd5cc] bg-white shadow-lg">
          {parsed.shortDigits && <p className="px-3 py-1.5 text-xs text-neutral-500">Type at least 3 digits to narrow it down.</p>}
          {!canAddMore && (
            <p className="px-3 py-1.5 text-xs text-amber-700">
              You&apos;ve reached the {EMAIL_MAX_JOBS}-job limit. Remove a job to add another.
            </p>
          )}
          {loading && <p className="px-3 py-1.5 text-xs text-neutral-500">Searching...</p>}
          {error && <p className="px-3 py-1.5 text-xs text-red-700">{error}</p>}
          {!loading && !error && rows && rows.length === 0 && <p className="px-3 py-1.5 text-sm text-neutral-500">No matching jobs.</p>}
          <ul id={listId} role="listbox" aria-label="Matching jobs" className="max-h-64 overflow-auto">
            {list.map((row, i) => {
              const picked = selectedIds.includes(row.reference_id);
              const equipment = equipmentLabel(row);
              return (
                <li
                  key={row.reference_id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={!canPick(row)}
                  aria-label={`#${row.reference_id} ${row.customer_name} ${equipment} ${row.status_name}${picked ? " (added)" : ""}`}
                  // Keep focus in the input so blur doesn't close the list before the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(row)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 border-t border-[#efeae4] px-3 py-1.5 text-sm first:border-t-0",
                    i === active && "bg-[#f6e3d6]",
                    !canPick(row) && "cursor-default opacity-60"
                  )}
                >
                  <span className="font-semibold">#{row.reference_id}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {row.customer_name}
                    {equipment && <span className="text-neutral-500"> · {equipment}</span>}
                  </span>
                  <span className="text-xs text-neutral-500">{picked ? "Added" : row.status_name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

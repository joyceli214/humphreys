import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { WorkOrderListItem } from "@/lib/api/generated/types";
import { AI_TEXTAREA_CLASS } from "@/components/ai-tools/ai-ui";

export type PickedJob = {
  referenceId: number;
  label: string;
  /** Only used to show a masked "To:" hint locally; never sent to the AI. */
  customerEmail?: string | null;
};

export function jobOptionLabel(item: Pick<WorkOrderListItem, "reference_id" | "customer_name" | "item_name" | "brand_names" | "model_number">) {
  const equipment = [item.brand_names?.join(" "), item.model_number || item.item_name].filter((part) => part && part.trim()).join(" ");
  return [`#${item.reference_id}`, item.customer_name, equipment].filter((part) => part && part.trim()).join(" – ");
}

/** Search jobs by job number, customer or equipment (uses the work order list search). */
export function JobPicker({ value, onChange, disabled }: { value: PickedJob | null; onChange: (job: PickedJob | null) => void; disabled?: boolean }) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [options, setOptions] = useState<WorkOrderListItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    setQuery(value?.label ?? "");
  }, [value?.referenceId, value?.label]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim().replace(/^#/, "");
    if (!q || q === value?.label) {
      setOptions([]);
      return;
    }
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q, page: "1", page_size: "8" });
        const res = await apiClient.listWorkOrders(params);
        if (requestId === requestRef.current) setOptions(res.items);
      } catch {
        if (requestId === requestRef.current) setOptions([]);
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, query, value?.label]);

  const choose = (item: WorkOrderListItem) => {
    onChange({ referenceId: item.reference_id, label: jobOptionLabel(item), customerEmail: item.customer_email });
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        id="ai-email-job"
        type="text"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls="ai-email-job-options"
        autoComplete="off"
        placeholder="Search by job number, customer or equipment"
        className={`${AI_TEXTAREA_CLASS} h-9`}
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
      />
      {open && (loading || options.length > 0) && (
        <ul
          id="ai-email-job-options"
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-[#e8e2db] bg-white py-1 text-sm shadow-lg"
        >
          {loading && options.length === 0 && <li className="px-3 py-2 text-neutral-500">Searching...</li>}
          {options.map((item) => (
            <li
              key={item.reference_id}
              role="option"
              aria-selected={value?.referenceId === item.reference_id}
              className="cursor-pointer px-3 py-2 hover:bg-[#f6f2ee]"
              onMouseDown={(event) => {
                event.preventDefault();
                choose(item);
              }}
            >
              {jobOptionLabel(item)}
              {item.status && <span className="ml-2 text-xs text-neutral-500">{item.status}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

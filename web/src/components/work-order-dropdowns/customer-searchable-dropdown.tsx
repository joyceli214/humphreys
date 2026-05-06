"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatPhoneNumber } from "@/lib/phone";
import type { CustomerLookupOption } from "@/lib/api/generated/types";

function formatCustomerLabel(label: string) {
  return label.replace(/\((\d+)\)/g, (_, digits: string) => {
    const formatted = formatPhoneNumber(digits);
    return formatted || `(${digits})`;
  });
}

export function CustomerSearchableDropdown({
  label,
  value,
  valueLabel,
  onChange,
  loadOptions,
  onAddNew,
  placeholder,
  allowAddNew = true,
  allowClear = false
}: {
  label?: string;
  value: number | null;
  valueLabel?: string;
  onChange: (option: CustomerLookupOption | null) => void;
  loadOptions: (query: string) => Promise<CustomerLookupOption[]>;
  onAddNew?: (seed: string) => void;
  placeholder: string;
  allowAddNew?: boolean;
  allowClear?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CustomerLookupOption[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadOptions(query).then((items) => {
        if (!cancelled) setOptions(items);
      });
    }, 500);
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [loadOptions, open, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (options.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(0);
  }, [open, options, query]);

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? options.length - 1 : prev - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = options[highlightedIndex] ?? options[0];
      if (!target) return;
      onChange(target);
      setOpen(false);
    }
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(0);
      } else if (options.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % options.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(Math.max(options.length - 1, 0));
      } else if (options.length > 0) {
        setHighlightedIndex((prev) => (prev <= 0 ? options.length - 1 : prev - 1));
      }
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const target = options[highlightedIndex] ?? options[0];
      if (!target) return;
      onChange(target);
      setOpen(false);
    }
  };

  const selected = options.find((item) => item.id === value);
  const selectedLabel = selected?.label ?? valueLabel ?? "";

  return (
    <div ref={rootRef} className="space-y-1">
      {label && <label className="block text-sm text-muted-foreground">{label}</label>}
      <div className="relative">
        <button
          type="button"
          className="flex h-10 w-full items-center rounded-md border border-input bg-white px-3 py-2 pr-10 text-sm"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="truncate text-left">{selectedLabel ? formatCustomerLabel(selectedLabel) : placeholder}</span>
        </button>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">▾</span>
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-white p-2 shadow-lg">
            <div className="relative">
              <Input ref={searchInputRef} className="pr-8" placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKeyDown} />
              {query.length > 0 && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="Clear customer search"
                >
                  ×
                </button>
              )}
            </div>
            <div className="mt-2 max-h-52 overflow-auto space-y-1">
              {allowClear && (
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  Any
                </button>
              )}
              {options.length === 0 && <p className="rounded px-2 py-1 text-sm text-muted-foreground">No customers found.</p>}
              {options.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${highlightedIndex === index ? "bg-muted" : ""}`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                >
                  {formatCustomerLabel(option.label)}
                </button>
              ))}
              {allowAddNew && onAddNew && (
                <button
                  type="button"
                  className="w-full rounded border border-dashed border-border px-2 py-1 text-left text-sm text-primary hover:bg-muted"
                  onClick={() => {
                    onAddNew(query.trim());
                    setOpen(false);
                  }}
                >
                  + Add new customer
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

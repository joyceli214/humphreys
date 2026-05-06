"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { useAlerts } from "@/lib/alerts/alert-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LookupOption } from "@/lib/api/generated/types";

export function MultiSearchableDropdown({
  label,
  values,
  valueLabels,
  onChange,
  loadOptions,
  placeholder,
  onAddNew,
  searchable = true
}: {
  label: string;
  values: number[];
  valueLabels: string[];
  onChange: (values: number[]) => void;
  loadOptions: (query: string) => Promise<LookupOption[]>;
  placeholder: string;
  onAddNew?: (label: string) => Promise<LookupOption>;
  searchable?: boolean;
}) {
  const alerts = useAlerts();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadOptions(query).then((items) => {
      if (!cancelled) setOptions(items);
    });
    return () => {
      cancelled = true;
    };
  }, [loadOptions, open, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !searchable) return;
    searchInputRef.current?.focus();
  }, [open, searchable]);

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
      if (!values.includes(target.id)) {
        onChange([...values, target.id]);
      }
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
      if (!values.includes(target.id)) {
        onChange([...values, target.id]);
      }
      setOpen(false);
    }
  };

  const labelsByID = new Map(options.map((item) => [item.id, item.label]));
  const selectedLabels = values
    .map((id) => labelsByID.get(id))
    .filter(Boolean) as string[];
  const fallback = valueLabels.slice(0, 3).join(", ");
  const buttonText = selectedLabels.length > 0 ? selectedLabels.join(", ") : fallback || placeholder;

  return (
    <div ref={rootRef} className="space-y-1">
      <label className="block text-sm text-muted-foreground">{label}</label>
      <div className="relative">
        <button
          type="button"
          className="flex h-10 w-full items-center rounded-md border border-input bg-white px-3 py-2 pr-10 text-sm"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="truncate text-left">{buttonText}</span>
        </button>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">▾</span>
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-white p-2 shadow-lg">
            {searchable && (
              <div className="relative">
                <Input ref={searchInputRef} className="pr-8" placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKeyDown} />
                {query.length > 0 && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => setQuery("")}
                    aria-label={`Clear ${label} search`}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
            <div className="mt-2 max-h-56 overflow-auto space-y-1">
              {options.map((option, index) => {
                const checked = values.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={cn("flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted", highlightedIndex === index && "bg-muted")}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onChange([...values, option.id]);
                        } else {
                          onChange(values.filter((v) => v !== option.id));
                        }
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
              {!adding && onAddNew && (
                <button
                  type="button"
                  className="w-full rounded border border-dashed border-border px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => setAdding(true)}
                >
                  + Add new...
                </button>
              )}
              {adding && onAddNew && (
                <div className="p-0">
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      className="focus-visible:ring-0 focus-visible:ring-transparent"
                      placeholder={`New ${label.toLowerCase()}`}
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdding(false);
                        setNewValue("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={async () => {
                        const value = newValue.trim();
                        if (!value) return;
                        try {
                          const created = await onAddNew(value);
                          if (!values.includes(created.id)) {
                            onChange([...values, created.id]);
                          }
                          setAdding(false);
                          setNewValue("");
                          alerts.success(`${label} added`);
                        } catch (err) {
                          alerts.error(`Failed to add ${label.toLowerCase()}`, err instanceof Error ? err.message : "Request failed");
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

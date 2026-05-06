"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { useAlerts } from "@/lib/alerts/alert-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LookupOption } from "@/lib/api/generated/types";

export function SingleSearchableDropdown({
  label,
  value,
  valueLabel,
  onChange,
  loadOptions,
  placeholder,
  onAddNew,
  onAddLocation,
  onAddOther,
  searchable = true,
  allowClear = false,
  clearLabel = "Any",
  disabled = false,
  className
}: {
  label?: string;
  value: number | null;
  valueLabel?: string;
  onChange: (value: number | null) => void;
  loadOptions: (query: string) => Promise<LookupOption[]>;
  placeholder: string;
  onAddNew?: (label: string) => Promise<LookupOption>;
  onAddLocation?: (payload: { shelf: string; floor: number }) => Promise<LookupOption>;
  onAddOther?: (label: string) => void;
  searchable?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const alerts = useAlerts();
  const labelText = label ?? "item";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addingOther, setAddingOther] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [otherValue, setOtherValue] = useState("");
  const [newShelf, setNewShelf] = useState("");
  const [newFloor, setNewFloor] = useState("0");

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
        setAddingOther(false);
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
      onChange(target.id);
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
      onChange(target.id);
      setOpen(false);
    }
  };

  const selected = options.find((item) => item.id === value);
  const selectedLabel = selected?.label ?? valueLabel ?? "";

  return (
    <div ref={rootRef} className={cn("space-y-1", className)}>
      {label && <label className="block text-sm text-muted-foreground">{label}</label>}
      <div className="relative">
        <button
          type="button"
          className={cn(
            "flex h-10 w-full items-center rounded-md border border-input bg-white px-3 py-2 pr-10 text-sm",
            disabled && "cursor-not-allowed opacity-60"
          )}
          onClick={() => {
            if (disabled) return;
            setOpen((v) => !v);
          }}
          onKeyDown={onTriggerKeyDown}
          disabled={disabled}
        >
          <span className="truncate text-left">{selectedLabel || placeholder}</span>
        </button>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">▾</span>
        {open && !disabled && (
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
                  {clearLabel}
                </button>
              )}
              {options.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  className={cn("w-full rounded px-2 py-1 text-left text-sm hover:bg-muted", highlightedIndex === index && "bg-muted")}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              ))}
              {!adding && !addingOther && onAddOther && (
                <button
                  type="button"
                  className="w-full rounded border border-dashed border-border px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    setAddingOther(true);
                    setAdding(false);
                  }}
                >
                  + Other...
                </button>
              )}
              {!adding && !addingOther && (onAddNew || onAddLocation) && (
                <button
                  type="button"
                  className="w-full rounded border border-dashed border-border px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    setAdding(true);
                    setAddingOther(false);
                  }}
                >
                  + Add new...
                </button>
              )}
              {adding && onAddLocation && (
                <div className="p-0 space-y-2">
                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <Input placeholder="Shelf" value={newShelf} onChange={(e) => setNewShelf(e.target.value)} />
                    <Input placeholder="Floor" type="number" min={0} value={newFloor} onChange={(e) => setNewFloor(e.target.value)} />
                  </div>
                  <p className="text-right text-xs text-muted-foreground">Input 0 for floor</p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdding(false);
                        setNewShelf("");
                        setNewFloor("0");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={async () => {
                        const shelf = newShelf.trim();
                        const floor = Number(newFloor.trim());
                        if (!shelf) {
                          alerts.error("Shelf required", "Enter a shelf value.");
                          return;
                        }
                        if (!Number.isInteger(floor) || floor < 0) {
                          alerts.error("Invalid floor", "Floor must be a whole number zero or greater.");
                          return;
                        }
                        try {
                          const created = await onAddLocation({ shelf, floor });
                          onChange(created.id);
                          setAdding(false);
                          setNewShelf("");
                          setNewFloor("0");
                          setOpen(false);
                          alerts.success(`${labelText} added`);
                        } catch (err) {
                          alerts.error(`Failed to add ${labelText.toLowerCase()}`, err instanceof Error ? err.message : "Request failed");
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}
              {adding && onAddNew && !onAddLocation && (
                <div className="p-0">
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      className="focus-visible:ring-0 focus-visible:ring-transparent"
                      placeholder={`New ${labelText.toLowerCase()}`}
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
                          setOptions((prev) => (prev.some((option) => option.id === created.id) ? prev : [created, ...prev]));
                          onChange(created.id);
                          setAdding(false);
                          setNewValue("");
                          setOpen(false);
                          alerts.success(`${labelText} added`);
                        } catch (err) {
                          alerts.error(`Failed to add ${labelText.toLowerCase()}`, err instanceof Error ? err.message : "Request failed");
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}
              {addingOther && onAddOther && (
                <div className="p-0">
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      className="focus-visible:ring-0 focus-visible:ring-transparent"
                      placeholder={`Other ${labelText.toLowerCase()}`}
                      value={otherValue}
                      onChange={(e) => setOtherValue(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddingOther(false);
                        setOtherValue("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const value = otherValue.trim();
                        if (!value) return;
                        onAddOther(value);
                        setAddingOther(false);
                        setOtherValue("");
                        setOpen(false);
                      }}
                    >
                      OK
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

"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "@/lib/api/client";
import type { CustomerLookupOption, LookupOption, WorkOrderListItem } from "@/lib/api/generated/types";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { useAlerts } from "@/lib/alerts/alert-context";
import { cn } from "@/lib/utils";
import { formatPhoneNumber, phoneDigits } from "@/lib/phone";

function parseLocalDate(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const monthIndex = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    return new Date(year, monthIndex, day);
  }

  const dateTime =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+\-]\d{2}:?\d{2})?$/.exec(value);
  if (dateTime) {
    const year = Number(dateTime[1]);
    const monthIndex = Number(dateTime[2]) - 1;
    const day = Number(dateTime[3]);
    const hour = Number(dateTime[4]);
    const minute = Number(dateTime[5]);
    const second = Number(dateTime[6] ?? "0");
    const millisecond = Number((dateTime[7] ?? "0").padEnd(3, "0"));
    return new Date(year, monthIndex, day, hour, minute, second, millisecond);
  }

  return new Date(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = parseLocalDate(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(date);
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "finished") return "bg-emerald-100 text-emerald-700";
  if (normalized === "received") return "bg-amber-100 text-amber-700";
  if (normalized === "picked up") return "bg-sky-100 text-sky-700";
  return "bg-muted text-muted-foreground";
}

function formatLocationValue(locationID: number | null, locationShelf: string | null, locationFloor: number | null) {
  if (locationID == null && !locationShelf && locationFloor == null) return "-";
  const shelf = locationShelf?.trim() ? locationShelf : "-";
  const floor = locationFloor == null ? "-" : locationFloor === 0 ? "FLOOR" : String(locationFloor);
  return `${shelf}-${floor}`;
}

function parseNonNegativeInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseCustomerLabel(label: string): { name: string; email: string; phone: string } {
  const trimmed = label.trim();
  if (!trimmed) return { name: "", email: "", phone: "" };

  let email = "";
  const emailMatch = trimmed.match(/-\s*([^\s]+@[^\s]+)$/);
  if (emailMatch) {
    email = emailMatch[1];
  }

  let phone = "";
  const phoneMatch = trimmed.match(/\(([^)]+)\)/);
  if (phoneMatch) {
    phone = phoneMatch[1].trim();
  }

  const name = trimmed
    .replace(/\s*-\s*[^\s]+@[^\s]+$/, "")
    .replace(/\s*\([^)]+\)\s*/, " ")
    .trim();

  return { name, email, phone };
}

function formatCustomerLabel(label: string) {
  return label.replace(/\((\d+)\)/g, (_, digits: string) => {
    const formatted = formatPhoneNumber(digits);
    return formatted || `(${digits})`;
  });
}

type WorkOrderListFilters = {
  customerId: number | null;
  statusId: number | null;
  jobTypeId: number | null;
  itemId: number | null;
  createdFrom: string;
  createdTo: string;
};

function parsePositiveIntParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function CustomerSearchableDropdown({
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

function SingleSearchableDropdown({
  label,
  value,
  valueLabel,
  onChange,
  loadOptions,
  placeholder,
  onAddNew,
  onAddLocation,
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
  const [newValue, setNewValue] = useState("");
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
          onKeyDown={(event) => {
            if (disabled) return;
            onTriggerKeyDown(event);
          }}
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
              {!adding && (onAddNew || onAddLocation) && (
                <button
                  type="button"
                  className="w-full rounded border border-dashed border-border px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => setAdding(true)}
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MultiSearchableDropdown({
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

export default function WorkOrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const alerts = useAlerts();
  const canViewSensitive = hasPermission("work_orders_sensitive:read");
  const canCreateWorkOrders = hasPermission("work_orders:create");
  const canUpdateWorkOrders = hasPermission("work_orders:update");
  const initialQuery = searchParams.get("q")?.trim() ?? "";
  const initialFilters: WorkOrderListFilters = {
    customerId: parsePositiveIntParam(searchParams.get("customer_id")),
    statusId: parsePositiveIntParam(searchParams.get("status_id")),
    jobTypeId: parsePositiveIntParam(searchParams.get("job_type_id")),
    itemId: parsePositiveIntParam(searchParams.get("item_id")),
    createdFrom: searchParams.get("created_from")?.trim() ?? "",
    createdTo: searchParams.get("created_to")?.trim() ?? ""
  };
  const hasInitialAdvancedFilters =
    initialFilters.statusId !== null ||
    initialFilters.jobTypeId !== null ||
    initialFilters.itemId !== null ||
    initialFilters.createdFrom.length > 0 ||
    initialFilters.createdTo.length > 0;
  const [items, setItems] = useState<WorkOrderListItem[]>([]);
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [customerFilterInputId, setCustomerFilterInputId] = useState<number | null>(initialFilters.customerId);
  const [customerFilterInputLabel, setCustomerFilterInputLabel] = useState("");
  const [statusFilterInputId, setStatusFilterInputId] = useState<number | null>(initialFilters.statusId);
  const [jobTypeFilterInputId, setJobTypeFilterInputId] = useState<number | null>(initialFilters.jobTypeId);
  const [itemFilterInputId, setItemFilterInputId] = useState<number | null>(initialFilters.itemId);
  const [createdFromInput, setCreatedFromInput] = useState(initialFilters.createdFrom);
  const [createdToInput, setCreatedToInput] = useState(initialFilters.createdTo);
  const [filters, setFilters] = useState<WorkOrderListFilters>(initialFilters);
  const [customerFilterLabel, setCustomerFilterLabel] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(hasInitialAdvancedFilters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(loading);
  const loadingMoreRef = useRef(loadingMore);
  const hasMoreRef = useRef(hasMore);
  const pageRef = useRef(page);
  const queryRef = useRef(query);
  const filtersRef = useRef(filters);
  const waitForSentinelExitRef = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationMode, setCreationMode] = useState<"new_job" | "stock">("new_job");
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerHomePhone, setNewCustomerHomePhone] = useState("");
  const [newCustomerWorkPhone, setNewCustomerWorkPhone] = useState("");
  const [newCustomerExtension, setNewCustomerExtension] = useState("");
  const [newCustomerAddress1, setNewCustomerAddress1] = useState("");
  const [newCustomerAddress2, setNewCustomerAddress2] = useState("");
  const [newCustomerCity, setNewCustomerCity] = useState("");
  const [newCustomerProvince, setNewCustomerProvince] = useState("");
  const [remoteControlQty, setRemoteControlQty] = useState("0");
  const [cableQty, setCableQty] = useState("0");
  const [cordQty, setCordQty] = useState("0");
  const [dvdVhsQty, setDvdVhsQty] = useState("0");
  const [albumCdCassetteQty, setAlbumCdCassetteQty] = useState("0");
  const [deposit, setDeposit] = useState("0");
  const [itemId, setItemId] = useState<number | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [brandIds, setBrandIds] = useState<number[]>([]);
  const [modelNumber, setModelNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<LookupOption[]>([]);
  const [frozenDropdowns, setFrozenDropdowns] = useState<Record<string, boolean>>({});
  const [updatingLocationByReferenceID, setUpdatingLocationByReferenceID] = useState<Record<number, boolean>>({});
  const [depositPaymentMethodId, setDepositPaymentMethodId] = useState("");
  const pageSize = 100;
  const toListSearch = (nextQuery: string, nextFilters: WorkOrderListFilters) => {
    const params = new URLSearchParams();
    const trimmedQuery = nextQuery.trim();
    if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }
    if (nextFilters.customerId) params.set("customer_id", String(nextFilters.customerId));
    if (nextFilters.statusId) params.set("status_id", String(nextFilters.statusId));
    if (nextFilters.jobTypeId) params.set("job_type_id", String(nextFilters.jobTypeId));
    if (nextFilters.itemId) params.set("item_id", String(nextFilters.itemId));
    if (nextFilters.createdFrom.trim()) params.set("created_from", nextFilters.createdFrom.trim());
    if (nextFilters.createdTo.trim()) params.set("created_to", nextFilters.createdTo.trim());
    return params;
  };

  const fetchPage = async (nextPage: number, nextQuery: string, nextFilters: WorkOrderListFilters) => {
    const params = toListSearch(nextQuery, nextFilters);
    params.set("page", String(nextPage));
    params.set("page_size", String(pageSize));
    const res = await apiClient.listWorkOrders(params);
    return res.items;
  };

  const loadInitial = async (nextQuery: string, nextFilters: WorkOrderListFilters) => {
    setLoading(true);
    setLoadingMore(false);
    waitForSentinelExitRef.current = false;
    try {
      const pageItems = await fetchPage(1, nextQuery, nextFilters);
      setItems(pageItems);
      setPage(1);
      setHasMore(pageItems.length === pageSize);
    } catch (err) {
      alerts.error("Failed to load work orders", err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) return;
    const nextPage = pageRef.current + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const pageItems = await fetchPage(nextPage, queryRef.current, filtersRef.current);
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.reference_id));
        const uniqueAdds = pageItems.filter((item) => !seen.has(item.reference_id));
        return [...prev, ...uniqueAdds];
      });
      setPage(nextPage);
      setHasMore(pageItems.length === pageSize);
      setSearchParams(toListSearch(queryRef.current, filtersRef.current));
      waitForSentinelExitRef.current = true;
    } catch (err) {
      alerts.error("Failed to load more work orders", err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  };

  useEffect(() => {
    if (!hasPermission("work_orders:read")) return;
    loadInitial(initialQuery, initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore || items.length === 0) return;
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first) return;
        if (!first.isIntersecting) {
          waitForSentinelExitRef.current = false;
          return;
        }
        if (!waitForSentinelExitRef.current) {
          void loadMore();
        }
      },
      { rootMargin: "0px", threshold: 1 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, items.length, loading, loadingMore, page, query]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    if (!hasPermission("work_orders:read")) return;
    apiClient
      .listDropdownManagement()
      .then((res) => {
        const next: Record<string, boolean> = {};
        for (const entry of res.items) {
          next[entry.key] = entry.is_frozen;
        }
        setFrozenDropdowns(next);
      })
      .catch((err) => {
        alerts.error("Failed to load dropdown settings", err instanceof Error ? err.message : "Request failed");
      });
  }, [alerts, hasPermission]);

  useEffect(() => {
    if (!createOpen || !canCreateWorkOrders) return;
    apiClient
      .listPaymentMethods("")
      .then((paymentRes) => {
        setPaymentMethods(paymentRes.items);
      })
      .catch((err) => {
        alerts.error("Failed to load create form options", err instanceof Error ? err.message : "Request failed");
      });
  }, [alerts, canCreateWorkOrders, createOpen]);

  const isDropdownFrozen = (key: string) => frozenDropdowns[key] === true;

  const updateLocationFromList = async (row: WorkOrderListItem, nextLocationID: number | null) => {
    if (row.location_id === nextLocationID) return;
    if (updatingLocationByReferenceID[row.reference_id] === true) return;
    setUpdatingLocationByReferenceID((prev) => ({ ...prev, [row.reference_id]: true }));
    try {
      const detail = await apiClient.getWorkOrderDetail(row.reference_id);
      const updated = await apiClient.updateWorkOrderEquipment(row.reference_id, {
        model_number: detail.model_number,
        serial_number: detail.serial_number,
        other_remarks: detail.other_remarks,
        status_id: detail.status_id,
        job_type_id: detail.job_type_id,
        location_id: nextLocationID,
        item_id: detail.item_id,
        brand_ids: detail.brand_ids,
        remote_control_qty: detail.remote_control_qty,
        cable_qty: detail.cable_qty,
        cord_qty: detail.cord_qty,
        dvd_vhs_qty: detail.dvd_vhs_qty,
        album_cd_cassette_qty: detail.album_cd_cassette_qty
      });
      setItems((prev) =>
        prev.map((item) =>
          item.reference_id === row.reference_id
            ? {
                ...item,
                location_id: updated.location_id,
                location_shelf: updated.location_shelf,
                location_floor: updated.location_floor
              }
            : item
        )
      );
      alerts.success(`Location updated for #${row.reference_id}`);
    } catch (err) {
      alerts.error("Failed to update location", err instanceof Error ? err.message : "Request failed");
    } finally {
      setUpdatingLocationByReferenceID((prev) => ({ ...prev, [row.reference_id]: false }));
    }
  };

  const resetCreateForm = () => {
    setCreationMode("new_job");
    setCustomerMode("existing");
    setSelectedCustomerId(null);
    setSelectedCustomerLabel("");
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerHomePhone("");
    setNewCustomerWorkPhone("");
    setNewCustomerExtension("");
    setNewCustomerAddress1("");
    setNewCustomerAddress2("");
    setNewCustomerCity("");
    setNewCustomerProvince("");
    setRemoteControlQty("0");
    setCableQty("0");
    setCordQty("0");
    setDvdVhsQty("0");
    setAlbumCdCassetteQty("0");
    setDeposit("0");
    setItemId(null);
    setLocationId(null);
    setBrandIds([]);
    setModelNumber("");
    setSerialNumber("");
    setDepositPaymentMethodId("");
  };

  const clearCustomerFields = () => {
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerHomePhone("");
    setNewCustomerWorkPhone("");
    setNewCustomerExtension("");
    setNewCustomerAddress1("");
    setNewCustomerAddress2("");
    setNewCustomerCity("");
    setNewCustomerProvince("");
  };

  const openCreateModal = (mode: "new_job" | "stock") => {
    resetCreateForm();
    setCreationMode(mode);
    if (mode === "new_job") {
      setCustomerMode("existing");
    } else {
      setCustomerMode("new");
    }
    setCreateOpen(true);
  };

  useEffect(() => {
    if (!canCreateWorkOrders) return;
    const createParam = searchParams.get("create");
    if (createParam !== "new_job" && createParam !== "stock") return;

    openCreateModal(createParam);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("create");
    setSearchParams(nextParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreateWorkOrders, searchParams, setSearchParams]);

  if (!hasPermission("work_orders:read")) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Work Orders</h1>
        {canCreateWorkOrders && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>Create New Work Order</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openCreateModal("new_job")}>Create New Job</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openCreateModal("stock")}>Create Stock</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {canViewSensitive
          ? "Browse imported service work orders and open full details."
          : "Browse work orders with a simplified, staff-safe view."}
      </p>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) resetCreateForm();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <div className="space-y-1">
            <DialogTitle className="text-lg font-semibold">Create New Work Order</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Admin only. {creationMode === "stock" ? "Creating stock job. Customer is not required." : "Use an existing customer or create a new one."}
            </DialogDescription>
          </div>
          <div className="space-y-4">
            {creationMode === "new_job" && (
            <div className="rounded-md border border-border p-3 space-y-3">
              <p className="text-sm font-medium">Customer</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={customerMode === "existing" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => setCustomerMode("existing")}
                >
                  Use Existing
                </Button>
                <Button
                  type="button"
                  variant={customerMode === "new" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => {
                    setCustomerMode("new");
                    setSelectedCustomerId(null);
                    setSelectedCustomerLabel("");
                    clearCustomerFields();
                  }}
                >
                  Create New
                </Button>
              </div>
              {customerMode === "existing" && (
                <div className="space-y-2">
                  <CustomerSearchableDropdown
                    value={selectedCustomerId}
                    valueLabel={selectedCustomerLabel}
                    placeholder="Search by name, phone, or email"
                    loadOptions={async (search) => (await apiClient.listWorkOrderCustomers(search)).items}
                    onChange={(option) => {
                      if (!option) {
                        setSelectedCustomerId(null);
                        setSelectedCustomerLabel("");
                        return;
                      }
                      setCustomerMode("existing");
                      setSelectedCustomerId(option.id);
                      setSelectedCustomerLabel(option.label);
                      const fallback = parseCustomerLabel(option.label);
                      const first = (option.first_name ?? "").trim();
                      const last = (option.last_name ?? "").trim();
                      const fullName = [first, last].filter(Boolean).join(" ");
                      const homePhone = option.home_phone ?? "";
                      const workPhone = option.work_phone ?? "";
                      setNewCustomerName(fullName || fallback.name);
                      setNewCustomerEmail(option.email ?? fallback.email);
                      setNewCustomerHomePhone(phoneDigits(homePhone || (!workPhone ? fallback.phone : "")));
                      setNewCustomerWorkPhone(phoneDigits(option.work_phone ?? ""));
                      setNewCustomerExtension(option.extension_text ?? "");
                      setNewCustomerAddress1(option.address_line_1 ?? "");
                      setNewCustomerAddress2(option.address_line_2 ?? "");
                      setNewCustomerCity(option.city ?? "");
                      setNewCustomerProvince(option.province ?? "");
                    }}
                    onAddNew={() => {
                      setCustomerMode("new");
                      setSelectedCustomerId(null);
                      setSelectedCustomerLabel("");
                      clearCustomerFields();
                    }}
                  />
                </div>
              )}
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-sm">Name *</label>
                    <Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Email</label>
                    <Input value={newCustomerEmail} onChange={(e) => setNewCustomerEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Home Phone *</label>
                    <Input
                      inputMode="tel"
                      placeholder="5551234567"
                      value={newCustomerHomePhone}
                      onChange={(e) => setNewCustomerHomePhone(phoneDigits(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Work Phone *</label>
                    <Input
                      inputMode="tel"
                      placeholder="5551234567"
                      value={newCustomerWorkPhone}
                      onChange={(e) => setNewCustomerWorkPhone(phoneDigits(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Extension</label>
                    <Input value={newCustomerExtension} onChange={(e) => setNewCustomerExtension(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Address Line 1</label>
                    <Input value={newCustomerAddress1} onChange={(e) => setNewCustomerAddress1(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Address Line 2</label>
                    <Input value={newCustomerAddress2} onChange={(e) => setNewCustomerAddress2(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">City</label>
                    <Input value={newCustomerCity} onChange={(e) => setNewCustomerCity(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Province</label>
                    <Input value={newCustomerProvince} onChange={(e) => setNewCustomerProvince(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
            )}

            <div className="rounded-md border border-border p-3 space-y-3">
              <p className="text-sm font-medium">Equipment</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <SingleSearchableDropdown
                  label="Location"
                  value={locationId}
                  onChange={setLocationId}
                  loadOptions={async (q) => (await apiClient.listLocations(q)).items}
                  placeholder="Select location"
                  onAddLocation={isDropdownFrozen("locations") ? undefined : (payload) => apiClient.createLocation(payload)}
                  allowClear
                  clearLabel="None"
                />
                <SingleSearchableDropdown
                  label="Item"
                  value={itemId}
                  onChange={setItemId}
                  loadOptions={async (q) => (await apiClient.listItems(q)).items}
                  placeholder="Select item"
                  onAddNew={isDropdownFrozen("items") ? undefined : (label) => apiClient.createItem(label)}
                />
                <MultiSearchableDropdown
                  label="Brands"
                  values={brandIds}
                  valueLabels={[]}
                  onChange={setBrandIds}
                  loadOptions={async (q) => (await apiClient.listBrands(q)).items}
                  placeholder="Select brands"
                  onAddNew={isDropdownFrozen("brands") ? undefined : (label) => apiClient.createBrand(label)}
                />
                <div className="space-y-1">
                  <label className="text-sm">Model Number</label>
                  <Input value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm">Serial Number</label>
                  <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border p-3 space-y-3">
              <p className="text-sm font-medium">Quantities</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-sm">Remote Controls</label>
                  <Input type="number" min={0} value={remoteControlQty} onChange={(e) => setRemoteControlQty(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm">Cables</label>
                  <Input type="number" min={0} value={cableQty} onChange={(e) => setCableQty(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm">Cords</label>
                  <Input type="number" min={0} value={cordQty} onChange={(e) => setCordQty(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm">DVD/VHS</label>
                  <Input type="number" min={0} value={dvdVhsQty} onChange={(e) => setDvdVhsQty(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm">Album/CD/Cassette</label>
                  <Input type="number" min={0} value={albumCdCassetteQty} onChange={(e) => setAlbumCdCassetteQty(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border p-3 space-y-3">
              <p className="text-sm font-medium">Deposit</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input placeholder="Deposit Amount" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
                <select
                  className="h-10 rounded-md border border-input bg-white px-3 py-2 text-sm"
                  value={depositPaymentMethodId}
                  onChange={(e) => setDepositPaymentMethodId(e.target.value)}
                >
                  <option value="">Select payment method</option>
                  {paymentMethods.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                disabled={creating}
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateForm();
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={creating}
                onClick={async () => {
                  if (creationMode === "new_job") {
                    if (customerMode === "existing" && !selectedCustomerId) {
                      alerts.error("Customer required", "Select an existing customer.");
                      return;
                    }
                    if (customerMode === "new") {
                      if (!newCustomerName.trim()) {
                        alerts.error("Customer name required", "Enter a customer name.");
                        return;
                      }
                      const home = newCustomerHomePhone.trim();
                      const work = newCustomerWorkPhone.trim();
                      if (!home && !work) {
                        alerts.error("Customer phone required", "Enter a home phone or work phone.");
                        return;
                      }
                      if (home && !/^\d+$/.test(home)) {
                        alerts.error("Invalid phone", "Home phone must contain digits only.");
                        return;
                      }
                      if (work && !/^\d+$/.test(work)) {
                        alerts.error("Invalid phone", "Work phone must contain digits only.");
                        return;
                      }
                    }
                  }

                  const parsedRemote = parseNonNegativeInt(remoteControlQty);
                  const parsedCable = parseNonNegativeInt(cableQty);
                  const parsedCord = parseNonNegativeInt(cordQty);
                  const parsedDVDVHS = parseNonNegativeInt(dvdVhsQty);
                  const parsedAlbum = parseNonNegativeInt(albumCdCassetteQty);
                  if (parsedRemote === null || parsedCable === null || parsedCord === null || parsedDVDVHS === null || parsedAlbum === null) {
                    alerts.error("Invalid quantities", "Quantities must be whole numbers zero or greater.");
                    return;
                  }

                  const parsedDeposit = Number(deposit.trim());
                  if (!Number.isFinite(parsedDeposit) || parsedDeposit < 0) {
                    alerts.error("Invalid deposit", "Deposit must be zero or greater.");
                    return;
                  }

                  const parsedDepositPaymentMethodID = Number(depositPaymentMethodId);
                  if (parsedDeposit > 0 && (!Number.isInteger(parsedDepositPaymentMethodID) || parsedDepositPaymentMethodID <= 0)) {
                    alerts.error("Payment method required", "Select a deposit payment method.");
                    return;
                  }
                  setCreating(true);
                  try {
                    const created = await apiClient.createWorkOrder({
                      creation_mode: creationMode,
                      customer_id: creationMode === "new_job" && customerMode === "existing" ? selectedCustomerId ?? undefined : undefined,
                      customer_updates:
                        creationMode === "new_job" && customerMode === "existing"
                          ? {
                              name: newCustomerName.trim() || undefined,
                              email: newCustomerEmail.trim() || undefined,
                              home_phone: newCustomerHomePhone.trim() || undefined,
                              work_phone: newCustomerWorkPhone.trim() || undefined,
                              extension_text: newCustomerExtension.trim() || undefined,
                              address_line_1: newCustomerAddress1.trim() || undefined,
                              address_line_2: newCustomerAddress2.trim() || undefined,
                              city: newCustomerCity.trim() || undefined,
                              province: newCustomerProvince.trim() || undefined
                            }
                          : undefined,
                      new_customer:
                        creationMode === "new_job" && customerMode === "new"
                          ? {
                              name: newCustomerName.trim(),
                              email: newCustomerEmail.trim() || undefined,
                              home_phone: newCustomerHomePhone.trim() || undefined,
                              work_phone: newCustomerWorkPhone.trim() || undefined,
                              extension_text: newCustomerExtension.trim() || undefined,
                              address_line_1: newCustomerAddress1.trim() || undefined,
                              address_line_2: newCustomerAddress2.trim() || undefined,
                              city: newCustomerCity.trim() || undefined,
                              province: newCustomerProvince.trim() || undefined
                            }
                          : undefined,
                      location_id: locationId ?? undefined,
                      item_id: itemId ?? undefined,
                      brand_ids: brandIds,
                      model_number: modelNumber.trim() || undefined,
                      serial_number: serialNumber.trim() || undefined,
                      remote_control_qty: parsedRemote,
                      cable_qty: parsedCable,
                      cord_qty: parsedCord,
                      dvd_vhs_qty: parsedDVDVHS,
                      album_cd_cassette_qty: parsedAlbum,
                      deposit: parsedDeposit,
                      deposit_payment_method_id:
                        parsedDeposit > 0 && Number.isInteger(parsedDepositPaymentMethodID) && parsedDepositPaymentMethodID > 0
                          ? parsedDepositPaymentMethodID
                          : undefined
                    });
                    alerts.success(`Work order #${created.reference_id} created`);
                    setCreateOpen(false);
                    resetCreateForm();
                    await loadInitial(query, filters);
                    const listSearch = toListSearch(query, filters).toString();
                    setSearchParams(toListSearch(query, filters));
                    navigate(`/work-orders/${created.reference_id}${listSearch ? `?${listSearch}` : ""}`);
                  } catch (err) {
                    alerts.error("Failed to create work order", err instanceof Error ? err.message : "Request failed");
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                {creating ? "Creating..." : "Create Work Order"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border border-border bg-white p-4 space-y-3">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const nextQuery = searchInput.trim();
            const nextFilters: WorkOrderListFilters = {
              customerId: customerFilterInputId,
              statusId: statusFilterInputId,
              jobTypeId: jobTypeFilterInputId,
              itemId: itemFilterInputId,
              createdFrom: createdFromInput.trim(),
              createdTo: createdToInput.trim()
            };
            setQuery(nextQuery);
            setFilters(nextFilters);
            setCustomerFilterLabel(customerFilterInputLabel);
            setSearchParams(toListSearch(nextQuery, nextFilters));
            await loadInitial(nextQuery, nextFilters);
          }}
        >
          <div className="flex gap-2">
            <Input
              placeholder={
                canViewSensitive
                  ? "Search reference, customer name/phone/email, status, job type, location, item, brand, model, serial"
                  : "Search reference, customer name, status, job type, location, item, brand, model, serial"
              }
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button variant="outline" type="submit">
              Search
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSearchInput("");
                setQuery("");
                setCustomerFilterInputId(null);
                setCustomerFilterInputLabel("");
                setStatusFilterInputId(null);
                setJobTypeFilterInputId(null);
                setItemFilterInputId(null);
                setCreatedFromInput("");
                setCreatedToInput("");
                setFilters({
                  customerId: null,
                  statusId: null,
                  jobTypeId: null,
                  itemId: null,
                  createdFrom: "",
                  createdTo: ""
                });
                setCustomerFilterLabel("");
                setSearchParams(new URLSearchParams());
                void loadInitial("", {
                  customerId: null,
                  statusId: null,
                  jobTypeId: null,
                  itemId: null,
                  createdFrom: "",
                  createdTo: ""
                });
              }}
            >
              Clear
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-2"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((prev) => !prev)}
            >
              {advancedOpen ? "Hide Advanced Search ▲" : "Show Advanced Search ▼"}
            </Button>
          </div>
          {advancedOpen && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                <CustomerSearchableDropdown
                  label="Customer"
                  value={customerFilterInputId}
                  valueLabel={customerFilterInputLabel || customerFilterLabel}
                  placeholder="Filter by customer"
                  loadOptions={async (search) => (await apiClient.listWorkOrderCustomers(search)).items}
                  onChange={(option) => {
                    if (!option) {
                      setCustomerFilterInputId(null);
                      setCustomerFilterInputLabel("");
                      return;
                    }
                    setCustomerFilterInputId(option.id);
                    setCustomerFilterInputLabel(option.label);
                  }}
                  allowAddNew={false}
                  allowClear
                />
                <SingleSearchableDropdown
                  label="Status"
                  value={statusFilterInputId}
                  onChange={setStatusFilterInputId}
                  loadOptions={async (q) => (await apiClient.listWorkOrderStatuses(q)).items}
                  placeholder="Any status"
                  allowClear
                />
                <SingleSearchableDropdown
                  label="Job Type"
                  value={jobTypeFilterInputId}
                  onChange={setJobTypeFilterInputId}
                  loadOptions={async (q) => (await apiClient.listJobTypes(q)).items}
                  placeholder="Any job type"
                  allowClear
                />
                <SingleSearchableDropdown
                  label="Item"
                  value={itemFilterInputId}
                  onChange={setItemFilterInputId}
                  loadOptions={async (q) => (await apiClient.listItems(q)).items}
                  placeholder="Any item"
                  allowClear
                />
                <div className="space-y-1">
                  <label className="block text-sm text-muted-foreground">Created From</label>
                  <Input type="date" value={createdFromInput} onChange={(e) => setCreatedFromInput(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="block text-sm text-muted-foreground">Created To</label>
                  <Input type="date" value={createdToInput} onChange={(e) => setCreatedToInput(e.target.value)} />
                </div>
              </div>
            </div>
          )}
        </form>

        <div className="overflow-x-auto">
          <Table className="min-w-[920px]">
            <thead>
              <tr>
                <Th className="w-[110px]">Ref #</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Job Type</Th>
                <Th>Item</Th>
                <Th>Location</Th>
                <Th>Created</Th>
                <Th className="w-[120px]">Action</Th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr>
                  <Td colSpan={8}>Loading work orders...</Td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <Td colSpan={8}>No work orders found.</Td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item.reference_id}>
                  <Td>{item.reference_id}</Td>
                  <Td>
                    <div className="space-y-1">
                      <p>{item.customer_name ?? "-"}</p>
                      {canViewSensitive && item.customer_email && <p className="text-xs text-muted-foreground">{item.customer_email}</p>}
                    </div>
                  </Td>
                  <Td>
                    <Badge className={statusClass(item.status)}>{item.status}</Badge>
                  </Td>
                  <Td>{item.job_type}</Td>
                  <Td>
                    <div className="space-y-1">
                      <p>{item.item_name ?? "-"}</p>
                      {item.brand_names.length > 0 && <p className="text-xs text-muted-foreground">{item.brand_names.join(", ")}</p>}
                    </div>
                  </Td>
                  <Td>
                    {canUpdateWorkOrders ? (
                      <SingleSearchableDropdown
                        className="min-w-[170px]"
                        value={item.location_id}
                        valueLabel={formatLocationValue(item.location_id, item.location_shelf, item.location_floor)}
                        disabled={updatingLocationByReferenceID[item.reference_id] === true}
                        onChange={(nextLocationID) => {
                          void updateLocationFromList(item, nextLocationID);
                        }}
                        loadOptions={async (q) => (await apiClient.listLocations(q)).items}
                        placeholder="-"
                        onAddLocation={isDropdownFrozen("locations") ? undefined : (payload) => apiClient.createLocation(payload)}
                        allowClear
                        clearLabel="None"
                      />
                    ) : (
                      formatLocationValue(item.location_id, item.location_shelf, item.location_floor)
                    )}
                  </Td>
                  <Td>{formatDateTime(item.created_at)}</Td>
                  <Td>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/work-orders/${item.reference_id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}>View</Link>
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="flex min-h-6 items-center justify-center">
          {loadingMore && <p className="text-xs text-muted-foreground">Loading more work orders...</p>}
          {!loading && !loadingMore && !hasMore && items.length > 0 && <p className="text-xs text-muted-foreground">End of results.</p>}
        </div>
        {!loading && !loadingMore && hasMore && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        )}
        <div ref={loadMoreRef} className="h-1 w-full" />
      </div>
    </section>
  );
}

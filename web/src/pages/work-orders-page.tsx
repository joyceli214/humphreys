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

function CustomerSearchableDropdown({
  value,
  valueLabel,
  onChange,
  loadOptions,
  onAddNew,
  placeholder
}: {
  value: number | null;
  valueLabel?: string;
  onChange: (option: CustomerLookupOption) => void;
  loadOptions: (query: string) => Promise<CustomerLookupOption[]>;
  onAddNew: (seed: string) => void;
  placeholder: string;
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
      <div className="relative">
        <button
          type="button"
          className="flex h-10 w-full items-center rounded-md border border-input bg-white px-3 py-2 pr-10 text-sm"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="truncate text-left">{selectedLabel || placeholder}</span>
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
                  {option.label}
                </button>
              ))}
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
  searchable = true
}: {
  label: string;
  value: number | null;
  valueLabel?: string;
  onChange: (value: number | null) => void;
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
    <div ref={rootRef} className="space-y-1">
      <label className="block text-sm text-muted-foreground">{label}</label>
      <div className="relative">
        <button
          type="button"
          className="flex h-10 w-full items-center rounded-md border border-input bg-white px-3 py-2 pr-10 text-sm"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="truncate text-left">{selectedLabel || placeholder}</span>
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
            <div className="mt-2 max-h-52 overflow-auto space-y-1">
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
              {!adding && (
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
                          onChange(created.id);
                          setAdding(false);
                          setNewValue("");
                          setOpen(false);
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
              {!adding && (
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
  const initialQuery = searchParams.get("q")?.trim() ?? "";
  const [items, setItems] = useState<WorkOrderListItem[]>([]);
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
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
  const [brandIds, setBrandIds] = useState<number[]>([]);
  const [modelNumber, setModelNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<LookupOption[]>([]);
  const [depositPaymentMethodId, setDepositPaymentMethodId] = useState("");
  const pageSize = 100;
  const toListSearch = (nextQuery: string) => {
    const params = new URLSearchParams();
    const trimmedQuery = nextQuery.trim();
    if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }
    return params;
  };

  const fetchPage = async (nextPage: number, nextQuery: string) => {
    const params = new URLSearchParams({
      q: nextQuery,
      page: String(nextPage),
      page_size: String(pageSize)
    });
    const res = await apiClient.listWorkOrders(params);
    return res.items;
  };

  const loadInitial = async (nextQuery: string) => {
    setLoading(true);
    setLoadingMore(false);
    waitForSentinelExitRef.current = false;
    try {
      const pageItems = await fetchPage(1, nextQuery);
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
      const pageItems = await fetchPage(nextPage, queryRef.current);
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.reference_id));
        const uniqueAdds = pageItems.filter((item) => !seen.has(item.reference_id));
        return [...prev, ...uniqueAdds];
      });
      setPage(nextPage);
      setHasMore(pageItems.length === pageSize);
      setSearchParams(toListSearch(queryRef.current));
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
    loadInitial(initialQuery);
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
                      setNewCustomerHomePhone(homePhone || (!workPhone ? fallback.phone : ""));
                      setNewCustomerWorkPhone(option.work_phone ?? "");
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
                    <Input value={newCustomerHomePhone} onChange={(e) => setNewCustomerHomePhone(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Work Phone *</label>
                    <Input value={newCustomerWorkPhone} onChange={(e) => setNewCustomerWorkPhone(e.target.value)} />
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
                  label="Item"
                  value={itemId}
                  onChange={setItemId}
                  loadOptions={async (q) => (await apiClient.listItems(q)).items}
                  placeholder="Select item"
                  onAddNew={(label) => apiClient.createItem(label)}
                />
                <MultiSearchableDropdown
                  label="Brands"
                  values={brandIds}
                  valueLabels={[]}
                  onChange={setBrandIds}
                  loadOptions={async (q) => (await apiClient.listBrands(q)).items}
                  placeholder="Select brands"
                  onAddNew={(label) => apiClient.createBrand(label)}
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
                    await loadInitial(query);
                    const listSearch = toListSearch(query).toString();
                    setSearchParams(toListSearch(query));
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
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const nextQuery = searchInput.trim();
            setQuery(nextQuery);
            setSearchParams(toListSearch(nextQuery));
            await loadInitial(nextQuery);
          }}
        >
          <Input
            placeholder={
              canViewSensitive
                ? "Search reference, customer, email, item, model, serial"
                : "Search reference, item, model, serial"
            }
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button variant="outline" type="submit">
            Search
          </Button>
        </form>

        <Table>
          <thead>
            <tr>
              <Th className="w-[110px]">Ref #</Th>
              {canViewSensitive && <Th>Customer</Th>}
              <Th>Status</Th>
              <Th>Job Type</Th>
              <Th>Item</Th>
              <Th>Created</Th>
              <Th className="w-[120px]">Action</Th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <Td colSpan={canViewSensitive ? 7 : 6}>Loading work orders...</Td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <Td colSpan={canViewSensitive ? 7 : 6}>No work orders found.</Td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.reference_id}>
                <Td>{item.reference_id}</Td>
                {canViewSensitive && (
                  <Td>
                    <div className="space-y-1">
                      <p>{item.customer_name ?? "-"}</p>
                      {item.customer_email && <p className="text-xs text-muted-foreground">{item.customer_email}</p>}
                    </div>
                  </Td>
                )}
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

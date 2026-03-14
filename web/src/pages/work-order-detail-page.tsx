"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "@/lib/api/client";
import type { LookupOption, PartsPurchaseRequest, RepairLog, WorkOrderDetail } from "@/lib/api/generated/types";
import { useAuth } from "@/lib/auth/auth-context";
import { useAlerts } from "@/lib/alerts/alert-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import rehypeRaw from "rehype-raw";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { generateDropOffFormPdf, generatePickupFormPdf } from "@/lib/pdf/work-order-forms";

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
    const second = Number(dateTime[6] ?? '0');
    const millisecond = Number((dateTime[7] ?? '0').padEnd(3, '0'));
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

function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD"
  }).format(value);
}

function formatLocationValue(locationID: number | null, locationShelf: string | null, locationFloor: number | null) {
  if (locationID == null && !locationShelf && locationFloor == null) return "-";
  const shelf = locationShelf?.trim() ? locationShelf : "-";
  const floor = locationFloor == null ? "-" : locationFloor === 0 ? "FLOOR" : String(locationFloor);
  return `${shelf}-${floor}`;
}

function statusClass(status: string | null) {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "finished") return "bg-emerald-100 text-emerald-700";
  if (normalized === "received") return "bg-amber-100 text-amber-700";
  if (normalized === "picked up") return "bg-sky-100 text-sky-700";
  return "bg-muted text-muted-foreground";
}

function fullName(firstName: string | null, lastName: string | null) {
  const name = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return name || "-";
}

function detailRow(label: string, value: string) {
  return (
    <div className="grid grid-cols-[170px_1fr] gap-2 text-sm">
      <p className="text-muted-foreground">{label}</p>
      <p>{value || "-"}</p>
    </div>
  );
}

function markdownBlock(value: string | null) {
  const content = value?.trim() ? value : "-";
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          p: ({ children }) => <p className="mb-2 leading-6 last:mb-0">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="mb-2 text-2xl font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-xl font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 text-lg font-semibold">{children}</h3>,
          ul: ({ children }) => <ul className="mb-2 list-disc pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal pl-6">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          u: ({ children }) => <u className="underline">{children}</u>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function markdownPlain(value: string | null) {
  const content = value?.trim() ? value : "-";
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        p: ({ children }) => <p className="mb-2 leading-6 last:mb-0">{children}</p>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        ),
        h1: ({ children }) => <h1 className="mb-2 text-2xl font-semibold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 text-xl font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 text-lg font-semibold">{children}</h3>,
        ul: ({ children }) => <ul className="mb-2 list-disc pl-6">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal pl-6">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        u: ({ children }) => <u className="underline">{children}</u>,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
        ),
        hr: () => <hr className="my-3 border-border" />,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function blankToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseLooseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseDecimalInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayDateInputValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emailValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function phoneDigitsOnly(value: string) {
  return /^\d+$/.test(value);
}

const workNotesEditorPlugins = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  markdownShortcutPlugin(),
  toolbarPlugin({
    toolbarContents: () => (
      <>
        <UndoRedo />
        <BoldItalicUnderlineToggles />
        <ListsToggle />
        <CreateLink />
        <InsertThematicBreak />
        <BlockTypeSelect />
      </>
    )
  })
];

const workNotesEditorContentClassName =
  "min-h-28 px-3 py-2 text-sm leading-6 " +
  "[&_p]:mb-2 [&_p:last-child]:mb-0 " +
  "[&_strong]:font-semibold [&_em]:italic [&_u]:underline " +
  "[&_a]:text-primary [&_a]:underline " +
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 " +
  "[&_li]:my-1 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold " +
  "[&_hr]:my-3 [&_hr]:border-border";

type SectionKey = "equipment" | "work_notes" | "line_items" | "totals" | "customer";

type EquipmentForm = {
  status_id: number | null;
  job_type_id: number | null;
  location_id: number | null;
  item_id: number | null;
  brand_ids: number[];
  model_number: string;
  serial_number: string;
  remote_control_qty: number;
  cable_qty: number;
  cord_qty: number;
  dvd_vhs_qty: number;
  album_cd_cassette_qty: number;
};

type WorkNotesForm = {
  problem_description: string;
  worker_ids: number[];
  work_done: string;
  payment_method_ids: number[];
};

type TotalsForm = {
  parts_total: string;
  delivery_total: string;
  labour_total: string;
  deposit: string;
};

type LineItemForm = {
  line_item_id: number | null;
  item_name: string;
  unit_price: string;
  quantity_text: string;
  line_total_text: string;
};

type LineItemModalMode = "create" | "edit";

type CustomerForm = {
  first_name: string;
  last_name: string;
  email: string;
  home_phone: string;
  work_phone: string;
  extension_text: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  province: string;
};

type FieldErrors = Partial<Record<"deposit" | "email" | "home_phone" | "work_phone", string>>;

type RepairLogForm = {
  repair_date: string;
  hours_used: string;
  details: string;
};

type PartsPurchaseRequestForm = {
  source: "online" | "supplier";
  source_url: string;
  total_price: string;
  item_name: string;
  quantity: string;
};

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
  allowClear = false
}: {
  label: string;
  value: number | null;
  valueLabel?: string;
  onChange: (value: number | null) => void;
  loadOptions: (query: string) => Promise<LookupOption[]>;
  placeholder: string;
  onAddNew?: (label: string) => Promise<LookupOption>;
  onAddLocation?: (payload: { shelf: string; floor: number }) => Promise<LookupOption>;
  searchable?: boolean;
  allowClear?: boolean;
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

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
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
              {allowClear && (
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  None
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
              {adding && onAddNew && !onAddLocation && (
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

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
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

function SingleDropdown({
  label,
  value,
  valueLabel,
  onChange,
  loadOptions,
  placeholder,
  onAddNew
}: {
  label: string;
  value: number | null;
  valueLabel?: string;
  onChange: (value: number | null) => void;
  loadOptions: () => Promise<LookupOption[]>;
  placeholder: string;
  onAddNew?: (label: string) => Promise<LookupOption>;
}) {
  return (
    <SingleSearchableDropdown
      label={label}
      value={value}
      valueLabel={valueLabel}
      onChange={onChange}
      loadOptions={async () => loadOptions()}
      placeholder={placeholder}
      onAddNew={onAddNew}
      searchable={false}
    />
  );
}

export default function WorkOrderDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = useAuth();
  const alerts = useAlerts();
  const canEdit = hasPermission("work_orders:update");
  const canAdminDeleteJob = hasPermission("work_orders:create");
  const canUpdateStatus = hasPermission("work_orders_status:update");
  const canViewSensitive = hasPermission("work_orders_sensitive:read");
  const canReadRepairLogs = hasPermission("repair_logs:read");
  const canCreateRepairLogs = hasPermission("repair_logs:create");
  const canUpdateRepairLogs = hasPermission("repair_logs:update");
  const canDeleteRepairLogs = hasPermission("repair_logs:delete");
  const canReadPartsRequests = hasPermission("parts_purchase_requests:read");
  const canCreatePartsRequests = hasPermission("parts_purchase_requests:create");
  const canUpdatePartsRequests = hasPermission("parts_purchase_requests:update");
  const canDeletePartsRequests = hasPermission("parts_purchase_requests:delete");
  const { referenceId } = useParams();
  const [item, setItem] = useState<WorkOrderDetail | null>(null);
  const [repairLogs, setRepairLogs] = useState<RepairLog[]>([]);
  const [partsRequests, setPartsRequests] = useState<PartsPurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [savingSection, setSavingSection] = useState<SectionKey | null>(null);
  const [sectionError, setSectionError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [savingRepairLog, setSavingRepairLog] = useState(false);
  const [savingPartsRequest, setSavingPartsRequest] = useState(false);
  const [completingJob, setCompletingJob] = useState(false);
  const [repairLogModalOpen, setRepairLogModalOpen] = useState(false);
  const [partsRequestModalOpen, setPartsRequestModalOpen] = useState(false);
  const [repairLogDeleteTarget, setRepairLogDeleteTarget] = useState<RepairLog | null>(null);
  const [partsRequestDeleteTarget, setPartsRequestDeleteTarget] = useState<PartsPurchaseRequest | null>(null);
  const [deletingRepairLog, setDeletingRepairLog] = useState(false);
  const [deletingPartsRequest, setDeletingPartsRequest] = useState(false);
  const [deleteWorkOrderOpen, setDeleteWorkOrderOpen] = useState(false);
  const [deletingWorkOrder, setDeletingWorkOrder] = useState(false);
  const [editingRepairLogID, setEditingRepairLogID] = useState<number | null>(null);
  const [editingPartsRequestID, setEditingPartsRequestID] = useState<number | null>(null);
  const [editingPartsRequestStatus, setEditingPartsRequestStatus] = useState<"draft" | "waiting_approval" | "ordered" | "used" | null>(null);
  const [aiSummary, setAISummary] = useState("");
  const [aiSummaryModel, setAISummaryModel] = useState<string | null>(null);
  const [aiSummaryGeneratedAt, setAISummaryGeneratedAt] = useState<string | null>(null);
  const [aiSummaryLoading, setAISummaryLoading] = useState(false);
  const [aiSummaryError, setAISummaryError] = useState("");
  const [aiSummaryLoadedReference, setAISummaryLoadedReference] = useState<number | null>(null);

  const [equipmentForm, setEquipmentForm] = useState<EquipmentForm>({
    status_id: null,
    job_type_id: null,
    location_id: null,
    item_id: null,
    brand_ids: [],
    model_number: "",
    serial_number: "",
    remote_control_qty: 0,
    cable_qty: 0,
    cord_qty: 0,
    dvd_vhs_qty: 0,
    album_cd_cassette_qty: 0
  });
  const [workNotesForm, setWorkNotesForm] = useState<WorkNotesForm>({
    problem_description: "",
    worker_ids: [],
    work_done: "",
    payment_method_ids: []
  });
  const [totalsForm, setTotalsForm] = useState<TotalsForm>({
    parts_total: "",
    delivery_total: "",
    labour_total: "",
    deposit: "0"
  });
  const [lineItemsForm, setLineItemsForm] = useState<LineItemForm[]>([]);
  const [lineItemModalOpen, setLineItemModalOpen] = useState(false);
  const [lineItemModalMode, setLineItemModalMode] = useState<LineItemModalMode>("create");
  const [lineItemEditIndex, setLineItemEditIndex] = useState<number | null>(null);
  const [lineItemDraft, setLineItemDraft] = useState<LineItemForm>({
    line_item_id: null,
    item_name: "",
    unit_price: "",
    quantity_text: "",
    line_total_text: ""
  });
  const [customerForm, setCustomerForm] = useState<CustomerForm>({
    first_name: "",
    last_name: "",
    email: "",
    home_phone: "",
    work_phone: "",
    extension_text: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    province: ""
  });
  const [repairLogForm, setRepairLogForm] = useState<RepairLogForm>({
    repair_date: todayDateInputValue(),
    hours_used: "0",
    details: ""
  });
  const [partsRequestForm, setPartsRequestForm] = useState<PartsPurchaseRequestForm>({
    source: "online",
    source_url: "",
    total_price: "",
    item_name: "",
    quantity: "1"
  });

  const parsedReferenceId = useMemo(() => Number(referenceId), [referenceId]);
  const backToWorkOrders = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get("q")?.trim() ?? "";
    const parsedPage = Number(params.get("page"));
    const page = Number.isInteger(parsedPage) && parsedPage > 1 ? String(parsedPage) : "";
    const backParams = new URLSearchParams();
    if (q) {
      backParams.set("q", q);
    }
    if (page) {
      backParams.set("page", page);
    }
    const queryString = backParams.toString();
    return queryString ? `/work-orders?${queryString}` : "/work-orders";
  }, [location.search]);

  const generateAISummary = useCallback(async () => {
    if (!canViewSensitive || !Number.isInteger(parsedReferenceId) || parsedReferenceId <= 0) return;
    setAISummaryLoading(true);
    setAISummaryError("");
    try {
      const res = await apiClient.generateWorkOrderAISummary(parsedReferenceId);
      setAISummary(res.summary);
      setAISummaryModel(res.model);
      setAISummaryGeneratedAt(res.generated_at);
      setAISummaryLoadedReference(parsedReferenceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setAISummaryError(message);
      setAISummary("");
      setAISummaryModel(null);
      setAISummaryGeneratedAt(null);
    } finally {
      setAISummaryLoading(false);
    }
  }, [canViewSensitive, parsedReferenceId]);

  const loadExtras = async (reference: number) => {
    setLoadingExtras(true);
    try {
      const [logsRes, partsRes] = await Promise.all([
        canReadRepairLogs ? apiClient.listRepairLogs(reference) : Promise.resolve({ items: [] }),
        canReadPartsRequests ? apiClient.listPartsPurchaseRequests(reference) : Promise.resolve({ items: [] })
      ]);
      setRepairLogs(logsRes.items);
      setPartsRequests(partsRes.items);
    } catch (err) {
      alerts.error("Failed to load staff logs", err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoadingExtras(false);
    }
  };

  useEffect(() => {
    if (!hasPermission("work_orders:read")) return;
    if (!Number.isInteger(parsedReferenceId) || parsedReferenceId <= 0) {
      setLoading(false);
      return;
    }

    setAISummary("");
    setAISummaryModel(null);
    setAISummaryGeneratedAt(null);
    setAISummaryError("");
    setAISummaryLoadedReference(null);

    (async () => {
      setLoading(true);
      try {
        const res = await apiClient.getWorkOrderDetail(parsedReferenceId);
        setItem(res);
        await loadExtras(parsedReferenceId);
      } finally {
        setLoading(false);
      }
    })();
  }, [hasPermission, parsedReferenceId, canReadRepairLogs, canReadPartsRequests]);

  useEffect(() => {
    if (!item) return;
    setEquipmentForm({
      status_id: item.status_id,
      job_type_id: item.job_type_id,
      location_id: item.location_id,
      item_id: item.item_id,
      brand_ids: item.brand_ids ?? [],
      model_number: item.model_number ?? "",
      serial_number: item.serial_number ?? "",
      remote_control_qty: item.remote_control_qty,
      cable_qty: item.cable_qty,
      cord_qty: item.cord_qty,
      dvd_vhs_qty: item.dvd_vhs_qty ?? 0,
      album_cd_cassette_qty: item.album_cd_cassette_qty
    });
    setWorkNotesForm({
      problem_description: item.problem_description ?? "",
      worker_ids: item.worker_ids ?? [],
      work_done: item.work_done ?? "",
      payment_method_ids: item.payment_method_ids ?? []
    });
    setTotalsForm({
      parts_total: item.parts_total == null ? "" : String(item.parts_total),
      delivery_total: item.delivery_total == null ? "" : String(item.delivery_total),
      labour_total: item.labour_total == null ? "" : String(item.labour_total),
      deposit: String(item.deposit)
    });
    setLineItemsForm(
      item.line_items.map((line) => ({
        line_item_id: line.line_item_id,
        item_name: line.item_name ?? "",
        unit_price: line.unit_price == null ? "" : String(line.unit_price),
        quantity_text: line.quantity_text ?? "",
        line_total_text: line.line_total_text ?? ""
      }))
    );
    setCustomerForm({
      first_name: item.customer.first_name ?? "",
      last_name: item.customer.last_name ?? "",
      email: item.customer.email ?? "",
      home_phone: item.customer.home_phone ?? "",
      work_phone: item.customer.work_phone ?? "",
      extension_text: item.customer.extension_text ?? "",
      address_line_1: item.customer.address_line_1 ?? "",
      address_line_2: item.customer.address_line_2 ?? "",
      city: item.customer.city ?? "",
      province: item.customer.province ?? ""
    });
  }, [item]);

  useEffect(() => {
    if (!item || !canViewSensitive) return;
    if (aiSummaryLoadedReference === item.reference_id) return;
    void generateAISummary();
  }, [item, canViewSensitive, aiSummaryLoadedReference, generateAISummary]);

  if (!hasPermission("work_orders:read")) {
    return null;
  }

  if (loading) {
    return <p>Loading work order...</p>;
  }

  if (!Number.isInteger(parsedReferenceId) || parsedReferenceId <= 0) {
    return (
      <section className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={backToWorkOrders}>Back to Work Orders</Link>
        </Button>
        <p>Invalid work order reference.</p>
      </section>
    );
  }

  if (!item) {
    return (
      <section className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={backToWorkOrders}>Back to Work Orders</Link>
        </Button>
        <p>Work order not found.</p>
      </section>
    );
  }

  const cancelEditing = () => {
    setEditingSection(null);
    setSectionError("");
    setFieldErrors({});
  };

  const openCreateLineItemModal = () => {
    setLineItemModalMode("create");
    setLineItemEditIndex(null);
    setLineItemDraft({
      line_item_id: null,
      item_name: "",
      unit_price: "",
      quantity_text: "",
      line_total_text: ""
    });
    setLineItemModalOpen(true);
  };

  const openEditLineItemModal = (line: LineItemForm, index: number) => {
    setLineItemModalMode("edit");
    setLineItemEditIndex(index);
    setLineItemDraft({
      line_item_id: line.line_item_id,
      item_name: line.item_name,
      unit_price: line.unit_price,
      quantity_text: line.quantity_text,
      line_total_text: line.line_total_text
    });
    setLineItemModalOpen(true);
  };

  const saveEquipment = async () => {
    setSavingSection("equipment");
    setSectionError("");
    try {
      const updated = await apiClient.updateWorkOrderEquipment(parsedReferenceId, {
        status_id: equipmentForm.status_id,
        job_type_id: equipmentForm.job_type_id,
        location_id: equipmentForm.location_id,
        item_id: equipmentForm.item_id,
        brand_ids: equipmentForm.brand_ids,
        model_number: blankToNull(equipmentForm.model_number),
        serial_number: blankToNull(equipmentForm.serial_number),
        remote_control_qty: Math.max(0, equipmentForm.remote_control_qty),
        cable_qty: Math.max(0, equipmentForm.cable_qty),
        cord_qty: Math.max(0, equipmentForm.cord_qty),
        dvd_vhs_qty: Math.max(0, equipmentForm.dvd_vhs_qty),
        album_cd_cassette_qty: Math.max(0, equipmentForm.album_cd_cassette_qty)
      });
      setItem(updated);
      setEditingSection(null);
      alerts.success("Equipment updated");
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Failed to save equipment");
      alerts.error("Failed to save equipment", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingSection(null);
    }
  };

  const saveStatusAndLocationOnly = async () => {
    setSavingSection("equipment");
    setSectionError("");
    try {
      const updated = await apiClient.updateWorkOrderEquipment(parsedReferenceId, {
        status_id: equipmentForm.status_id,
        job_type_id: equipmentForm.job_type_id,
        location_id: equipmentForm.location_id,
        item_id: equipmentForm.item_id,
        brand_ids: equipmentForm.brand_ids,
        model_number: blankToNull(equipmentForm.model_number),
        serial_number: blankToNull(equipmentForm.serial_number),
        remote_control_qty: Math.max(0, equipmentForm.remote_control_qty),
        cable_qty: Math.max(0, equipmentForm.cable_qty),
        cord_qty: Math.max(0, equipmentForm.cord_qty),
        dvd_vhs_qty: Math.max(0, equipmentForm.dvd_vhs_qty),
        album_cd_cassette_qty: Math.max(0, equipmentForm.album_cd_cassette_qty)
      });
      setItem(updated);
      setEditingSection(null);
      alerts.success("Status/location updated");
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Failed to save status/location");
      alerts.error("Failed to save status/location", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingSection(null);
    }
  };

  const setDepositAndFinalPaymentMethods = (depositPaymentMethodID: number | null, finalPaymentMethodID: number | null) => {
    const next: number[] = [];
    if (depositPaymentMethodID !== null) {
      next.push(depositPaymentMethodID);
    }
    if (finalPaymentMethodID !== null) {
      next.push(finalPaymentMethodID);
    }
    setWorkNotesForm((prev) => ({ ...prev, payment_method_ids: next }));
  };

  const completeJob = async () => {
    setCompletingJob(true);
    setSectionError("");
    try {
      const statuses = await apiClient.listWorkOrderStatuses("");
      const finishedStatus =
        statuses.items.find((status) => status.label.trim().toLowerCase() === "finished") ??
        statuses.items.find((status) => status.label.trim().toLowerCase().includes("finish"));
      if (!finishedStatus) {
        alerts.error("Cannot complete job", "Finished status is not configured");
        return;
      }

      const updated = await apiClient.updateWorkOrderStatus(parsedReferenceId, {
        status_id: finishedStatus.id
      });
      setItem(updated);
      setEquipmentForm((prev) => ({ ...prev, status_id: updated.status_id }));
      alerts.success("Job marked as finished");
    } catch (err) {
      alerts.error("Failed to complete job", err instanceof Error ? err.message : "Request failed");
    } finally {
      setCompletingJob(false);
    }
  };

  const saveWorkNotes = async () => {
    setSavingSection("work_notes");
    setSectionError("");
    try {
      const updated = await apiClient.updateWorkOrderWorkNotes(parsedReferenceId, {
        problem_description: blankToNull(workNotesForm.problem_description),
        worker_ids: workNotesForm.worker_ids,
        work_done: blankToNull(workNotesForm.work_done),
        payment_method_ids: workNotesForm.payment_method_ids
      });
      setItem(updated);
      setEditingSection(null);
      alerts.success("Work notes updated");
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Failed to save notes");
      alerts.error("Failed to save notes", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingSection(null);
    }
  };

  const saveLineItems = async (nextLineItems: LineItemForm[], successMessage = "Line items updated") => {
    setSavingSection("line_items");
    setSectionError("");
    try {
      const payload = nextLineItems.map((line, index) => {
        const unitPrice = parseOptionalNumber(line.unit_price);
        if (line.unit_price.trim() !== "" && unitPrice === null) {
          throw new Error(`Line ${index + 1}: Unit price must be a valid number`);
        }
        const parsedLineTotal = parseLooseNumber(line.line_total_text);
        if (line.line_total_text.trim() !== "" && parsedLineTotal === null) {
          throw new Error(`Line ${index + 1}: Line total must be a valid number`);
        }
        return {
          line_item_id: line.line_item_id ?? undefined,
          item_name: blankToNull(line.item_name),
          unit_price: unitPrice,
          quantity_text: blankToNull(line.quantity_text),
          line_total_text: blankToNull(line.line_total_text)
        };
      });
      const updated = await apiClient.updateWorkOrderLineItems(parsedReferenceId, {
        line_items: payload
      });
      setItem(updated);
      setLineItemsForm(
        updated.line_items.map((line) => ({
          line_item_id: line.line_item_id,
          item_name: line.item_name ?? "",
          unit_price: line.unit_price == null ? "" : String(line.unit_price),
          quantity_text: line.quantity_text ?? "",
          line_total_text: line.line_total_text ?? ""
        }))
      );
      alerts.success(successMessage);
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Failed to save line items");
      alerts.error("Failed to save line items", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingSection(null);
    }
  };

  const saveLineItemFromModal = async () => {
    const next =
      lineItemModalMode === "edit" && lineItemEditIndex !== null
        ? lineItemsForm.map((line, index) => (index === lineItemEditIndex ? lineItemDraft : line))
        : [...lineItemsForm, { ...lineItemDraft, line_item_id: null }];

    setLineItemModalOpen(false);
    setLineItemEditIndex(null);
    await saveLineItems(next, lineItemModalMode === "edit" ? "Line item updated" : "Line item added");
  };

  const deleteLineItem = async (index: number) => {
    const next = lineItemsForm.filter((_, rowIndex) => rowIndex !== index);
    await saveLineItems(next, "Line item deleted");
  };

  const saveTotals = async () => {
    setFieldErrors((prev) => ({ ...prev, deposit: undefined }));
    const delivery = parseOptionalNumber(totalsForm.delivery_total);
    const labour = parseOptionalNumber(totalsForm.labour_total);
    const deposit = Number(totalsForm.deposit.trim() || "0");

    if (Number.isNaN(deposit)) {
      setFieldErrors((prev) => ({ ...prev, deposit: "Deposit must be a valid number" }));
      alerts.error("Invalid totals", "Deposit must be a valid number");
      return;
    }

    setSavingSection("totals");
    setSectionError("");
    try {
      await apiClient.updateWorkOrderTotals(parsedReferenceId, {
        delivery_total: delivery,
        labour_total: labour,
        deposit
      });
      const updated = await apiClient.updateWorkOrderWorkNotes(parsedReferenceId, {
        problem_description: blankToNull(workNotesForm.problem_description),
        worker_ids: workNotesForm.worker_ids,
        work_done: blankToNull(workNotesForm.work_done),
        payment_method_ids: workNotesForm.payment_method_ids
      });
      setItem(updated);
      setEditingSection(null);
      alerts.success("Payment breakdown updated");
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Failed to save payment breakdown");
      alerts.error("Failed to save payment breakdown", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingSection(null);
    }
  };

  const saveCustomer = async () => {
    setFieldErrors((prev) => ({ ...prev, email: undefined, home_phone: undefined, work_phone: undefined }));
    const email = customerForm.email.trim();
    const homePhone = customerForm.home_phone.trim();
    const workPhone = customerForm.work_phone.trim();
    const nextErrors: FieldErrors = {};

    if (email && !emailValid(email)) {
      nextErrors.email = "Email format is invalid";
    }
    if (homePhone && !phoneDigitsOnly(homePhone)) {
      nextErrors.home_phone = "Home phone must contain numbers only";
    }
    if (workPhone && !phoneDigitsOnly(workPhone)) {
      nextErrors.work_phone = "Work phone must contain numbers only";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
      const firstError = nextErrors.email ?? nextErrors.home_phone ?? nextErrors.work_phone ?? "Please review the highlighted fields";
      alerts.error("Invalid customer data", firstError);
      return;
    }

    setSavingSection("customer");
    setSectionError("");
    try {
      const updated = await apiClient.updateWorkOrderCustomer(parsedReferenceId, {
        first_name: blankToNull(customerForm.first_name),
        last_name: blankToNull(customerForm.last_name),
        email: blankToNull(email),
        home_phone: blankToNull(homePhone),
        work_phone: blankToNull(workPhone),
        extension_text: blankToNull(customerForm.extension_text),
        address_line_1: blankToNull(customerForm.address_line_1),
        address_line_2: blankToNull(customerForm.address_line_2),
        city: blankToNull(customerForm.city),
        province: blankToNull(customerForm.province)
      });
      setItem(updated);
      setEditingSection(null);
      alerts.success("Customer updated");
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Failed to save customer");
      alerts.error("Failed to save customer", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingSection(null);
    }
  };

  const saveRepairLog = async () => {
    if (!canCreateRepairLogs) return;
    const parsedHours = parseDecimalInput(repairLogForm.hours_used);
    const hoursUsed = parsedHours === null ? NaN : parsedHours;
    if (!repairLogForm.details.trim()) {
      alerts.error("Invalid repair log", "Details are required");
      return;
    }
    if (!Number.isFinite(hoursUsed) || hoursUsed < 0) {
      alerts.error("Invalid repair log", "Hours used must be zero or greater");
      return;
    }
    setSavingRepairLog(true);
    try {
      if (editingRepairLogID !== null) {
        await apiClient.updateRepairLog(parsedReferenceId, editingRepairLogID, {
          repair_date: blankToNull(repairLogForm.repair_date),
          hours_used: hoursUsed,
          details: repairLogForm.details.trim()
        });
      } else {
        await apiClient.createRepairLog(parsedReferenceId, {
          repair_date: blankToNull(repairLogForm.repair_date),
          hours_used: hoursUsed,
          details: repairLogForm.details.trim()
        });
      }
      setRepairLogForm({ repair_date: todayDateInputValue(), hours_used: "0", details: "" });
      setEditingRepairLogID(null);
      setRepairLogModalOpen(false);
      await loadExtras(parsedReferenceId);
      alerts.success(editingRepairLogID !== null ? "Repair log updated" : "Repair log added");
    } catch (err) {
      alerts.error(editingRepairLogID !== null ? "Failed to update repair log" : "Failed to add repair log", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingRepairLog(false);
    }
  };

  const savePartsRequest = async (status: "draft" | "waiting_approval") => {
    if (!canCreatePartsRequests) return;
    const quantity = Number(partsRequestForm.quantity.trim());
    const totalPrice = Number(partsRequestForm.total_price.trim() || "0");
    if (!partsRequestForm.item_name.trim()) {
      alerts.error("Invalid parts request", "Item name is required");
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      alerts.error("Invalid parts request", "Quantity must be at least 1");
      return;
    }
    if (!Number.isFinite(totalPrice) || totalPrice < 0) {
      alerts.error("Invalid parts request", "Total price must be zero or greater");
      return;
    }

    const effectiveStatus =
      editingPartsRequestID !== null
        ? status === "waiting_approval"
          ? "waiting_approval"
          : (editingPartsRequestStatus ?? "draft")
        : status;

    setSavingPartsRequest(true);
    try {
      if (editingPartsRequestID !== null) {
        await apiClient.updatePartsPurchaseRequest(parsedReferenceId, editingPartsRequestID, {
          source: partsRequestForm.source,
          source_url: blankToNull(partsRequestForm.source_url),
          status: effectiveStatus,
          total_price: totalPrice,
          item_name: partsRequestForm.item_name.trim(),
          quantity
        });
      } else {
        await apiClient.createPartsPurchaseRequest(parsedReferenceId, {
          source: partsRequestForm.source,
          source_url: blankToNull(partsRequestForm.source_url),
          status: effectiveStatus,
          total_price: totalPrice,
          item_name: partsRequestForm.item_name.trim(),
          quantity
        });
      }
      setPartsRequestForm({
        source: "online",
        source_url: "",
        total_price: "",
        item_name: "",
        quantity: "1"
      });
      setEditingPartsRequestID(null);
      setEditingPartsRequestStatus(null);
      setPartsRequestModalOpen(false);
      await loadExtras(parsedReferenceId);
      alerts.success(editingPartsRequestID !== null ? "Parts request updated" : "Parts request added");
    } catch (err) {
      alerts.error(editingPartsRequestID !== null ? "Failed to update parts request" : "Failed to add parts request", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingPartsRequest(false);
    }
  };

  const openCreateRepairLogModal = () => {
    setEditingRepairLogID(null);
    setRepairLogForm({ repair_date: todayDateInputValue(), hours_used: "0", details: "" });
    setRepairLogModalOpen(true);
  };

  const openEditRepairLogModal = (log: RepairLog) => {
    setEditingRepairLogID(log.repair_log_id);
    setRepairLogForm({
      repair_date: log.repair_date ? log.repair_date.slice(0, 10) : "",
      hours_used: String(log.hours_used),
      details: log.details
    });
    setRepairLogModalOpen(true);
  };

  const confirmDeleteRepairLog = async () => {
    if (!repairLogDeleteTarget) return;
    setDeletingRepairLog(true);
    try {
      await apiClient.deleteRepairLog(parsedReferenceId, repairLogDeleteTarget.repair_log_id);
      await loadExtras(parsedReferenceId);
      setRepairLogDeleteTarget(null);
      alerts.success("Repair log deleted");
    } catch (err) {
      alerts.error("Failed to delete repair log", err instanceof Error ? err.message : "Request failed");
    } finally {
      setDeletingRepairLog(false);
    }
  };

  const openCreatePartsRequestModal = () => {
    setEditingPartsRequestID(null);
    setEditingPartsRequestStatus(null);
    setPartsRequestForm({
      source: "online",
      source_url: "",
      total_price: "",
      item_name: "",
      quantity: "1"
    });
    setPartsRequestModalOpen(true);
  };

  const openEditPartsRequestModal = (request: PartsPurchaseRequest) => {
    setEditingPartsRequestID(request.parts_purchase_request_id);
    setEditingPartsRequestStatus(request.status);
    setPartsRequestForm({
      source: request.source,
      source_url: request.source_url ?? "",
      total_price: String(request.total_price),
      item_name: request.item_name,
      quantity: String(request.quantity)
    });
    setPartsRequestModalOpen(true);
  };

  const confirmDeletePartsRequest = async () => {
    if (!partsRequestDeleteTarget) return;
    setDeletingPartsRequest(true);
    try {
      await apiClient.deletePartsPurchaseRequest(parsedReferenceId, partsRequestDeleteTarget.parts_purchase_request_id);
      await loadExtras(parsedReferenceId);
      setPartsRequestDeleteTarget(null);
      alerts.success("Parts request deleted");
    } catch (err) {
      alerts.error("Failed to delete parts request", err instanceof Error ? err.message : "Request failed");
    } finally {
      setDeletingPartsRequest(false);
    }
  };

  const confirmDeleteWorkOrder = async () => {
    setDeletingWorkOrder(true);
    try {
      await apiClient.deleteWorkOrder(parsedReferenceId);
      setDeleteWorkOrderOpen(false);
      alerts.success("Work order deleted");
      navigate(backToWorkOrders);
    } catch (err) {
      alerts.error("Failed to delete work order", err instanceof Error ? err.message : "Request failed");
    } finally {
      setDeletingWorkOrder(false);
    }
  };

  const markPartsRequestOrdered = async (request: PartsPurchaseRequest) => {
    try {
      await apiClient.updatePartsPurchaseRequest(parsedReferenceId, request.parts_purchase_request_id, {
        source: request.source,
        source_url: request.source_url,
        status: "ordered",
        total_price: request.total_price,
        item_name: request.item_name,
        quantity: request.quantity
      });
      await loadExtras(parsedReferenceId);
      alerts.success("Marked as ordered");
    } catch (err) {
      alerts.error("Failed to mark as ordered", err instanceof Error ? err.message : "Request failed");
    }
  };

  const equipmentBlock = (
    <article className="rounded-lg border border-border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Equipment</h2>
        {(canEdit || canUpdateStatus) && editingSection !== "equipment" && <Button variant="outline" size="sm" onClick={() => setEditingSection("equipment")}>Edit</Button>}
      </div>

      {editingSection === "equipment" ? (
        <div className="space-y-3">
          <SingleDropdown
            label="Status"
            value={equipmentForm.status_id}
            valueLabel={item.status_name ?? undefined}
            onChange={(value) => setEquipmentForm((prev) => ({ ...prev, status_id: value }))}
            loadOptions={async () => (await apiClient.listWorkOrderStatuses("")).items}
            placeholder="Select status"
            onAddNew={canEdit ? (label) => apiClient.createWorkOrderStatus(label) : undefined}
          />
          <SingleSearchableDropdown
            label="Location"
            value={equipmentForm.location_id}
            valueLabel={formatLocationValue(item.location_id, item.location_shelf, item.location_floor)}
            onChange={(value) => setEquipmentForm((prev) => ({ ...prev, location_id: value }))}
            loadOptions={async (q) => (await apiClient.listLocations(q)).items}
            placeholder="Select location"
            onAddLocation={canEdit ? (payload) => apiClient.createLocation(payload) : undefined}
            allowClear
          />
          {canEdit ? (
            <>
          <SingleDropdown
            label="Job Type"
            value={equipmentForm.job_type_id}
            valueLabel={item.job_type_name ?? undefined}
            onChange={(value) => setEquipmentForm((prev) => ({ ...prev, job_type_id: value }))}
            loadOptions={async () => (await apiClient.listJobTypes("")).items}
            placeholder="Select job type"
            onAddNew={(label) => apiClient.createJobType(label)}
          />
          <SingleSearchableDropdown
            label="Item"
            value={equipmentForm.item_id}
            valueLabel={item.item_name ?? undefined}
            onChange={(value) => setEquipmentForm((prev) => ({ ...prev, item_id: value }))}
            loadOptions={async (q) => (await apiClient.listItems(q)).items}
            placeholder="Select item"
            onAddNew={(label) => apiClient.createItem(label)}
          />
          <MultiSearchableDropdown
            label="Brands"
            values={equipmentForm.brand_ids}
            valueLabels={item.brand_names}
            onChange={(values) => setEquipmentForm((prev) => ({ ...prev, brand_ids: values }))}
            loadOptions={async (q) => (await apiClient.listBrands(q)).items}
            placeholder="Select brands"
            onAddNew={(label) => apiClient.createBrand(label)}
          />
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">Model</label>
            <Input value={equipmentForm.model_number} onChange={(e) => setEquipmentForm((prev) => ({ ...prev, model_number: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">Serial</label>
            <Input value={equipmentForm.serial_number} onChange={(e) => setEquipmentForm((prev) => ({ ...prev, serial_number: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Remote Control Qty</label>
              <Input type="number" min={0} value={equipmentForm.remote_control_qty} onChange={(e) => setEquipmentForm((prev) => ({ ...prev, remote_control_qty: Number(e.target.value || "0") }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Cable Qty</label>
              <Input type="number" min={0} value={equipmentForm.cable_qty} onChange={(e) => setEquipmentForm((prev) => ({ ...prev, cable_qty: Number(e.target.value || "0") }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Cord Qty</label>
              <Input type="number" min={0} value={equipmentForm.cord_qty} onChange={(e) => setEquipmentForm((prev) => ({ ...prev, cord_qty: Number(e.target.value || "0") }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">DVD/VHS Qty</label>
              <Input type="number" min={0} value={equipmentForm.dvd_vhs_qty} onChange={(e) => setEquipmentForm((prev) => ({ ...prev, dvd_vhs_qty: Number(e.target.value || "0") }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Album/CD/Cassette Qty</label>
              <Input type="number" min={0} value={equipmentForm.album_cd_cassette_qty} onChange={(e) => setEquipmentForm((prev) => ({ ...prev, album_cd_cassette_qty: Number(e.target.value || "0") }))} />
            </div>
          </div>
            </>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={canEdit ? saveEquipment : saveStatusAndLocationOnly} disabled={savingSection === "equipment"}>{savingSection === "equipment" ? "Saving..." : "Save"}</Button>
            <Button size="sm" variant="outline" onClick={cancelEditing} disabled={savingSection === "equipment"}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          {detailRow("Status", item.status_name ?? "-")}
          {detailRow("Status Updated At", formatDateTime(item.status_updated_at))}
          {detailRow("Job Type", item.job_type_name ?? "-")}
          {detailRow("Location", formatLocationValue(item.location_id, item.location_shelf, item.location_floor))}
          {detailRow("Original Job", item.original_job_id ? String(item.original_job_id) : "-")}
          {detailRow("Item", item.item_name ?? "-")}
          {detailRow("Brands", item.brand_names.join(", ") || "-")}
          {detailRow("Model", item.model_number ?? "-")}
          {detailRow("Serial", item.serial_number ?? "-")}
          {detailRow("Remote Control", String(item.remote_control_qty))}
          {detailRow("Cable", String(item.cable_qty))}
          {detailRow("Cord", String(item.cord_qty))}
          {detailRow("DVD/VHS", String(item.dvd_vhs_qty ?? 0))}
          {detailRow("Album/CD/Cassette", String(item.album_cd_cassette_qty))}
        </>
      )}
    </article>
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Work Order #{item.reference_id}</h1>
          <p className="text-sm text-muted-foreground">Created {formatDateTime(item.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={statusClass(item.status_name)}>{item.status_name ?? "Unknown"}</Badge>
          {canViewSensitive && <Button className="h-auto whitespace-normal py-2 text-center leading-tight" variant="outline" onClick={() => generateDropOffFormPdf(item)}>Create Drop Off Form</Button>}
          {canViewSensitive && <Button className="h-auto whitespace-normal py-2 text-center leading-tight" variant="outline" onClick={() => generatePickupFormPdf(item)}>Create Pick Up Form</Button>}
          <Button variant="outline" asChild>
            <Link to={backToWorkOrders}>Back</Link>
          </Button>
        </div>
      </div>

      {sectionError && <p className="text-sm text-destructive">{sectionError}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-[7fr_3fr] gap-4 items-start">
        <div className="space-y-4">
          {canViewSensitive && (
            <article className="rounded-lg border border-border bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">AI Summary</h2>
                </div>
                <Button size="sm" variant="outline" onClick={() => void generateAISummary()} disabled={aiSummaryLoading}>
                  {aiSummaryLoading ? "Generating..." : aiSummary ? "Refresh" : "Generate"}
                </Button>
              </div>
              {aiSummaryError && <p className="text-sm text-destructive">{aiSummaryError}</p>}
              {!aiSummaryError && aiSummaryLoading && !aiSummary && (
                <p className="text-sm text-muted-foreground">Generating summary...</p>
              )}
              {aiSummary ? (
                <div className="space-y-2">
                  {markdownBlock(aiSummary)}
                </div>
              ) : null}
            </article>
          )}

          <article className="rounded-lg border border-border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Work Notes</h2>
              {canEdit && editingSection !== "work_notes" && <Button variant="outline" size="sm" onClick={() => setEditingSection("work_notes")}>Edit</Button>}
            </div>

            {editingSection === "work_notes" ? (
              <div className="space-y-3">
                <MultiSearchableDropdown
                  label="Technicians"
                  values={workNotesForm.worker_ids}
                  valueLabels={item.worker_names}
                  onChange={(values) => setWorkNotesForm((prev) => ({ ...prev, worker_ids: values }))}
                  loadOptions={async (q) => (await apiClient.listWorkers(q)).items}
                  placeholder="Select technicians"
                  onAddNew={(label) => apiClient.createWorker(label)}
                />
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Problem Description</label>
                  <div className="rounded-md border border-input bg-white p-2">
                    <MDXEditor
                      markdown={workNotesForm.problem_description}
                      contentEditableClassName={workNotesEditorContentClassName}
                      onChange={(value) => setWorkNotesForm((prev) => ({ ...prev, problem_description: value }))}
                      plugins={workNotesEditorPlugins}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Work Done</label>
                  <div className="rounded-md border border-input bg-white p-2">
                    <MDXEditor
                      markdown={workNotesForm.work_done}
                      contentEditableClassName={workNotesEditorContentClassName}
                      onChange={(value) => setWorkNotesForm((prev) => ({ ...prev, work_done: value }))}
                      plugins={workNotesEditorPlugins}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveWorkNotes} disabled={savingSection === "work_notes"}>{savingSection === "work_notes" ? "Saving..." : "Save"}</Button>
                  <Button size="sm" variant="outline" onClick={cancelEditing} disabled={savingSection === "work_notes"}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                {detailRow("Technicians", item.worker_names.join(", ") || "-")}
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Problem Description</p>
                  {markdownBlock(item.problem_description)}
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Work Done</p>
                  {markdownBlock(item.work_done)}
                </div>
                {detailRow("Updated", formatDateTime(item.updated_at))}
              </>
            )}
          </article>

          {canViewSensitive && (
          <>
          <article className="rounded-lg border border-border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Payment Breakdown</h2>
              <div className="flex flex-wrap gap-2">
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={openCreateLineItemModal}>
                    New Line Item
                  </Button>
                )}
                {canEdit && editingSection !== "totals" && (
                  <Button variant="outline" size="sm" onClick={() => setEditingSection("totals")}>Edit Payment</Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Line Items</p>
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th className="w-[140px]">Unit Price</Th>
                      <Th className="w-[140px]">Qty</Th>
                      <Th className="w-[180px]">Line Total</Th>
                      {canEdit && <Th className="w-[70px]" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItemsForm.length === 0 && (
                      <tr>
                        <Td colSpan={canEdit ? 5 : 4}>No line items.</Td>
                      </tr>
                    )}
                    {lineItemsForm.map((line, index) => (
                      <tr key={line.line_item_id ?? `line-${index}`}>
                        <Td>{line.item_name.trim() || "-"}</Td>
                        <Td>{line.unit_price.trim() ? formatCurrency(parseOptionalNumber(line.unit_price)) : "-"}</Td>
                        <Td>{line.quantity_text.trim() || "-"}</Td>
                        <Td>{line.line_total_text.trim() || "-"}</Td>
                        {canEdit && (
                          <Td>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-lg font-bold text-slate-500 hover:bg-slate-100">⋮</Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditLineItemModal(line, index)}>Edit</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void deleteLineItem(index)}>Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </Td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>

            {canEdit && (
              <Dialog open={lineItemModalOpen} onOpenChange={setLineItemModalOpen}>
                <DialogContent className="max-w-lg">
                  <DialogTitle className="text-lg font-semibold">{lineItemModalMode === "edit" ? "Edit Line Item" : "New Line Item"}</DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    Update fields below and save to apply changes to this work order.
                  </DialogDescription>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-sm text-muted-foreground">Item</label>
                      <Input value={lineItemDraft.item_name} onChange={(e) => setLineItemDraft((prev) => ({ ...prev, item_name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">Unit Price</label>
                      <Input value={lineItemDraft.unit_price} onChange={(e) => setLineItemDraft((prev) => ({ ...prev, unit_price: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">Qty</label>
                      <Input value={lineItemDraft.quantity_text} onChange={(e) => setLineItemDraft((prev) => ({ ...prev, quantity_text: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-sm text-muted-foreground">Line Total</label>
                      <Input value={lineItemDraft.line_total_text} onChange={(e) => setLineItemDraft((prev) => ({ ...prev, line_total_text: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
                      <Button variant="outline" onClick={() => setLineItemModalOpen(false)} disabled={savingSection === "line_items"}>Cancel</Button>
                      <Button onClick={() => void saveLineItemFromModal()} disabled={savingSection === "line_items"}>
                        {savingSection === "line_items" ? "Saving..." : lineItemModalMode === "edit" ? "Save Changes" : "Add Line Item"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Payment</p>
              {editingSection === "totals" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <SingleDropdown
                      label="Deposit Payment Method"
                      value={workNotesForm.payment_method_ids[0] ?? null}
                      valueLabel={item.payment_method_names[0] ?? undefined}
                      onChange={(value) => setDepositAndFinalPaymentMethods(value, workNotesForm.payment_method_ids[1] ?? null)}
                      loadOptions={async () => (await apiClient.listPaymentMethods("")).items}
                      placeholder="Select deposit payment method"
                      onAddNew={(label) => apiClient.createPaymentMethod(label)}
                    />
                    <SingleDropdown
                      label="Final Payment Method"
                      value={workNotesForm.payment_method_ids[1] ?? null}
                      valueLabel={item.payment_method_names[1] ?? undefined}
                      onChange={(value) => setDepositAndFinalPaymentMethods(workNotesForm.payment_method_ids[0] ?? null, value)}
                      loadOptions={async () => (await apiClient.listPaymentMethods("")).items}
                      placeholder="Select final payment method"
                      onAddNew={(label) => apiClient.createPaymentMethod(label)}
                    />
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">Parts (from line totals)</label>
                      <Input value={totalsForm.parts_total} disabled />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">Delivery</label>
                      <Input value={totalsForm.delivery_total} onChange={(e) => setTotalsForm((prev) => ({ ...prev, delivery_total: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">Labour</label>
                      <Input value={totalsForm.labour_total} onChange={(e) => setTotalsForm((prev) => ({ ...prev, labour_total: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">Deposit</label>
                      <Input
                        value={totalsForm.deposit}
                        className={cn(fieldErrors.deposit && "border-destructive focus-visible:ring-destructive")}
                        onChange={(e) => {
                          setTotalsForm((prev) => ({ ...prev, deposit: e.target.value }));
                          setFieldErrors((prev) => ({ ...prev, deposit: undefined }));
                        }}
                      />
                      {fieldErrors.deposit && <p className="mt-1 text-xs text-destructive">{fieldErrors.deposit}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveTotals} disabled={savingSection === "totals"}>{savingSection === "totals" ? "Saving..." : "Save"}</Button>
                    <Button size="sm" variant="outline" onClick={cancelEditing} disabled={savingSection === "totals"}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  {detailRow("Deposit Payment Method", item.payment_method_names[0] ?? "-")}
                  {detailRow("Final Payment Method", item.payment_method_names[1] ?? "-")}
                  {detailRow("Parts", formatCurrency(item.parts_total))}
                  {detailRow("Delivery", formatCurrency(item.delivery_total))}
                  {detailRow("Labour", formatCurrency(item.labour_total))}
                  {detailRow("Deposit", formatCurrency(item.deposit))}
                </>
              )}
            </div>
          </article>
          </>
          )}

          {(canReadRepairLogs || canCreateRepairLogs) && (
            <article className="rounded-lg border border-border bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Repair Logs</h2>
                <div className="flex flex-wrap items-center gap-2">
                  {loadingExtras && <span className="text-xs text-muted-foreground">Loading...</span>}
                  {canUpdateStatus &&
                    item.status_key !== "finished" &&
                    item.status_name?.trim().toLowerCase() !== "finished" && (
                    <Button size="sm" variant="outline" onClick={completeJob} disabled={completingJob}>
                      {completingJob ? "Completing..." : "Complete Job"}
                    </Button>
                    )}
                  {canCreateRepairLogs && (
                    <Button size="sm" onClick={openCreateRepairLogModal}>
                      Add Repair Log
                    </Button>
                  )}
                </div>
              </div>

              {canCreateRepairLogs && (
                <Dialog open={repairLogModalOpen} onOpenChange={setRepairLogModalOpen}>
                  <DialogContent className="max-w-xl">
                    <DialogTitle className="text-lg font-semibold">{editingRepairLogID !== null ? "Edit Repair Log" : "Add Repair Log"}</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground">
                      Record time spent and repair details for this work order.
                    </DialogDescription>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm text-muted-foreground">Repair Date</label>
                        <Input
                          type="date"
                          value={repairLogForm.repair_date}
                          onChange={(e) => setRepairLogForm((prev) => ({ ...prev, repair_date: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-muted-foreground">Hours Used</label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={repairLogForm.hours_used}
                          onChange={(e) => setRepairLogForm((prev) => ({ ...prev, hours_used: e.target.value }))}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-sm text-muted-foreground">Details</label>
                        <div className="rounded-md border border-input bg-white p-2">
                          <MDXEditor
                            markdown={repairLogForm.details}
                            contentEditableClassName={workNotesEditorContentClassName}
                            onChange={(value) => setRepairLogForm((prev) => ({ ...prev, details: value }))}
                            plugins={workNotesEditorPlugins}
                          />
                        </div>
                      </div>
                      <div className="md:col-span-2 flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setRepairLogModalOpen(false);
                            setEditingRepairLogID(null);
                          }}
                          disabled={savingRepairLog}
                        >
                          Cancel
                        </Button>
                        <Button onClick={saveRepairLog} disabled={savingRepairLog}>
                          {savingRepairLog ? "Saving..." : editingRepairLogID !== null ? "Save Changes" : "Save Repair Log"}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}

              {canReadRepairLogs && (
                <div className="relative space-y-4 pl-6">
                  <div className="absolute bottom-0 left-[11px] top-0 w-px bg-border" />
                  {repairLogs.length === 0 && <p className="text-sm text-muted-foreground">No repair logs yet.</p>}
                  {repairLogs.map((log) => (
                    <div key={log.repair_log_id} className="relative">
                      <div className="absolute -left-[19px] top-5 h-4 w-4 rounded-full border-2 border-white bg-primary shadow" />
                      <div className="rounded-lg p-2">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">{formatDateTime(log.repair_date)}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge className="bg-slate-100 text-slate-700">{`${log.hours_used} hrs`}</Badge>
                            <span>{log.created_by_name ?? log.created_by_user_id}</span>
                            {(canUpdateRepairLogs || canDeleteRepairLogs) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-lg font-bold text-slate-500 hover:bg-slate-100">⋮</Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {canUpdateRepairLogs && (
                                    <DropdownMenuItem onClick={() => openEditRepairLogModal(log)}>Edit</DropdownMenuItem>
                                  )}
                                  {canDeleteRepairLogs && (
                                    <DropdownMenuItem onClick={() => setRepairLogDeleteTarget(log)}>Delete</DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </div>
                        <div className="text-sm leading-6">{markdownPlain(log.details)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )}

          {(canReadPartsRequests || canCreatePartsRequests) && (
            <article className="rounded-lg border border-border bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Parts Purchase Requests</h2>
                <div className="flex flex-wrap items-center gap-2">
                  {loadingExtras && <span className="text-xs text-muted-foreground">Loading...</span>}
                  {canCreatePartsRequests && (
                    <Button size="sm" className="h-auto whitespace-normal py-2 text-center leading-tight" onClick={openCreatePartsRequestModal}>
                      Add Parts Request
                    </Button>
                  )}
                </div>
              </div>

              {canCreatePartsRequests && (
                <Dialog open={partsRequestModalOpen} onOpenChange={setPartsRequestModalOpen}>
                  <DialogContent className="max-w-2xl">
                    <DialogTitle className="text-lg font-semibold">
                      {editingPartsRequestID !== null ? "Edit Parts Purchase Request" : "Create Parts Purchase Request"}
                    </DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground">
                      Fill details for parts procurement.
                    </DialogDescription>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm text-muted-foreground">Item Name</label>
                        <Input
                          value={partsRequestForm.item_name}
                          onChange={(e) => setPartsRequestForm((prev) => ({ ...prev, item_name: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-muted-foreground">Quantity</label>
                        <Input
                          type="number"
                          min={1}
                          value={partsRequestForm.quantity}
                          onChange={(e) => setPartsRequestForm((prev) => ({ ...prev, quantity: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-muted-foreground">Source</label>
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                          value={partsRequestForm.source}
                          onChange={(e) => setPartsRequestForm((prev) => ({ ...prev, source: e.target.value as "online" | "supplier" }))}
                        >
                          <option value="online">Online</option>
                          <option value="supplier">Supplier</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-muted-foreground">Source URL</label>
                        <Input
                          value={partsRequestForm.source_url}
                          onChange={(e) => setPartsRequestForm((prev) => ({ ...prev, source_url: e.target.value }))}
                          placeholder="https://..."
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-muted-foreground">Total Price</label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={partsRequestForm.total_price}
                          onChange={(e) => setPartsRequestForm((prev) => ({ ...prev, total_price: e.target.value }))}
                        />
                      </div>
                      <div className="md:col-span-2 flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPartsRequestModalOpen(false);
                            setEditingPartsRequestID(null);
                            setEditingPartsRequestStatus(null);
                          }}
                          disabled={savingPartsRequest}
                        >
                          Cancel
                        </Button>
                        {editingPartsRequestID === null ? (
                          <>
                            <Button variant="outline" onClick={() => savePartsRequest("draft")} disabled={savingPartsRequest}>
                              {savingPartsRequest ? "Saving..." : "Save Draft"}
                            </Button>
                            <Button onClick={() => savePartsRequest("waiting_approval")} disabled={savingPartsRequest}>
                              {savingPartsRequest ? "Saving..." : "Submit"}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button onClick={() => savePartsRequest("draft")} disabled={savingPartsRequest}>
                              {savingPartsRequest ? "Saving..." : "Save Changes"}
                            </Button>
                            {editingPartsRequestStatus === "draft" && (
                              <Button onClick={() => savePartsRequest("waiting_approval")} disabled={savingPartsRequest}>
                                {savingPartsRequest ? "Saving..." : "Submit"}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}

              {canReadPartsRequests && (
                <div className="overflow-x-auto">
                <Table className="min-w-[900px]">
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th className="w-[90px]">Qty</Th>
                      <Th className="w-[120px]">Source</Th>
                      <Th className="w-[160px]">Status</Th>
                      <Th className="w-[140px]">Total</Th>
                      <Th>URL</Th>
                      <Th className="w-[180px]">User</Th>
                      {(canUpdatePartsRequests || canDeletePartsRequests || (canViewSensitive && canUpdatePartsRequests)) && <Th className="w-[70px]" />}
                    </tr>
                  </thead>
                  <tbody>
                    {partsRequests.length === 0 && (
                      <tr>
                        <Td colSpan={(canUpdatePartsRequests || canDeletePartsRequests || (canViewSensitive && canUpdatePartsRequests)) ? 8 : 7}>No parts purchase requests yet.</Td>
                      </tr>
                    )}
                    {partsRequests.map((request) => (
                      <tr key={request.parts_purchase_request_id}>
                        <Td>{request.item_name}</Td>
                        <Td>{request.quantity}</Td>
                        <Td className="capitalize">{request.source}</Td>
                        <Td>{request.status.replace("_", " ")}</Td>
                        <Td>{formatCurrency(request.total_price)}</Td>
                        <Td>
                          {request.source_url ? (
                            <a href={request.source_url} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                              Open
                            </a>
                          ) : (
                            "-"
                          )}
                        </Td>
                        <Td>{request.created_by_name ?? request.created_by_user_id}</Td>
                        {(canUpdatePartsRequests || canDeletePartsRequests || (canViewSensitive && canUpdatePartsRequests)) && (
                          <Td>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-lg font-bold text-slate-500 hover:bg-slate-100">⋮</Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canUpdatePartsRequests && (
                                  <DropdownMenuItem onClick={() => openEditPartsRequestModal(request)}>Edit</DropdownMenuItem>
                                )}
                                {canDeletePartsRequests && (
                                  <DropdownMenuItem onClick={() => setPartsRequestDeleteTarget(request)}>Delete</DropdownMenuItem>
                                )}
                                {canViewSensitive && canUpdatePartsRequests && request.status !== "ordered" && (
                                  <DropdownMenuItem onClick={() => markPartsRequestOrdered(request)}>Mark as Ordered</DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </Td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
                </div>
              )}
            </article>
          )}
        </div>

        <div className="space-y-4">
          {equipmentBlock}

          <aside className="rounded-lg border border-border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Customer</h2>
              <div className="flex items-center gap-2">
                {editingSection !== "customer" && item.customer.customer_id !== null && item.customer.customer_id > 0 && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/work-orders?customer_id=${item.customer.customer_id}`}>View Jobs</Link>
                  </Button>
                )}
                {canEdit && canViewSensitive && editingSection !== "customer" && <Button variant="outline" size="sm" onClick={() => setEditingSection("customer")}>Edit</Button>}
              </div>
            </div>

            {editingSection === "customer" && canViewSensitive ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">First Name</label>
                    <Input value={customerForm.first_name} onChange={(e) => setCustomerForm((prev) => ({ ...prev, first_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">Last Name</label>
                    <Input value={customerForm.last_name} onChange={(e) => setCustomerForm((prev) => ({ ...prev, last_name: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Email</label>
                  <Input
                    type="email"
                    className={cn(fieldErrors.email && "border-destructive focus-visible:ring-destructive")}
                    value={customerForm.email}
                    onChange={(e) => {
                      setCustomerForm((prev) => ({ ...prev, email: e.target.value }));
                      setFieldErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                  />
                  {fieldErrors.email && <p className="mt-1 text-xs text-destructive">{fieldErrors.email}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">Home Phone</label>
                    <Input
                      className={cn(fieldErrors.home_phone && "border-destructive focus-visible:ring-destructive")}
                      value={customerForm.home_phone}
                      onChange={(e) => {
                        setCustomerForm((prev) => ({ ...prev, home_phone: e.target.value }));
                        setFieldErrors((prev) => ({ ...prev, home_phone: undefined }));
                      }}
                    />
                    {fieldErrors.home_phone && <p className="mt-1 text-xs text-destructive">{fieldErrors.home_phone}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">Work Phone</label>
                    <Input
                      className={cn(fieldErrors.work_phone && "border-destructive focus-visible:ring-destructive")}
                      value={customerForm.work_phone}
                      onChange={(e) => {
                        setCustomerForm((prev) => ({ ...prev, work_phone: e.target.value }));
                        setFieldErrors((prev) => ({ ...prev, work_phone: undefined }));
                      }}
                    />
                    {fieldErrors.work_phone && <p className="mt-1 text-xs text-destructive">{fieldErrors.work_phone}</p>}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Extension</label>
                  <Input value={customerForm.extension_text} onChange={(e) => setCustomerForm((prev) => ({ ...prev, extension_text: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Address</label>
                  <Input value={customerForm.address_line_1} onChange={(e) => setCustomerForm((prev) => ({ ...prev, address_line_1: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Address 2</label>
                  <Input value={customerForm.address_line_2} onChange={(e) => setCustomerForm((prev) => ({ ...prev, address_line_2: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">City</label>
                    <Input value={customerForm.city} onChange={(e) => setCustomerForm((prev) => ({ ...prev, city: e.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">Province</label>
                    <Input value={customerForm.province} onChange={(e) => setCustomerForm((prev) => ({ ...prev, province: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveCustomer} disabled={savingSection === "customer"}>{savingSection === "customer" ? "Saving..." : "Save"}</Button>
                  <Button size="sm" variant="outline" onClick={cancelEditing} disabled={savingSection === "customer"}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                {detailRow("Name", fullName(item.customer.first_name, item.customer.last_name))}
                {canViewSensitive && (
                  <>
                    {detailRow("Email", item.customer.email ?? "-")}
                    {detailRow("Home Phone", item.customer.home_phone ?? "-")}
                    {detailRow("Work Phone", item.customer.work_phone ?? "-")}
                    {detailRow("Extension", item.customer.extension_text ?? "-")}
                    {detailRow("Address", item.customer.address_line_1 ?? "-")}
                    {detailRow("Address 2", item.customer.address_line_2 ?? "-")}
                    {detailRow("City", item.customer.city ?? "-")}
                    {detailRow("Province", item.customer.province ?? "-")}
                  </>
                )}
              </>
            )}
          </aside>

          <aside className="rounded-lg border border-border bg-white p-4 space-y-2">
            <h2 className="font-semibold">Meta</h2>
            {detailRow("Created At", formatDateTime(item.created_at))}
            {detailRow("Updated At", formatDateTime(item.updated_at))}
            {detailRow("Status", item.status_name ?? "-")}
          </aside>
        </div>
      </div>

      {canAdminDeleteJob && (
        <article className="rounded-lg border border-destructive/30 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-destructive">Danger Zone</h2>
              <p className="text-sm text-muted-foreground">Deleting this job is permanent and cannot be undone.</p>
            </div>
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setDeleteWorkOrderOpen(true)}
            >
              Delete Job
            </Button>
          </div>
        </article>
      )}

      <AlertDialog
        open={repairLogDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletingRepairLog) setRepairLogDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete repair log?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRepairLog}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteRepairLog} disabled={deletingRepairLog}>
              {deletingRepairLog ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={partsRequestDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletingPartsRequest) setPartsRequestDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete parts request?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPartsRequest}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePartsRequest} disabled={deletingPartsRequest}>
              {deletingPartsRequest ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteWorkOrderOpen}
        onOpenChange={(open) => {
          if (!open && !deletingWorkOrder) setDeleteWorkOrderOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure? If deleted, it cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingWorkOrder}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteWorkOrder} disabled={deletingWorkOrder}>
              {deletingWorkOrder ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

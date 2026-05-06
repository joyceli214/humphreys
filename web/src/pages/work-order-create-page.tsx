"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "@/lib/api/client";
import type { LookupOption, WorkOrderListItem } from "@/lib/api/generated/types";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { CustomerSearchableDropdown } from "@/components/work-order-dropdowns/customer-searchable-dropdown";
import { SingleSearchableDropdown } from "@/components/work-order-dropdowns/single-searchable-dropdown";
import { MultiSearchableDropdown } from "@/components/work-order-dropdowns/multi-searchable-dropdown";
import { useAlerts } from "@/lib/alerts/alert-context";
import { cn } from "@/lib/utils";
import { formatPhoneNumber, phoneDigits } from "@/lib/phone";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  InsertImage,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  headingsPlugin,
  imagePlugin,
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

async function markdownImageUploadHandler(file: File) {
  const { url } = await apiClient.uploadMarkdownImage(file);
  return url;
}

const workNotesEditorPlugins = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  imagePlugin({
    imageUploadHandler: markdownImageUploadHandler,
    disableImageSettingsButton: true
  }),
  markdownShortcutPlugin(),
  toolbarPlugin({
    toolbarContents: () => (
      <>
        <UndoRedo />
        <BoldItalicUnderlineToggles />
        <ListsToggle />
        <CreateLink />
        <InsertImage />
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
  "[&_img]:my-3 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold " +
  "[&_hr]:my-3 [&_hr]:border-border";

type WorkOrderListFilters = {
  customerId: number | null;
  statusId: number | null;
  jobTypeId: number | null;
  itemId: number | null;
  createdFrom: string;
  createdTo: string;
};

type CreateFormState = {
  createStep: number;
  creationMode: "new_job" | "stock";
  customerMode: "existing" | "new";
  selectedCustomerId: number | null;
  selectedCustomerLabel: string;
  newCustomerName: string;
  newCustomerEmail: string;
  newCustomerHomePhone: string;
  newCustomerWorkPhone: string;
  newCustomerAddress1: string;
  newCustomerAddress2: string;
  newCustomerCity: string;
  newCustomerProvince: string;
  newCustomerPostalCode: string;
  newCustomerRemark: string;
  problemDescription: string;
  remoteControlQty: string;
  cableQty: string;
  cordQty: string;
  dvdVhsQty: string;
  albumCdCassetteQty: string;
  deposit: string;
  itemId: number | null;
  locationId: number | null;
  brandIds: number[];
  modelNumber: string;
  serialNumber: string;
  depositPaymentMethodId: string;
};

const initialCreateFormState: CreateFormState = {
  createStep: 1,
  creationMode: "new_job",
  customerMode: "existing",
  selectedCustomerId: null,
  selectedCustomerLabel: "",
  newCustomerName: "",
  newCustomerEmail: "",
  newCustomerHomePhone: "",
  newCustomerWorkPhone: "",
  newCustomerAddress1: "",
  newCustomerAddress2: "",
  newCustomerCity: "",
  newCustomerProvince: "",
  newCustomerPostalCode: "",
  newCustomerRemark: "",
  problemDescription: "",
  remoteControlQty: "0",
  cableQty: "0",
  cordQty: "0",
  dvdVhsQty: "0",
  albumCdCassetteQty: "0",
  deposit: "0",
  itemId: null,
  locationId: null,
  brandIds: [],
  modelNumber: "",
  serialNumber: "",
  depositPaymentMethodId: ""
};

function parsePositiveIntParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function WorkOrderCreatePage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
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
  const [createForm, setCreateForm] = useState<CreateFormState>(initialCreateFormState);
  const [creating, setCreating] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<LookupOption[]>([]);
  const [itemOptions, setItemOptions] = useState<LookupOption[]>([]);
  const [brandOptions, setBrandOptions] = useState<LookupOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<LookupOption[]>([]);
  const [provinceOptions, setProvinceOptions] = useState<string[]>([]);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [frozenDropdowns, setFrozenDropdowns] = useState<Record<string, boolean>>({});
  const [updatingLocationByReferenceID, setUpdatingLocationByReferenceID] = useState<Record<number, boolean>>({});
  const {
    createStep,
    creationMode,
    customerMode,
    selectedCustomerId,
    selectedCustomerLabel,
    newCustomerName,
    newCustomerEmail,
    newCustomerHomePhone,
    newCustomerWorkPhone,
    newCustomerAddress1,
    newCustomerAddress2,
    newCustomerCity,
    newCustomerProvince,
    newCustomerPostalCode,
    newCustomerRemark,
    problemDescription,
    remoteControlQty,
    cableQty,
    cordQty,
    dvdVhsQty,
    albumCdCassetteQty,
    deposit,
    itemId,
    locationId,
    brandIds,
    modelNumber,
    serialNumber,
    depositPaymentMethodId
  } = createForm;
  const provinceLookupOptions = useMemo(
    () => provinceOptions.map((label, index) => ({ id: index + 1, label })),
    [provinceOptions]
  );
  const cityLookupOptions = useMemo(
    () => cityOptions.map((label, index) => ({ id: index + 1, label })),
    [cityOptions]
  );
  const selectedProvinceOptionId = useMemo(
    () => provinceLookupOptions.find((option) => option.label === newCustomerProvince)?.id ?? null,
    [newCustomerProvince, provinceLookupOptions]
  );
  const selectedCityOptionId = useMemo(
    () => cityLookupOptions.find((option) => option.label === newCustomerCity)?.id ?? null,
    [cityLookupOptions, newCustomerCity]
  );
  const setCreateStep = (next: number | ((prev: number) => number)) =>
    setCreateForm((prev) => ({ ...prev, createStep: typeof next === "function" ? next(prev.createStep) : next }));
  const setCreationMode = (value: "new_job" | "stock") => setCreateForm((prev) => ({ ...prev, creationMode: value }));
  const setCustomerMode = (value: "existing" | "new") => setCreateForm((prev) => ({ ...prev, customerMode: value }));
  const setSelectedCustomerId = (value: number | null) => setCreateForm((prev) => ({ ...prev, selectedCustomerId: value }));
  const setSelectedCustomerLabel = (value: string) => setCreateForm((prev) => ({ ...prev, selectedCustomerLabel: value }));
  const setNewCustomerName = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerName: value }));
  const setNewCustomerEmail = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerEmail: value }));
  const setNewCustomerHomePhone = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerHomePhone: value }));
  const setNewCustomerWorkPhone = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerWorkPhone: value }));
  const setNewCustomerAddress1 = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerAddress1: value }));
  const setNewCustomerAddress2 = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerAddress2: value }));
  const setNewCustomerCity = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerCity: value }));
  const setNewCustomerProvince = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerProvince: value }));
  const setNewCustomerPostalCode = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerPostalCode: value }));
  const setNewCustomerRemark = (value: string) => setCreateForm((prev) => ({ ...prev, newCustomerRemark: value }));
  const setProblemDescription = (value: string) => setCreateForm((prev) => ({ ...prev, problemDescription: value }));
  const setRemoteControlQty = (value: string) => setCreateForm((prev) => ({ ...prev, remoteControlQty: value }));
  const setCableQty = (value: string) => setCreateForm((prev) => ({ ...prev, cableQty: value }));
  const setCordQty = (value: string) => setCreateForm((prev) => ({ ...prev, cordQty: value }));
  const setDvdVhsQty = (value: string) => setCreateForm((prev) => ({ ...prev, dvdVhsQty: value }));
  const setAlbumCdCassetteQty = (value: string) => setCreateForm((prev) => ({ ...prev, albumCdCassetteQty: value }));
  const setDeposit = (value: string) => setCreateForm((prev) => ({ ...prev, deposit: value }));
  const setItemId = (value: number | null) => setCreateForm((prev) => ({ ...prev, itemId: value }));
  const setLocationId = (value: number | null) => setCreateForm((prev) => ({ ...prev, locationId: value }));
  const setBrandIds = (value: number[]) => setCreateForm((prev) => ({ ...prev, brandIds: value }));
  const setModelNumber = (value: string) => setCreateForm((prev) => ({ ...prev, modelNumber: value }));
  const setSerialNumber = (value: string) => setCreateForm((prev) => ({ ...prev, serialNumber: value }));
  const setDepositPaymentMethodId = (value: string) => setCreateForm((prev) => ({ ...prev, depositPaymentMethodId: value }));
  const isCreateRoute = true;
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
    Promise.all([
      apiClient.listPaymentMethods(""),
      apiClient.listItems(""),
      apiClient.listBrands(""),
      apiClient.listLocations("")
    ])
      .then(([paymentRes, itemsRes, brandsRes, locationsRes]) => {
        setPaymentMethods(paymentRes.items);
        setItemOptions(itemsRes.items);
        setBrandOptions(brandsRes.items);
        setLocationOptions(locationsRes.items);
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
    setCreateForm(initialCreateFormState);
  };

  const clearCustomerFields = () => {
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerHomePhone("");
    setNewCustomerWorkPhone("");
    setNewCustomerAddress1("");
    setNewCustomerAddress2("");
    setNewCustomerCity("");
    setNewCustomerProvince("");
    setNewCustomerPostalCode("");
    setNewCustomerRemark("");
  };

  const openCreateModal = (mode: "new_job" | "stock") => {
    resetCreateForm();
    setCreateStep(1);
    setCreationMode(mode);
    if (mode === "new_job") {
      setCustomerMode("existing");
    } else {
      setCustomerMode("new");
    }
    setCreateOpen(true);
  };

  const closeCreateFlow = () => {
    setCreateOpen(false);
    resetCreateForm();
    navigate("/work-orders");
  };

  const loadProvinceOptions = async () => {
    try {
      const res = await fetch("https://countriesnow.space/api/v0.1/countries/states");
      if (!res.ok) return;
      const json = (await res.json()) as {
        error: boolean;
        data?: Array<{ name: string; states: Array<{ name: string }> }>;
      };
      const canada = json.data?.find((country) => country.name === "Canada");
      const options = (canada?.states ?? [])
        .map((state) => state.name.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setProvinceOptions(options);
    } catch {
      setProvinceOptions([]);
    }
  };

  const loadCityOptions = async (province: string) => {
    const state = province.trim();
    if (!state) {
      setCityOptions([]);
      return;
    }
    try {
      const params = new URLSearchParams({ country: "Canada", state });
      const res = await fetch(`https://countriesnow.space/api/v0.1/countries/state/cities/q?${params.toString()}`);
      if (!res.ok) return;
      const json = (await res.json()) as { error: boolean; data?: string[] };
      const options = (json.data ?? [])
        .map((city) => city.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setCityOptions(options);
    } catch {
      setCityOptions([]);
    }
  };

  useEffect(() => {
    if (!createOpen) return;
    void loadProvinceOptions();
  }, [createOpen]);

  useEffect(() => {
    if (!canCreateWorkOrders) return;
    if (!isCreateRoute) return;
    if (createOpen) return;
    const modeParam = searchParams.get("mode");
    const mode = modeParam === "stock" ? "stock" : "new_job";
    openCreateModal(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreateWorkOrders, createOpen, isCreateRoute, searchParams]);

  useEffect(() => {
    if (!canCreateWorkOrders) return;
    if (isCreateRoute) return;
    const createParam = searchParams.get("create");
    if (createParam !== "new_job" && createParam !== "stock") return;
    navigate(`/work-orders/create?mode=${createParam}`, { replace: true });
  }, [canCreateWorkOrders, isCreateRoute, navigate, searchParams]);

  const createSteps = creationMode === "stock"
    ? (["Equipment", "Confirmation"] as const)
    : (["Customer Info", "Equipment", "Payment", "Confirmation"] as const);
  const equipmentStep = creationMode === "stock" ? 1 : 2;
  const paymentStep = creationMode === "stock" ? null : 3;
  const confirmationStep = creationMode === "stock" ? 2 : 4;
  const canGoNextStep = createStep < createSteps.length;
  const canGoPrevStep = createStep > 1;

  const validateCustomerStep = () => {
    if (creationMode !== "new_job") return true;
    if (customerMode === "existing" && !selectedCustomerId) {
      alerts.error("Customer required", "Select an existing customer.");
      return false;
    }
    if (customerMode === "new") {
      if (!newCustomerName.trim()) {
        alerts.error("Customer name required", "Enter a customer name.");
        return false;
      }
      const home = newCustomerHomePhone.trim();
      const work = newCustomerWorkPhone.trim();
      if (!home && !work) {
        alerts.error("Customer phone required", "Enter a home phone or work phone.");
        return false;
      }
      if (home && !/^\d+$/.test(home)) {
        alerts.error("Invalid phone", "Home phone must contain digits only.");
        return false;
      }
      if (work && !/^\d+$/.test(work)) {
        alerts.error("Invalid phone", "Work phone must contain digits only.");
        return false;
      }
    }
    return true;
  };

  const validateEquipmentStep = () => {
    const parsedRemote = parseNonNegativeInt(remoteControlQty);
    const parsedCable = parseNonNegativeInt(cableQty);
    const parsedCord = parseNonNegativeInt(cordQty);
    const parsedDVDVHS = parseNonNegativeInt(dvdVhsQty);
    const parsedAlbum = parseNonNegativeInt(albumCdCassetteQty);
    if (parsedRemote === null || parsedCable === null || parsedCord === null || parsedDVDVHS === null || parsedAlbum === null) {
      alerts.error("Invalid quantities", "Quantities must be whole numbers zero or greater.");
      return false;
    }
    return true;
  };

  const validatePaymentStep = () => {
    const parsedDeposit = Number(deposit.trim());
    if (!Number.isFinite(parsedDeposit) || parsedDeposit < 0) {
      alerts.error("Invalid deposit", "Deposit must be zero or greater.");
      return false;
    }
    const parsedDepositPaymentMethodID = Number(depositPaymentMethodId);
    if (parsedDeposit > 0 && (!Number.isInteger(parsedDepositPaymentMethodID) || parsedDepositPaymentMethodID <= 0)) {
      alerts.error("Payment method required", "Select a deposit payment method.");
      return false;
    }
    return true;
  };

  const handleCreateNextStep = () => {
    if (createStep === 1 && !validateCustomerStep()) return;
    if (createStep === equipmentStep && !validateEquipmentStep()) return;
    if (paymentStep !== null && createStep === paymentStep && !validatePaymentStep()) return;
    if (canGoNextStep) setCreateStep((prev) => prev + 1);
  };

  const validateCreateStepByNumber = (step: number) => {
    if (step === equipmentStep) return validateEquipmentStep();
    if (paymentStep !== null && step === paymentStep) return validatePaymentStep();
    if (step === 1) return validateCustomerStep();
    return true;
  };

  const goToCreateStep = (targetStep: number) => {
    if (targetStep === createStep) return;
    if (targetStep < 1 || targetStep > createSteps.length) return;
    if (targetStep < createStep) {
      setCreateStep(targetStep);
      return;
    }
    for (let step = createStep; step < targetStep; step += 1) {
      if (!validateCreateStepByNumber(step)) return;
    }
    setCreateStep(targetStep);
  };

  const handleCreateWorkOrder = async () => {
    if (!validateCustomerStep() || !validateEquipmentStep() || !validatePaymentStep()) return;

    const parsedRemote = parseNonNegativeInt(remoteControlQty);
    const parsedCable = parseNonNegativeInt(cableQty);
    const parsedCord = parseNonNegativeInt(cordQty);
    const parsedDVDVHS = parseNonNegativeInt(dvdVhsQty);
    const parsedAlbum = parseNonNegativeInt(albumCdCassetteQty);
    if (parsedRemote === null || parsedCable === null || parsedCord === null || parsedDVDVHS === null || parsedAlbum === null) return;

    const parsedDeposit = Number(deposit.trim());
    const parsedDepositPaymentMethodID = Number(depositPaymentMethodId);

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
                postal_code: newCustomerPostalCode.trim() || undefined,
                remark: newCustomerRemark.trim() || undefined,
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
                postal_code: newCustomerPostalCode.trim() || undefined,
                remark: newCustomerRemark.trim() || undefined,
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
      if (problemDescription.trim()) {
        await apiClient.updateWorkOrderWorkNotes(created.reference_id, {
          problem_description: problemDescription.trim(),
          worker_ids: [],
          work_done: null,
          payment_method_ids: []
        });
      }
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
  };

  if (!hasPermission("work_orders:read")) {
    return null;
  }

  return (
    <section className="space-y-4">
      {!isCreateRoute && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold">Work Orders</h1>
              <p className="text-sm text-muted-foreground">
                {canViewSensitive
                  ? "Browse imported service work orders and open full details."
                  : "Browse work orders with a simplified, staff-safe view."}
              </p>
            </div>
            {canCreateWorkOrders && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>Create New Work Order</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate("/work-orders/create?mode=new_job")}>Create New Job</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/work-orders/create?mode=stock")}>Create Stock</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </>
      )}

      {isCreateRoute && (
        <section className="min-h-[calc(100dvh-170px)] rounded-xl">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{creationMode === "stock" ? "Create Stock" : "Create New Work Order"}</h1>
              <p className="text-sm text-muted-foreground">
                {creationMode === "stock" ? "Create a stock intake record." : "Use an existing customer or create a new one."}
              </p>
            </div>
            <Button type="button" variant="outline" className="h-8 rounded-md px-3 text-xs" onClick={closeCreateFlow}>
              Back to Work Orders
            </Button>
          </div>

          <div className="mx-auto mb-6 w-full max-w-2xl overflow-hidden">
            <div className="grid w-full grid-cols-4 gap-x-0 px-1">
            {createSteps.map((step, index) => {
              const stepNumber = index + 1;
              const active = createStep === stepNumber;
              const complete = createStep > stepNumber;
              const isLast = index === createSteps.length - 1;
              return (
                <div key={step} className="min-w-0">
                  <button
                    type="button"
                    className="relative w-full min-w-0 px-0 text-center"
                    onClick={() => goToCreateStep(stepNumber)}
                  >
                    <div className="relative flex items-center justify-center">
                    {!isLast && (
                      <span
                        className={cn(
                          "absolute left-[calc(50%+11px)] right-[calc(-50%+11px)] top-1/2 h-px -translate-y-1/2",
                          complete ? "bg-sky-200" : "bg-slate-200"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium",
                        complete ? "border-sky-600 bg-sky-600 text-white" : active ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 bg-white text-slate-500"
                      )}
                    >
                      {stepNumber}
                    </span>
                  </div>
                  <p className={cn("mt-1 truncate text-center text-xs font-medium leading-tight sm:text-sm", active ? "text-slate-900" : "text-slate-500")}>
                    {step}
                  </p>
                  </button>
                </div>
              );
            })}
            </div>
          </div>

          <div className="mx-auto max-w-2xl rounded-lg border border-border bg-white p-3 md:p-4">
            <div className="space-y-4">
              {createStep === 1 && creationMode === "new_job" && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700">Customer</p>
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
                        setNewCustomerAddress1(option.address_line_1 ?? "");
                        setNewCustomerAddress2(option.address_line_2 ?? "");
                        setNewCustomerCity(option.city ?? "");
                        setNewCustomerProvince(option.province ?? "");
                        setNewCustomerPostalCode(option.postal_code ?? "");
                        setNewCustomerRemark(option.remark ?? "");
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
                {(customerMode === "new" || selectedCustomerId) && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700">Basic Info</p>
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
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700">Address</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-sm">Address</label>
                          <Input value={newCustomerAddress1} onChange={(e) => setNewCustomerAddress1(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm">Apartment, Suite, etc.</label>
                          <Input value={newCustomerAddress2} onChange={(e) => setNewCustomerAddress2(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm">Province</label>
                          <SingleSearchableDropdown
                            value={selectedProvinceOptionId}
                            valueLabel={newCustomerProvince}
                            onChange={(id) => {
                              const selected = provinceLookupOptions.find((option) => option.id === id);
                              const province = selected?.label ?? "";
                              setNewCustomerProvince(province);
                              setNewCustomerCity("");
                              void loadCityOptions(province);
                            }}
                            loadOptions={async (q) => {
                              const needle = q.trim().toLowerCase();
                              if (!needle) return provinceLookupOptions;
                              return provinceLookupOptions.filter((option) => option.label.toLowerCase().includes(needle));
                            }}
                            placeholder="Select province"
                            allowClear
                            clearLabel="None"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm">City</label>
                          <SingleSearchableDropdown
                            value={selectedCityOptionId}
                            valueLabel={newCustomerCity}
                            onChange={(id) => {
                              const selected = cityLookupOptions.find((option) => option.id === id);
                              setNewCustomerCity(selected?.label ?? "");
                            }}
                            loadOptions={async (q) => {
                              const needle = q.trim().toLowerCase();
                              if (!needle) return cityLookupOptions;
                              return cityLookupOptions.filter((option) => option.label.toLowerCase().includes(needle));
                            }}
                            placeholder={newCustomerProvince ? "Select city" : "Select province first"}
                            allowClear
                            clearLabel="None"
                            disabled={!newCustomerProvince}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm">Postal Code</label>
                          <Input
                            value={newCustomerPostalCode}
                            onChange={(e) => setNewCustomerPostalCode(e.target.value.toUpperCase())}
                            placeholder="A1A 1A1"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm">Remark</label>
                          <Input value={newCustomerRemark} onChange={(e) => setNewCustomerRemark(e.target.value)} placeholder="Door code, access note, etc." />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}
              {createStep === equipmentStep && (
              <>
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700">Equipment</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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
                </div>
                <div className="space-y-1">
                  <label className="text-sm">Problem Description</label>
                  <div className="rounded-md border border-input bg-white p-2">
                    <MDXEditor
                      markdown={problemDescription}
                      contentEditableClassName={workNotesEditorContentClassName}
                      onChange={setProblemDescription}
                      plugins={workNotesEditorPlugins}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700">Quantities</p>
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
              </>
              )}

              {paymentStep !== null && createStep === paymentStep && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700">Deposit</p>
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
              )}

              {createStep === confirmationStep && (
                <div className="space-y-3">
                  <div className="space-y-3 text-sm">
                    {creationMode !== "stock" && (
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-slate-700">Customer Info</p>
                      <p><span className="font-medium">Customer:</span> {customerMode === "existing" ? (selectedCustomerLabel || "Existing selected") : (newCustomerName.trim() || "-")}</p>
                      <p><span className="font-medium">Email:</span> {newCustomerEmail.trim() || "-"}</p>
                      <p><span className="font-medium">Home Phone:</span> {formatPhoneNumber(newCustomerHomePhone) || "-"}</p>
                      <p><span className="font-medium">Work Phone:</span> {formatPhoneNumber(newCustomerWorkPhone) || "-"}</p>
                    </div>
                    )}
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-slate-700">Equipment</p>
                      <p><span className="font-medium">Item:</span> {itemOptions.find((x) => x.id === itemId)?.label ?? "-"}</p>
                      <p><span className="font-medium">Brands:</span> {brandIds.length ? brandIds.map((id) => brandOptions.find((x) => x.id === id)?.label ?? `#${id}`).join(", ") : "-"}</p>
                      <p><span className="font-medium">Model:</span> {modelNumber.trim() || "-"}</p>
                      <p><span className="font-medium">Serial:</span> {serialNumber.trim() || "-"}</p>
                      <p><span className="font-medium">Location:</span> {locationOptions.find((x) => x.id === locationId)?.label ?? "-"}</p>
                      <div className="space-y-2 pt-1">
                        <p className="font-medium">Problem Description</p>
                        <div>
                          {problemDescription.trim() ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeRaw]}
                              components={{
                                p: ({ children }) => <p className="mb-1.5 leading-6 last:mb-0">{children}</p>,
                                a: ({ children, href }) => (
                                  <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-all">
                                    {children}
                                  </a>
                                ),
                                ul: ({ children }) => <ul className="mb-2 list-disc pl-6">{children}</ul>,
                                ol: ({ children }) => <ol className="mb-2 list-decimal pl-6">{children}</ol>,
                                li: ({ children }) => <li>{children}</li>,
                                blockquote: ({ children }) => (
                                  <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
                                ),
                                strong: ({ children }) => <strong className="font-semibold">{children}</strong>
                              }}
                            >
                              {problemDescription}
                            </ReactMarkdown>
                          ) : (
                            <p>-</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-slate-700">Quantities</p>
                      <p><span className="font-medium">Remote Controls:</span> {remoteControlQty.trim() || "0"}</p>
                      <p><span className="font-medium">Cables:</span> {cableQty.trim() || "0"}</p>
                      <p><span className="font-medium">Cords:</span> {cordQty.trim() || "0"}</p>
                      <p><span className="font-medium">DVD/VHS:</span> {dvdVhsQty.trim() || "0"}</p>
                      <p><span className="font-medium">Album/CD/Cassette:</span> {albumCdCassetteQty.trim() || "0"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-slate-700">Payment</p>
                      <p><span className="font-medium">Deposit:</span> {deposit.trim() || "0"}</p>
                      <p><span className="font-medium">Payment Method:</span> {paymentMethods.find((x) => String(x.id) === depositPaymentMethodId)?.label ?? "-"}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                {canGoPrevStep && (
                  <Button type="button" variant="outline" disabled={creating} onClick={() => setCreateStep((prev) => prev - 1)}>
                    Back
                  </Button>
                )}
                {canGoNextStep ? (
                  <Button className="bg-sky-600 hover:bg-sky-700" type="button" disabled={creating} onClick={handleCreateNextStep}>
                    Next
                  </Button>
                ) : (
                <Button
                  className="bg-sky-600 hover:bg-sky-700"
                  type="button"
                  disabled={creating}
                  onClick={handleCreateWorkOrder}
                >
                  {creating ? "Creating..." : "Create Work Order"}
                </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
      {!isCreateRoute && (
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
      )}
    </section>
  );
}

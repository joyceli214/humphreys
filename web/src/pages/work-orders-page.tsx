"use client";

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "@/lib/api/client";
import type { WorkOrderListItem } from "@/lib/api/generated/types";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { CustomerSearchableDropdown } from "@/components/work-order-dropdowns/customer-searchable-dropdown";
import { SingleSearchableDropdown } from "@/components/work-order-dropdowns/single-searchable-dropdown";
import { useAlerts } from "@/lib/alerts/alert-context";

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

function statusClass(statusGroup: "to_do" | "in_progress" | "completed" | null | undefined) {
  if (statusGroup === "completed") return "bg-emerald-100 text-emerald-700";
  if (statusGroup === "in_progress") return "bg-amber-100 text-amber-700";
  if (statusGroup === "to_do") return "bg-sky-100 text-sky-700";
  return "bg-muted text-muted-foreground";
}

function formatLocationValue(locationID: number | null, locationShelf: string | null, locationFloor: number | null) {
  if (locationID == null && !locationShelf && locationFloor == null) return "-";
  const shelf = locationShelf?.trim() ? locationShelf : "-";
  const floor = locationFloor == null ? "-" : locationFloor === 0 ? "FLOOR" : String(locationFloor);
  return `${shelf}-${floor}`;
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
  const [frozenDropdowns, setFrozenDropdowns] = useState<Record<string, boolean>>({});
  const [updatingLocationByReferenceID, setUpdatingLocationByReferenceID] = useState<Record<number, boolean>>({});
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

  useEffect(() => {
    if (!canCreateWorkOrders) return;
    const createParam = searchParams.get("create");
    if (createParam !== "new_job" && createParam !== "stock") return;
    navigate(`/work-orders/create?mode=${createParam}`, { replace: true });
  }, [canCreateWorkOrders, navigate, searchParams]);

  if (!hasPermission("work_orders:read")) {
    return null;
  }

  return (
    <section className="space-y-4">
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
                <Th>Model #</Th>
                <Th>Location</Th>
                <Th>Created</Th>
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
              {items.map((item) => {
                const detailPath = `/work-orders/${item.reference_id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
                return (
                  <tr
                    key={item.reference_id}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => navigate(detailPath)}
                  >
                    <Td>{item.reference_id}</Td>
                    <Td>
                      <div className="space-y-1">
                        <p>{item.customer_name ?? "-"}</p>
                        {canViewSensitive && item.customer_email && <p className="text-xs text-muted-foreground">{item.customer_email}</p>}
                      </div>
                    </Td>
                    <Td>
                      <Badge className={statusClass(item.status_group)}>{item.status}</Badge>
                    </Td>
                    <Td>{item.job_type}</Td>
                    <Td>
                      <div className="space-y-1">
                        <p>{item.item_name ?? "-"}</p>
                        {item.brand_names.length > 0 && <p className="text-xs text-muted-foreground">{item.brand_names.join(", ")}</p>}
                      </div>
                    </Td>
                    <Td>{item.model_number ?? "-"}</Td>
                    <Td>
                      <div onClick={(event) => event.stopPropagation()}>
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
                      </div>
                    </Td>
                    <Td>{formatDateTime(item.created_at)}</Td>
                  </tr>
                );
              })}
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
      </>
    </section>
  );
}

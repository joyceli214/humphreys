"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/lib/api/client";
import type { PartsPurchaseRequest } from "@/lib/api/generated/types";
import { useAuth } from "@/lib/auth/auth-context";
import { useAlerts } from "@/lib/alerts/alert-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";

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

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = parseLocalDate(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(date);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD"
  }).format(value);
}

function statusClass(status: PartsPurchaseRequest["status"]) {
  if (status === "used") return "bg-emerald-100 text-emerald-700";
  if (status === "ordered") return "bg-sky-100 text-sky-700";
  if (status === "waiting_approval") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function PartsPurchaseRequestsPage() {
  const { hasPermission } = useAuth();
  const alerts = useAlerts();
  const canReadPage = hasPermission("parts_purchase_requests:read") && hasPermission("work_orders_sensitive:read");
  const [items, setItems] = useState<PartsPurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<PartsPurchaseRequest["status"] | "all">("waiting_approval");
  const [sortBy, setSortBy] = useState<"created_desc" | "created_asc" | "job_desc" | "job_asc">("created_desc");

  const visibleItems = useMemo(() => {
    const filtered = statusFilter === "all" ? items : items.filter((item) => item.status === statusFilter);
    return [...filtered].sort((a, b) => {
      if (sortBy === "job_asc") return a.reference_id - b.reference_id;
      if (sortBy === "job_desc") return b.reference_id - a.reference_id;

      const aCreated = a.created_at ? parseLocalDate(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? parseLocalDate(b.created_at).getTime() : 0;
      if (sortBy === "created_asc") return aCreated - bCreated;
      return bCreated - aCreated;
    });
  }, [items, sortBy, statusFilter]);

  useEffect(() => {
    if (!canReadPage) return;
    let cancelled = false;
    setLoading(true);
    apiClient
      .listAllPartsPurchaseRequests()
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        alerts.error("Failed to load parts requests", err instanceof Error ? err.message : "Request failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [alerts, canReadPage]);

  if (!canReadPage) return null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Parts Purchase Requests</h1>
        <p className="text-sm text-muted-foreground">Admin view across all work orders.</p>
      </div>

      <div className="rounded-lg border border-border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="block text-sm text-muted-foreground">Status</label>
            <select
              className="flex h-10 min-w-[190px] rounded-md border border-input bg-white px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PartsPurchaseRequest["status"] | "all")}
            >
              <option value="waiting_approval">Waiting approval</option>
              <option value="draft">Draft</option>
              <option value="ordered">Ordered</option>
              <option value="used">Used</option>
              <option value="all">All statuses</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-muted-foreground">Sort</label>
            <select
              className="flex h-10 min-w-[190px] rounded-md border border-input bg-white px-3 py-2 text-sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "created_desc" | "created_asc" | "job_desc" | "job_asc")}
            >
              <option value="created_desc">Created (newest)</option>
              <option value="created_asc">Created (oldest)</option>
              <option value="job_desc">Job ID (high to low)</option>
              <option value="job_asc">Job ID (low to high)</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[1100px]">
            <thead>
              <tr>
                <Th className="w-[90px]">Ref #</Th>
                <Th>Item</Th>
                <Th className="w-[80px]">Qty</Th>
                <Th className="w-[120px]">Source</Th>
                <Th className="w-[160px]">Status</Th>
                <Th className="w-[130px]">Total</Th>
                <Th className="w-[170px]">Requested By</Th>
                <Th className="w-[130px]">Created</Th>
                <Th className="w-[120px]">Action</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <Td colSpan={9}>Loading parts requests...</Td>
                </tr>
              )}
              {!loading && visibleItems.length === 0 && (
                <tr>
                  <Td colSpan={9}>No parts purchase requests found for current filters.</Td>
                </tr>
              )}
              {!loading &&
                visibleItems.map((item) => (
                  <tr key={item.parts_purchase_request_id}>
                    <Td>{item.reference_id}</Td>
                    <Td>
                      <div className="space-y-1">
                        <p>{item.item_name}</p>
                        {item.source_url ? (
                          <a href={item.source_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-2">
                            Open source link
                          </a>
                        ) : null}
                      </div>
                    </Td>
                    <Td>{item.quantity}</Td>
                    <Td className="capitalize">{item.source}</Td>
                    <Td>
                      <Badge className={statusClass(item.status)}>{item.status.replace("_", " ")}</Badge>
                    </Td>
                    <Td>{formatCurrency(item.total_price)}</Td>
                    <Td>{item.created_by_name ?? item.created_by_user_id}</Td>
                    <Td>{formatDate(item.created_at)}</Td>
                    <Td>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/work-orders/${item.reference_id}`}>Open WO</Link>
                      </Button>
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </div>
      </div>
    </section>
  );
}

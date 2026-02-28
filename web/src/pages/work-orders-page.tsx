"use client";

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/lib/api/client";
import type { WorkOrderListItem } from "@/lib/api/generated/types";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
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

export default function WorkOrdersPage() {
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<WorkOrderListItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const load = async (nextPage = page, nextQuery = query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: nextQuery,
        page: String(nextPage),
        page_size: String(pageSize)
      });
      const res = await apiClient.listWorkOrders(params);
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasPermission("work_orders:read")) return;
    load(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  if (!hasPermission("work_orders:read")) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Work Orders</h1>
        <p className="text-sm text-muted-foreground">Browse imported service work orders and open full details.</p>
      </div>

      <div className="rounded-lg border border-border bg-white p-4 space-y-3">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const nextQuery = searchInput.trim();
            setQuery(nextQuery);
            setPage(1);
            await load(1, nextQuery);
          }}
        >
          <Input
            placeholder="Search reference, customer, email, item, model, serial"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button variant="outline" type="submit">Search</Button>
        </form>

        <Table>
          <thead>
            <tr>
              <Th className="w-[110px]">Ref #</Th>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th>Job Type</Th>
              <Th>Item</Th>
              <Th>Created</Th>
              <Th className="w-[120px]">Action</Th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <Td colSpan={7}>Loading work orders...</Td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <Td colSpan={7}>No work orders found.</Td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr key={item.reference_id}>
                  <Td>{item.reference_id}</Td>
                  <Td>
                    <div className="space-y-1">
                      <p>{item.customer_name ?? "-"}</p>
                      {item.customer_email && <p className="text-xs text-muted-foreground">{item.customer_email}</p>}
                    </div>
                  </Td>
                  <Td>
                    <Badge className={statusClass(item.status)}>{item.status}</Badge>
                  </Td>
                  <Td>{item.job_type}</Td>
                  <Td>
                    <div className="space-y-1">
                      <p>{item.item_name ?? "-"}</p>
                      {item.brand_names.length > 0 && (
                        <p className="text-xs text-muted-foreground">{item.brand_names.join(", ")}</p>
                      )}
                    </div>
                  </Td>
                  <Td>{formatDateTime(item.created_at)}</Td>
                  <Td>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/work-orders/${item.reference_id}`}>View</Link>
                    </Button>
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Page {page}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={async () => {
                const next = page - 1;
                setPage(next);
                await load(next, query);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || items.length < pageSize}
              onClick={async () => {
                const next = page + 1;
                setPage(next);
                await load(next, query);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

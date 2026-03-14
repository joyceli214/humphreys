import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { DashboardActivityItem, DashboardData, DashboardOverdueItem, DashboardPartsReviewItem, DashboardWorkOrderItem } from "@/lib/api/generated/types";
import { useAlerts } from "@/lib/alerts/alert-context";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DashboardDateRange = "90d" | "2w" | "1m" | "1y";

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
    month: "short",
    day: "2-digit"
  }).format(date);
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD"
  }).format(value);
}

function totalPages(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const alerts = useAlerts();
  const { hasPermission } = useAuth();
  const canReadPartsReview = hasPermission("parts_purchase_requests:read") && hasPermission("work_orders_sensitive:read");
  const canReadRepairLogs = hasPermission("repair_logs:read");
  const canViewSensitive = hasPermission("work_orders_sensitive:read");

  const [dateRange, setDateRange] = useState<DashboardDateRange>("90d");
  const [searchInput, setSearchInput] = useState("");
  const [overduePage, setOverduePage] = useState(1);
  const [readyPage, setReadyPage] = useState(1);
  const pageSize = 5;

  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardData>({
    ready_total: 0,
    overdue_total: 0,
    ready_items: [],
    overdue_items: [],
    parts_review_items: [],
    activity_items: []
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({
      range: dateRange,
      ready_page: String(readyPage),
      ready_page_size: String(pageSize),
      overdue_page: String(overduePage),
      overdue_page_size: String(pageSize)
    });

    apiClient
      .getDashboard(params)
      .then((data) => {
        if (cancelled) return;
        setDashboard(data);
      })
      .catch((err) => {
        alerts.error("Failed to load dashboard", err instanceof Error ? err.message : "Request failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [alerts, dateRange, overduePage, readyPage]);

  useEffect(() => {
    setOverduePage(1);
    setReadyPage(1);
  }, [dateRange]);

  const overdueTotalPages = useMemo(() => totalPages(dashboard.overdue_total, pageSize), [dashboard.overdue_total]);
  const readyTotalPages = useMemo(() => totalPages(dashboard.ready_total, pageSize), [dashboard.ready_total]);

  const overdueRows: DashboardOverdueItem[] = dashboard.overdue_items;
  const readyRows: DashboardWorkOrderItem[] = dashboard.ready_items;
  const partsReviewRows: DashboardPartsReviewItem[] = dashboard.parts_review_items;
  const activityRows: DashboardActivityItem[] = dashboard.activity_items;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Logistics and performance overview.</p>
        </div>
        <select
          value={dateRange}
          onChange={(event) => setDateRange(event.target.value as DashboardDateRange)}
          className="h-9 rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Dashboard date range"
        >
          <option value="90d">Last 90 Days</option>
          <option value="2w">Last 2 Weeks</option>
          <option value="1m">Last Month</option>
          <option value="1y">Last Year</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <section className="rounded-md border border-border bg-white p-5 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Lookup</p>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = searchInput.trim();
              if (!trimmed) return;
              navigate(`/work-orders?q=${encodeURIComponent(trimmed)}`);
            }}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="h-9 bg-muted/50 pl-9"
                placeholder={
                  canViewSensitive
                    ? "Search reference, customer name/phone/email, status, job type, location, item, brand, model, serial"
                    : "Search reference, customer name, status, job type, location, item, brand, model, serial"
                }
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline" size="sm">
                Search
              </Button>
            </div>
          </form>
        </section>

        <section className="rounded-md border border-border bg-white p-5 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ready for Pickup</p>
          <p className="text-2xl font-bold text-foreground">{dashboard.ready_total}</p>
          <p className="mt-1 text-xs text-muted-foreground">Awaiting customer</p>
        </section>

        <section className="flex flex-col justify-between rounded-md border border-primary bg-primary p-5 text-primary-foreground shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground/80">Operations</p>
          <div>
            <p className="text-lg font-bold">New Order</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm" className="bg-white text-primary hover:bg-white/90">
                <Link to="/work-orders?create=new_job">Create New Job</Link>
              </Button>
              <Button asChild size="sm" className="bg-white text-primary hover:bg-white/90">
                <Link to="/work-orders?create=stock">Create Stock</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-md border border-border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Ready for Pickup Queue</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-3 font-medium">Order</th>
                    <th className="px-4 pb-3 font-medium">Customer</th>
                    <th className="px-4 pb-3 font-medium">Ready Since</th>
                    <th className="px-4 pb-3 font-medium">Status</th>
                    <th className="pb-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        Loading pickup queue...
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    readyRows.map((row) => (
                      <tr key={row.reference_id}>
                        <td className="py-3 pr-4 font-medium text-primary">#{row.reference_id}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{row.customer_name ?? "Unknown"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(row.status_updated_at)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.status}</td>
                        <td className="py-3 pl-4 text-right">
                          <Button asChild type="button" size="sm" variant="outline">
                            <Link to={`/work-orders/${row.reference_id}`}>View</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  {!loading && readyRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        No ready pickups found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!loading && dashboard.ready_total > 0 && (
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {readyPage} of {readyTotalPages}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={readyPage <= 1} onClick={() => setReadyPage((prev) => prev - 1)}>
                    Prev
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={readyPage >= readyTotalPages} onClick={() => setReadyPage((prev) => prev + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-md border border-border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Overdue Pickups</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-3 font-medium">Customer</th>
                    <th className="px-4 pb-3 font-medium">Item</th>
                    <th className="px-4 pb-3 font-medium">Late</th>
                    <th className="pb-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        Loading overdue pickups...
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    overdueRows.map((row) => (
                      <tr key={row.reference_id}>
                        <td className="py-3 pr-4">
                          <p className="font-medium text-foreground">{row.customer_name ?? "Unknown"}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">ID: {row.reference_id}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{row.item_name ?? "-"}</td>
                        <td className="px-4 py-3">
                          <Badge className="rounded border border-destructive/20 bg-destructive/10 text-destructive">{row.late_days}D</Badge>
                        </td>
                        <td className="py-3 pl-4 text-right">
                          <Button asChild type="button" variant="outline" size="sm">
                            <Link to={`/work-orders/${row.reference_id}`}>View</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  {!loading && overdueRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        No overdue pickups found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!loading && dashboard.overdue_total > 0 && (
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {overduePage} of {overdueTotalPages}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={overduePage <= 1} onClick={() => setOverduePage((prev) => prev - 1)}>
                    Prev
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={overduePage >= overdueTotalPages}
                    onClick={() => setOverduePage((prev) => prev + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-md border border-border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Parts Review</h2>
            {!canReadPartsReview && <p className="text-sm text-muted-foreground">Missing permission to view parts requests.</p>}
            {canReadPartsReview && (
              <div className="space-y-3">
                {partsReviewRows.map((part) => (
                  <div key={part.parts_purchase_request_id} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{part.item_name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Order #{part.reference_id} <span className="ml-1 font-medium text-foreground">{formatCurrency(part.total_price)}</span>
                      </p>
                    </div>
                    <Button asChild type="button" size="sm" variant="ghost" className="text-primary">
                      <Link to={`/work-orders/${part.reference_id}`}>Review</Link>
                    </Button>
                  </div>
                ))}
                {partsReviewRows.length === 0 && <p className="text-sm text-muted-foreground">No items awaiting approval.</p>}
              </div>
            )}
          </section>

          <section className="rounded-md border border-border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Shop Activity</h2>
            {!canReadRepairLogs && <p className="text-sm text-muted-foreground">Missing permission to view repair logs.</p>}
            {canReadRepairLogs && (
              <div className="space-y-4">
                {loading && <p className="text-sm text-muted-foreground">Loading repair activity...</p>}
                {!loading &&
                  activityRows.map((activity) => (
                    <div key={activity.person_id} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{activity.person_name}</p>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/work-orders/${activity.reference_id}`}>Job #{activity.reference_id}</Link>
                        </Button>
                      </div>
                      <p className="mt-1 text-xs italic text-muted-foreground">&quot;{activity.details}&quot;</p>
                      <p className="mt-1 text-xs text-muted-foreground">Logged: {formatDateTime(activity.logged_at)}</p>
                    </div>
                  ))}
                {!loading && activityRows.length === 0 && <p className="text-sm text-muted-foreground">No recent repair logs.</p>}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

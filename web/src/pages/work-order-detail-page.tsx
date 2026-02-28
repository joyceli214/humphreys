"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "@/lib/api/client";
import type { WorkOrderDetail } from "@/lib/api/generated/types";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { generateDropOffFormPdf, generatePickupFormPdf } from "@/lib/pdf/work-order-forms";

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

function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD"
  }).format(value);
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
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function WorkOrderDetailPage() {
  const { hasPermission } = useAuth();
  const { referenceId } = useParams();
  const [item, setItem] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const parsedReferenceId = useMemo(() => Number(referenceId), [referenceId]);

  useEffect(() => {
    if (!hasPermission("work_orders:read")) return;
    if (!Number.isInteger(parsedReferenceId) || parsedReferenceId <= 0) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const res = await apiClient.getWorkOrderDetail(parsedReferenceId);
        setItem(res);
      } finally {
        setLoading(false);
      }
    })();
  }, [hasPermission, parsedReferenceId]);

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
          <Link to="/work-orders">Back to Work Orders</Link>
        </Button>
        <p>Invalid work order reference.</p>
      </section>
    );
  }

  if (!item) {
    return (
      <section className="space-y-4">
        <Button variant="outline" asChild>
          <Link to="/work-orders">Back to Work Orders</Link>
        </Button>
        <p>Work order not found.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Work Order #{item.reference_id}</h1>
          <p className="text-sm text-muted-foreground">Created {formatDateTime(item.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusClass(item.status_name)}>{item.status_name ?? "Unknown"}</Badge>
          <Button variant="outline" onClick={() => generateDropOffFormPdf(item)}>Create Drop Off Form</Button>
          <Button variant="outline" onClick={() => generatePickupFormPdf(item)}>Create Pick Up Form</Button>
          <Button variant="outline" asChild>
            <Link to="/work-orders">Back</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[7fr_3fr] gap-4 items-start">
        <div className="space-y-4">
          <article className="rounded-lg border border-border bg-white p-4 space-y-2">
          <h2 className="font-semibold">Equipment</h2>
          {detailRow("Job Type", item.job_type_name ?? "-")}
          {detailRow("Original Job", item.original_job_id ? String(item.original_job_id) : "-")}
          {detailRow("Item", item.item_name ?? "-")}
          {detailRow("Brands", item.brand_names.join(", ") || "-")}
          {detailRow("Model", item.model_number ?? "-")}
          {detailRow("Serial", item.serial_number ?? "-")}
          {detailRow("Remote Control", String(item.remote_control_qty))}
          {detailRow("Cable", String(item.cable_qty))}
          {detailRow("Cord", String(item.cord_qty))}
          {detailRow("Album/CD/Cassette", String(item.album_cd_cassette_qty))}
          </article>

          <article className="rounded-lg border border-border bg-white p-4 space-y-3">
            <h2 className="font-semibold">Work Notes</h2>
            {detailRow("Technicians", item.worker_names.join(", ") || "-")}
            {detailRow("Payment Methods", item.payment_method_names.join(", ") || "-")}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Problem Description</p>
              {markdownBlock(item.problem_description)}
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Work Done</p>
              {markdownBlock(item.work_done)}
            </div>
            {detailRow("Updated", formatDateTime(item.updated_at))}
          </article>

          <article className="rounded-lg border border-border bg-white p-4 space-y-3">
            <h2 className="font-semibold">Line Items</h2>
            <Table>
              <thead>
                <tr>
                  <Th className="w-[100px]">ID</Th>
                  <Th>Item</Th>
                  <Th className="w-[140px]">Unit Price</Th>
                  <Th className="w-[140px]">Qty</Th>
                  <Th className="w-[180px]">Line Total</Th>
                </tr>
              </thead>
              <tbody>
                {item.line_items.length === 0 && (
                  <tr>
                    <Td colSpan={5}>No line items.</Td>
                  </tr>
                )}
                {item.line_items.map((line) => (
                  <tr key={line.line_item_id}>
                    <Td>{line.line_item_id}</Td>
                    <Td>{line.item_name ?? "-"}</Td>
                    <Td>{formatCurrency(line.unit_price)}</Td>
                    <Td>{line.quantity_text ?? "-"}</Td>
                    <Td>{line.line_total_text ?? "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </article>

          <article className="rounded-lg border border-border bg-white p-4 space-y-2">
            <h2 className="font-semibold">Totals</h2>
            {detailRow("Parts", formatCurrency(item.parts_total))}
            {detailRow("Delivery", formatCurrency(item.delivery_total))}
            {detailRow("Labour", formatCurrency(item.labour_total))}
            {detailRow("Deposit", formatCurrency(item.deposit))}
          </article>
        </div>

        <div className="space-y-4">
          <aside className="rounded-lg border border-border bg-white p-4 space-y-2">
            <h2 className="font-semibold">Customer</h2>
            {detailRow("Name", fullName(item.customer.first_name, item.customer.last_name))}
            {detailRow("Email", item.customer.email ?? "-")}
            {detailRow("Home Phone", item.customer.home_phone ?? "-")}
            {detailRow("Work Phone", item.customer.work_phone ?? "-")}
            {detailRow("Extension", item.customer.extension_text ?? "-")}
            {detailRow("Address", item.customer.address_line_1 ?? "-")}
            {detailRow("Address 2", item.customer.address_line_2 ?? "-")}
            {detailRow("City", item.customer.city ?? "-")}
            {detailRow("Province", item.customer.province ?? "-")}
          </aside>

          <aside className="rounded-lg border border-border bg-white p-4 space-y-2">
            <h2 className="font-semibold">Meta</h2>
            {detailRow("Created At", formatDateTime(item.created_at))}
            {detailRow("Updated At", formatDateTime(item.updated_at))}
            {detailRow("Status", item.status_name ?? "-")}
          </aside>
        </div>
      </div>
    </section>
  );
}

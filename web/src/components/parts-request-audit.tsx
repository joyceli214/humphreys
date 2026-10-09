import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { apiClient } from "@/lib/api/client";
import type { PartsAuditEntry, PartsPurchaseRequest } from "@/lib/api/generated/types";

const warningLabels: Record<string, string> = {
  approved_without_review: "Approved without waiting for approval",
  price_changed_after_approval: "Price changed after approval"
};

export function PartsRequestWarnings({ flags }: { flags: string[] | null | undefined }) {
  return <div className="mt-1 flex flex-wrap gap-1">
    {(flags ?? []).filter((flag) => warningLabels[flag]).map((flag) => (
      <Badge key={flag} className="border-amber-300 bg-amber-50 text-amber-900">
        {warningLabels[flag]}
      </Badge>
    ))}
  </div>;
}

function auditValue(value: string | null, field: PartsAuditEntry["field"]) {
  if (value === null) return "—";
  if (field === "total_price") {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(value));
  }
  return value.replace(/_/g, " ");
}

export function PartsRequestHistory({ referenceID, requests }: { referenceID: number; requests: PartsPurchaseRequest[] }) {
  const [entries, setEntries] = useState<PartsAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setEntries([]);
    apiClient.getPartsPurchaseRequestHistory(referenceID)
      .then((rows) => { if (!cancelled) setEntries(rows); })
      .catch(() => { if (!cancelled) setError("Could not load parts request history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [referenceID, requests, retry]);

  useEffect(() => { setFilter("all"); }, [referenceID]);

  const requestOptions = useMemo(() => {
    const options = new Map<number, string>();
    requests.forEach((request) => options.set(request.parts_purchase_request_id, request.item_name));
    entries.forEach((entry) => {
      if (!options.has(entry.parts_purchase_request_id)) options.set(entry.parts_purchase_request_id, "Deleted request");
    });
    return Array.from(options);
  }, [requests, entries]);
  const visible = entries.filter((entry) => filter === "all" || String(entry.parts_purchase_request_id) === filter).slice().reverse();

  return <details className="rounded-md border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">Parts request history</summary>
    <div className="mt-3 space-y-3">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Request
        <select className="rounded-md border border-input bg-white px-3 py-2" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All requests (including deleted)</option>
          {requestOptions.map(([id, name]) => <option key={id} value={id}>#{id} · {name}</option>)}
        </select>
      </label>
      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading request history...</p> : error ? (
        <div><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>
      ) : visible.length === 0 ? <p className="text-sm text-muted-foreground">No recorded changes.</p> : (
        <div className="max-h-80 overflow-auto">
          <Table className="min-w-[750px]">
            <thead><tr><Th>Request</Th><Th>Action</Th><Th>Field</Th><Th>Before</Th><Th>After</Th><Th>Changed by</Th><Th>When</Th></tr></thead>
            <tbody>{visible.map((entry) => <tr key={entry.id}>
              <Td>#{entry.parts_purchase_request_id}</Td>
              <Td className="capitalize">{entry.action}</Td>
              <Td>{entry.field === "total_price" ? "Total price" : "Status"}</Td>
              <Td>{auditValue(entry.old_value, entry.field)}</Td>
              <Td>{auditValue(entry.new_value, entry.field)}</Td>
              <Td><span title={entry.changed_by_user_id}>{entry.changed_by_name}</span></Td>
              <Td><time dateTime={entry.changed_at}>{new Date(entry.changed_at).toLocaleString()}</time></Td>
            </tr>)}</tbody>
          </Table>
        </div>
      )}
    </div>
  </details>;
}

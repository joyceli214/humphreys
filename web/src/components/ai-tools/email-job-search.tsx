import { useState, type FormEvent } from "react";
import { apiClient } from "@/lib/api/client";
import type { AISearchRow } from "@/lib/ai-tools/types";
import { equipmentLabel } from "@/lib/ai-tools/email-selection";
import { AIButton, AIErrorBox, errorMessage } from "@/components/ai-tools/ai-ui";

const SEARCH_LIMIT = 20;

type Props = {
  selectedIds: number[];
  canAddMore: boolean;
  onAdd: (row: AISearchRow) => void;
};

/**
 * Step 1: one search box for customer name or job #. Uses the owner-only
 * Advanced Search endpoint, which returns display names only (no email/phone).
 */
export function EmailJobSearch({ selectedIds, canAddMore, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AISearchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = query.trim().replace(/^#/, "");
    if (!text) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.runAISearch({ text, limit: SEARCH_LIMIT });
      setRows(res.rows);
    } catch (err) {
      setError(errorMessage(err, "Search failed."));
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(event) => void runSearch(event)}>
        <label htmlFor="ai-email-search" className="sr-only">
          Search by customer name or job #
        </label>
        <input
          id="ai-email-search"
          className="h-9 min-w-0 flex-1 rounded-md border border-[#ddd5cc] bg-white px-3 text-sm outline-none focus:ring-1 focus:ring-[#c2571a]"
          placeholder="Customer name or job #"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <AIButton type="submit" variant="outline" disabled={loading || !query.trim()}>
          {loading ? "Searching..." : "Search"}
        </AIButton>
      </form>
      {error && <AIErrorBox>{error}</AIErrorBox>}
      {rows && rows.length === 0 && <p className="text-sm text-neutral-500">No jobs found.</p>}
      {rows && rows.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-md border border-[#ddd5cc] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#f6f2ee] text-xs text-neutral-600">
              <tr>
                <th className="px-2 py-1.5">Job #</th>
                <th className="px-2 py-1.5">Customer</th>
                <th className="px-2 py-1.5">Equipment</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const picked = selectedIds.includes(row.reference_id);
                return (
                  <tr key={row.reference_id} className="border-t border-[#efeae4]">
                    <td className="px-2 py-1.5 font-semibold">#{row.reference_id}</td>
                    <td className="px-2 py-1.5">{row.customer_name}</td>
                    <td className="px-2 py-1.5">{equipmentLabel(row)}</td>
                    <td className="px-2 py-1.5">{row.status_name}</td>
                    <td className="px-2 py-1.5 text-right">
                      <AIButton
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        aria-label={`Add job #${row.reference_id}`}
                        disabled={picked || !canAddMore}
                        onClick={() => onAdd(row)}
                      >
                        {picked ? "Added" : "Add"}
                      </AIButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

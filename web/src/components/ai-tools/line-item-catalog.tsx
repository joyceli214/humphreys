import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { LineItemCatalogItem } from "@/lib/ai-tools/types";
import { formatMoney } from "@/lib/ai-tools/money";
import { AICard, AICardTitle, AIErrorBox } from "@/components/ai-tools/ai-ui";

/** Example instruction for a catalog item, ending in "to job " so the user can type the number. */
export function catalogInstruction(item: LineItemCatalogItem): string {
  const qty = item.quantity_text.trim() || "1";
  return `Add "${item.name}" at ${formatMoney(item.unit_price)} (qty ${qty}) to job `;
}

type State = { status: "loading" } | { status: "error" } | { status: "ready"; items: LineItemCatalogItem[] };

/** Typical line item prices; "Insert" adds an example instruction for the row. */
export function LineItemCatalog({ onInsert, disabled = false }: { onInsert: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    apiClient
      .getAILineItemCatalog()
      .then((res) => active && setState({ status: "ready", items: res.items ?? [] }))
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, []);

  return (
    <AICard>
      <AICardTitle>Typical line item prices</AICardTitle>
      <p className="mt-1 text-xs text-neutral-500">
        Typical prices from past jobs. The AI uses these when you name an item without a price.
      </p>
      {state.status === "loading" && <p className="mt-3 text-sm text-neutral-500">Loading typical prices...</p>}
      {state.status === "error" && (
        <div className="mt-3">
          <AIErrorBox>The typical prices could not be loaded. You can still name a price in your instruction.</AIErrorBox>
        </div>
      )}
      {state.status === "ready" && state.items.length === 0 && (
        <p className="mt-3 text-sm text-neutral-500">No typical prices are available yet.</p>
      )}
      {state.status === "ready" && state.items.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#e8e2db] text-left text-xs font-semibold text-neutral-500">
                <th className="px-2 py-1.5">Item</th>
                <th className="px-2 py-1.5 text-right">Typical price</th>
                <th className="px-2 py-1.5">Qty</th>
                <th className="px-2 py-1.5">
                  <span className="sr-only">Insert</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.name} className="border-b border-[#efeae4] align-top">
                  <td className="px-2 py-1.5">
                    <div className="text-neutral-800">{item.name}</div>
                    {item.notes && <div className="text-xs text-neutral-500">{item.notes}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(item.unit_price)}</td>
                  <td className="px-2 py-1.5">{item.quantity_text || "1"}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      aria-label={`Insert ${item.name}`}
                      disabled={disabled}
                      onClick={() => onInsert(catalogInstruction(item))}
                      className="text-xs font-semibold text-[#c2571a] hover:text-[#8a3d10] disabled:pointer-events-none disabled:opacity-50"
                    >
                      Insert
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AICard>
  );
}

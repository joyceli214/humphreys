import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { LineItemCatalogItem } from "@/lib/ai-tools/types";
import { formatMoney } from "@/lib/ai-tools/money";
import { AICard, AICardTitle, AIErrorBox } from "@/components/ai-tools/ai-ui";
import { BillingProfilePicker } from "@/components/billing-profile-picker";
import type { BillingProfileItem } from "@/lib/billing-profiles";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; items: LineItemCatalogItem[] };

type Props = {
  /** Called with the row's item; the parent opens the add-item template with it prefilled. */
  onInsert: (item: LineItemCatalogItem) => void;
  onPickProfile: (item: BillingProfileItem) => void;
  /** Called once the list has loaded, so the item slot can offer the same names. */
  onLoaded?: (items: LineItemCatalogItem[]) => void;
  disabled?: boolean;
};

/** Typical line item prices; "Insert" opens the add-item template for the row. */
export function LineItemCatalog({ onInsert, onPickProfile, onLoaded, disabled = false }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    let active = true;
    apiClient
      .getAILineItemCatalog()
      .then((res) => {
        if (!active) return;
        const items = res.items ?? [];
        setState({ status: "ready", items });
        onLoadedRef.current?.(items);
      })
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
      <div className="mt-3">
        <BillingProfilePicker onPick={onPickProfile} actionLabel="Insert" disabled={disabled} />
      </div>
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
                      onClick={() => onInsert(item)}
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

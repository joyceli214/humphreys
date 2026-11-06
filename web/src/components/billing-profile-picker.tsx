import { useEffect, useId, useState } from "react";
import { BILLING_PROFILES, billingProfileForEquipment, type BillingProfileItem } from "@/lib/billing-profiles";

type Props = {
  equipmentName?: string | null;
  onPick: (item: BillingProfileItem) => void;
  disabled?: boolean;
  actionLabel?: string;
};

/** Reusable quick-entry list. Choosing an item only opens the existing edit or preview flow. */
export function BillingProfilePicker({ equipmentName, onPick, disabled = false, actionLabel = "Use" }: Props) {
  const productInputId = useId();
  const [profileId, setProfileId] = useState(() => billingProfileForEquipment(equipmentName)?.id ?? "");

  useEffect(() => {
    setProfileId(billingProfileForEquipment(equipmentName)?.id ?? "");
  }, [equipmentName]);

  const profile = BILLING_PROFILES.find((entry) => entry.id === profileId);

  return (
    <details className="rounded-md border border-border bg-slate-50/70 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">
        Pick from product profile{profile ? ` · ${profile.label}` : ""}
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block text-xs font-medium text-slate-600" htmlFor={productInputId}>
          Product
        </label>
        <select
          id={productInputId}
          aria-label="Product profile"
          className="w-full rounded-md border border-border bg-white px-2 py-2 text-sm"
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
          disabled={disabled}
        >
          <option value="">Choose a product</option>
          {BILLING_PROFILES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        {profile ? (
          <div className="space-y-1">
            {profile.items.map((item) => (
              <div key={item.name} className="flex items-start justify-between gap-2 rounded border border-border bg-white px-2 py-2 text-xs">
                <div className="min-w-0">
                  <p className="break-words font-medium text-slate-800">{item.name}</p>
                  <p className="text-slate-500">
                    {item.referencePrice === undefined ? "Price to confirm" : `Past price $${item.referencePrice.toFixed(2)}`}
                    {item.quantity ? ` · Qty ${item.quantity}` : " · Qty to confirm"}
                  </p>
                  <p className="mt-1 text-slate-500">{item.note}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 font-semibold text-[#c2571a] hover:text-[#8a3d10] disabled:opacity-50"
                  aria-label={`${actionLabel} ${item.name} from ${profile.label}`}
                  onClick={() => onPick(item)}
                  disabled={disabled}
                >
                  {actionLabel}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Choose a product to see its optional bill items.</p>
        )}
        <p className="text-xs text-slate-500">Only choose items used on this repair. Confirm the price and quantity before saving.</p>
      </div>
    </details>
  );
}

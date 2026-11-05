import { useId } from "react";
import type { LineItemCatalogItem } from "@/lib/ai-tools/types";
import { getTemplate, type SlotKind, type TemplateId, type TemplateValues } from "@/lib/ai-tools/mass-update-templates";

type Props = {
  templateId: TemplateId;
  values: TemplateValues;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  statusOptions: string[];
  catalogItems: LineItemCatalogItem[];
  disabled?: boolean;
};

const INPUT_CLASS =
  "h-8 rounded-md border border-[#ddd5cc] bg-white px-2 text-sm text-neutral-800 outline-none focus:border-[#c2571a] focus:ring-1 focus:ring-[#c2571a] disabled:opacity-60";

const WIDTH: Record<SlotKind, string> = {
  jobs: "w-40",
  status: "w-48",
  item: "w-52",
  money: "w-24",
  qty: "w-14",
  percent: "w-16",
  text: "w-32"
};

const INPUT_MODE: Partial<Record<SlotKind, "numeric" | "decimal">> = { money: "decimal", qty: "numeric", percent: "decimal" };

/** Small inline fill-in inputs for the active example; their values compose the instruction. */
export function MassUpdateTemplateSlots({ templateId, values, onChange, onClose, statusOptions, catalogItems, disabled }: Props) {
  const baseId = useId();
  const template = getTemplate(templateId);
  const itemListId = `${baseId}-items`;

  return (
    <div
      role="group"
      aria-label="Fill in the example"
      className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border border-dashed border-[#e2c9b6] bg-[#fdf9f6] px-3 py-2"
    >
      {template.slots.map((slot) => {
        const id = `${baseId}-${slot.key}`;
        const value = values[slot.key] ?? "";
        const set = (v: string) => onChange(slot.key, v);
        let control;
        if (slot.kind === "status" && statusOptions.length > 0) {
          const options = value && !statusOptions.includes(value) ? [...statusOptions, value] : statusOptions;
          control = (
            <select id={id} value={value} disabled={disabled} onChange={(e) => set(e.target.value)} className={`${INPUT_CLASS} ${WIDTH.status}`}>
              <option value="">Choose a status</option>
              {options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          );
        } else {
          control = (
            <input
              id={id}
              type="text"
              value={value}
              disabled={disabled}
              autoComplete="off"
              inputMode={INPUT_MODE[slot.kind]}
              list={slot.kind === "item" ? itemListId : undefined}
              onChange={(e) => set(e.target.value)}
              className={`${INPUT_CLASS} ${WIDTH[slot.kind]} max-[480px]:w-full`}
            />
          );
        }
        return (
          <div key={slot.key} className="flex items-center gap-1.5 max-[480px]:w-full">
            <label htmlFor={id} className="shrink-0 text-xs font-medium text-neutral-600">
              {slot.label}
            </label>
            {control}
          </div>
        );
      })}
      {template.slots.some((slot) => slot.kind === "item") && (
        <datalist id={itemListId}>
          {catalogItems.map((item) => (
            <option key={item.name} value={item.name} />
          ))}
        </datalist>
      )}
      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        className="ml-auto h-8 rounded px-2 text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
      >
        Done
      </button>
    </div>
  );
}

import { cn } from "@/lib/utils";

type Props = {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Toggle-chip multi-select for job statuses. Selected names that aren't in the
 * option list (e.g. not loaded yet) are still shown so they can be removed.
 */
export function SearchStatusPicker({ options, selected, onChange, disabled }: Props) {
  const extras = selected.filter((name) => !options.some((option) => same(option, name)));
  const all = [...options, ...extras];

  const toggle = (name: string) => {
    const isOn = selected.some((value) => same(value, name));
    onChange(isOn ? selected.filter((value) => !same(value, name)) : [...selected, name]);
  };

  if (all.length === 0) {
    return <p className="text-xs text-neutral-500">Loading statuses...</p>;
  }

  return (
    <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
      {all.map((name) => {
        const on = selected.some((value) => same(value, name));
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(name)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition disabled:opacity-50",
              on
                ? "border-[#c2571a] bg-[#f6e3d6] font-medium text-[#8a3d10]"
                : "border-[#ddd5cc] bg-white text-neutral-600 hover:bg-[#f6f2ee]"
            )}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

type Props = {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/** Tags are shown under the trigger only up to this many selections. */
const MAX_TAGS = 3;

const norm = (s: string) => s.trim().toLowerCase();
const same = (a: string, b: string) => norm(a) === norm(b);

export function statusTriggerLabel(selected: string[]): string {
  if (selected.length === 0) return "Status: Any";
  if (selected.length === 1) return `Status: ${selected[0]}`;
  return `Status: ${selected.length} selected`;
}

/**
 * Compact multi-select for job statuses: a trigger button opening a popover with
 * a search box and a checkbox list. Matching is case-insensitive, and selected
 * names that aren't in the option list (e.g. not loaded yet) are still listed so
 * they can be removed. The emitted value array is identical to the old chip picker.
 */
export function StatusPickList({ options, selected, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const popoverId = `${baseId}-popover`;

  const extras = selected.filter((name) => !options.some((option) => same(option, name)));
  const all = [...options, ...extras];
  const q = norm(query);
  const visible = q ? all.filter((name) => norm(name).includes(q)) : all;
  const isOn = (name: string) => selected.some((value) => same(value, name));

  const toggle = (name: string) => {
    onChange(isOn(name) ? selected.filter((value) => !same(value, name)) : [...selected, name]);
  };
  const remove = (name: string) => onChange(selected.filter((value) => value !== name));

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onOutside = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) close(false);
  }, [disabled, open]);

  const onPopoverKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const showTags = selected.length > 0 && selected.length <= MAX_TAGS;

  return (
    <div ref={rootRef} className="relative w-full sm:w-72">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-white px-2.5 text-left text-sm text-neutral-800 outline-none sm:h-9",
          "focus:border-[#c2571a] focus:ring-1 focus:ring-[#c2571a] disabled:opacity-60",
          selected.length > 0 ? "border-[#c2571a]" : "border-[#ddd5cc]"
        )}
      >
        <span className="truncate">{statusTriggerLabel(selected)}</span>
        <span aria-hidden="true" className="text-xs text-neutral-500">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Choose statuses"
          onKeyDown={onPopoverKeyDown}
          className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-[#ddd5cc] bg-white p-2 shadow-lg"
        >
          <input
            ref={searchRef}
            type="search"
            aria-label="Search statuses"
            placeholder="Search statuses"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-md border border-[#ddd5cc] px-2.5 text-sm outline-none focus:border-[#c2571a] focus:ring-1 focus:ring-[#c2571a] sm:h-8"
          />
          <div className="mt-2 max-h-60 overflow-y-auto overscroll-contain">
            {all.length === 0 ? (
              <p className="px-1 py-2 text-xs text-neutral-500">Loading statuses...</p>
            ) : visible.length === 0 ? (
              <p className="px-1 py-2 text-xs text-neutral-500">No matching statuses</p>
            ) : (
              <ul className="space-y-0.5">
                {visible.map((name) => {
                  const id = `${baseId}-opt-${all.indexOf(name)}`;
                  return (
                    <li key={name}>
                      <label
                        htmlFor={id}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1.5 text-sm text-neutral-800 hover:bg-[#f6f2ee] sm:min-h-8"
                      >
                        <input
                          id={id}
                          type="checkbox"
                          value={name}
                          checked={isOn(name)}
                          onChange={() => toggle(name)}
                          className="h-4 w-4 accent-[#c2571a]"
                        />
                        <span>{name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-[#eee7df] pt-2">
            <span className="text-xs text-neutral-500">{selected.length} selected</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="min-h-11 rounded px-3 text-sm text-[#c2571a] hover:underline disabled:opacity-50 sm:min-h-8"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {showTags && (
        <ul aria-label="Selected statuses" className="mt-1.5 flex flex-wrap gap-1">
          {selected.map((name) => (
            <li
              key={name}
              className="inline-flex items-center gap-0.5 rounded-full border border-[#c2571a] bg-[#f6e3d6] py-0.5 pl-2 pr-0.5 text-xs text-[#8a3d10]"
            >
              <span>{name}</span>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                disabled={disabled}
                onClick={() => remove(name)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[#ecd0bd] disabled:opacity-50"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

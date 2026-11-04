import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type Shared = {
  id: string;
  /** Server-side character cap; enforced with maxLength and shown as "n / limit". */
  limit: number;
  value: string;
  onValueChange: (value: string) => void;
};

type InputProps = Shared & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "maxLength">;
type TextareaProps = Shared & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "value" | "onChange" | "maxLength">;

export type CharCounterInputProps = InputProps | TextareaProps;

/**
 * Text input (or textarea when `multiline`) capped at `limit` characters with a
 * live "n / limit" counter underneath. The counter is linked via aria-describedby.
 */
export function CharCounterInput(props: CharCounterInputProps) {
  const { id, limit, value, onValueChange, multiline, "aria-describedby": describedBy, ...rest } = props;
  const counterId = `${id}-counter`;
  const describedByIds = [describedBy, counterId].filter(Boolean).join(" ");
  const atLimit = value.length >= limit;

  return (
    <div>
      {multiline ? (
        <textarea
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          id={id}
          value={value}
          maxLength={limit}
          aria-describedby={describedByIds}
          onChange={(event) => onValueChange(event.target.value)}
        />
      ) : (
        <input
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
          id={id}
          value={value}
          maxLength={limit}
          aria-describedby={describedByIds}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}
      <p id={counterId} className={`mt-0.5 text-right text-[11px] tabular-nums ${atLimit ? "text-red-700" : "text-neutral-400"}`}>
        {value.length} / {limit}
      </p>
    </div>
  );
}

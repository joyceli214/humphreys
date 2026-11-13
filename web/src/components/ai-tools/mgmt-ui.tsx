import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Visual baseline for the Management Ask + Email panels (plan §5): teal
// actions, ink/muted text, 17px body, 44–48px tap targets, visible focus.
// Colours: teal #1a7f94 / #135f6f, ink #1f2328, muted #4a5260,
// bg #f7f4f1, blank #ffe27a on #3d2c00, orange #b8501a.

export const FOCUS = "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#1a7f94]/50 focus-visible:ring-offset-1";

export const INPUT_CLASS =
  "w-full min-h-[48px] rounded-[10px] border-[1.5px] border-[#8b949e] bg-white px-3 py-2.5 text-[17px] text-[#1f2328] outline-none focus:border-[#1a7f94] focus:ring-[3px] focus:ring-[#e6f3f6]";

export const LINK_BUTTON = cn(
  "inline-flex min-h-[44px] items-center px-2.5 text-[16px] font-bold text-[#135f6f] underline disabled:opacity-50",
  FOCUS
);

export const BLANK_MARK = "rounded bg-[#ffe27a] px-1 font-semibold text-[#3d2c00] outline outline-[1.5px] outline-dashed outline-[#b58900]";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" };

export function MgmtButton({ className, variant = "primary", type = "button", ...props }: BtnProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-[48px] items-center justify-center rounded-[10px] border-[1.5px] px-4 text-[17px] font-bold transition disabled:cursor-not-allowed",
        variant === "primary"
          ? "border-transparent bg-[#1a7f94] text-white hover:bg-[#135f6f] disabled:bg-[#5f6b73]"
          : "border-[#8b949e] bg-white text-[#1f2328] hover:bg-[#f6f2ee] disabled:opacity-50",
        FOCUS,
        className
      )}
      {...props}
    />
  );
}

export function MgmtChip({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "min-h-[44px] rounded-full border-[1.5px] border-[#1a7f94] bg-white px-4 py-2 text-[16px] font-semibold text-[#135f6f] hover:bg-[#e6f3f6] disabled:opacity-50",
        FOCUS,
        className
      )}
      {...props}
    />
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ready" | "wait" | "work" }) {
  const tones = {
    neutral: "bg-[#eef0f2] text-[#1f2328]",
    ready: "bg-[#dff3e4] text-[#14532d]",
    wait: "bg-[#fff1c9] text-[#6b3d00]",
    work: "bg-[#e6f3f6] text-[#135f6f]"
  };
  return <span className={cn("inline-block whitespace-nowrap rounded-[10px] px-2 text-[14px] font-semibold", tones[tone])}>{children}</span>;
}

/** Status pill colour from a status name (display only). */
export function statusTone(name: string): "neutral" | "ready" | "wait" | "work" {
  const s = name.toLowerCase();
  if (/ready|finish|complete|picked|arrived/.test(s)) return "ready";
  if (/wait|estimate|parts|approval|back-order/.test(s)) return "wait";
  if (/progress|repair|ordered|approved/.test(s)) return "work";
  return "neutral";
}

export function MgmtError({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[16px] text-red-800">
      <span>{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className={cn(LINK_BUTTON, "text-red-800")}>
          Retry
        </button>
      )}
    </div>
  );
}

export function MgmtLoading({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <p role="status" className="text-[16px] text-[#4a5260]">
      {children}
    </p>
  );
}

/** HTTP status from an APIError-like value, else null. */
export function errorStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

export const TABLE_CLASS = "w-full border-collapse text-[16px] [&_td]:border-b [&_td]:border-[#eceef0] [&_td]:px-1.5 [&_td]:py-2 [&_td]:align-top [&_th]:whitespace-nowrap [&_th]:border-b-[1.5px] [&_th]:border-[#d5d9de] [&_th]:px-1.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-[14px] [&_th]:font-semibold [&_th]:text-[#4a5260]";

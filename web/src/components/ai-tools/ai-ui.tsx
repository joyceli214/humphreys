import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Small presentational primitives for the AI Tools window, matching the
// mockups: warm cards with a 1px #e8e2db border and orange #c2571a actions.

export function AICard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-[#e8e2db] bg-white p-4", className)} {...props} />;
}

export function AICardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-neutral-800", className)} {...props} />;
}

type AIButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" };

export function AIButton({ className, variant = "primary", type = "button", ...props }: AIButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md px-3.5 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50",
        variant === "primary"
          ? "bg-[#c2571a] text-white hover:bg-[#a94a14]"
          : "border border-[#ddd5cc] bg-white text-neutral-800 hover:bg-[#f6f2ee]",
        className
      )}
      {...props}
    />
  );
}

type PillTone = "neutral" | "red" | "amber" | "orange";

const PILL_TONES: Record<PillTone, string> = {
  neutral: "bg-[#efebe7] text-neutral-700",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
  orange: "bg-[#f6e3d6] text-[#8a3d10]"
};

export function AIPill({ tone = "neutral", className, children }: { tone?: PillTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", PILL_TONES[tone], className)}>
      {children}
    </span>
  );
}

export function AIErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </div>
  );
}

export function AINotice({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{children}</div>;
}

export function errorMessage(err: unknown, fallback = "Request failed") {
  if (!(err instanceof Error) || !err.message) return fallback;
  // APIClient appends "(status /path)"; strip it for end-user display.
  return err.message.replace(/\s*\(\d{3} \/[^)]*\)\s*$/, "") || fallback;
}

export const AI_TEXTAREA_CLASS =
  "w-full rounded-md border border-[#ddd5cc] bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none focus:border-[#c2571a] focus:ring-1 focus:ring-[#c2571a]";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold bg-muted text-muted-foreground", className)}>{children}</span>;
}

import type { ReactNode } from "react";
import { handleJobLinkClick, jobPath } from "@/lib/ai-tools/open-job";
import { cn } from "@/lib/utils";

/** A [#Job] link inside Management. Opens the job in the portal (see lib/ai-tools/open-job). */
export function JobLink({
  referenceId,
  children,
  className
}: {
  referenceId: number;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={jobPath(referenceId)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => handleJobLinkClick(event, referenceId)}
      className={cn("hover:text-[#c2571a] hover:underline", className)}
    >
      {children ?? `#${referenceId}`}
    </a>
  );
}

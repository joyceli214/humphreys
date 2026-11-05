// The one place that decides how a job link inside Management (/ai-tools)
// opens. Every [#Job] link in components/ai-tools goes through here.
//
//  - Embedded in the portal's split-pane iframe: ask the parent portal to
//    navigate (it keeps the pane open). No new tab.
//  - Pop-out window whose same-origin opener is still open: ask the opener
//    to navigate and focus it.
//  - Otherwise (standalone tab, opener gone): open the job in a new tab.

import type { MouseEvent } from "react";
import { OPEN_JOB_MESSAGE, ownOrigin, sameOriginOpener, sameOriginParent } from "@/lib/ai-tools/management-messages";

export type OpenJobRoute = "embedded" | "opener" | "new-tab";

/** Path of a job in the main portal. */
export function jobPath(referenceId: number) {
  return `/work-orders/${referenceId}`;
}

export function openJobInPortal(referenceId: number, win: Window = window): OpenJobRoute {
  const origin = ownOrigin(win);
  const message = { type: OPEN_JOB_MESSAGE, id: referenceId };

  const parent = sameOriginParent(win);
  if (parent && origin) {
    try {
      parent.postMessage(message, origin);
      return "embedded";
    } catch {
      // fall through
    }
  }

  const opener = sameOriginOpener(win);
  if (opener && origin) {
    try {
      opener.postMessage(message, origin);
    } catch {
      try {
        opener.location.assign(jobPath(referenceId));
      } catch {
        win.open(jobPath(referenceId), "_blank");
        return "new-tab";
      }
    }
    try {
      opener.focus();
    } catch {
      // focus may be blocked; the opener still navigates
    }
    return "opener";
  }

  win.open(jobPath(referenceId), "_blank");
  return "new-tab";
}

/** Plain left clicks route through openJobInPortal; modified/middle clicks keep native link behaviour. */
export function handleJobLinkClick(
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "preventDefault">,
  referenceId: number,
  win: Window = window
): OpenJobRoute | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  event.preventDefault();
  return openJobInPortal(referenceId, win);
}

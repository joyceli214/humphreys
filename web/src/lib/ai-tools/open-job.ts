/** Path of a job in the main portal. */
export function jobPath(referenceId: number) {
  return `/work-orders/${referenceId}`;
}

/**
 * Shows a job in the main portal window that opened AI Tools, falling back to
 * a new tab when there is no reachable opener.
 */
export function openJobInPortal(referenceId: number, win: Window = window) {
  const path = jobPath(referenceId);
  const opener = win.opener as Window | null;
  if (opener && !opener.closed) {
    try {
      opener.location.assign(path);
      opener.focus();
      return;
    } catch {
      // Cross-origin or blocked opener: fall through to a new tab.
    }
  }
  win.open(path, "_blank");
}

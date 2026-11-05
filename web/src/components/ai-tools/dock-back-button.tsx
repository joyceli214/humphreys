import { useState } from "react";
import { PanelRight } from "lucide-react";
import { dockBack } from "@/lib/ai-tools/dock";
import { isManagementPopout } from "@/lib/ai-tools/management-messages";

/**
 * "Dock back" for the pop-out Management window: returns Management to the
 * portal's split pane. Rendered only in the pop-out (not when embedded in the
 * pane iframe and not in a plain standalone tab).
 */
export function DockBackButton({ win = window }: { win?: Window }) {
  const [visible] = useState(() => isManagementPopout(win));
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => dockBack(win)}
      title="Dock back into the portal"
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[#c2571a] bg-[#fdf4ee] px-2.5 text-xs font-semibold text-[#c2571a] hover:bg-[#f9e6d9]"
    >
      <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
      Dock back
    </button>
  );
}

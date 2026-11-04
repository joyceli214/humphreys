import { useAuth } from "@/lib/auth/auth-context";
import { canUseAITools, openAIToolsWindow } from "@/lib/ai-tools/access";
import { useManagementPane } from "@/components/ai-tools/management-pane";
import { cn } from "@/lib/utils";

/**
 * Full-width "Management" button shown in the sidebar for owners/admins only.
 * Inside a ManagementPaneProvider it toggles the in-portal split pane;
 * otherwise it opens the Management page (/ai-tools) in its own named window.
 */
export function AIToolsButton({ className }: { className?: string }) {
  const { scope } = useAuth();
  const pane = useManagementPane();
  if (!canUseAITools(scope)) return null;

  return (
    <button
      type="button"
      title="Management"
      aria-label="Management"
      aria-pressed={pane.available ? pane.open : undefined}
      onClick={() => (pane.available ? pane.toggle() : openAIToolsWindow())}
      className={cn(
        "inline-flex h-8 w-full items-center justify-center rounded-md border border-[#c2571a] bg-[#fdf4ee] px-2 text-xs font-semibold text-[#c2571a] hover:bg-[#f9e6d9]",
        pane.available && pane.open && "bg-[#f9e6d9]",
        className
      )}
    >
      Management
    </button>
  );
}

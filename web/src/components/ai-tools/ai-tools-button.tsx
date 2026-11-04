import { useAuth } from "@/lib/auth/auth-context";
import { canUseAITools, openAIToolsWindow } from "@/lib/ai-tools/access";
import { cn } from "@/lib/utils";

/**
 * Small "✦ AI" button shown in the sidebar header for owners/admins only.
 * Opens the AI Tools page in its own named browser window.
 */
export function AIToolsButton({ className }: { className?: string }) {
  const { scope } = useAuth();
  if (!canUseAITools(scope)) return null;

  return (
    <button
      type="button"
      title="Open AI Tools in a new window"
      aria-label="Open AI Tools"
      onClick={() => openAIToolsWindow()}
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-md border border-[#c2571a] bg-[#fdf4ee] px-2 text-xs font-semibold text-[#c2571a] hover:bg-[#f9e6d9]",
        className
      )}
    >
      ✦ AI
    </button>
  );
}

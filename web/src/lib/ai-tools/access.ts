// Access + window helpers for the admin-only AI Tools window.
//
// The server gates every /api/ai-tools endpoint on work_orders:update (the same
// permission that guards AI Settings — owners/admins have it, staff/workers do
// not). The UI mirrors that exact check so the button and route never show for
// someone the API would reject.

export const AI_TOOLS_PERMISSION = "work_orders:update";
export const AI_TOOLS_PATH = "/ai-tools";
export const AI_TOOLS_WINDOW_NAME = "humphreys-ai-tools";
const AI_TOOLS_WINDOW_FEATURES = "width=1100,height=800,resizable=yes,scrollbars=yes";

export function canUseAITools(scope: readonly string[]): boolean {
  return scope.includes(AI_TOOLS_PERMISSION);
}

/**
 * Opens (or re-focuses) the AI Tools page in its own named browser window.
 * Using a fixed window name means a second click reuses the existing window
 * instead of spawning another one.
 */
export function openAIToolsWindow(win: Window = window): Window | null {
  const popup = win.open(AI_TOOLS_PATH, AI_TOOLS_WINDOW_NAME, AI_TOOLS_WINDOW_FEATURES);
  if (popup) {
    try {
      popup.focus();
    } catch {
      // Some browsers block focus() on popups; the window is still open.
    }
  }
  return popup;
}

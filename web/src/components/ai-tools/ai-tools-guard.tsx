import type { ReactNode } from "react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth/auth-context";
import { firstReadableRoute } from "@/lib/auth/authorization";
import { canUseAITools } from "@/lib/ai-tools/access";

/**
 * Same session guard as ProtectedShell (AuthProvider redirects to /login when
 * the session can't be refreshed) plus the owner/admin role guard, but without
 * the sidebar/topbar chrome since this page lives in its own window.
 */
export function AIToolsGuard({ children }: { children: ReactNode }) {
  const { loading, user, scope } = useAuth();
  const navigate = useNavigate();
  const allowed = canUseAITools(scope);

  useEffect(() => {
    if (!loading && user && !allowed) {
      navigate(firstReadableRoute(scope), { replace: true });
    }
  }, [allowed, loading, navigate, scope, user]);

  if (loading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background">Loading session...</div>;
  }
  if (!user || !allowed) {
    return null;
  }
  return <>{children}</>;
}

"use client";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useAuth } from "@/lib/auth/auth-context";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { firstReadableRoute, requiredReadPermissionForPath } from "@/lib/auth/authorization";
import { canUseAITools } from "@/lib/ai-tools/access";
import { ManagementPaneProvider, ManagementSplit } from "@/components/ai-tools/management-pane";

export function ProtectedShell({ children }: { children: ReactNode }) {
  const { loading, user, scope, hasPermission } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const routePermission = requiredReadPermissionForPath(pathname);

  useEffect(() => {
    if (!loading && routePermission && !hasPermission(routePermission)) {
      navigate(firstReadableRoute(scope), { replace: true });
    }
  }, [hasPermission, loading, navigate, routePermission, scope]);

  if (loading) {
    return <div className="min-h-[100dvh] bg-background flex items-center justify-center">Loading session...</div>;
  }
  if (!user) {
    return null;
  }
  if (routePermission && !hasPermission(routePermission)) {
    return null;
  }

  const column = (
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar onMenuToggle={() => setMobileMenuOpen(true)} />
      <main className="safe-area-bottom min-w-0 overflow-x-hidden p-6">{children}</main>
    </div>
  );

  // Owners/admins get the in-portal Management split pane: the sidebar stays
  // left and the split is between portal content and the Management iframe.
  const managementEnabled = canUseAITools(scope);

  const layout = (
    <div className="min-h-[100dvh] flex overflow-x-hidden bg-background">
      <AppSidebar className="hidden md:block" />

      {mobileMenuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu overlay"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <AppSidebar className="safe-area-top fixed left-0 top-0 z-50 h-full md:hidden" onNavigate={() => setMobileMenuOpen(false)} />
        </>
      )}

      {managementEnabled ? <ManagementSplit>{column}</ManagementSplit> : column}
    </div>
  );

  return managementEnabled ? <ManagementPaneProvider>{layout}</ManagementPaneProvider> : layout;
}

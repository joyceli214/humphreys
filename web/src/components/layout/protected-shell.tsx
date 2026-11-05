"use client";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useAuth } from "@/lib/auth/auth-context";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { firstReadableRoute, requiredReadPermissionForPath } from "@/lib/auth/authorization";
import { canUseAITools } from "@/lib/ai-tools/access";
import { jobPath } from "@/lib/ai-tools/open-job";
import { ManagementPaneProvider, ManagementSplit, useManagementDocked } from "@/components/ai-tools/management-pane";
import { cn } from "@/lib/utils";

/**
 * Outer shell row. While the Management pane is docked the row is locked to
 * the viewport so the portal column and the pane scroll independently (the
 * document does not scroll); the sidebar then scrolls on its own too.
 */
function ShellRow({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const docked = useManagementDocked();
  return (
    <div
      data-testid="shell-row"
      className={cn("flex overflow-x-hidden bg-background", docked ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]")}
    >
      {/* Stable wrapper so docking never remounts the sidebar; md:flex lets it stretch full height. */}
      <div data-testid="shell-sidebar" className={cn("hidden shrink-0 md:flex", docked && "min-h-0 overflow-y-auto")}>
        {sidebar}
      </div>
      {children}
    </div>
  );
}

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
    <ShellRow sidebar={<AppSidebar className="hidden md:block" />}>
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
    </ShellRow>
  );

  return managementEnabled ? (
    <ManagementPaneProvider onOpenJob={(id) => navigate(jobPath(id))}>{layout}</ManagementPaneProvider>
  ) : (
    layout
  );
}

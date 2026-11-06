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
import { PortalWidthProvider, isPortalDesktopSidebar, usePortalWidth, usePortalWidthRefs } from "@/components/layout/portal-width";

/**
 * Outer shell row. While the Management pane is docked the row is locked to
 * the viewport so the portal column and the pane scroll independently (the
 * document does not scroll); the sidebar then scrolls on its own too.
 */
function ShellRow({ sidebar, desktopSidebar, children }: { sidebar: ReactNode; desktopSidebar: boolean; children: ReactNode }) {
  const docked = useManagementDocked();
  const { sidebarRef } = usePortalWidthRefs();
  return (
    <div
      data-testid="shell-row"
      className={cn("flex overflow-x-hidden bg-background", docked ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]")}
    >
      {/* Stable wrapper so docking never remounts the sidebar; flex lets it stretch full height.
          Shown from the portal's available width (beside Management), not the viewport. */}
      <div
        ref={sidebarRef}
        data-testid="shell-sidebar"
        className={cn("shrink-0", desktopSidebar ? "flex" : "hidden", docked && "min-h-0 overflow-y-auto")}
      >
        {sidebar}
      </div>
      {children}
    </div>
  );
}

/**
 * Sidebar vs. hamburger is decided from the portal's measured width (the space
 * beside a docked Management pane), so a squeezed portal uses the existing
 * mobile layout even on a wide viewport.
 */
function ShellLayout({
  managementEnabled,
  mobileMenuOpen,
  setMobileMenuOpen,
  children
}: {
  managementEnabled: boolean;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  const desktopSidebar = isPortalDesktopSidebar(usePortalWidth());
  const { contentRef } = usePortalWidthRefs();

  const column = (
    <div ref={contentRef} data-testid="portal-column" className="flex min-w-0 flex-1 flex-col">
      <Topbar onMenuToggle={() => setMobileMenuOpen(true)} showMenuButton={!desktopSidebar} />
      <main className="safe-area-bottom min-w-0 overflow-x-hidden p-6">{children}</main>
    </div>
  );

  return (
    <ShellRow sidebar={<AppSidebar />} desktopSidebar={desktopSidebar}>
      {mobileMenuOpen && !desktopSidebar && (
        <>
          <button
            type="button"
            aria-label="Close menu overlay"
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <AppSidebar className="safe-area-top fixed left-0 top-0 z-50 h-full" onNavigate={() => setMobileMenuOpen(false)} />
        </>
      )}

      {managementEnabled ? <ManagementSplit>{column}</ManagementSplit> : column}
    </ShellRow>
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

  // Owners/admins get the in-portal Management split pane: the sidebar stays
  // left and the split is between portal content and the Management iframe.
  const managementEnabled = canUseAITools(scope);

  const layout = (
    <PortalWidthProvider>
      <ShellLayout managementEnabled={managementEnabled} mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen}>
        {children}
      </ShellLayout>
    </PortalWidthProvider>
  );

  return managementEnabled ? (
    <ManagementPaneProvider onOpenJob={(id) => navigate(jobPath(id))}>{layout}</ManagementPaneProvider>
  ) : (
    layout
  );
}

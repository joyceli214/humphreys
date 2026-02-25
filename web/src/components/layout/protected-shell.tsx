"use client";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useAuth } from "@/lib/auth/auth-context";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { firstReadableRoute, requiredReadPermissionForPath } from "@/lib/auth/authorization";

export function ProtectedShell({ children }: { children: ReactNode }) {
  const { loading, user, scope, hasPermission } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const routePermission = requiredReadPermissionForPath(pathname);

  useEffect(() => {
    if (!loading && routePermission && !hasPermission(routePermission)) {
      router.replace(firstReadableRoute(scope));
    }
  }, [hasPermission, loading, routePermission, router, scope]);

  if (loading) {
    return <div className="min-h-[100dvh] bg-background flex items-center justify-center">Loading session...</div>;
  }
  if (!user) {
    return null;
  }
  if (routePermission && !hasPermission(routePermission)) {
    return null;
  }

  return (
    <div className="min-h-[100dvh] flex bg-background">
      <AppSidebar className="hidden md:block" />

      {mobileMenuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu overlay"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <AppSidebar className="fixed left-0 top-0 z-50 h-full md:hidden" onNavigate={() => setMobileMenuOpen(false)} />
        </>
      )}

      <div className="flex-1 flex flex-col">
        <Topbar onMenuToggle={() => setMobileMenuOpen(true)} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

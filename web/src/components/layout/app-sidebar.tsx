"use client";

import { Link, useLocation } from "react-router-dom";
import {
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  PackageCheck,
  ShieldCheck,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { visibleNavEntries } from "@/lib/auth/authorization";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/work-orders": ClipboardList,
  "/dropdown-management": ListChecks,
  "/parts-purchase-requests": PackageCheck,
  "/users": Users,
  "/roles": ShieldCheck
};

export function AppSidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { scope } = useAuth();
  const visibleLinks = visibleNavEntries(scope);
  const primaryLinks = visibleLinks.filter((link) => link.group !== "settings");
  const settingsLinks = visibleLinks.filter((link) => link.group === "settings");
  const settingsActive = settingsLinks.some((link) => pathname === link.href || pathname.startsWith(`${link.href}/`));
  const [settingsOpen, setSettingsOpen] = useState(settingsActive);

  useEffect(() => {
    if (settingsActive) setSettingsOpen(true);
  }, [settingsActive]);

  const renderLink = (link: (typeof visibleLinks)[number], nested = false) => {
    const Icon = NAV_ICONS[link.href];

    return (
      <Link
        key={link.href}
        to={link.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap",
          nested && "pl-8",
          pathname === link.href ? "bg-accent text-accent-foreground" : "hover:bg-muted"
        )}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span>{link.label}</span>
      </Link>
    );
  };

  return (
    <aside className={cn("w-64 shrink-0 border-r border-border bg-white", className)}>
      <div className="px-5 py-6 border-b border-border">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Admin Panel</p>
        <h1 className="text-lg font-semibold whitespace-nowrap">Control Center</h1>
      </div>
      <nav className="p-3 space-y-1">
        {primaryLinks.map((link) => renderLink(link))}
        {settingsLinks.length > 0 && (
          <div>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium whitespace-nowrap hover:bg-muted",
                settingsActive && !settingsOpen && "bg-accent text-accent-foreground"
              )}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", settingsOpen && "rotate-90")} />
              <span>Administration</span>
            </button>
            {settingsOpen && <div className="mt-1 space-y-1">{settingsLinks.map((link) => renderLink(link, true))}</div>}
          </div>
        )}
      </nav>
    </aside>
  );
}

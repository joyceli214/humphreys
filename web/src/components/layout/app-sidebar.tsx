"use client";

import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { visibleNavEntries } from "@/lib/auth/authorization";

export function AppSidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { scope } = useAuth();
  const visibleLinks = visibleNavEntries(scope);
  return (
    <aside className={cn("w-64 border-r border-border bg-white", className)}>
      <div className="px-5 py-6 border-b border-border">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Admin Panel</p>
        <h1 className="text-lg font-semibold">Control Center</h1>
      </div>
      <nav className="p-3 space-y-1">
        {visibleLinks.map((link) => (
          <Link
            key={link.href}
            to={link.href}
            onClick={onNavigate}
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium",
              pathname === link.href ? "bg-accent text-accent-foreground" : "hover:bg-muted"
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

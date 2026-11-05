"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { Menu } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * `showMenuButton` lets the shell decide from the portal's available width;
 * when omitted the button falls back to the viewport `md` breakpoint.
 */
export function Topbar({ onMenuToggle, showMenuButton }: { onMenuToggle?: () => void; showMenuButton?: boolean }) {
  const { user, logout } = useAuth();
  const greetingName = user?.full_name ?? "there";

  return (
    <header className="safe-area-top h-16 border-b border-border bg-white px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {showMenuButton !== false && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={showMenuButton === undefined ? "md:hidden" : undefined}
            onClick={onMenuToggle}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <h2 className="font-semibold">Admin Dashboard</h2>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="border-0 shadow-none">
            Hello, {greetingName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/work-order-layout">Work Order Layout</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => logout()}>Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

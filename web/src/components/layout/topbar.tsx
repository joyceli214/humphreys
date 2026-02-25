"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { Menu } from "lucide-react";

export function Topbar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { user, logout } = useAuth();
  const greetingName = user?.full_name ?? "there";

  return (
    <header className="h-16 border-b border-border bg-white px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" className="md:hidden" onClick={onMenuToggle} aria-label="Open menu">
          <Menu className="h-4 w-4" />
        </Button>
        <h2 className="font-semibold">Admin Dashboard</h2>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="border-0 shadow-none">
            Hello, {greetingName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => logout()}>Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

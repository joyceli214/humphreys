export type NavEntry = {
  href: string;
  label: string;
  readPermission: string;
  group?: "settings";
};

export const NAV_ENTRIES: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", readPermission: "work_orders:read" },
  { href: "/work-orders", label: "Work Orders", readPermission: "work_orders:read" },
  { href: "/dropdown-management", label: "Dropdown Management", readPermission: "work_orders:update", group: "settings" },
  { href: "/email-templates", label: "Email Templates", readPermission: "work_orders:update", group: "settings" },
  { href: "/parts-purchase-requests", label: "Parts Requests", readPermission: "work_orders_sensitive:read" },
  { href: "/users", label: "User Management", readPermission: "users:read", group: "settings" },
  { href: "/roles", label: "Role Management", readPermission: "roles:read", group: "settings" }
];

export function firstReadableRoute(scope: string[]): string {
  for (const entry of NAV_ENTRIES) {
    if (scope.includes(entry.readPermission)) return entry.href;
  }
  return "/login";
}

export function requiredReadPermissionForPath(pathname: string): string | null {
  const matched = NAV_ENTRIES.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  return matched?.readPermission ?? null;
}

export function visibleNavEntries(scope: string[]): NavEntry[] {
  return NAV_ENTRIES.filter((entry) => scope.includes(entry.readPermission));
}

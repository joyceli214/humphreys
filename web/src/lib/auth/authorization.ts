export type NavEntry = {
  href: string;
  label: string;
  readPermission: string;
};

export const NAV_ENTRIES: NavEntry[] = [
  { href: "/users", label: "User Management", readPermission: "users:read" },
  { href: "/roles", label: "Role Management", readPermission: "roles:read" }
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

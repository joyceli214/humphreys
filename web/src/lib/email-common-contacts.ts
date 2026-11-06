import type { EmailCommonContactRole } from "@/lib/api/generated/types";

export const EMAIL_CONTACT_ROLES: Array<{ value: EmailCommonContactRole; label: string; zh: string }> = [
  { value: "boss", label: "Boss", zh: "老闆" },
  { value: "staff", label: "Staff", zh: "員工" },
  { value: "other", label: "Other", zh: "其他" }
];

export const EMAIL_CONTACT_NAME_MAX = 120;

export function roleLabel(role: string): string {
  const entry = EMAIL_CONTACT_ROLES.find((r) => r.value === role);
  return entry ? `${entry.label} ${entry.zh}` : role;
}

export function roleBadgeClass(role: string): string {
  switch (role) {
    case "boss":
      return "bg-amber-100 text-amber-800";
    case "staff":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** Same order as the server: pinned first, then sort_order, then name. */
export function sortContacts<T extends { is_pinned: boolean; name: string; id: number; sort_order?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (so !== 0) return so;
    const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return byName !== 0 ? byName : a.id - b.id;
  });
}

/** Light client check for a bare address; the server is authoritative. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

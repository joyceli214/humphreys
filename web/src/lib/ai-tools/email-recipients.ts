import type { CustomerEmailRecipientFields } from "@/lib/api/client";
import type { EmailPickerContact } from "@/lib/api/generated/types";

/** Server caps (also returned by GET /work-orders/email-common-contacts). */
export const DEFAULT_MAX_TO = 10;
export const DEFAULT_MAX_CC = 10;

/**
 * What the sender picked in the Recipients block of Management email drafts.
 *
 * Roles are derived, keeping the UX simple:
 * - Customer checked → customer is To; common contacts and typed addresses are Cc.
 * - Customer unchecked (or no email on file) → common contacts and typed
 *   addresses become To.
 * - Portal staff are always Cc.
 */
export type RecipientSelection = {
  toCustomer: boolean;
  contactIds: number[];
  staffCc: string[];
  typed: string[];
};

export const EMPTY_RECIPIENTS: RecipientSelection = { toCustomer: true, contactIds: [], staffCc: [], typed: [] };

type Roles = {
  toCustomer: boolean;
  toContactIds: number[];
  ccContactIds: number[];
  toEmails: string[];
  ccEmails: string[];
};

export function recipientRoles(sel: RecipientSelection, hasCustomerEmail: boolean): Roles {
  const toCustomer = sel.toCustomer && hasCustomerEmail;
  if (toCustomer) {
    return { toCustomer, toContactIds: [], ccContactIds: sel.contactIds, toEmails: [], ccEmails: [...sel.staffCc, ...sel.typed] };
  }
  return { toCustomer, toContactIds: sel.contactIds, ccContactIds: [], toEmails: sel.typed, ccEmails: sel.staffCc };
}

/** Request fields for POST /work-orders/:id/customer-email (picker mode). */
export function recipientPayload(sel: RecipientSelection, hasCustomerEmail: boolean): CustomerEmailRecipientFields {
  const roles = recipientRoles(sel, hasCustomerEmail);
  return {
    to_customer: roles.toCustomer,
    ...(roles.toContactIds.length > 0 ? { to_contact_ids: roles.toContactIds } : {}),
    ...(roles.ccContactIds.length > 0 ? { cc_contact_ids: roles.ccContactIds } : {}),
    ...(roles.toEmails.length > 0 ? { to_emails: roles.toEmails } : {}),
    ...(roles.ccEmails.length > 0 ? { cc_emails: roles.ccEmails } : {})
  };
}

export function contactLabel(contact: Pick<EmailPickerContact, "name" | "email">) {
  const name = contact.name.trim();
  return name ? `${name} <${contact.email}>` : contact.email;
}

/** Human-readable To / Cc lists for the confirm step and the sent note. */
export function recipientLabels(
  sel: RecipientSelection,
  hasCustomerEmail: boolean,
  customerHint: string,
  contacts: EmailPickerContact[]
): { to: string[]; cc: string[] } {
  const roles = recipientRoles(sel, hasCustomerEmail);
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const label = (id: number) => {
    const contact = byId.get(id);
    return contact ? contactLabel(contact) : `contact #${id}`;
  };
  const dedupe = (list: string[]) => {
    const seen = new Set<string>();
    return list.filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return {
    to: dedupe([...(roles.toCustomer ? [customerHint] : []), ...roles.toContactIds.map(label), ...roles.toEmails]),
    cc: dedupe([...roles.ccContactIds.map(label), ...roles.ccEmails])
  };
}

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { EmailPickerContact } from "@/lib/api/generated/types";
import { DEFAULT_MAX_CC, DEFAULT_MAX_TO, type RecipientSelection } from "@/lib/ai-tools/email-recipients";
import { looksLikeEmail, roleBadgeClass, roleLabel } from "@/lib/email-common-contacts";
import { StaffCcPicker } from "@/components/ai-tools/staff-cc-picker";
import { cn } from "@/lib/utils";

export type PickerContacts = {
  contacts: EmailPickerContact[];
  loading: boolean;
  error: string;
  maxTo: number;
  maxCc: number;
};

/** Loads active common contacts (GET /work-orders/email-common-contacts) once. */
export function usePickerContacts(enabled: boolean): PickerContacts {
  const [state, setState] = useState<PickerContacts>({ contacts: [], loading: enabled, error: "", maxTo: DEFAULT_MAX_TO, maxCc: DEFAULT_MAX_CC });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    Promise.resolve()
      .then(() => apiClient.listEmailPickerContacts())
      .then((res) => {
        if (cancelled) return;
        setState({
          contacts: res.items ?? [],
          loading: false,
          error: "",
          maxTo: res.max_to > 0 ? res.max_to : DEFAULT_MAX_TO,
          maxCc: res.max_cc > 0 ? res.max_cc : DEFAULT_MAX_CC
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, contacts: [], loading: false, error: "Couldn't load common contacts." }));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return state;
}

type Props = {
  value: RecipientSelection;
  onChange: (next: RecipientSelection) => void;
  /** Masked customer address from the draft response; "" when none on file. */
  customerHint: string;
  contacts: PickerContacts;
  /** Owners/admins (work_orders:update) may type any address. */
  canType: boolean;
  disabled?: boolean;
};

const CHIP = "inline-flex items-center gap-1 rounded-full bg-[#efebe7] px-2 py-0.5 text-xs text-neutral-800";

/**
 * Recipients block for Management email drafts: customer (To), common contacts,
 * portal staff (Cc) and — for owners/admins — a typed address. The server
 * re-checks everything when sending.
 */
export function EmailRecipientPicker({ value, onChange, customerHint, contacts, canType, disabled = false }: Props) {
  const [typedInput, setTypedInput] = useState("");
  const [typedError, setTypedError] = useState("");
  const hasCustomerEmail = customerHint !== "";
  const customerIsTo = value.toCustomer && hasCustomerEmail;
  const extrasRole = customerIsTo ? "Cc" : "To";

  const toggleContact = (id: number, checked: boolean) => {
    const next = checked ? [...value.contactIds.filter((entry) => entry !== id), id] : value.contactIds.filter((entry) => entry !== id);
    onChange({ ...value, contactIds: next });
  };

  const addTyped = () => {
    const email = typedInput.trim();
    if (!email) return;
    if (!looksLikeEmail(email)) {
      setTypedError("Enter a plain email address like name@example.com.");
      return;
    }
    const key = email.toLowerCase();
    if (!value.typed.some((entry) => entry.toLowerCase() === key)) {
      onChange({ ...value, typed: [...value.typed, email] });
    }
    setTypedInput("");
    setTypedError("");
  };

  return (
    <fieldset aria-label="Recipients" className="space-y-2 rounded-md border border-[#efeae4] bg-[#fbfaf8] p-2 text-sm text-neutral-700" disabled={disabled}>
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Recipients</legend>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Send to customer"
          checked={customerIsTo}
          disabled={disabled || !hasCustomerEmail}
          onChange={(event) => onChange({ ...value, toCustomer: event.target.checked })}
        />
        <span className="font-medium">Customer</span>
        {hasCustomerEmail ? (
          <span className="text-neutral-600">
            {customerHint} <span className="text-xs text-neutral-500">(To)</span>
          </span>
        ) : (
          <span className="text-red-700">Customer has no email on file</span>
        )}
      </label>

      <div>
        <p className="text-xs font-medium text-neutral-600">
          Common contacts 常用聯絡人 <span className="font-normal text-neutral-500">— selected go on {extrasRole}</span>
        </p>
        {contacts.loading ? (
          <p className="text-xs text-neutral-500">Loading contacts...</p>
        ) : contacts.error ? (
          <p className="text-xs text-red-700">{contacts.error}</p>
        ) : contacts.contacts.length === 0 ? (
          <p className="text-xs text-neutral-500">
            No common contacts yet.{canType ? " Add them under Config → Common contacts." : ""}
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5" aria-label="Common contacts">
            {contacts.contacts.map((contact) => {
              const checked = value.contactIds.includes(contact.id);
              return (
                <li key={contact.id}>
                  <label className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${contact.name} <${contact.email}>`}
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) => toggleContact(contact.id, event.target.checked)}
                    />
                    <span className={cn("text-neutral-800", checked && "font-medium")}>{contact.name}</span>
                    <span className="text-xs text-neutral-500">{contact.email}</span>
                    <span className={cn("rounded-full px-1.5 py-0 text-[10px]", roleBadgeClass(contact.role))}>{roleLabel(contact.role)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <StaffCcPicker value={value.staffCc} onChange={(staffCc) => onChange({ ...value, staffCc })} disabled={disabled} />

      {canType && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor="ai-email-typed" className="shrink-0 text-xs font-medium text-neutral-600">
              Other address ({extrasRole}):
            </label>
            {value.typed.map((email) => (
              <span key={email} className={CHIP}>
                {email}
                <button
                  type="button"
                  aria-label={`Remove ${email}`}
                  className="rounded-full p-0.5 hover:bg-[#e0d8d0] disabled:opacity-40"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, typed: value.typed.filter((entry) => entry !== email) })}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              id="ai-email-typed"
              type="email"
              aria-label="Add email address"
              placeholder="name@example.com"
              className="min-w-0 flex-1 rounded border border-[#ddd5cc] bg-white px-1.5 py-0.5 text-xs"
              value={typedInput}
              disabled={disabled}
              onChange={(event) => {
                setTypedInput(event.target.value);
                setTypedError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTyped();
                }
              }}
            />
            <button
              type="button"
              className="rounded border border-[#ddd5cc] bg-white px-2 py-0.5 text-xs hover:bg-[#f3efeb] disabled:opacity-40"
              disabled={disabled || typedInput.trim() === ""}
              onClick={addTyped}
            >
              Add
            </button>
          </div>
          {typedError && <p className="text-xs text-red-700">{typedError}</p>}
        </div>
      )}
    </fieldset>
  );
}

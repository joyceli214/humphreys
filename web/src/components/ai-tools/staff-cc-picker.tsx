import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { StaffContact } from "@/lib/api/generated/types";

type Props = {
  value: string[];
  onChange: (emails: string[]) => void;
  disabled?: boolean;
};

const DEFAULT_MAX_CC = 10;

export function staffLabel(contact: StaffContact) {
  const name = contact.full_name.trim();
  return name ? `${name} <${contact.email}>` : contact.email;
}

/**
 * Cc picker limited to active staff (from GET /work-orders/email-staff). There
 * is no free-text entry: the server rejects any address that isn't staff.
 */
export function StaffCcPicker({ value, onChange, disabled = false }: Props) {
  const [staff, setStaff] = useState<StaffContact[] | null>(null);
  const [maxCc, setMaxCc] = useState(DEFAULT_MAX_CC);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => apiClient.listEmailStaff())
      .then((res) => {
        if (cancelled) return;
        setStaff(res.items ?? []);
        if (res.max_cc > 0) setMaxCc(res.max_cc);
      })
      .catch(() => {
        if (cancelled) return;
        setStaff([]);
        setError("Couldn't load staff emails.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chosen = new Set(value.map((email) => email.toLowerCase()));
  const options = (staff ?? []).filter((contact) => !chosen.has(contact.email.toLowerCase()));
  const byEmail = new Map((staff ?? []).map((contact) => [contact.email.toLowerCase(), contact]));
  const atCap = value.length >= maxCc;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor="ai-email-cc" className="shrink-0">
          Cc:
        </label>
        {value.map((email) => {
          const contact = byEmail.get(email.toLowerCase());
          return (
            <span key={email} className="inline-flex items-center gap-1 rounded-full bg-[#efebe7] px-2 py-0.5 text-xs text-neutral-800">
              {contact?.full_name?.trim() || email}
              <button
                type="button"
                aria-label={`Remove ${email} from Cc`}
                className="rounded-full p-0.5 hover:bg-[#e0d8d0] disabled:opacity-40"
                disabled={disabled}
                onClick={() => onChange(value.filter((entry) => entry !== email))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <select
          id="ai-email-cc"
          aria-label="Add staff to Cc"
          className="min-w-0 rounded border border-[#ddd5cc] bg-white px-1.5 py-0.5 text-xs text-neutral-700"
          value=""
          disabled={disabled || staff === null || atCap || options.length === 0}
          onChange={(event) => {
            const email = event.target.value;
            if (email) onChange([...value, email]);
          }}
        >
          <option value="">{staff === null ? "Loading staff..." : atCap ? `Max ${maxCc}` : options.length === 0 ? "No more staff" : "+ Add staff"}</option>
          {options.map((contact) => (
            <option key={contact.id} value={contact.email}>
              {staffLabel(contact)}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

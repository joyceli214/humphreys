import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { CustomerLookupOption, EmailPickerContact, WorkOrderListItem } from "@/lib/api/generated/types";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { LINK_BUTTON } from "@/components/ai-tools/mgmt-ui";
import {
  WHO_ADDED_CLASS,
  WHO_GROUP_LABEL,
  WHO_ROW_ACTIVE,
  WHO_ROW_CLASS,
  WHO_SEARCH_DEBOUNCE_MS,
  jobItemLabel
} from "@/components/ai-tools/email-flow/who-search";
import { contactMention, customerName, hasMention, jobMention, type ShortcutKind } from "@/components/ai-tools/ask/ask-shortcuts";
import { cn } from "@/lib/utils";

const JOB_RESULTS = 10;

export type MenuRow =
  | { type: "skill"; key: string; label: string; prompt: string }
  | { type: "contact"; key: string; mention: string; contact: EmailPickerContact }
  | { type: "customer"; key: string; mention: string; name: string; detail: string; customer: CustomerLookupOption }
  | { type: "job"; key: string; mention: string; row: WorkOrderListItem };

type Group = { label: string; rows: MenuRow[] };
type Note = { text: string; tone?: "error"; onRetry?: () => void; status?: boolean };

export type ShortcutResults = {
  groups: Group[];
  /** Pickable rows in display order (keyboard options). */
  options: MenuRow[];
  isPicked: (row: MenuRow) => boolean;
  notes: Note[];
};

function useDebouncedSearch<T>(q: string, enabled: boolean, fetcher: (q: string) => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  useEffect(() => {
    const id = ++requestId.current;
    if (!enabled || !q) {
      setItems(null);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetchRef.current(q);
        if (id !== requestId.current) return;
        setItems(res);
      } catch (err) {
        if (id !== requestId.current) return;
        setItems(null);
        setError(errorMessage(err, "Search failed."));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, WHO_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q, enabled, attempt]);

  return { items, loading, error, retry: () => setAttempt((n) => n + 1) };
}

function useContacts(enabled: boolean) {
  const [state, setState] = useState<{ items: EmailPickerContact[] | null; loading: boolean; error: string }>({ items: null, loading: false, error: "" });
  const [attempt, setAttempt] = useState(0);
  const loaded = state.items !== null;

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    setState({ items: null, loading: true, error: "" });
    apiClient.listEmailPickerContacts().then(
      (res) => !cancelled && setState({ items: res.items ?? [], loading: false, error: "" }),
      () => !cancelled && setState({ items: null, loading: false, error: "Couldn't load contacts." })
    );
    return () => {
      cancelled = true;
    };
    // Load once; a failed load waits for Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/** Rows for the open `/`, `@` or `#` menu. Picked state comes from the text: a row is added while its mention is in `input`. */
export function useShortcutResults(
  menu: { kind: ShortcutKind; query: string } | null,
  input: string,
  skills: ReadonlyArray<{ label: string; prompt: string }>
): ShortcutResults {
  const kind = menu?.kind;
  const q = (menu?.query ?? "").trim();
  const jobQ = q.replace(/^#+/, "");
  const contacts = useContacts(kind === "@");
  const customers = useDebouncedSearch(q, kind === "@", async (s) => (await apiClient.listWorkOrderCustomers(s)).items ?? []);
  const jobs = useDebouncedSearch(jobQ, kind === "#", async (s) => {
    const params = new URLSearchParams({ q: s, page_size: String(JOB_RESULTS) });
    return (await apiClient.listWorkOrders(params)).items ?? [];
  });

  const isPicked = (row: MenuRow) => row.type !== "skill" && hasMention(input, row.mention);
  const groups: Group[] = [];
  const notes: Note[] = [];
  const needle = q.toLowerCase();

  if (kind === "/") {
    const rows = skills
      .filter((s) => s.label.toLowerCase().includes(needle))
      .map((s): MenuRow => ({ type: "skill", key: `s:${s.label}`, label: s.label, prompt: s.prompt }));
    if (rows.length) groups.push({ label: "Skills", rows });
    else notes.push({ text: "No match." });
  }

  if (kind === "@") {
    const contactRows = (contacts.items ?? [])
      .filter((c) => !needle || `${c.name} ${c.email}`.toLowerCase().includes(needle))
      .map((contact): MenuRow => ({ type: "contact", key: `c:${contact.id}`, mention: contactMention(contact.name), contact }));
    const customerRows = (customers.items ?? []).map((customer): MenuRow => {
      const name = customerName(customer);
      const detail = [customer.email, customer.home_phone || customer.work_phone].map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");
      return { type: "customer", key: `u:${customer.id}`, mention: contactMention(name), name, detail, customer };
    });
    if (contactRows.length) groups.push({ label: "Contacts", rows: contactRows });
    if (customerRows.length) groups.push({ label: "Customers", rows: customerRows });
    if (contacts.loading) notes.push({ text: "Loading contacts…", status: true });
    if (contacts.error) notes.push({ text: contacts.error, tone: "error", onRetry: contacts.retry });
    if (customers.loading) notes.push({ text: "Searching…", status: true });
    if (customers.error) notes.push({ text: customers.error, tone: "error", onRetry: customers.retry });
    const settled = !contacts.loading && !customers.loading && !contacts.error && !customers.error;
    if (settled && !q && contacts.items?.length === 0) notes.push({ text: "No contacts yet. Add them on Common contacts." });
    if (settled && q && customers.items !== null && !contactRows.length && !customerRows.length) {
      notes.push({ text: "No match." });
      if (contacts.items?.length === 0) notes.push({ text: "No contacts yet. Add them on Common contacts." });
    }
    if (!q && !contacts.error) notes.push({ text: "Type a name to find customers." });
  }

  if (kind === "#") {
    const rows = (jobs.items ?? []).map((row): MenuRow => ({ type: "job", key: `j:${row.reference_id}`, mention: jobMention(row.reference_id), row }));
    if (rows.length) groups.push({ label: "Jobs", rows });
    if (!jobQ) notes.push({ text: "Type a job number or name." });
    if (jobs.loading) notes.push({ text: "Searching…", status: true });
    if (jobs.error) notes.push({ text: jobs.error, tone: "error", onRetry: jobs.retry });
    if (!jobs.loading && !jobs.error && jobs.items !== null && rows.length === 0) notes.push({ text: "No match." });
  }

  const options = groups.flatMap((g) => g.rows).filter((row) => !isPicked(row));
  return { groups, options, isPicked, notes };
}

const TAGS = { skill: "Skill", contact: "Contact", customer: "Customer", job: "+ Job" } as const;

function rowLabel(row: MenuRow) {
  switch (row.type) {
    case "skill":
      return row.label;
    case "contact":
      return `${row.contact.name} ${row.contact.email}`;
    case "customer":
      return [row.name, row.detail].filter(Boolean).join(" ");
    case "job":
      return `#${row.row.reference_id} ${jobItemLabel(row.row)} · ${row.row.customer_name ?? ""} · ${row.row.status}`;
  }
}

function RowBody({ row }: { row: MenuRow }) {
  switch (row.type) {
    case "skill":
      return <b className="block truncate">{row.label}</b>;
    case "contact":
      return (
        <>
          <b className="block truncate">{row.contact.name}</b>
          <small className="block truncate text-[15px] text-[#4a5260]">{row.contact.email}</small>
        </>
      );
    case "customer":
      return (
        <>
          <b className="block truncate">{row.name}</b>
          {row.detail && <small className="block truncate text-[15px] text-[#4a5260]">{row.detail}</small>}
        </>
      );
    case "job":
      return (
        <>
          <b className="block truncate">
            <span className="text-[#135f6f]">#{row.row.reference_id}</span> {jobItemLabel(row.row)}
          </b>
          <small className="block truncate text-[15px] text-[#4a5260]">
            {row.row.customer_name || "No customer"} · {row.row.status}
          </small>
        </>
      );
  }
}

const MENU_LABEL: Record<ShortcutKind, string> = { "/": "Skills", "@": "Contacts and customers", "#": "Jobs" };

type MenuProps = {
  kind: ShortcutKind;
  listId: string;
  results: ShortcutResults;
  active: number;
  optionId: (i: number) => string;
  onHover: (i: number) => void;
  onPick: (row: MenuRow) => void;
};

/** Popup over the Ask box: grouped 56px rows like WhoSearch; picked rows show Added ✓. */
export function AskMentionMenu({ kind, listId, results, active, optionId, onHover, onPick }: MenuProps) {
  const { groups, options, isPicked, notes } = results;
  return (
    <div
      className="absolute inset-x-3 bottom-full z-30 mb-2 max-h-[min(360px,50vh)] overflow-y-auto overscroll-contain rounded-[12px] border border-[#d5d9de] bg-white p-2 text-[17px] shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div id={listId} role="listbox" aria-label={MENU_LABEL[kind]} className="space-y-1.5">
        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label} className="space-y-1.5">
            <p className={WHO_GROUP_LABEL}>{group.label}</p>
            {group.rows.map((row) => {
              if (isPicked(row)) {
                return (
                  <div key={row.key} role="option" aria-selected={false} aria-disabled="true" aria-label={`${rowLabel(row)} · Added`} className={WHO_ADDED_CLASS}>
                    <span className="min-w-0">
                      <RowBody row={row} />
                    </span>
                    <span className="flex-none text-[14px] font-semibold text-[#135f6f]">Added ✓</span>
                  </div>
                );
              }
              const i = options.indexOf(row);
              return (
                <div
                  key={row.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-label={rowLabel(row)}
                  tabIndex={-1}
                  className={cn(WHO_ROW_CLASS, i === active && WHO_ROW_ACTIVE)}
                  onMouseEnter={() => onHover(i)}
                  onClick={() => onPick(row)}
                >
                  <span className="min-w-0">
                    <RowBody row={row} />
                  </span>
                  <span className="flex-none text-[14px] font-semibold text-[#4a5260]">{TAGS[row.type]}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {notes.length > 0 && (
        <div className={cn("space-y-1", groups.length > 0 && "mt-2")}>
          {notes.map((note, n) =>
            note.tone === "error" ? (
              <p key={n} role="alert" className="flex flex-wrap items-center gap-2 text-[15px] text-red-700">
                {note.text}
                <button type="button" className={LINK_BUTTON} onClick={note.onRetry}>
                  Retry
                </button>
              </p>
            ) : (
              <p key={n} role={note.status ? "status" : undefined} className="text-[16px] text-[#4a5260]">
                {note.text}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

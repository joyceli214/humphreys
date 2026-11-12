import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { EmailPickerContact, PartsPurchaseRequest, WorkOrderDetail, WorkOrderListItem } from "@/lib/api/generated/types";
import type { EmailDraftTarget, EmailDraftType } from "@/lib/ai-tools/types";
import { DEFAULT_EMAIL_TEMPLATES, emailTemplatesHref, firstTemplateKey, type EmailTemplateKey } from "@/lib/email-templates";
import { templateForDraftType } from "@/lib/ai-tools/email-handoff";
import { EMAIL_MAX_JOBS, customerGroups, type SelectedEmailJob } from "@/lib/ai-tools/email-selection";
import { DEFAULT_MAX_CC, DEFAULT_MAX_TO, EMPTY_RECIPIENTS, contactLabel, recipientLabels, recipientPayload, type RecipientSelection } from "@/lib/ai-tools/email-recipients";
import {
  COMMON_CONTACTS_PATH,
  CUSTOMER_DRAFTS,
  SHOP_APPROVAL_PART_STATUSES,
  SHOP_DRAFTS,
  SHOP_TEMPLATE_KEYS,
  SUPPLIER_DRAFTS,
  SUPPLIER_TEMPLATE_KEYS,
  buildCustomerDraft,
  buildShopDraft,
  buildSupplierDraft,
  maskEmailHint,
  partsStatusHint,
  partsStatusWord,
  signOffFromTemplate,
  supplierStatusHint,
  type CustomerTemplates,
  type EmailJob,
  type JobParts,
  type ShopDraftType,
  type SupplierDraftType,
  type TemplateText,
  joinRecipientNames
} from "@/lib/ai-tools/email-flow";
import { countBlanks, sendButtonState } from "@/lib/ai-tools/email-blanks";
import { buildMailto, draftClipboardText, mailtoNavigator } from "@/lib/mailto";
import { looksLikeEmail } from "@/lib/email-common-contacts";
import { useAuth } from "@/lib/auth/auth-context";
import { useDraftPhotos } from "@/lib/ai-tools/draft-photos";
import { summarizePhotoSelection } from "@/lib/email-photos";
import { EmailPhotoPanel } from "@/components/email-photo-panel";
import { EmailRecipientPicker, type PickerContacts } from "@/components/ai-tools/email-recipient-picker";
import { EmailSendConfirm } from "@/components/ai-tools/email-send-confirm";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { FOCUS, INPUT_CLASS, LINK_BUTTON, MgmtButton, MgmtError, StatusPill, errorStatus, statusTone } from "@/components/ai-tools/mgmt-ui";
import { WhoSearch, jobItemLabel } from "@/components/ai-tools/email-flow/who-search";
import { EmailWriter } from "@/components/ai-tools/email-flow/email-writer";
import { cn } from "@/lib/utils";


type Kind = "customer" | "supplier" | "shop";
type AnyDraftType = EmailDraftType | SupplierDraftType | ShopDraftType;
type LoadedTemplate = TemplateText & { label: string };

const KIND_LABEL: Record<Kind, string> = { customer: "Customer", supplier: "Supplier", shop: "Shop" };

/** Who-step copy per kind (plan §4.3, §12.2). */
const WHO_COPY: Record<Kind, { heading: string; hint: string; placeholder: string; contactsLabel: string; contactTag: string }> = {
  customer: {
    heading: "Pick jobs or a contact.",
    hint: "One job or several. Jobs for the same customer go in one email.",
    placeholder: "Name or job #",
    contactsLabel: "Contacts",
    contactTag: "Contact"
  },
  supplier: {
    heading: "Pick jobs and a supplier.",
    hint: "Pick every job that needs parts. One email asks about all of them.",
    placeholder: "Supplier name or job #",
    contactsLabel: "Suppliers",
    contactTag: "Supplier"
  },
  shop: {
    heading: "Pick jobs and a shop contact.",
    hint: "Emails inside the shop. The search stays open — tap each job you need.",
    placeholder: "Shop contact or job #",
    contactsLabel: "Shop contacts",
    contactTag: "Shop"
  }
};

const ALL_TEMPLATE_KEYS = Object.keys(DEFAULT_EMAIL_TEMPLATES) as EmailTemplateKey[];

function defaultTemplates(): Record<EmailTemplateKey, LoadedTemplate> {
  return Object.fromEntries(ALL_TEMPLATE_KEYS.map((key) => [key, DEFAULT_EMAIL_TEMPLATES[key]])) as unknown as Record<EmailTemplateKey, LoadedTemplate>;
}
type Step = 1 | 2 | 3;

type PickedJob = {
  referenceId: number;
  customerId: number | null;
  customerName: string;
  equipment: string;
  status: string;
  detail: WorkOrderDetail | null;
  loading: boolean;
  error: string;
};

type PartsState = { status: "loading" | "ok" | "forbidden" | "error"; items: PartsPurchaseRequest[]; error?: string };

type Draft = {
  key: string;
  title: string;
  jobIds: number[];
  subject: string;
  body: string;
  /** Body as last generated; differs from body once the user edits it. */
  basis: string;
  /** Subject as last generated; a subject the user changed is not regenerated. */
  subjectBasis: string;
  edited: boolean;
  recipients: RecipientSelection;
  hasCustomerEmail: boolean;
  customerHint: string;
  customerEmail: string;
  /** Supplier / Shop To: picked common contacts in pick order + typed addresses (work_orders:update only). */
  contactIds: number[];
  typedTo: string[];
  photoIds: string[];
  sent: boolean;
  sentTo: string;
};

const TOO_LONG_NOTE = "Draft is too long for the email app link; copied to clipboard.";
const COPY_FAILED_NOTE = "Couldn't copy the draft. Select the text and copy it yourself.";
const NO_JOB_SEND_NOTE = "Add a job to send from the portal, or use Open in email app.";

function personName(detail: WorkOrderDetail | null, fallback: string) {
  const name = [detail?.customer.first_name, detail?.customer.last_name].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
  return name || fallback || "Unknown";
}

function toSelected(job: PickedJob): SelectedEmailJob {
  return { referenceId: job.referenceId, customerId: job.customerId, customerName: job.customerName, equipment: job.equipment, status: job.status };
}

function toEmailJob(job: PickedJob): EmailJob {
  return { referenceId: job.referenceId, customerName: job.customerName, equipment: job.equipment, status: job.status, detail: job.detail };
}

/** Active common contacts for the Who search, with retry. */
function useContacts(): PickerContacts & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PickerContacts>({ contacts: [], loading: true, error: "", maxTo: DEFAULT_MAX_TO, maxCc: DEFAULT_MAX_CC });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    apiClient.listEmailPickerContacts().then(
      (res) =>
        !cancelled &&
        setState({
          contacts: res.items ?? [],
          loading: false,
          error: "",
          maxTo: res.max_to > 0 ? res.max_to : DEFAULT_MAX_TO,
          maxCc: res.max_cc > 0 ? res.max_cc : DEFAULT_MAX_CC
        }),
      () => !cancelled && setState((s) => ({ ...s, contacts: [], loading: false, error: "Couldn't load contacts." }))
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return { ...state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

async function copyText(text: string) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

function Stepper({ step, canGo, onGo }: { step: Step; canGo: (s: Step) => boolean; onGo: (s: Step) => void }) {
  const steps: Array<[Step, string]> = [
    [1, "Who"],
    [2, "Draft"],
    [3, "Write"]
  ];
  return (
    <ol aria-label="Email steps" className="flex gap-1.5 border-b border-[#d5d9de] pb-1">
      {steps.map(([n, label]) => {
        const current = n === step;
        const done = n < step;
        return (
          <li key={n} className="flex-1">
            <button
              type="button"
              aria-current={current ? "step" : undefined}
              disabled={!current && !canGo(n)}
              onClick={() => onGo(n)}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-1.5 border-b-[3px] text-[16px] font-semibold disabled:cursor-not-allowed",
                current ? "border-[#b8501a] text-[#1f2328]" : "border-transparent text-[#4a5260]",
                FOCUS
              )}
            >
              <span
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-full text-[15px]",
                  current ? "bg-[#b8501a] text-white" : done ? "bg-[#1a7f94] text-white" : "bg-[#e2ddd7]"
                )}
              >
                {n}
              </span>
              {label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PickedRow({ job, onRemove, onRetry }: { job: PickedJob; onRemove: () => void; onRetry: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-[12px] border-[1.5px] border-[#1a7f94] bg-white py-1.5 pl-3.5 pr-1">
      <span className="min-w-0">
        <b className="text-[#135f6f]">#{job.referenceId}</b> {job.equipment}
        <small className="flex flex-wrap items-center gap-1 text-[15px] text-[#4a5260]">
          {job.customerName}
          {job.status && (
            <>
              {" · "}
              <StatusPill tone={statusTone(job.status)}>{job.status}</StatusPill>
            </>
          )}
        </small>
        {job.loading && <small className="block text-[15px] text-[#4a5260]">Loading job…</small>}
        {job.error && (
          <small className="flex flex-wrap items-center gap-1 text-[15px] text-red-700">
            {job.error}
            <button type="button" className={LINK_BUTTON} onClick={onRetry}>
              Retry
            </button>
          </small>
        )}
      </span>
      <button
        type="button"
        aria-label={`Remove job #${job.referenceId}`}
        onClick={onRemove}
        className={cn("grid h-11 w-11 flex-none place-items-center rounded-lg hover:bg-[#e6f3f6]", FOCUS)}
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
    </li>
  );
}

function ToChip({ label, sub, tag, onRemove, removeLabel }: { label: string; sub?: string; tag?: string; onRemove?: () => void; removeLabel: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-[12px] border-[1.5px] border-[#1a7f94] bg-[#e6f3f6] py-1.5 pl-3.5 pr-1 font-semibold">
      <span className="min-w-0 break-words">
        {label}
        {tag && <span className="ml-1.5 rounded-md bg-white px-1.5 text-[13px] font-bold text-[#135f6f]">{tag}</span>}
        {sub && <small className="block break-all text-[15px] font-normal text-[#4a5260]">{sub}</small>}
      </span>
      {onRemove && (
        <button type="button" aria-label={removeLabel} onClick={onRemove} className={cn("grid h-11 w-11 flex-none place-items-center rounded-lg", FOCUS)}>
          <X className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Management Email: 1 Who → 2 Draft → 3 Write. Customer or Supplier. */
export function EmailTab({ target }: { target: EmailDraftTarget | null }) {
  const { hasPermission } = useAuth();
  const canType = hasPermission("work_orders:update");
  const contacts = useContacts();

  const [kind, setKind] = useState<Kind>("customer");
  const [step, setStep] = useState<Step>(1);
  const [jobs, setJobs] = useState<PickedJob[]>([]);
  const [toCustomer, setToCustomer] = useState(true);
  const [contactIds, setContactIds] = useState<number[]>([]);
  const [toContactId, setToContactId] = useState<number | null>(null);
  const [mix, setMix] = useState<null | "split" | "picking">(null);
  const [draftType, setDraftType] = useState<AnyDraftType | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [current, setCurrent] = useState(0);
  const [showNames, setShowNames] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Email Templates page templates; DEFAULT copy (same as migrations) when the API fails or lacks a key.
  const [templates, setTemplates] = useState<{
    status: "idle" | "loading" | "ok" | "fallback";
    value: Record<EmailTemplateKey, LoadedTemplate>;
    missing: EmailTemplateKey[];
  }>(() => ({ status: "idle", value: defaultTemplates(), missing: [] }));
  const [parts, setParts] = useState<Record<number, PartsState>>({});
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [note, setNote] = useState("");
  const [typedInput, setTypedInput] = useState("");
  const [typedError, setTypedError] = useState("");
  const detailRequests = useRef(new Map<number, number>());

  const customerContacts = useMemo(() => contacts.contacts.filter((c) => c.role !== "supplier"), [contacts.contacts]);
  const supplierContacts = useMemo(() => contacts.contacts.filter((c) => c.role === "supplier"), [contacts.contacts]);
  // Shop emails go to internal people: Common contacts with role boss or staff.
  const shopContacts = useMemo(() => contacts.contacts.filter((c) => c.role === "boss" || c.role === "staff"), [contacts.contacts]);
  const kindContacts = kind === "customer" ? customerContacts : kind === "supplier" ? supplierContacts : shopContacts;
  const contactById = useMemo(() => new Map(contacts.contacts.map((c) => [c.id, c])), [contacts.contacts]);
  const toContact = toContactId != null ? contactById.get(toContactId) ?? null : null;

  // --- Who state changes reset any drafts (plan: changing jobs resets the draft) ---
  const resetDrafts = () => {
    setDrafts([]);
    setDraftType(null);
    setCurrent(0);
    setConfirming(false);
    setSendError("");
    setNote("");
  };

  const loadDetail = useCallback((referenceId: number) => {
    const req = (detailRequests.current.get(referenceId) ?? 0) + 1;
    detailRequests.current.set(referenceId, req);
    setJobs((list) => list.map((j) => (j.referenceId === referenceId ? { ...j, loading: true, error: "" } : j)));
    apiClient.getWorkOrderDetail(referenceId).then(
      (detail) => {
        if (detailRequests.current.get(referenceId) !== req) return;
        setJobs((list) =>
          list.map((j) =>
            j.referenceId === referenceId
              ? {
                  ...j,
                  detail,
                  loading: false,
                  customerId: detail.customer.customer_id ?? null,
                  customerName: personName(detail, j.customerName),
                  status: detail.status_name?.trim() || j.status
                }
              : j
          )
        );
      },
      (err) => {
        if (detailRequests.current.get(referenceId) !== req) return;
        setJobs((list) =>
          list.map((j) => (j.referenceId === referenceId ? { ...j, loading: false, error: errorMessage(err, "Couldn't load this job.") } : j))
        );
      }
    );
  }, []);

  // Mirror of `jobs` so pick handlers can check duplicates / the cap synchronously.
  const jobsRef = useRef<PickedJob[]>([]);
  jobsRef.current = jobs;

  const addJob = (job: Omit<PickedJob, "detail" | "loading" | "error">, forKind: Kind) => {
    const list = jobsRef.current;
    if (list.some((j) => j.referenceId === job.referenceId) || list.length >= EMAIL_MAX_JOBS) return;
    const next = [...list, { ...job, detail: null, loading: forKind === "customer", error: "" }];
    jobsRef.current = next;
    setJobs(next);
    resetDrafts();
    setMix(null);
    if (forKind === "customer") {
      if (contactIds.length === 0) setToCustomer(true);
      loadDetail(job.referenceId);
    }
  };

  const pickRow = (row: WorkOrderListItem) =>
    addJob(
      {
        referenceId: row.reference_id,
        customerId: null,
        customerName: row.customer_name || "Unknown",
        equipment: jobItemLabel(row),
        status: row.status ?? ""
      },
      kind
    );

  // "Draft email" from a work-order page: Customer, job added to Who.
  useEffect(() => {
    if (!target) return;
    const job = target.job ?? { referenceId: target.referenceId, customerId: null, customerName: target.label, equipment: "", status: "" };
    setKind("customer");
    setToContactId(null);
    setStep(1);
    if (kind !== "customer") {
      jobsRef.current = [];
      setContactIds([]);
      setParts({});
    }
    addJob({ ...job }, "customer");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const switchKind = (next: Kind) => {
    if (next === kind) return;
    setKind(next);
    setJobs([]);
    setContactIds([]);
    setToCustomer(true);
    setToContactId(null);
    setMix(null);
    setShowNames(false);
    setParts({});
    resetDrafts();
    setStep(1);
  };

  const removeJob = (referenceId: number) => {
    detailRequests.current.delete(referenceId);
    setJobs((list) => list.filter((j) => j.referenceId !== referenceId));
    setMix(null);
    resetDrafts();
  };

  // --- derived Who state ---
  const anyLoading = jobs.some((j) => j.loading);
  const groups = useMemo(() => customerGroups(jobs.map(toSelected)), [jobs]);
  const mixed = kind === "customer" && !anyLoading && groups.length > 1;
  const split = mixed && mix === "split";
  const firstDetail = jobs.find((j) => j.detail)?.detail ?? null;
  const firstEmail = firstDetail?.customer.email?.trim() ?? "";
  const whoValid =
    kind === "customer"
      ? (jobs.length > 0 || contactIds.length > 0) && !anyLoading && (!mixed || split)
      : jobs.length > 0 || toContactId != null; // supplier / shop: jobs or a To

  // --- Draft step data ---
  useEffect(() => {
    if (step < 2 || templates.status !== "idle") return;
    setTemplates((t) => ({ ...t, status: "loading" }));
    apiClient.listEmailTemplates().then(
      (res) => {
        const byKey = new Map((res.items ?? []).map((t) => [t.key, t]));
        const value = defaultTemplates();
        const missing: EmailTemplateKey[] = [];
        for (const key of ALL_TEMPLATE_KEYS) {
          const item = byKey.get(key);
          if (item) value[key] = item;
          else missing.push(key);
        }
        setTemplates({ status: "ok", value, missing });
      },
      () => setTemplates((t) => ({ ...t, status: "fallback", missing: ALL_TEMPLATE_KEYS }))
    );
  }, [step, templates.status]);

  const loadParts = useCallback((referenceId: number) => {
    setParts((p) => ({ ...p, [referenceId]: { status: "loading", items: [] } }));
    apiClient.listPartsPurchaseRequests(referenceId).then(
      (res) => setParts((p) => ({ ...p, [referenceId]: { status: "ok", items: res.items ?? [] } })),
      (err) =>
        setParts((p) => ({
          ...p,
          [referenceId]:
            errorStatus(err) === 403 ? { status: "forbidden", items: [] } : { status: "error", items: [], error: errorMessage(err, "Couldn't load parts.") }
        }))
    );
  }, []);

  useEffect(() => {
    if (kind === "customer" || step < 2) return;
    for (const job of jobs) if (!parts[job.referenceId]) loadParts(job.referenceId);
  }, [kind, step, jobs, parts, loadParts]);

  const partsReady = jobs.every((j) => parts[j.referenceId] && parts[j.referenceId].status !== "loading");
  const signOff = signOffFromTemplate(templates.value.job_started.body_template);
  const templatesReady = templates.status === "ok" || templates.status === "fallback";
  const customerTemplates: CustomerTemplates = useMemo(
    () => ({ job_started: templates.value.job_started, job_completed: templates.value.job_completed }),
    [templates.value]
  );
  const templateKeyFor = (type: AnyDraftType): EmailTemplateKey | null => {
    if (type === "custom") return null;
    if (kind === "supplier") return SUPPLIER_TEMPLATE_KEYS[type as Exclude<SupplierDraftType, "custom">] ?? null;
    if (kind === "shop") return SHOP_TEMPLATE_KEYS[type as Exclude<ShopDraftType, "custom">] ?? null;
    return null;
  };

  // Supplier / Shop body + subject follow parts, names and the current To (greeting, signature) until edited.
  const writeContactIds = drafts.length > 0 ? drafts[0].contactIds : toContactId != null ? [toContactId] : [];
  const writeContactNameKey = writeContactIds
    .map((id) => contactById.get(id)?.name?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
  // Names in pick order; keyed by a string so the memo below only reruns when they change.
  const writeContactNames = useMemo(() => (writeContactNameKey ? writeContactNameKey.split("\n") : []), [writeContactNameKey]);
  const groupGenerated = useMemo(() => {
    if (kind === "customer" || !draftType) return null;
    const key = templateKeyFor(draftType);
    const template = key ? templates.value[key] : null;
    const partsOf = (id: number) => {
      const state = parts[id];
      return state && state.status === "ok" ? state.items : null;
    };
    if (kind === "supplier") {
      const jobParts: JobParts[] = jobs.map((j) => ({ referenceId: j.referenceId, customerName: j.customerName, parts: partsOf(j.referenceId) }));
      return buildSupplierDraft({ type: draftType as SupplierDraftType, template, supplierName: writeContactNames, jobs: jobParts, showNames, signOff });
    }
    return buildShopDraft({
      type: draftType as ShopDraftType,
      template,
      recipientName: writeContactNames,
      jobs: jobs.map((j) => ({ referenceId: j.referenceId, customerName: j.customerName, equipment: j.equipment, status: j.status, parts: partsOf(j.referenceId) })),
      signOff
    });
    // templateKeyFor only reads kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, draftType, jobs, parts, writeContactNames, showNames, signOff, templates.value]);

  const buildCustomerDrafts = (type: EmailDraftType): Draft[] => {
    const sets = split
      ? groups.map((g) => ({ title: g.customerName, picked: g.jobs.map((s) => jobs.find((j) => j.referenceId === s.referenceId)!) }))
      : [{ title: jobs[0]?.customerName ?? "", picked: jobs }];
    return sets.map((set, i) => {
      const built = buildCustomerDraft({ type, jobs: set.picked.map(toEmailJob), templates: customerTemplates });
      const email = set.picked.find((j) => j.detail)?.detail?.customer.email?.trim() ?? "";
      const hint = maskEmailHint(email);
      return {
        key: `c${i}-${set.picked.map((j) => j.referenceId).join(",")}`,
        title: set.title,
        jobIds: set.picked.map((j) => j.referenceId),
        subject: built.subject,
        body: built.body,
        basis: built.body,
        subjectBasis: built.subject,
        edited: false,
        recipients: split ? { ...EMPTY_RECIPIENTS } : { ...EMPTY_RECIPIENTS, toCustomer, contactIds },
        hasCustomerEmail: hint !== "",
        customerHint: hint,
        customerEmail: hint ? email : "",
        contactIds: [],
        typedTo: [],
        photoIds: [],
        sent: false,
        sentTo: ""
      };
    });
  };

  const pickDraft = (type: AnyDraftType) => {
    setDraftType(type);
    setCurrent(0);
    setConfirming(false);
    setSendError("");
    setNote("");
    if (kind === "customer") setDrafts(buildCustomerDrafts(type as EmailDraftType));
    else setDrafts([]);
    setStep(3);
  };

  // Supplier / Shop draft appears once parts are loaded; then follows parts / names / To changes unless edited.
  useEffect(() => {
    if (kind === "customer" || !groupGenerated || !partsReady || !templatesReady) return;
    setDrafts((list) => {
      if (list.length === 0) {
        return [
          {
            key: "s0",
            title: toContact?.name ?? "",
            jobIds: jobs.map((j) => j.referenceId),
            subject: groupGenerated.subject,
            body: groupGenerated.body,
            basis: groupGenerated.body,
            subjectBasis: groupGenerated.subject,
            edited: false,
            recipients: { ...EMPTY_RECIPIENTS, toCustomer: false },
            hasCustomerEmail: false,
            customerHint: "",
            customerEmail: "",
            contactIds: toContactId != null ? [toContactId] : [],
            typedTo: [],
            photoIds: [],
            sent: false,
            sentTo: ""
          }
        ];
      }
      const d = list[0];
      if (d.edited || d.sent || d.body !== d.basis) return list;
      if (d.basis === groupGenerated.body && d.subjectBasis === groupGenerated.subject) return list;
      // Subject follows too (e.g. a new To name), unless the user changed it.
      const subject = d.subject === d.subjectBasis ? groupGenerated.subject : d.subject;
      return [{ ...d, body: groupGenerated.body, basis: groupGenerated.body, subject, subjectBasis: groupGenerated.subject }];
    });
  }, [kind, groupGenerated, partsReady, templatesReady, jobs, toContact?.name, toContactId]);

  const draft = drafts[current] ?? null;
  const updateDraft = (patch: Partial<Draft>) => setDrafts((list) => list.map((d, i) => (i === current ? { ...d, ...patch } : d)));

  // --- recipients / send ---
  const toLabels = (d: Draft): { to: string[]; cc: string[] } => {
    if (kind !== "customer") {
      const picked = d.contactIds.flatMap((id) => {
        const c = contactById.get(id);
        return c ? [contactLabel(c)] : [];
      });
      return { to: [...picked, ...d.typedTo], cc: [] };
    }
    const named = d.hasCustomerEmail ? `${d.title} <${d.customerHint}>` : "";
    return recipientLabels(d.recipients, d.hasCustomerEmail, named, contacts.contacts);
  };

  const photoJobIds = kind === "customer" && draft && draft.jobIds.length > 0 ? draft.jobIds : null;
  const draftPhotos = useDraftPhotos(step === 3 ? photoJobIds : null);
  const photoSummary = summarizePhotoSelection(draftPhotos.photos, draft?.photoIds ?? [], draftPhotos.limits, draftPhotos.loading);

  const labels = draft ? toLabels(draft) : { to: [], cc: [] };
  const blanks = draft ? countBlanks(draft.subject, draft.body) : 0;
  const button = sendButtonState({ blanks, hasTo: labels.to.length > 0, split: drafts.length > 1 ? { index: current, total: drafts.length } : undefined });
  let blockedReason = "";
  if (draft && draft.jobIds.length === 0) blockedReason = NO_JOB_SEND_NOTE;
  else if (draft && labels.to.length > contacts.maxTo) blockedReason = `Too many To recipients (max ${contacts.maxTo}).`;
  else if (draft && labels.cc.length > contacts.maxCc) blockedReason = `Too many Cc recipients (max ${contacts.maxCc}).`;
  else if (photoSummary.blockedReason) blockedReason = photoSummary.blockedReason;

  const send = async () => {
    if (!draft || draft.jobIds.length === 0) return;
    setSending(true);
    setSendError("");
    try {
      const base = { to: "", subject: draft.subject.trim(), body: draft.body.trim() };
      if (kind === "customer") {
        const ids = draft.photoIds;
        await apiClient.sendWorkOrderCustomerEmail(draft.jobIds[0], {
          template: templateForDraftType(draftType as EmailDraftType),
          ...base,
          ...recipientPayload(draft.recipients, draft.hasCustomerEmail),
          ...(ids.length > 0 ? { photo_ids: ids } : {}),
          ...(ids.length > 0 && draft.jobIds.length > 1 ? { photo_work_order_ids: draft.jobIds.slice(1) } : {})
        });
      } else {
        await apiClient.sendWorkOrderCustomerEmail(draft.jobIds[0], {
          template: "job_started",
          ...base,
          to_customer: false,
          ...(draft.contactIds.length > 0 ? { to_contact_ids: draft.contactIds } : {}),
          ...(draft.typedTo.length > 0 ? { to_emails: draft.typedTo } : {})
        });
      }
      const sentTo = labels.to.join(", ");
      const nextIndex = drafts.findIndex((d, i) => i !== current && !d.sent);
      setDrafts((list) => list.map((d, i) => (i === current ? { ...d, sent: true, sentTo } : d)));
      setConfirming(false);
      // Split: move to the next unsent email; it needs its own confirm.
      if (nextIndex >= 0) setCurrent(nextIndex);
    } catch (err) {
      setSendError(errorMessage(err, "Could not send the email. Your draft is kept; try again."));
    } finally {
      setSending(false);
    }
  };

  const mailtoTo = (d: Draft) => {
    if (kind !== "customer") {
      const picked = d.contactIds.flatMap((id) => {
        const c = contactById.get(id);
        return c ? [c.email] : [];
      });
      return [...picked, ...d.typedTo].join(",");
    }
    const list: string[] = [];
    if (d.recipients.toCustomer && d.customerEmail) list.push(d.customerEmail);
    for (const id of d.recipients.contactIds) {
      const c = contactById.get(id);
      if (c) list.push(c.email);
    }
    return [...list, ...d.recipients.typed].join(",");
  };

  const openInEmailApp = async () => {
    if (!draft) return;
    setNote("");
    const link = buildMailto(mailtoTo(draft), draft.subject.trim(), draft.body.trim());
    if (link.tooLong) setNote((await copyText(draftClipboardText(draft.subject.trim(), draft.body.trim()))) ? TOO_LONG_NOTE : COPY_FAILED_NOTE);
    mailtoNavigator.open(link.href);
  };

  // --- navigation ---
  const canGo = (s: Step) => (s === 1 ? true : s === 2 ? whoValid : whoValid && draftType !== null);
  const go = (s: Step) => {
    if (!canGo(s)) return;
    setConfirming(false);
    setStep(s);
  };

  // ---------------------------------------------------------------------------
  // Render pieces

  const summary = (() => {
    const toLabel = joinRecipientNames(writeContactNames) ?? (kind === "shop" ? "No one yet" : "No supplier yet");
    let label: string;
    if (kind !== "customer") label = `${toLabel} · ${jobs.length} job${jobs.length === 1 ? "" : "s"}`;
    else if (split) label = `${jobs.length} jobs · ${groups.length} customers`;
    else if (jobs.length === 1) label = `Job #${jobs[0].referenceId} · ${jobs[0].customerName}`;
    else if (jobs.length > 1) label = `${jobs.length} jobs · ${jobs[0].customerName}`;
    else label = contactIds.map((id) => contactById.get(id)?.name ?? `contact #${id}`).join(", ");
    const expandable = jobs.length > 1;
    return (
      <div className="mb-3 rounded-[10px] border border-[#d5d9de] bg-white">
        <div className="flex min-h-[48px] items-center justify-between gap-2 py-0.5 pl-3 pr-1">
          {expandable ? (
            <button
              type="button"
              aria-expanded={summaryOpen}
              onClick={() => setSummaryOpen((v) => !v)}
              className={cn("flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left text-[16px]", FOCUS)}
            >
              <b className="min-w-0 truncate">{label}</b>
              <span aria-hidden className={cn("grid h-[30px] w-[30px] flex-none place-items-center rounded-lg bg-[#e6f3f6] text-[15px] text-[#135f6f]", summaryOpen && "rotate-180")}>
                ▾
              </span>
            </button>
          ) : (
            <b className="min-w-0 py-1.5 text-[16px]">{label}</b>
          )}
          <button type="button" className={cn(LINK_BUTTON, "flex-none")} onClick={() => go(1)}>
            Change
          </button>
        </div>
        {expandable && summaryOpen && (
          <ul className="border-t border-[#e3e6e9] px-3 pb-2 pt-1 text-[16px]">
            {jobs.map((j) => (
              <li key={j.referenceId} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#eceef0] py-1.5 last:border-b-0">
                <b className="text-[#135f6f]">#{j.referenceId}</b> {j.equipment}
                {(kind !== "customer" || split) && <small className="text-[#4a5260]">· {j.customerName}</small>}
                {j.status && (
                  <span className="ml-auto">
                    <StatusPill tone={statusTone(j.status)}>{j.status}</StatusPill>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  })();

  const mixNotice = (() => {
    if (!mixed) return null;
    const who = groups.map((g) => `${g.customerName} (${g.jobs.length} job${g.jobs.length === 1 ? "" : "s"})`).join(", ");
    if (mix === "split") {
      return (
        <div className="mt-3.5 flex flex-col gap-2 rounded-[10px] border-[1.5px] border-l-[6px] border-[#2f855a] bg-[#e9f6ee] px-3.5 py-3">
          <b className="text-[17px] text-[#14532d]">✓ {groups.length} emails, one per customer</b>
          <p className="text-[16px]">{who}. You write each one in step 3.</p>
          <button type="button" className={cn(LINK_BUTTON, "self-start px-1")} onClick={() => setMix(null)}>
            Undo
          </button>
        </div>
      );
    }
    return (
      <div className="mt-3.5 flex flex-col gap-2 rounded-[10px] border-[1.5px] border-l-[6px] border-[#d99a00] bg-[#fff4dc] px-3.5 py-3">
        <b className="text-[17px] text-[#5c3b00]">{mix === "picking" ? "Which customer is this email for?" : `These jobs are for ${groups.length} customers`}</b>
        {mix === "picking" ? (
          <>
            <p className="text-[16px] text-[#4a3b1a]">The other jobs are taken off this email.</p>
            <div role="radiogroup" aria-label="Customer" className="flex flex-col gap-2">
              {groups.map((g) => (
                <label key={g.key} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[10px] border-[1.5px] border-[#8b949e] bg-white px-3 text-[17px]">
                  <input
                    type="radio"
                    name="email-one-customer"
                    className="h-5 w-5"
                    aria-label={`${g.customerName} (${g.jobs.length} job${g.jobs.length === 1 ? "" : "s"})`}
                    onChange={() => {
                      const keep = new Set(g.jobs.map((j) => j.referenceId));
                      setJobs((list) => list.filter((j) => keep.has(j.referenceId)));
                      setMix(null);
                      setToCustomer(true);
                      resetDrafts();
                    }}
                  />
                  {g.customerName} ({g.jobs.length} job{g.jobs.length === 1 ? "" : "s"})
                </label>
              ))}
            </div>
            <button type="button" className={cn(LINK_BUTTON, "self-start px-1")} onClick={() => setMix(null)}>
              Back
            </button>
          </>
        ) : (
          <>
            <p className="text-[16px] text-[#4a3b1a]">{who}. One email can't go to different customers.</p>
            <MgmtButton className="w-full" onClick={() => setMix("split")}>
              Send one email each
            </MgmtButton>
            <MgmtButton variant="ghost" className="w-full" onClick={() => setMix("picking")}>
              Pick one customer
            </MgmtButton>
          </>
        )}
      </div>
    );
  })();

  const pickedJobs =
    jobs.length > 0 ? (
      <>
        <p className="mb-1 mt-3 text-[16px] font-semibold">{jobs.length === 1 ? "Job" : `${jobs.length} jobs`}</p>
        <ul className="flex flex-col gap-2">
          {jobs.map((j) => (
            <PickedRow key={j.referenceId} job={j} onRemove={() => removeJob(j.referenceId)} onRetry={() => loadDetail(j.referenceId)} />
          ))}
        </ul>
      </>
    ) : null;

  const whoStep = (
    <div>
      <div role="radiogroup" aria-label="Email to" className="mb-3.5 grid grid-cols-3 rounded-[12px] bg-[#e7e2dc] p-1">
        {(["customer", "supplier", "shop"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => switchKind(k)}
            className={cn(
              "min-h-[44px] rounded-[9px] text-[17px] font-semibold",
              kind === k ? "bg-white text-[#b8501a] shadow" : "text-[#4a5260]",
              FOCUS
            )}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <h2 className="mb-1 text-[20px] font-bold">{WHO_COPY[kind].heading}</h2>
      <p className="text-[#4a5260]">{WHO_COPY[kind].hint}</p>
      {drafts.length > 0 && <p className="mt-2 rounded-lg bg-[#fff1c9] px-3 py-1.5 text-[15px] text-[#6b3d00]">Changing jobs resets the draft.</p>}
      <WhoSearch
        key={kind}
        placeholder={WHO_COPY[kind].placeholder}
        contactsLabel={WHO_COPY[kind].contactsLabel}
        contactTag={WHO_COPY[kind].contactTag}
        contacts={kindContacts}
        contactsLoading={contacts.loading}
        contactsError={contacts.error}
        onRetryContacts={contacts.retry}
        pickedContactIds={kind === "customer" ? contactIds : toContactId != null ? [toContactId] : []}
        pickedJobIds={jobs.map((j) => j.referenceId)}
        canAddJob={jobs.length < EMAIL_MAX_JOBS}
        onPickJob={pickRow}
        onPickContact={(c: EmailPickerContact) => {
          resetDrafts();
          if (kind === "customer") setContactIds((ids) => (ids.includes(c.id) ? ids : [...ids, c.id]));
          else setToContactId(c.id);
        }}
      />
      {pickedJobs}
      {kind === "customer" && !mixed && (jobs.length > 0 || contactIds.length > 0) && (
        <>
          <p className="mb-1 mt-3 text-[16px] font-semibold">To</p>
          <div className="flex flex-col gap-2">
            {jobs.length > 0 && !anyLoading && firstEmail && toCustomer && (
              <ToChip
                label={jobs[0].customerName}
                sub={maskEmailHint(firstEmail)}
                tag="from job"
                removeLabel="Remove customer"
                onRemove={() => {
                  setToCustomer(false);
                  resetDrafts();
                }}
              />
            )}
            {jobs.length > 0 && !anyLoading && !firstEmail && (
              <p className="rounded-[10px] border-[1.5px] border-dashed border-[#8b949e] bg-white px-3 py-2.5 text-[16px]">
                No email on file for this customer. Pick a contact above, or add one on Write.
              </p>
            )}
            {contactIds.map((id) => {
              const c = contactById.get(id);
              return (
                <ToChip
                  key={id}
                  label={c?.name ?? `contact #${id}`}
                  sub={c?.email}
                  tag={toCustomer && firstEmail && jobs.length > 0 ? "Cc" : undefined}
                  removeLabel={`Remove ${c?.name ?? "contact"}`}
                  onRemove={() => {
                    setContactIds((ids) => ids.filter((x) => x !== id));
                    resetDrafts();
                  }}
                />
              );
            })}
          </div>
        </>
      )}
      {kind === "supplier" && (
        <>
          <p className="mb-1 mt-3 text-[16px] font-semibold">To (supplier)</p>
          {toContact ? (
            <ToChip
              label={toContact.name}
              sub={toContact.email}
              removeLabel="Remove supplier"
              onRemove={() => {
                setToContactId(null);
                resetDrafts();
              }}
            />
          ) : (
            <p className="rounded-[10px] border-[1.5px] border-dashed border-[#8b949e] bg-white px-3 py-2.5 text-[16px]">
              {!contacts.loading && !contacts.error && supplierContacts.length === 0 ? (
                <>
                  No suppliers saved yet. Add them on{" "}
                  <a href={COMMON_CONTACTS_PATH} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#135f6f] underline">
                    Common contacts
                  </a>
                  .
                </>
              ) : (
                <>
                  No supplier yet. Search above, or add suppliers on{" "}
                  <a href={COMMON_CONTACTS_PATH} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#135f6f] underline">
                    Common contacts
                  </a>
                  .
                </>
              )}
            </p>
          )}
        </>
      )}
      {kind === "shop" && (
        <>
          <p className="mb-1 mt-3 text-[16px] font-semibold">To (shop)</p>
          {toContact ? (
            <ToChip
              label={toContact.name}
              sub={`${toContact.role === "boss" ? "Boss" : "Staff"} · ${toContact.email}`}
              removeLabel="Remove shop contact"
              onRemove={() => {
                setToContactId(null);
                resetDrafts();
              }}
            />
          ) : (
            <p className="rounded-[10px] border-[1.5px] border-dashed border-[#8b949e] bg-white px-3 py-2.5 text-[16px]">
              {!contacts.loading && !contacts.error && shopContacts.length === 0
                ? "No shop contacts saved yet. Add boss or staff on "
                : "No one yet. Search above, or add boss or staff on "}
              <a href={COMMON_CONTACTS_PATH} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#135f6f] underline">
                Common contacts
              </a>
              .
            </p>
          )}
        </>
      )}
      {mixNotice}
    </div>
  );

  // Customer keeps its four Management drafts; Supplier / Shop list the Email Templates page entries + Custom.
  const draftOptions: Array<{ value: AnyDraftType; label: string; hint: string; key: EmailTemplateKey | null }> = (() => {
    if (kind === "customer") {
      return CUSTOMER_DRAFTS.map((d) => ({ ...d, key: d.value === "custom" ? null : templateForDraftType(d.value) }));
    }
    const base: Array<{ value: AnyDraftType; label: string; hint: string }> = kind === "supplier" ? SUPPLIER_DRAFTS : SHOP_DRAFTS;
    return base.map((d) => {
      const key = templateKeyFor(d.value);
      return { ...d, key, label: key ? templates.value[key].label || d.label : d.label };
    });
  })();

  const draftStep = (
    <div>
      {summary}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[20px] font-bold">Pick a draft</h2>
        <a href={emailTemplatesHref(firstTemplateKey(kind))} target="_blank" rel="noopener noreferrer" className={cn(LINK_BUTTON, "px-0")}>
          Edit templates
        </a>
      </div>
      {templates.status === "loading" && <p className="text-[15px] text-[#4a5260]">Loading email config…</p>}
      {templatesReady && draftOptions.some((d) => d.key && templates.missing.includes(d.key)) && (
        <p className="text-[15px] text-[#4a5260]">Using default template (couldn't load email config)</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {draftOptions.map((d) => (
          <button
            key={d.value}
            type="button"
            disabled={!templatesReady}
            onClick={() => pickDraft(d.value)}
            className={cn(
              "min-h-[96px] rounded-[12px] border-[1.5px] bg-white p-3.5 text-left hover:border-[#1a7f94] hover:bg-[#e6f3f6] disabled:opacity-60",
              draftType === d.value ? "border-[#1a7f94]" : "border-[#d5d9de]",
              FOCUS
            )}
          >
            <b className="block text-[18px]">{d.label}</b>
            <small className="text-[15px] text-[#4a5260]">{d.hint}</small>
          </button>
        ))}
      </div>
    </div>
  );

  const usesParts = (kind === "supplier" && draftType !== null && draftType !== "custom") || (kind === "shop" && draftType === "approval");
  const partsNotes =
    usesParts && draftType ? (
      <div className="mt-2 space-y-1 text-[15px] text-[#4a5260]">
        <p>{kind === "supplier" ? supplierStatusHint(draftType as SupplierDraftType) : partsStatusHint(SHOP_APPROVAL_PART_STATUSES)}</p>
        {groupGenerated && groupGenerated.excluded > 0 && (
          <p>
            {groupGenerated.excluded} other part{groupGenerated.excluded === 1 ? "" : "s"} left out ({groupGenerated.excludedStatuses.map(partsStatusWord).join(", ")}).
          </p>
        )}
        {jobs.some((j) => parts[j.referenceId]?.status === "forbidden") && <p className="text-[#6b3d00]">You can't read parts requests, so fill the parts in by hand.</p>}
        {jobs
          .filter((j) => parts[j.referenceId]?.status === "error")
          .map((j) => (
            <MgmtError key={j.referenceId} onRetry={() => loadParts(j.referenceId)}>
              Couldn't load parts for #{j.referenceId}.
            </MgmtError>
          ))}
      </div>
    ) : null;

  const namesNote =
    kind === "supplier" && draft ? (
      <div className="mt-3 space-y-1">
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-lg py-0.5 pl-3 pr-1 text-[15px]",
            showNames ? "border border-[#d99a00] bg-[#fff4dc] text-[#5c3b00]" : "bg-[#eef0f2]"
          )}
        >
          <span>{showNames ? "Customer names will be shown to the supplier." : "Customer names are left out of supplier emails."}</span>
          {!draft.sent && (
            <button type="button" className={cn(LINK_BUTTON, "flex-none")} onClick={() => setShowNames((v) => !v)}>
              {showNames ? "Hide names" : "Show names"}
            </button>
          )}
        </div>
        {draft.edited && !draft.sent && groupGenerated && groupGenerated.body !== draft.basis && (
          <button
            type="button"
            className={cn(LINK_BUTTON, "px-0")}
            onClick={() => updateDraft({ body: groupGenerated.body, basis: groupGenerated.body, subject: draft.subject, edited: false })}
          >
            Body was edited — reset to draft to apply
          </button>
        )}
      </div>
    ) : null;

  const addTyped = () => {
    if (!draft) return;
    const email = typedInput.trim();
    if (!email) return;
    if (!looksLikeEmail(email)) {
      setTypedError("Enter a plain email address like name@example.com.");
      return;
    }
    if (!draft.typedTo.some((e) => e.toLowerCase() === email.toLowerCase())) updateDraft({ typedTo: [...draft.typedTo, email] });
    setTypedInput("");
    setTypedError("");
  };

  const toField = (d: Draft): ReactNode => {
    if (kind === "customer") {
      return (
        <div>
          <p className="mb-1 text-[16px] font-semibold">To</p>
          <EmailRecipientPicker
            value={d.recipients}
            onChange={(recipients) => updateDraft({ recipients })}
            customerHint={d.customerHint}
            contacts={{ ...contacts, contacts: customerContacts }}
            canType={canType}
            disabled={d.sent || sending}
          />
        </div>
      );
    }
    const picked = d.contactIds.flatMap((id) => {
      const c = contactById.get(id);
      return c ? [c] : [];
    });
    // Already-picked contacts are left out; the list stays until everyone is picked or To is full.
    const remaining = kindContacts.filter((c) => !d.contactIds.includes(c.id));
    const toCount = picked.length + d.typedTo.length;
    const toFull = toCount >= contacts.maxTo;
    const pickContact = (id: number) => {
      if (d.contactIds.includes(id) || toFull) return;
      updateDraft({ contactIds: [...d.contactIds, id] });
    };
    return (
      <div>
        <p className="mb-1 text-[16px] font-semibold">To</p>
        <div className="flex flex-col gap-2">
          {picked.map((c) => (
            <ToChip
              key={c.id}
              label={c.name}
              sub={c.email}
              removeLabel={`Remove ${kind === "shop" ? "shop contact" : "supplier"} ${c.name}`}
              onRemove={d.sent ? undefined : () => updateDraft({ contactIds: d.contactIds.filter((id) => id !== c.id) })}
            />
          ))}
          {d.typedTo.map((email) => (
            <ToChip key={email} label={email} removeLabel={`Remove ${email}`} onRemove={d.sent ? undefined : () => updateDraft({ typedTo: d.typedTo.filter((e) => e !== email) })} />
          ))}
          {remaining.length > 0 && !d.sent && (
            <select
              aria-label={kind === "shop" ? "Shop contact" : "Supplier"}
              className={INPUT_CLASS}
              value=""
              disabled={toFull || sending}
              onChange={(e) => e.target.value && pickContact(Number(e.target.value))}
            >
              <option value="">
                {toFull
                  ? `To is full (max ${contacts.maxTo})`
                  : picked.length > 0
                    ? kind === "shop"
                      ? "Add another shop contact…"
                      : "Add another supplier…"
                    : kind === "shop"
                      ? "Pick a shop contact…"
                      : "Pick a supplier…"}
              </option>
              {remaining.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                </option>
              ))}
            </select>
          )}
          {canType && !d.sent && (
            <div className="flex gap-2">
              <input
                aria-label="Add email address"
                type="email"
                className={INPUT_CLASS}
                placeholder="name@example.com"
                value={typedInput}
                onChange={(e) => {
                  setTypedInput(e.target.value);
                  setTypedError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTyped();
                  }
                }}
              />
              <MgmtButton variant="ghost" onClick={addTyped} disabled={!typedInput.trim()}>
                Add
              </MgmtButton>
            </div>
          )}
          {typedError && <p className="text-[15px] text-red-700">{typedError}</p>}
        </div>
      </div>
    );
  };

  const writeStep = (
    <div>
      {summary}
      {drafts.length > 1 && (
        <div role="tablist" aria-label="Emails" className="mb-2 grid gap-1 rounded-[12px] bg-[#e7e2dc] p-1" style={{ gridTemplateColumns: `repeat(${drafts.length}, minmax(0, 1fr))` }}>
          {drafts.map((d, i) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={i === current}
              onClick={() => {
                setCurrent(i);
                setConfirming(false);
                setSendError("");
              }}
              className={cn(
                "min-h-[44px] rounded-[9px] px-2 text-[15px] font-semibold",
                i === current ? "bg-white text-[#b8501a] shadow" : "text-[#4a5260]",
                FOCUS
              )}
            >
              Email {i + 1} of {drafts.length}
              <small className="block truncate font-normal">
                {d.title}
                {d.sent ? " · Sent ✓" : ""}
              </small>
            </button>
          ))}
        </div>
      )}
      {kind !== "customer" && (!partsReady || !draft) ? (
        <p role="status" className="text-[#4a5260]">
          Loading parts requests…
        </p>
      ) : draft ? (
        <>
          <EmailWriter
            key={draft.key}
            idPrefix={`email-${draft.key}`}
            subject={draft.subject}
            body={draft.body}
            locked={draft.sent}
            onSubject={(subject) => updateDraft({ subject })}
            onBody={(body) => updateDraft({ body, edited: true })}
            to={toField(draft)}
            beforeMessage={
              <>
                {namesNote}
                {partsNotes}
              </>
            }
          />
          {kind === "customer" && draft.jobIds.length > 0 && (
            <div className="mt-3">
              <EmailPhotoPanel
                photos={draftPhotos.photos}
                placeholderUrls={[]}
                loading={draftPhotos.loading}
                error={draftPhotos.error}
                limits={draftPhotos.limits}
                selectedIds={draft.photoIds}
                onChange={(photoIds) => updateDraft({ photoIds })}
                disabled={draft.sent || sending}
                layout="stacked"
              />
            </div>
          )}
          {confirming && !draft.sent && (
            <EmailSendConfirm
              recipientHint={labels.to.join(", ")}
              jobIds={draft.jobIds}
              cc={labels.cc}
              photoCount={photoSummary.count}
              photoBytes={photoSummary.totalBytes}
              sending={sending}
              onCancel={() => setConfirming(false)}
              onConfirm={() => void send()}
            />
          )}
          {sendError && (
            <div className="mt-2">
              <MgmtError onRetry={() => void send()}>{sendError}</MgmtError>
            </div>
          )}
          {draft.sent && (
            <p role="status" className="mt-2 rounded-lg bg-[#dff3e4] px-3 py-2 text-[16px] font-semibold text-[#14532d]">
              Sent to {draft.sentTo}.
            </p>
          )}
          {blockedReason && !draft.sent && <p className="mt-2 text-[15px] text-[#4a5260]">{blockedReason}</p>}
          {note && (
            <p role="status" className="mt-2 text-[15px] text-[#4a5260]">
              {note}
            </p>
          )}
        </>
      ) : null}
    </div>
  );

  let footer: ReactNode;
  if (step === 1) {
    footer = (
      <MgmtButton className="w-full" disabled={!whoValid} onClick={() => go(2)}>
        Next
      </MgmtButton>
    );
  } else if (step === 2) {
    footer = (
      <MgmtButton variant="ghost" className="w-full" onClick={() => go(1)}>
        Back
      </MgmtButton>
    );
  } else {
    const sentLabel = draft?.sent ? "Sent ✓" : button.label;
    footer = (
      <div className="flex gap-2.5">
        <MgmtButton
          className="flex-[1.1] whitespace-nowrap px-2 text-[16px]"
          disabled={!draft || draft.sent || button.disabled || Boolean(blockedReason) || sending}
          title={button.disabled ? "Fill the yellow blanks and add a recipient first" : undefined}
          onClick={() => {
            setSendError("");
            setConfirming(true);
          }}
        >
          {sentLabel}
        </MgmtButton>
        <MgmtButton variant="ghost" className="flex-1 whitespace-nowrap px-2 text-[16px]" disabled={!draft} onClick={() => void openInEmailApp()}>
          Open in email app
        </MgmtButton>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col text-[17px] leading-normal text-[#1f2328]">
      <Stepper step={step} canGo={canGo} onGo={go} />
      <div className="flex-1 pb-4 pt-4">{step === 1 ? whoStep : step === 2 ? draftStep : writeStep}</div>
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-[#d5d9de] bg-white px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] sm:-mx-7">{footer}</div>
    </div>
  );
}

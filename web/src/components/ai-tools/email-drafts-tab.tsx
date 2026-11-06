import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient } from "@/lib/api/client";
import type { EmailDraftTarget, EmailDraftType } from "@/lib/ai-tools/types";
import { templateForDraftType } from "@/lib/ai-tools/email-handoff";
import { buildMailto, draftClipboardText, mailtoNavigator } from "@/lib/mailto";
import {
  EMAIL_MAX_JOBS,
  addSelectedJob,
  customerGroups,
  loadSelectedJobs,
  removeSelectedJob,
  saveSelectedJobs,
  selectedJobFromRow,
  type SelectedEmailJob
} from "@/lib/ai-tools/email-selection";
import { cn } from "@/lib/utils";
import { AI_TEXTAREA_CLASS, AIButton, AICard, AIErrorBox, errorMessage } from "@/components/ai-tools/ai-ui";
import { AI_TEXT_MAX } from "@/lib/ai-tools/limits";
import { CharCounterInput } from "@/components/ai-tools/char-counter-input";
import { EmailDraftEditor, type EditableDraft } from "@/components/ai-tools/email-draft-editor";
import { EmailJobSearch } from "@/components/ai-tools/email-job-search";
import { EmailSelectedJobs } from "@/components/ai-tools/email-selected-jobs";
import { EmailSendConfirm } from "@/components/ai-tools/email-send-confirm";
import { StaffCcPicker } from "@/components/ai-tools/staff-cc-picker";
import { EmailPhotoPanel } from "@/components/email-photo-panel";
import { useDraftPhotos } from "@/lib/ai-tools/draft-photos";
import { summarizePhotoSelection } from "@/lib/email-photos";

const DRAFT_TYPES: Array<{ value: EmailDraftType; label: string }> = [
  { value: "estimate", label: "Estimate" },
  { value: "progress_update", label: "Progress update" },
  { value: "ready_for_pickup", label: "Ready for pickup reminder" },
  { value: "custom", label: "Custom" }
];

/** What the current draft was generated for (from the server response). */
type DraftMeta = {
  ids: number[];
  type: EmailDraftType;
  recipientHint: string;
  /** Full address for mailto:; "" when not on file or not permitted. Kept in memory only. */
  customerEmail: string;
  customerEmailMixed: boolean;
};

const NO_RECIPIENT_NOTE = "No email on file for this customer; add the recipient in your email app.";
const MIXED_CUSTOMERS_NOTE = "These jobs belong to different customers; using the first customer's email.";
const TOO_LONG_NOTE = "Draft is too long for the email app link; copied to clipboard";
const COPIED_NOTE = "Draft copied to clipboard.";
const COPY_FAILED_NOTE = "Couldn't copy the draft to the clipboard. Select the text above and copy it manually.";

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={`Step ${n}: ${title}`}>
      <h3 className="mb-1.5 text-sm font-semibold text-neutral-800">
        {n}. {title}
      </h3>
      {children}
    </section>
  );
}

const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((id, i) => id === b[i]);
const jobList = (ids: number[]) => ids.map((id) => `#${id}`).join(", ");

export function EmailDraftsTab({ target }: { target: EmailDraftTarget | null }) {
  const [jobs, setJobs] = useState<SelectedEmailJob[]>(() => loadSelectedJobs());
  const [chosenCustomer, setChosenCustomer] = useState<string | null>(null);
  const [type, setType] = useState<EmailDraftType>("estimate");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<EditableDraft | null>(null);
  const [meta, setMeta] = useState<DraftMeta | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState(false);
  const [clipboardNote, setClipboardNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  // Photos come from every job in the draft. When the jobs belong to different
  // customers only the send job's photos are offered (the server enforces this).
  const photoJobIds = meta ? (meta.customerEmailMixed ? meta.ids.slice(0, 1) : meta.ids) : null;
  const draftPhotos = useDraftPhotos(photoJobIds);

  useEffect(() => saveSelectedJobs(jobs), [jobs]);

  // A new draft (different jobs) starts with no photos picked.
  const metaKey = meta?.ids.join(",") ?? "";
  useEffect(() => setPhotoIds([]), [metaKey]);

  // Jumping here from another tool pre-selects the job and a fitting type.
  useEffect(() => {
    if (!target) return;
    const job: SelectedEmailJob = target.job ?? {
      referenceId: target.referenceId,
      customerId: null,
      customerName: target.label,
      equipment: "",
      status: ""
    };
    setJobs((list) => addSelectedJob(list, job));
    setType(target.type);
  }, [target]);

  const groups = useMemo(() => customerGroups(jobs), [jobs]);
  const activeGroup = groups.length === 1 ? groups[0] : groups.find((g) => g.key === chosenCustomer) ?? null;
  const emailIds = activeGroup?.jobs.map((j) => j.referenceId) ?? [];
  const busy = drafting || sending;

  const resetSendState = () => {
    setConfirming(false);
    setSendError("");
    setSent(false);
  };

  const runDraft = async () => {
    if (emailIds.length === 0) return;
    setDrafting(true);
    setError("");
    setNote("");
    setClipboardNote("");
    resetSendState();
    try {
      const res = await apiClient.draftAICustomerEmail({ work_order_ids: emailIds, type, notes: notes.trim() });
      setDraft({ subject: res.subject, body: res.body });
      setMeta({
        ids: res.work_order_ids?.length ? res.work_order_ids : emailIds,
        type: res.type ?? type,
        recipientHint: res.recipient_hint ?? "",
        customerEmail: res.customer_email?.trim() ?? "",
        customerEmailMixed: res.customer_email_mixed === true
      });
    } catch (err) {
      setError(errorMessage(err, "Could not draft the email."));
    } finally {
      setDrafting(false);
    }
  };

  const photoSummary = summarizePhotoSelection(draftPhotos.photos, photoIds, draftPhotos.limits, draftPhotos.loading);

  const send = async () => {
    if (!draft || !meta) return;
    if (photoSummary.blockedReason) {
      setSendError(photoSummary.blockedReason);
      return;
    }
    setSending(true);
    setSendError("");
    try {
      // Same endpoint as the Email Customer dialog. "to" is left empty so the
      // server sends to the address on the customer record. The send runs on
      // the first job; photos from the draft's other jobs (same customer) are
      // allowed via photo_work_order_ids and checked server-side.
      await apiClient.sendWorkOrderCustomerEmail(meta.ids[0], {
        template: templateForDraftType(meta.type),
        to: "",
        subject: draft.subject.trim(),
        body: draft.body.trim(),
        ...(photoIds.length > 0 ? { photo_ids: photoIds } : {}),
        ...(photoIds.length > 0 && photoJobIds && photoJobIds.length > 1 ? { photo_work_order_ids: photoJobIds.slice(1) } : {}),
        ...(cc.length > 0 ? { cc } : {})
      });
      setSent(true);
      setConfirming(false);
    } catch (err) {
      setSendError(errorMessage(err, "Could not send the email."));
    } finally {
      setSending(false);
    }
  };

  const mailto = useMemo(
    () => (draft ? buildMailto(meta?.customerEmail ?? "", draft.subject.trim(), draft.body.trim()) : null),
    [draft, meta?.customerEmail]
  );

  const copyDraft = async (successNote: string) => {
    if (!draft) return false;
    const ok = await copyText(draftClipboardText(draft.subject.trim(), draft.body.trim()));
    setClipboardNote(ok ? successNote : COPY_FAILED_NOTE);
    return ok;
  };

  // Opens only on click. When the draft is too long for a mailto link, the link
  // carries recipient + subject and the full draft goes to the clipboard.
  const openInEmailApp = async () => {
    if (!mailto) return;
    setClipboardNote("");
    if (mailto.tooLong) await copyDraft(TOO_LONG_NOTE);
    mailtoNavigator.open(mailto.href);
  };

  let sendBlockedReason: string | undefined;
  if (meta && !meta.recipientHint) sendBlockedReason = "Send is disabled: no email address on file for this customer.";
  else if (meta && !sameIds(meta.ids, emailIds)) sendBlockedReason = "The selected jobs changed since this draft was generated. Regenerate first.";
  else if (sent) sendBlockedReason = "This draft was sent. Regenerate to send another email.";
  else if (photoSummary.blockedReason) sendBlockedReason = photoSummary.blockedReason;

  const multiJobPhotoNote =
    meta && meta.ids.length > 1
      ? meta.customerEmailMixed
        ? `These jobs belong to different customers, so only photos from job #${meta.ids[0]} can be attached.`
        : `Photos from all ${meta.ids.length} jobs are shown, labelled by job. They go out together on one email.`
      : null;

  return (
    // Stacks on narrow panes; side by side from md up, giving the draft the larger share on wide panes.
    <div className="grid w-full flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <AICard className="min-w-0 space-y-4">
        <Step n={1} title="Search jobs">
          <EmailJobSearch
            selectedIds={jobs.map((j) => j.referenceId)}
            canAddMore={jobs.length < EMAIL_MAX_JOBS}
            onAdd={(row) => setJobs((list) => addSelectedJob(list, selectedJobFromRow(row)))}
          />
        </Step>

        <Step n={2} title="Selected jobs">
          <EmailSelectedJobs
            jobs={jobs}
            groups={groups}
            customerKey={chosenCustomer}
            onCustomerChange={setChosenCustomer}
            onRemove={(id) => setJobs((list) => removeSelectedJob(list, id))}
            disabled={busy}
          />
        </Step>

        <Step n={3} title="Intention">
          <div role="radiogroup" aria-label="Email type" className="flex flex-wrap gap-1.5">
            {DRAFT_TYPES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="radio"
                aria-checked={type === entry.value}
                onClick={() => setType(entry.value)}
                disabled={busy}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs",
                  type === entry.value ? "bg-[#f6e3d6] font-semibold text-[#8a3d10] ring-1 ring-[#c2571a]" : "bg-[#efebe7] text-neutral-700 hover:bg-[#e6e0da]"
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </Step>

        <Step n={4} title="Description">
          <label htmlFor="ai-email-notes" className="mb-1 block text-xs text-neutral-600">
            Extra notes for the AI (optional)
          </label>
          <CharCounterInput
            multiline
            id="ai-email-notes"
            limit={AI_TEXT_MAX}
            rows={3}
            className={`${AI_TEXTAREA_CLASS} resize-y`}
            placeholder="e.g. Output stage needs a new pair of transistors. Estimate $180 parts and labour."
            value={notes}
            onValueChange={setNotes}
            disabled={busy}
          />
        </Step>

        <Step n={5} title="Generate">
          <AIButton onClick={() => void runDraft()} disabled={busy || emailIds.length === 0}>
            {drafting ? "Drafting..." : "Generate draft"}
          </AIButton>
          {emailIds.length > 0 && <p className="mt-1 text-xs text-neutral-500">Covers job(s) {jobList(emailIds)}.</p>}
        </Step>

        {error && <AIErrorBox>{error}</AIErrorBox>}
        {note && <p className="text-sm text-green-700">{note}</p>}
      </AICard>

      <EmailDraftEditor
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          setSent(false);
        }}
        recipientHint={meta?.recipientHint ?? ""}
        busy={busy}
        onOpenInEmailApp={() => void openInEmailApp()}
        onCopyDraft={mailto?.tooLong ? () => void copyDraft(COPIED_NOTE) : undefined}
        emailAppNotes={
          meta && (
            <div className="mt-2 space-y-1 text-sm text-neutral-600">
              {!meta.customerEmail && <p>{NO_RECIPIENT_NOTE}</p>}
              {meta.customerEmailMixed && <p>{MIXED_CUSTOMERS_NOTE}</p>}
              {clipboardNote && <p role="status">{clipboardNote}</p>}
            </div>
          )
        }
        onRegenerate={() => void runDraft()}
        canRegenerate={emailIds.length > 0}
        onSend={() => {
          setSendError("");
          setConfirming(true);
        }}
        sendBlockedReason={sendBlockedReason}
        ccField={
          meta && meta.recipientHint ? (
            <StaffCcPicker
              value={cc}
              onChange={(next) => {
                setCc(next);
                setSent(false);
              }}
              disabled={busy}
            />
          ) : undefined
        }
        photos={
          meta ? (
            <div className="space-y-1.5">
              {multiJobPhotoNote && <p className="text-xs text-neutral-600">{multiJobPhotoNote}</p>}
              <EmailPhotoPanel
                photos={draftPhotos.photos}
                placeholderUrls={[]}
                loading={draftPhotos.loading}
                error={draftPhotos.error}
                limits={draftPhotos.limits}
                selectedIds={photoIds}
                onChange={(ids) => {
                  setPhotoIds(ids);
                  setSent(false);
                }}
                disabled={busy}
                layout="stacked"
              />
            </div>
          ) : undefined
        }
        footer={
          <>
            {confirming && meta && !sendBlockedReason && (
              <EmailSendConfirm
                recipientHint={meta.recipientHint}
                jobIds={meta.ids}
                cc={cc}
                photoCount={photoSummary.count}
                photoBytes={photoSummary.totalBytes}
                sending={sending}
                onCancel={() => setConfirming(false)}
                onConfirm={() => void send()}
              />
            )}
            {sent && meta && (
              <p className="mt-2 text-sm text-green-700">
                Email sent to {meta.recipientHint}
                {cc.length > 0 ? ` (Cc ${cc.join(", ")})` : ""} for job(s) {jobList(meta.ids)}
                {photoSummary.count > 0 ? ` with ${photoSummary.count} ${photoSummary.count === 1 ? "photo" : "photos"}` : ""}.
              </p>
            )}
            {sendError && (
              <div className="mt-2">
                <AIErrorBox>{sendError}</AIErrorBox>
              </div>
            )}
          </>
        }
      />
    </div>
  );
}

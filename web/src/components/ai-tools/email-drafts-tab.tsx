import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient } from "@/lib/api/client";
import type { EmailDraftTarget, EmailDraftType } from "@/lib/ai-tools/types";
import { openJobWithDraft, saveAIEmailDraft, templateForDraftType } from "@/lib/ai-tools/email-handoff";
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
import { EmailDraftEditor, type EditableDraft } from "@/components/ai-tools/email-draft-editor";
import { EmailJobSearch } from "@/components/ai-tools/email-job-search";
import { EmailSelectedJobs } from "@/components/ai-tools/email-selected-jobs";
import { EmailSendConfirm } from "@/components/ai-tools/email-send-confirm";

const DRAFT_TYPES: Array<{ value: EmailDraftType; label: string }> = [
  { value: "estimate", label: "Estimate" },
  { value: "progress_update", label: "Progress update" },
  { value: "ready_for_pickup", label: "Ready for pickup reminder" },
  { value: "custom", label: "Custom" }
];

/** What the current draft was generated for (from the server response). */
type DraftMeta = { ids: number[]; type: EmailDraftType; recipientHint: string };

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

  useEffect(() => saveSelectedJobs(jobs), [jobs]);

  // Jumping here from another tool pre-selects the job and a fitting type.
  useEffect(() => {
    if (!target) return;
    setJobs((list) =>
      addSelectedJob(list, { referenceId: target.referenceId, customerId: null, customerName: target.label, equipment: "", status: "" })
    );
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
    resetSendState();
    try {
      const res = await apiClient.draftAICustomerEmail({ work_order_ids: emailIds, type, notes: notes.trim() });
      setDraft({ subject: res.subject, body: res.body });
      setMeta({ ids: res.work_order_ids?.length ? res.work_order_ids : emailIds, type: res.type ?? type, recipientHint: res.recipient_hint ?? "" });
    } catch (err) {
      setError(errorMessage(err, "Could not draft the email."));
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    if (!draft || !meta) return;
    setSending(true);
    setSendError("");
    try {
      // Same endpoint as the Email Customer dialog. "to" is left empty so the
      // server sends to the address on the customer record.
      await apiClient.sendWorkOrderCustomerEmail(meta.ids[0], {
        template: templateForDraftType(meta.type),
        to: "",
        subject: draft.subject.trim(),
        body: draft.body.trim()
      });
      setSent(true);
      setConfirming(false);
    } catch (err) {
      setSendError(errorMessage(err, "Could not send the email."));
    } finally {
      setSending(false);
    }
  };

  const openInEditor = () => {
    if (!draft || !meta || meta.ids.length !== 1) return;
    const saved = saveAIEmailDraft({
      referenceId: meta.ids[0],
      template: templateForDraftType(meta.type),
      subject: draft.subject.trim(),
      body: draft.body.trim()
    });
    if (!saved) {
      setError("Couldn't hand the draft over (browser storage is unavailable). Copy the text instead.");
      return;
    }
    openJobWithDraft(meta.ids[0]);
    setNote(`Opened job #${meta.ids[0]} in the portal window with this draft in the Email Customer editor.`);
  };

  let sendBlockedReason: string | undefined;
  if (meta && !meta.recipientHint) sendBlockedReason = "Send is disabled: no email address on file for this customer.";
  else if (meta && !sameIds(meta.ids, emailIds)) sendBlockedReason = "The selected jobs changed since this draft was generated. Regenerate first.";
  else if (sent) sendBlockedReason = "This draft was sent. Regenerate to send another email.";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <AICard className="space-y-4">
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
          <textarea
            id="ai-email-notes"
            rows={3}
            className={`${AI_TEXTAREA_CLASS} resize-y`}
            placeholder="e.g. Output stage needs a new pair of transistors. Estimate $180 parts and labour."
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
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
        canOpenInEditor={meta?.ids.length === 1}
        onOpenInEditor={openInEditor}
        onRegenerate={() => void runDraft()}
        canRegenerate={emailIds.length > 0}
        onSend={() => {
          setSendError("");
          setConfirming(true);
        }}
        sendBlockedReason={sendBlockedReason}
        footer={
          <>
            {confirming && meta && !sendBlockedReason && (
              <EmailSendConfirm
                recipientHint={meta.recipientHint}
                jobIds={meta.ids}
                sending={sending}
                onCancel={() => setConfirming(false)}
                onConfirm={() => void send()}
              />
            )}
            {sent && meta && (
              <p className="mt-2 text-sm text-green-700">
                Email sent to {meta.recipientHint} for job(s) {jobList(meta.ids)}.
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

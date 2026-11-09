import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AI_TEXTAREA_CLASS, AIButton, AICard, AICardTitle } from "@/components/ai-tools/ai-ui";

export type EditableDraft = { subject: string; body: string };

type Props = {
  draft: EditableDraft | null;
  onChange: (draft: EditableDraft) => void;
  /** Masked address from the server (e.g. "j***@gmail.com"); "" when none on file. */
  recipientHint: string;
  busy: boolean;
  /** Opens the device's email app (mailto:) with the current draft. Click only. */
  onOpenInEmailApp: () => void;
  /** When set, shows a "Copy draft" button (used when the draft is too long for a mailto link). */
  onCopyDraft?: () => void;
  /** Notes about the email-app handoff (missing recipient, mixed customers, clipboard). */
  emailAppNotes?: ReactNode;
  onRegenerate: () => void;
  canRegenerate: boolean;
  /** Undefined hides the Send button; a reason string disables it with a note. */
  onSend?: () => void;
  sendBlockedReason?: string;
  /** Rendered under the buttons (confirm step, success/error). */
  footer?: ReactNode;
  /** Optional Cc row rendered under "To:" (staff picker). */
  ccField?: ReactNode;
  /** Full recipients block; replaces the "To:" line and ccField when given. */
  recipientsField?: ReactNode;
  /** Optional job photo picker rendered under the body. */
  photos?: ReactNode;
};

export function EmailDraftEditor({
  draft,
  onChange,
  recipientHint,
  busy,
  onOpenInEmailApp,
  onCopyDraft,
  emailAppNotes,
  onRegenerate,
  canRegenerate,
  onSend,
  sendBlockedReason,
  footer,
  ccField,
  recipientsField,
  photos
}: Props) {
  const complete = Boolean(draft?.subject.trim() && draft?.body.trim());

  return (
    <AICard className="flex min-w-0 flex-col">
      <AICardTitle>Draft (editable)</AICardTitle>
      {draft ? (
        <>
          <div className="mt-2 flex flex-1 flex-col rounded-md border border-[#ddd5cc] bg-white">
            <div className="space-y-1 border-b border-[#efeae4] px-3 py-2 text-sm text-neutral-500">
              {recipientsField ?? (
                <>
                  <div>To: {recipientHint || <span className="text-red-700">customer has no email on file</span>}</div>
                  {ccField}
                </>
              )}
              <div className="flex items-start gap-1">
                <label htmlFor="ai-email-subject" className="shrink-0 leading-5">
                  Subject:
                </label>
                <SubjectField value={draft.subject} onChange={(subject) => onChange({ ...draft, subject })} disabled={busy} />
              </div>
            </div>
            <textarea
              aria-label="Email body"
              rows={12}
              className={`${AI_TEXTAREA_CLASS} min-h-[16rem] flex-1 resize-y border-0 focus:ring-0`}
              value={draft.body}
              onChange={(event) => onChange({ ...draft, body: event.target.value })}
              disabled={busy}
            />
          </div>
          {photos && <div className="mt-3">{photos}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onSend && (
              <AIButton onClick={onSend} disabled={busy || !complete || Boolean(sendBlockedReason)}>
                Send email
              </AIButton>
            )}
            <AIButton variant="outline" onClick={onRegenerate} disabled={busy || !canRegenerate}>
              {busy ? "Drafting..." : "Regenerate"}
            </AIButton>
            <AIButton variant="outline" onClick={onOpenInEmailApp} disabled={busy || !complete}>
              Open in email app
            </AIButton>
            {onCopyDraft && (
              <AIButton variant="outline" onClick={onCopyDraft} disabled={busy || !complete}>
                Copy draft
              </AIButton>
            )}
          </div>
          {sendBlockedReason && <p className="mt-2 text-sm text-neutral-600">{sendBlockedReason}</p>}
          {emailAppNotes}
          {footer}
        </>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">{busy ? "Drafting..." : "Select jobs and press Generate draft."}</p>
      )}
      <p className="mt-3 text-sm text-neutral-500">
        {photos
          ? "Nothing is sent until you press Send email and confirm. Photos picked above are attached when you press Send email; 'Open in email app' carries the text only."
          : "Nothing is sent until you press Send email and confirm. 'Open in email app' opens your device's email app with this draft; add photos there."}
      </p>
    </AICard>
  );
}

/**
 * Single-line subject that wraps instead of clipping: a textarea that grows to
 * fit its content, with Enter and pasted line breaks suppressed.
 */
function SubjectField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      id="ai-email-subject"
      rows={1}
      className="min-w-0 flex-1 resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent leading-5 text-neutral-800 outline-none"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\r?\n/g, " "))}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
      disabled={disabled}
    />
  );
}

import { AIButton } from "@/components/ai-tools/ai-ui";

type Props = {
  recipientHint: string;
  jobIds: number[];
  sending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Step 7 confirm: nothing is sent until the admin presses Send here. */
export function EmailSendConfirm({ recipientHint, jobIds, sending, onCancel, onConfirm }: Props) {
  const jobs = jobIds.map((id) => `#${id}`).join(", ");
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="ai-email-confirm-title"
      className="mt-3 rounded-md border border-[#c2571a] bg-[#fbf1ea] p-3"
    >
      <p id="ai-email-confirm-title" className="text-sm font-semibold text-neutral-900">
        Send to {recipientHint} for job(s) {jobs}?
      </p>
      <p className="mt-1 text-xs text-neutral-600">This sends the email now through the shop mailbox. No attachments are included.</p>
      <div className="mt-2 flex gap-2">
        <AIButton variant="outline" onClick={onCancel} disabled={sending}>
          Cancel
        </AIButton>
        <AIButton onClick={onConfirm} disabled={sending}>
          {sending ? "Sending..." : "Send"}
        </AIButton>
      </div>
    </div>
  );
}

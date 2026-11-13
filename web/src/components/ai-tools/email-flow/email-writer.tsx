import { useRef, useState, type ReactNode } from "react";
import { PenLine, X } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { EmailRewriteAction } from "@/lib/ai-tools/types";
import { findBlanks } from "@/lib/ai-tools/email-blanks";
import { EMAIL_REWRITE_BODY_MAX } from "@/lib/ai-tools/limits";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { BLANK_MARK, FOCUS, INPUT_CLASS, LINK_BUTTON, MgmtError, errorStatus } from "@/components/ai-tools/mgmt-ui";
import { cn } from "@/lib/utils";

const AI_ACTIONS: Array<{ value: EmailRewriteAction; label: string }> = [
  { value: "fix_grammar", label: "Fix grammar" },
  { value: "more_detail", label: "More detail" },
  { value: "shorter", label: "Shorter" },
  { value: "friendlier", label: "Friendlier" }
];

type Props = {
  subject: string;
  body: string;
  onSubject: (value: string) => void;
  /** `byAI` is true when the AI help (or its Undo) changed the body. */
  onBody: (value: string, byAI?: boolean) => void;
  /** Read-only once sent. */
  locked: boolean;
  /** To field (chips / recipient picker) rendered above Subject. */
  to: ReactNode;
  /** Shown between Subject and Message (e.g. the supplier names note). */
  beforeMessage?: ReactNode;
  idPrefix: string;
};

/** Subject + Message with yellow {blanks} (tap to select) and the ✎ AI help menu. */
export function EmailWriter({ subject, body, onSubject, onBody, locked, to, beforeMessage, idPrefix }: Props) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [penOpen, setPenOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [undo, setUndo] = useState<string | null>(null);

  const subjectBlanks = findBlanks(subject);
  const bodyBlanks = findBlanks(body);
  const total = subjectBlanks.length + bodyBlanks.length;

  const select = (field: "subject" | "body", start: number, end: number) => {
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
  };

  const rewrite = async (action: EmailRewriteAction) => {
    setPenOpen(false);
    setAiBusy(true);
    setAiError("");
    try {
      const res = await apiClient.rewriteEmail({ action, subject, body });
      setUndo(body);
      onBody(res.body, true);
    } catch (err) {
      setAiError(errorStatus(err) === 429 ? "Too many AI requests. Wait a minute, then try again." : errorMessage(err, "AI help failed. Try again."));
    } finally {
      setAiBusy(false);
    }
  };

  const tooLong = body.length > EMAIL_REWRITE_BODY_MAX;

  return (
    <div className="space-y-1">
      {to}
      <label htmlFor={`${idPrefix}-subject`} className="mb-1 mt-3 block text-[16px] font-semibold">
        Subject
      </label>
      <input
        id={`${idPrefix}-subject`}
        ref={subjectRef}
        className={INPUT_CLASS}
        value={subject}
        maxLength={300}
        readOnly={locked}
        onChange={(e) => onSubject(e.target.value)}
      />
      {beforeMessage}
      <label htmlFor={`${idPrefix}-body`} className="mb-1 mt-3 block text-[16px] font-semibold">
        Message
      </label>
      <div className="overflow-hidden rounded-[10px] border-[1.5px] border-[#8b949e] bg-white focus-within:border-[#1a7f94] focus-within:ring-[3px] focus-within:ring-[#e6f3f6]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e3e6e9] bg-[#fafbfc] px-2.5 py-1.5">
          <span
            className={cn(
              "rounded-md px-2 text-[15px] font-bold",
              total > 0 ? "bg-[#fff1c9] text-[#6b3d00]" : "bg-[#dff3e4] text-[#14532d]"
            )}
          >
            {total > 0 ? `${total} yellow blank${total === 1 ? "" : "s"} to fill` : "✓ No blanks"}
          </span>
          {!locked && (
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={penOpen}
              aria-controls={`${idPrefix}-pen`}
              disabled={aiBusy || tooLong}
              onClick={() => setPenOpen((v) => !v)}
              className={cn(
                "flex min-h-[44px] items-center gap-1.5 rounded-full border-[1.5px] border-[#1a7f94] px-3.5 text-[16px] font-bold disabled:opacity-50",
                penOpen ? "bg-[#1a7f94] text-white" : "bg-white text-[#135f6f]",
                FOCUS
              )}
            >
              <PenLine className="h-5 w-5" aria-hidden />
              {aiBusy ? "Working…" : "AI help"}
            </button>
          )}
        </div>
        {penOpen && (
          <div id={`${idPrefix}-pen`} className="grid grid-cols-2 gap-2 border-b border-[#b9dde5] bg-[#e6f3f6] p-2.5">
            {AI_ACTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => void rewrite(a.value)}
                className={cn("min-h-[48px] rounded-[10px] border-[1.5px] border-[#1a7f94] bg-white text-[16px] font-semibold text-[#135f6f] hover:bg-[#d3ecf1]", FOCUS)}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          id={`${idPrefix}-body`}
          ref={bodyRef}
          className="block min-h-[260px] w-full resize-y border-0 p-3 text-[17px] leading-normal text-[#1f2328] outline-none"
          rows={12}
          value={body}
          readOnly={locked}
          onChange={(e) => onBody(e.target.value)}
        />
      </div>
      {!locked && <p className="text-[15px] text-[#4a5260]">Nothing is written by the AI until you ask.</p>}
      {tooLong && <p className="text-[15px] text-[#4a5260]">AI help works on messages up to {EMAIL_REWRITE_BODY_MAX} characters.</p>}
      {aiError && <MgmtError>{aiError}</MgmtError>}
      {undo !== null && (
        <div role="status" className="mt-2 flex items-center justify-between rounded-lg bg-[#e6f3f6] py-1 pl-3 pr-1 text-[16px]">
          <span>AI changed the text.</span>
          <span className="flex">
            <button
              type="button"
              className={LINK_BUTTON}
              onClick={() => {
                onBody(undo, true);
                setUndo(null);
              }}
            >
              Undo
            </button>
            <button type="button" aria-label="Dismiss" className={cn(LINK_BUTTON, "no-underline")} onClick={() => setUndo(null)}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </span>
        </div>
      )}
      {total > 0 && !locked && (
        <div className="mt-2">
          <p className="text-[15px] text-[#4a5260]">Tap a blank to select it, then type over it.</p>
          <ul aria-label="Blanks to fill" className="mt-1 flex flex-wrap gap-2">
            {subjectBlanks.map((b, i) => (
              <li key={`s${i}`}>
                <button type="button" className={cn("min-h-[44px]", BLANK_MARK, FOCUS)} onClick={() => select("subject", b.start, b.end)}>
                  {b.token}
                </button>
              </li>
            ))}
            {bodyBlanks.map((b, i) => (
              <li key={`b${i}`}>
                <button type="button" className={cn("min-h-[44px]", BLANK_MARK, FOCUS)} onClick={() => select("body", b.start, b.end)}>
                  {b.token}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

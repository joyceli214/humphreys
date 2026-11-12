import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { AskInterpretResponse } from "@/lib/ai-tools/types";
import { AI_TEXT_MAX } from "@/lib/ai-tools/limits";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { FOCUS, MgmtChip, MgmtError, MgmtLoading, errorStatus } from "@/components/ai-tools/mgmt-ui";
import { ChargesAnswer, CustomerJobsAnswer, PartsAnswer, UpdatePreviewAnswer } from "@/components/ai-tools/ask/ask-answers";
import { cn } from "@/lib/utils";

/** Starter chips put an editable example in the box; they never send by themselves. */
export const ASK_STARTERS: Array<{ label: string; prompt: string }> = [
  { label: "Jobs for a customer", prompt: "Show all jobs for " },
  { label: "Update a job", prompt: "Job #: set status to " },
  { label: "Parts requests", prompt: "Show all parts requests" },
  { label: "Update many jobs", prompt: "Set jobs # and # to status " },
  { label: "Sum up charges", prompt: "Sum up the charges on job #" }
];

type Turn = {
  id: number;
  text: string;
  state: { status: "loading" } | { status: "error"; message: string } | { status: "ok"; answer: AskInterpretResponse };
};

function interpretError(err: unknown) {
  if (errorStatus(err) === 429) return "Too many AI requests. Wait a minute, then try again.";
  return errorMessage(err, "I couldn't understand that right now.");
}

function Answer({ answer, text, onStarter }: { answer: AskInterpretResponse; text: string; onStarter: (prompt: string) => void }) {
  switch (answer.intent) {
    case "customer_jobs":
      return <CustomerJobsAnswer customerQuery={answer.customer_query} referenceIds={answer.reference_ids ?? []} />;
    case "update_jobs":
      return <UpdatePreviewAnswer message={text} />;
    case "parts_requests":
      return <PartsAnswer query={answer.parts_query} statuses={answer.parts_statuses ?? []} />;
    case "charges_summary":
      return <ChargesAnswer referenceIds={answer.reference_ids ?? []} customerQuery={answer.customer_query} />;
    default:
      return (
        <div>
          <p className="mb-2 whitespace-pre-wrap">{answer.reply || "I can find jobs, update jobs, list parts requests, or sum up charges."}</p>
          <Starters onPick={onStarter} />
        </div>
      );
  }
}

function Starters({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {ASK_STARTERS.map((s) => (
        <MgmtChip key={s.label} onClick={() => onPick(s.prompt)}>
          {s.label}
        </MgmtChip>
      ))}
    </div>
  );
}

/** Management Ask: free-text commands → classified → read tables or a Mass Update preview (Apply / Cancel). */
export function AskTab() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const nextId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns]);

  const run = async (id: number, text: string) => {
    setTurns((list) => list.map((t) => (t.id === id ? { ...t, state: { status: "loading" } } : t)));
    try {
      const answer = await apiClient.interpretAsk(text);
      setTurns((list) => list.map((t) => (t.id === id ? { ...t, state: { status: "ok", answer } } : t)));
    } catch (err) {
      setTurns((list) => list.map((t) => (t.id === id ? { ...t, state: { status: "error", message: interpretError(err) } } : t)));
    }
  };

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    const id = nextId.current++;
    setTurns((list) => [...list, { id, text, state: { status: "loading" } }]);
    setInput("");
    void run(id, text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const fill = (prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(prompt.length, prompt.length);
    });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col text-[17px] leading-normal text-[#1f2328]">
      <div role="log" aria-live="polite" aria-label="Ask messages" className="flex-1 space-y-3 pb-4">
        {turns.length === 0 && (
          <div>
            <p className="mb-4 mt-1 text-[18px]">
              Ask me to find or change jobs.
              <br />
              <span className="text-[#4a5260]">I show a preview first. Nothing is saved until you tap Apply.</span>
            </p>
            <Starters onPick={fill} />
          </div>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-3">
            <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-[16px_16px_4px_16px] bg-[#1a7f94] px-3.5 py-2.5 text-white">
              {turn.text}
            </div>
            <div className="min-w-0 rounded-[4px_16px_16px_16px] border border-[#d5d9de] bg-white px-3.5 py-3">
              {turn.state.status === "loading" && <MgmtLoading>Thinking…</MgmtLoading>}
              {turn.state.status === "error" && <MgmtError onRetry={() => void run(turn.id, turn.text)}>{turn.state.message}</MgmtError>}
              {turn.state.status === "ok" && <Answer answer={turn.state.answer} text={turn.text} onStarter={fill} />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={send}
        className="sticky bottom-0 z-10 -mx-4 flex items-end gap-2 border-t border-[#d5d9de] bg-white px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] sm:-mx-7"
      >
        <label htmlFor="ask-input" className="sr-only">
          Message
        </label>
        <textarea
          id="ask-input"
          ref={inputRef}
          rows={1}
          maxLength={AI_TEXT_MAX}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask or tell me what to change…"
          className="max-h-[140px] min-h-[48px] flex-1 resize-none rounded-[12px] border-[1.5px] border-[#8b949e] bg-white px-3.5 py-2.5 text-[17px] outline-none focus:border-[#1a7f94] focus:ring-[3px] focus:ring-[#e6f3f6]"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!input.trim()}
          className={cn("grid h-12 w-12 flex-none place-items-center rounded-[12px] bg-[#1a7f94] text-white hover:bg-[#135f6f] disabled:bg-[#5f6b73]", FOCUS)}
        >
          <SendHorizontal className="h-5 w-5" aria-hidden />
        </button>
      </form>
    </div>
  );
}

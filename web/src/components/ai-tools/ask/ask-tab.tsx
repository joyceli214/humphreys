import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type SyntheticEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { AskInterpretResponse } from "@/lib/ai-tools/types";
import { AI_TEXT_MAX } from "@/lib/ai-tools/limits";
import { errorMessage } from "@/components/ai-tools/ai-ui";
import { FOCUS, MgmtChip, MgmtError, MgmtLoading, errorStatus } from "@/components/ai-tools/mgmt-ui";
import { ChargesAnswer, CustomerJobsAnswer, PartsAnswer, UpdatePreviewAnswer } from "@/components/ai-tools/ask/ask-answers";
import { AskMentionMenu, useShortcutResults, type MenuRow } from "@/components/ai-tools/ask/ask-mention-menu";
import { appendMention, findTrigger, insertMention, type ShortcutKind, type ShortcutTrigger } from "@/components/ai-tools/ask/ask-shortcuts";
import { cn } from "@/lib/utils";

/** Starter chips put an editable example in the box; they never send by themselves. */
export const ASK_STARTERS: Array<{ label: string; prompt: string }> = [
  { label: "Jobs for a customer", prompt: "Show all jobs for " },
  { label: "Update a job", prompt: "Job #: set status to " },
  { label: "Parts requests", prompt: "Show all parts requests" },
  { label: "Update many jobs", prompt: "Set jobs # and # to status " },
  { label: "Sum up charges", prompt: "Sum up the charges on job #" }
];

/**
 * Open shortcut menu. `caret` is where the next pick goes. After an `@`/`#`
 * pick the menu is `sticky`: the token is gone from the text but the list
 * stays open on the same query so several can be added.
 */
type MenuState = { kind: ShortcutKind; query: string; start: number; caret: number; sticky: boolean };

type Turn = {
  id: number;
  text: string;
  state: { status: "loading" } | { status: "error"; message: string } | { status: "ok"; answer: AskInterpretResponse };
};

function interpretError(err: unknown) {
  if (errorStatus(err) === 429) return "Too many AI requests. Wait a minute, then try again.";
  return errorMessage(err, "I couldn't understand that right now.");
}

/** "Using jobs #275, #27501 from your last answer." when the server filled in a follow-up. */
function contextLine(answer: AskInterpretResponse): string {
  if (!answer.context_used) return "";
  const ids = answer.reference_ids ?? [];
  if (ids.length > 0) return `Using ${ids.length === 1 ? "job" : "jobs"} ${ids.map((id) => `#${id}`).join(", ")} from your last answer.`;
  if (answer.customer_query) return `Using “${answer.customer_query}” from your last answer.`;
  return "";
}

function Answer(props: { answer: AskInterpretResponse; text: string; onStarter: (prompt: string) => void }) {
  const { answer } = props;
  const using = contextLine(answer);
  return (
    <>
      {answer.notice && <p className="mb-2 font-semibold">{answer.notice}</p>}
      {using && <p className="mb-2 text-[15px] text-[#4a5260]">{using}</p>}
      <AnswerBody {...props} />
    </>
  );
}

const NO_JOBS_REPLY = "I don't have recent jobs to refer to. Tell me the job numbers.";

function AnswerBody({ answer, onStarter }: { answer: AskInterpretResponse; text: string; onStarter: (prompt: string) => void }) {
  switch (answer.intent) {
    case "customer_jobs":
      return <CustomerJobsAnswer customerQuery={answer.customer_query} referenceIds={answer.reference_ids ?? []} />;
    case "update_jobs":
      // Only the server-built instruction (it names the jobs) is ever previewed;
      // the typed text alone may be a follow-up with no job numbers.
      if (!answer.preview_instruction) return <p>{NO_JOBS_REPLY}</p>;
      return <UpdatePreviewAnswer message={answer.preview_instruction} />;
    case "parts_requests":
      return <PartsAnswer query={answer.parts_query} statuses={answer.parts_statuses ?? []} referenceIds={answer.reference_ids ?? []} />;
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
  const formRef = useRef<HTMLFormElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<MenuState | null>(null);
  const [active, setActive] = useState(0);
  const [inserted, setInserted] = useState<string[]>([]);
  const dismissed = useRef<{ kind: ShortcutKind; start: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();
  // A query still being typed (#15, @Name) is not itself an inserted mention.
  const pickedText = menu && !menu.sticky ? `${input.slice(0, menu.start)}${input.slice(menu.caret)}` : input;
  const results = useShortcutResults(menu, pickedText, ASK_STARTERS);
  const activeIndex = active >= 0 && active < results.options.length ? active : -1;
  const optionId = (i: number) => `${listId}-o${i}`;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns]);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const el = inputRef.current;
    if (caret === null || !el) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [input]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (!formRef.current?.contains(event.target as Node)) {
        menuRef.current = null;
        setMenu(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

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
    closeMenu();
    const text = input.trim();
    if (!text) return;
    const id = nextId.current++;
    setTurns((list) => [...list, { id, text, state: { status: "loading" } }]);
    setInput("");
    void run(id, text);
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

  const closeMenu = () => {
    menuRef.current = null;
    setMenu(null);
  };

  const openMenu = (t: ShortcutTrigger, caret: number) => {
    const d = dismissed.current;
    if (d && d.kind === t.kind && d.start === t.start) {
      closeMenu();
      return;
    }
    dismissed.current = null;
    const prev = menuRef.current;
    if (!prev || prev.sticky || prev.kind !== t.kind || prev.start !== t.start || prev.query !== t.query) setActive(0);
    const next = { kind: t.kind, query: t.query, start: t.start, caret, sticky: false };
    menuRef.current = next;
    setMenu(next);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const caret = event.target.selectionStart ?? value.length;
    const deleted = value.length < input.length;
    setInput(value);
    const t = findTrigger(value, caret, inserted);
    if (t) {
      openMenu(t, caret);
      return;
    }
    dismissed.current = null;
    const m = menuRef.current;
    if (m?.sticky && deleted) {
      menuRef.current = { ...m, caret };
      setMenu(menuRef.current);
    } else if (m) {
      closeMenu();
    }
  };

  const onSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    const caret = el.selectionStart;
    const m = menuRef.current;
    if (el.selectionEnd !== caret) {
      if (m) closeMenu();
      return;
    }
    if (m?.sticky) {
      if (caret !== m.caret) closeMenu();
      return;
    }
    const t = findTrigger(el.value, caret, inserted);
    if (t) openMenu(t, caret);
    else if (m) closeMenu();
  };

  const pick = (row: MenuRow) => {
    const m = menuRef.current;
    if (!m) return;
    if (row.type === "skill") {
      closeMenu();
      fill(row.prompt);
      return;
    }
    if (results.isPicked(row)) return;
    const next = m.sticky ? appendMention(input, m.caret, row.mention) : insertMention(input, m, m.caret, row.mention);
    setInput(next.value);
    pendingCaret.current = next.caret;
    setInserted((list) => (list.includes(row.mention) ? list : [...list, row.mention]));
    menuRef.current = { ...m, caret: next.caret, sticky: true };
    setMenu(menuRef.current);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu) {
      const { options } = results;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!menu.sticky) dismissed.current = { kind: menu.kind, start: menu.start };
        closeMenu();
        return;
      }
      if (event.key === "Tab") {
        closeMenu();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (options.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i < 0 || i >= options.length ? (step > 0 ? 0 : options.length - 1) : (i + step + options.length) % options.length));
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (activeIndex >= 0) pick(options[activeIndex]);
        else if (menu.sticky) closeMenu();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
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
        ref={formRef}
        onSubmit={send}
        className="relative sticky bottom-0 z-10 -mx-4 border-t border-[#d5d9de] bg-white px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] sm:-mx-7"
      >
        {menu && (
          <AskMentionMenu
            kind={menu.kind}
            listId={listId}
            results={results}
            active={activeIndex}
            optionId={optionId}
            onHover={setActive}
            onPick={pick}
          />
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="ask-input" className="sr-only">
            Message
          </label>
          <textarea
            id="ask-input"
            ref={inputRef}
            rows={1}
            maxLength={AI_TEXT_MAX}
            value={input}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={menu !== null}
            aria-controls={menu ? listId : undefined}
            aria-activedescendant={menu && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-describedby="ask-input-hint"
            autoComplete="off"
            onChange={onChange}
            onSelect={onSelect}
            onKeyDown={onKeyDown}
            placeholder="Ask or tell me what to change…"
            className="max-h-[140px] min-h-[48px] min-w-0 flex-1 resize-none rounded-[12px] border-[1.5px] border-[#8b949e] bg-white px-3.5 py-2.5 text-[17px] outline-none focus:border-[#1a7f94] focus:ring-[3px] focus:ring-[#e6f3f6]"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim()}
            className={cn("grid h-12 w-12 flex-none place-items-center rounded-[12px] bg-[#1a7f94] text-white hover:bg-[#135f6f] disabled:bg-[#5f6b73]", FOCUS)}
          >
            <SendHorizontal className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p id="ask-input-hint" className="mt-1 px-1 text-[15px] text-[#4a5260]">
          Type / for skills, @ for people, # for jobs.
        </p>
      </form>
    </div>
  );
}

export type ShortcutKind = "/" | "@" | "#";

export type ShortcutTrigger = {
  kind: ShortcutKind;
  /** Index of the trigger character in the text. */
  start: number;
  /** Text typed after the trigger, up to the caret. */
  query: string;
};

const MENTION_QUERY_MAX = 40;
const MENTION_QUERY_MAX_SPACES = 3;

const isSpace = (ch: string | undefined) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
const atTokenStart = (value: string, i: number) => i === 0 || isSpace(value[i - 1]);

/** True when the text at `start` is one of the mentions already inserted from the menu. */
function startsWithInserted(value: string, start: number, inserted: readonly string[]) {
  return inserted.some((m) => m.length > 1 && value.startsWith(m, start) && endsAtBoundary(value, start + m.length));
}

function endsAtBoundary(value: string, end: number) {
  return end >= value.length || !/[\p{L}\p{N}_]/u.test(value[end]);
}

/**
 * The `/`, `@` or `#` command being typed at the caret, or null.
 * A trigger must start the text or follow whitespace, so `10/15`, `and/or`,
 * `foo@bar` and `abc#15` stay plain text. `/` and `#` queries have no spaces;
 * an `@` query may hold a few words (a full name). Mentions already inserted
 * from the menu (`inserted`) never re-open it.
 */
export function findTrigger(value: string, caret: number, inserted: readonly string[] = []): ShortcutTrigger | null {
  if (caret < 1 || caret > value.length) return null;

  let tokenStart = caret;
  while (tokenStart > 0 && !isSpace(value[tokenStart - 1])) tokenStart--;
  const head = value[tokenStart];
  if (tokenStart < caret && (head === "/" || head === "#" || head === "@")) {
    if (startsWithInserted(value, tokenStart, inserted)) return null;
    return { kind: head, start: tokenStart, query: value.slice(tokenStart + 1, caret) };
  }

  for (let i = caret - 1; i >= 0 && caret - i - 1 <= MENTION_QUERY_MAX; i--) {
    const ch = value[i];
    if (ch === "\n" || ch === "\r") return null;
    if (ch !== "@" || !atTokenStart(value, i)) continue;
    const query = value.slice(i + 1, caret);
    if (!query || isSpace(query[0])) return null;
    if ((query.match(/\s/g) ?? []).length > MENTION_QUERY_MAX_SPACES) return null;
    if (startsWithInserted(value, i, inserted)) return null;
    return { kind: "@", start: i, query };
  }
  return null;
}

/** Replace the trigger token (trigger char up to the caret) with `text` plus a space. */
export function insertMention(value: string, trigger: Pick<ShortcutTrigger, "start">, caret: number, text: string) {
  const before = value.slice(0, trigger.start);
  const after = value.slice(caret).replace(/^[ \t]+/, "");
  const inserted = `${text} `;
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/** Append another mention at `caret` (after an earlier pick), adding a space after it. */
export function appendMention(value: string, caret: number, text: string) {
  const before = value.slice(0, caret);
  const sep = before === "" || isSpace(before[before.length - 1]) ? "" : " ";
  const after = value.slice(caret).replace(/^[ \t]+/, "");
  const inserted = `${sep}${text} `;
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True while `mention` (e.g. `#15`, `@Staff Test`) is still in the text as a whole token. `#150` is not `#15`. */
export function hasMention(value: string, mention: string) {
  if (!mention) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(mention)}(?=$|[^\\p{L}\\p{N}_])`, "u").test(value);
}

export const jobMention = (id: number) => `#${id}`;

export function contactMention(name: string) {
  return `@${name.replace(/\s+/g, " ").trim()}`;
}

export function customerName(c: { label: string; first_name?: string | null; last_name?: string | null }) {
  const name = [c.first_name, c.last_name].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
  return name || c.label.trim();
}

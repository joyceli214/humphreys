// Yellow {blanks} in Management email drafts: anything the draft could not
// fill from the portal (a missing amount, a part, the account number). Send
// stays locked until none are left. Mirrors emailBlankPattern on the server
// (ai_tools_email_rewrite.go), which checks AI rewrites keep every blank.

/** A single-brace token, 1–60 chars, on one line. `{{…}}` template variables are not blanks. */
const BLANK_PATTERN = /\{[^{}\n]{1,60}\}/g;

export type Blank = { start: number; end: number; token: string };

export function findBlanks(text: string): Blank[] {
  const out: Blank[] = [];
  for (const match of text.matchAll(BLANK_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > 0 && text[start - 1] === "{") continue;
    if (end < text.length && text[end] === "}") continue;
    out.push({ start, end, token: match[0] });
  }
  return out;
}

export function countBlanks(...texts: string[]): number {
  return texts.reduce((sum, text) => sum + findBlanks(text).length, 0);
}

/** Footer primary button: "Fill N blanks" → "Add a recipient" → "Send email (i of n)". */
export function sendButtonState({
  blanks,
  hasTo,
  split
}: {
  blanks: number;
  hasTo: boolean;
  split?: { index: number; total: number };
}): { label: string; disabled: boolean } {
  if (blanks > 0) return { label: `Fill ${blanks} blank${blanks === 1 ? "" : "s"}`, disabled: true };
  if (!hasTo) return { label: "Add a recipient", disabled: true };
  return { label: split ? `Send email ${split.index + 1} of ${split.total}` : "Send email", disabled: false };
}

function decodeHtmlEntitiesPass(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

export function decodeHtmlEntities(value: string) {
  let out = value;
  // Two passes handle double-encoded values like: &amp;#x20;
  for (let i = 0; i < 2; i += 1) {
    const next = decodeHtmlEntitiesPass(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function normalizeEscapedLineBreaks(value: string) {
  if (value.includes("\n")) return value;
  if (!/\\r\\n|\\n|\\r/.test(value)) return value;
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\t/g, "\t");
}

export function normalizeMarkdownInput(value: string | null | undefined) {
  const raw = (value ?? "").replace(/\r\n?/g, "\n");
  const withEscapedBreaks = normalizeEscapedLineBreaks(raw);
  return decodeHtmlEntities(withEscapedBreaks).trim();
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1");
}

export function markdownToPlainText(value: string | null | undefined) {
  const normalized = normalizeMarkdownInput(value);
  if (!normalized) return "-";

  const lines = normalized.split("\n");
  const output: string[] = [];
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      output.push("");
      continue;
    }

    let cleaned = line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s{0,3}>\s?/, "")
      .replace(/^\s{0,3}[-*+]\s+/, "• ")
      .replace(/^\s{0,3}(\d+)\.\s+/, "$1. ")
      .replace(/^\s{0,3}\|/, "")
      .replace(/\|\s*$/, "")
      .replace(/\s*\|\s*/g, " | ");

    cleaned = stripInlineMarkdown(cleaned);
    cleaned = cleaned.replace(/<[^>]+>/g, "");
    cleaned = decodeHtmlEntities(cleaned);
    output.push(cleaned);
  }

  const compact = output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return compact || "-";
}

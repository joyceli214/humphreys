import DOMPurify from "dompurify";

/**
 * Helpers for the customer email composer.
 *
 * Templates are stored as plain text with light markdown (links, bullets,
 * bold/italic). The composer edits HTML, so we convert the rendered template
 * to HTML when the dialog opens, sanitize whatever the editor produces, and
 * derive a plain-text copy for the API's `body` fallback.
 */

export const EMAIL_ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "hr"];
const SAFE_HREF_PATTERN = /^(?:https?:|mailto:|tel:)/i;

const SIGN_OFF_PATTERN = /^(thank you|thanks|many thanks|thank you very much|regards|kind regards|best regards|warm regards|best|sincerely|cheers)[\s,.!]*$/i;

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "hr" };

type LinkToken = { text: string; href: string | null };

const PLACEHOLDER = (index: number) => `\u0000L${index}\u0000`;
const PLACEHOLDER_PATTERN = /\u0000L(\d+)\u0000/g;

// [text](href) or [text](<href>) with an optional "title". Link text may span a line break.
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(\s*<?([^\s<>()]+)>?(?:\s+"[^"]*")?\s*\)/g;
const BARE_URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"\u0000]+)/gi;

export function isSafeEmailHref(href: string) {
  return SAFE_HREF_PATTERN.test(href.trim());
}

function normalizeHref(raw: string) {
  const href = raw.trim().replace(/\\/g, "");
  if (/^www\./i.test(href)) return `https://${href}`;
  return href;
}

function isWhatsAppHref(href: string) {
  return /^https?:\/\/(?:wa\.me|api\.whatsapp\.com|(?:www\.)?whatsapp\.com)\b/i.test(href);
}

function looksLikeUrl(text: string) {
  return /^(?:https?:\/\/|www\.|mailto:|tel:)/i.test(text.trim());
}

/** Turn raw URLs used as link text into something a customer can read. */
export function readableLinkText(text: string, href: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const urlText = !cleaned || looksLikeUrl(cleaned) || cleaned === href;
  if (!urlText) return cleaned;
  if (isWhatsAppHref(href)) return "Message us on WhatsApp";
  if (/^tel:/i.test(href)) return decodeURIComponent(href.slice(4));
  if (/^mailto:/i.test(href)) return decodeURIComponent(href.slice(7).split("?")[0]);
  return cleaned
    .replace(/^https?:\/\//i, "")
    .replace(/^mailto:|^tel:/i, "")
    .replace(/\/$/, "");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatInline(value: string, links: LinkToken[]) {
  let out = escapeHtml(value);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?=[^_\w]|$)/g, "$1<em>$2</em>");
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1");
  return out.replace(PLACEHOLDER_PATTERN, (_match, index: string) => {
    const link = links[Number(index)];
    if (!link) return "";
    if (!link.href) return escapeHtml(link.text);
    return `<a href="${escapeHtml(link.href)}">${escapeHtml(readableLinkText(link.text, link.href))}</a>`;
  });
}

function extractLinks(text: string, links: LinkToken[]) {
  const withMarkdownLinks = text.replace(MARKDOWN_LINK_PATTERN, (_match, label: string, rawHref: string) => {
    const href = normalizeHref(rawHref);
    links.push({ text: label.replace(/\s+/g, " ").trim(), href: isSafeEmailHref(href) ? href : null });
    return PLACEHOLDER(links.length - 1);
  });
  return withMarkdownLinks.replace(BARE_URL_PATTERN, (match: string) => {
    const trailing = match.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
    const url = trailing ? match.slice(0, -trailing.length) : match;
    const href = normalizeHref(url);
    links.push({ text: url, href: isSafeEmailHref(href) ? href : null });
    return PLACEHOLDER(links.length - 1) + trailing;
  });
}

const HR_LINE = /^\s*(?:([-*_])\s*\1\s*\1[\s\-*_]*|--)\s*$/;
const BULLET_LINE = /^\s*[-*+•·]\s+(.*)$/;
const ORDERED_LINE = /^\s*\d+[.)]\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "p", lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (HR_LINE.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "hr" });
      continue;
    }
    const bullet = line.match(BULLET_LINE);
    const ordered = bullet ? null : line.match(ORDERED_LINE);
    if (bullet || ordered) {
      const kind = bullet ? "ul" : "ol";
      flushParagraph();
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((bullet ?? ordered)![1].trim());
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

function addSignatureSeparator(blocks: Block[]) {
  if (blocks.some((block) => block.kind === "hr")) return blocks;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.kind !== "p") continue;
    if (!SIGN_OFF_PATTERN.test(block.lines[0] ?? "")) continue;
    if (block.lines.length === 1 && index < blocks.length - 1) {
      return [...blocks.slice(0, index + 1), { kind: "hr" } as Block, ...blocks.slice(index + 1)];
    }
    return blocks;
  }
  return blocks;
}

/** Convert a rendered (plain text / light markdown) template into email HTML. */
export function emailTextToHtml(text: string) {
  const normalized = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  const links: LinkToken[] = [];
  // "Whatsapp:[+1 416…](…)" reads better with a space after the label.
  const withPlaceholders = extractLinks(normalized, links).replace(/(\w):(\u0000L\d+\u0000)/g, "$1: $2");
  const blocks = addSignatureSeparator(parseBlocks(withPlaceholders));
  return blocks
    .map((block) => {
      if (block.kind === "hr") return "<hr>";
      if (block.kind === "p") return `<p>${block.lines.map((line) => formatInline(line, links)).join("<br>")}</p>`;
      return `<${block.kind}>${block.items.map((item) => `<li><p>${formatInline(item, links)}</p></li>`).join("")}</${block.kind}>`;
    })
    .join("");
}

/** Allow only simple email formatting; links must be http(s), mailto or tel. */
export function sanitizeEmailHtml(html: string) {
  return DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS: EMAIL_ALLOWED_TAGS,
    ALLOWED_ATTR: ["href"],
    ALLOWED_URI_REGEXP: SAFE_HREF_PATTERN,
    KEEP_CONTENT: true
  });
}

function hrefLabel(href: string) {
  return href.replace(/^mailto:|^tel:/i, "");
}

/** Plain-text copy of the email (used as the API's `body` fallback). */
export function emailHtmlToPlainText(html: string) {
  const container = document.createElement("div");
  container.innerHTML = sanitizeEmailHtml(html);

  const walk = (node: Node, listContext?: { kind: "ul" | "ol"; index: number }): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
    if (!(node instanceof HTMLElement)) return "";
    const tag = node.tagName.toLowerCase();
    const children = (context?: { kind: "ul" | "ol"; index: number }) =>
      Array.from(node.childNodes).map((child) => walk(child, context)).join("");
    switch (tag) {
      case "br":
        return "\n";
      case "hr":
        return "\n--\n\n";
      case "p":
        return `${children().trim()}\n${listContext ? "" : "\n"}`;
      case "ul":
      case "ol": {
        const context = { kind: tag, index: 0 } as { kind: "ul" | "ol"; index: number };
        const items = Array.from(node.children).map((child) => walk(child, context)).join("");
        return `${items}\n`;
      }
      case "li": {
        if (listContext) listContext.index += 1;
        const marker = listContext?.kind === "ol" ? `${listContext.index}. ` : "• ";
        return `${marker}${children(listContext).trim()}\n`;
      }
      case "a": {
        const text = children().trim();
        const href = node.getAttribute("href") ?? "";
        const sameDigits = /^tel:/i.test(href) && text.replace(/\D/g, "") === href.replace(/\D/g, "");
        if (!href || sameDigits || text === href || text === hrefLabel(href)) return text || hrefLabel(href);
        return `${text} (${hrefLabel(href)})`;
      }
      default:
        return children(listContext);
    }
  };

  return walk(container)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/^ +/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Final touch before sending: keep the sanitized markup but make it friendlier
 * to email clients (TipTap wraps list items in <p>, and empty paragraphs
 * collapse in Outlook/Gmail).
 */
export function finalizeEmailHtml(html: string) {
  return sanitizeEmailHtml(html)
    .replace(/<li><p>([\s\S]*?)<\/p><\/li>/g, (match, inner: string) => (inner.includes("<p>") ? match : `<li>${inner}</li>`))
    .replace(/<p><\/p>/g, "<p><br></p>")
    .trim();
}

/**
 * A tiny, dependency-free rehype plugin that filters the HAST tree produced by
 * `rehype-raw` against an explicit allowlist. It keeps only the elements and
 * attributes the repair-log toolbar can produce (bold/italic/underline, lists
 * and task lists, links, images, headings, quotes, dividers, code, tables) and
 * drops everything else — `<script>`, `<style>`, `<iframe>`, `<form>`, inline
 * event handlers, and unsafe URL schemes.
 *
 * Run it AFTER `rehype-raw` so the raw HTML has already been parsed into HAST:
 *   rehypePlugins={[rehypeRaw, rehypeSanitizeAllowlist]}
 */

type HastProperties = Record<string, unknown>;

interface HastElement {
  type: "element";
  tagName: string;
  properties?: HastProperties;
  children: HastNode[];
}

interface HastText {
  type: "text";
  value: string;
}

interface HastOther {
  type: string;
  value?: string;
  children?: HastNode[];
}

type HastNode = HastElement | HastText | HastOther;

interface HastRoot {
  type: "root";
  children: HastNode[];
}

// Tags the toolbar can produce (directly or via markdown round-tripping).
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "ul",
  "ol",
  "li",
  "input",
  "a",
  "img",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "code",
  "pre",
  "span",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td"
]);

// Disallowed tags whose entire subtree (including text) must be removed.
const DROP_SUBTREE = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input", // non-checkbox inputs are handled separately; this guards textarea-like leftovers
  "textarea",
  "button",
  "select",
  "option",
  "noscript",
  "template",
  "svg",
  "math",
  "link",
  "meta",
  "head",
  "title",
  "base",
  "frame",
  "frameset",
  "applet",
  "audio",
  "video",
  "source"
]);

// Attributes allowed on every element (safe, non-scripting).
const GLOBAL_ATTRS = new Set(["className", "class"]);

// Attributes allowed per tag.
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  input: new Set(["type", "checked", "disabled"]),
  ol: new Set(["start"]),
  td: new Set(["align", "colSpan", "rowSpan"]),
  th: new Set(["align", "colSpan", "rowSpan", "scope"])
};

const SAFE_LINK_SCHEME = /^(?:https?:|mailto:|tel:)/i;
const SAFE_IMG_SCHEME = /^https?:/i;

function sanitizeProperties(tagName: string, properties: HastProperties | undefined): HastProperties {
  const allowed = TAG_ATTRS[tagName];
  const clean: HastProperties = {};
  if (!properties) return clean;
  for (const [key, value] of Object.entries(properties)) {
    const lower = key.toLowerCase();
    if (lower.startsWith("on")) continue; // drop all event handlers
    if (!GLOBAL_ATTRS.has(key) && !allowed?.has(key)) continue;
    if (tagName === "a" && key === "href") {
      if (typeof value !== "string" || !SAFE_LINK_SCHEME.test(value.trim())) continue;
    }
    if (tagName === "img" && key === "src") {
      if (typeof value !== "string" || !SAFE_IMG_SCHEME.test(value.trim())) continue;
    }
    clean[key] = value;
  }
  return clean;
}

function isCheckboxInput(node: HastElement): boolean {
  const type = node.properties?.type;
  return typeof type === "string" && type.toLowerCase() === "checkbox";
}

function transformNodes(nodes: HastNode[]): HastNode[] {
  const out: HastNode[] = [];
  for (const node of nodes) {
    const result = transformNode(node);
    if (Array.isArray(result)) out.push(...result);
    else if (result) out.push(result);
  }
  return out;
}

function transformNode(node: HastNode): HastNode | HastNode[] | null {
  if (node.type === "comment" || node.type === "raw" || node.type === "doctype") {
    return null;
  }
  if (node.type !== "element") {
    return node; // text and other leaf content pass through
  }
  const element = node as HastElement;
  const tag = element.tagName.toLowerCase();

  // A non-checkbox <input> (and other interactive controls) is removed whole.
  if (tag === "input") {
    return isCheckboxInput(element) ? finalizeElement(element, tag) : null;
  }
  if (DROP_SUBTREE.has(tag)) {
    return null;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    // Unknown-but-harmless wrapper: drop the tag, keep its (sanitized) children.
    return transformNodes(element.children ?? []);
  }
  return finalizeElement(element, tag);
}

function finalizeElement(element: HastElement, tag: string): HastElement {
  element.properties = sanitizeProperties(tag, element.properties);
  element.children = transformNodes(element.children ?? []);
  return element;
}

export function rehypeSanitizeAllowlist() {
  return (tree: HastRoot) => {
    tree.children = transformNodes(tree.children ?? []);
  };
}

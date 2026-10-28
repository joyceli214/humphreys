import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { rehypeSanitizeAllowlist } from "@/lib/rehype-sanitize-allowlist";
import { normalizeMarkdownInput } from "@/lib/markdown";
import { cn } from "@/lib/utils";

export type ImageClickHandler = (src: string, alt?: string | null) => void;

export function parseImageDimension(value: number | string | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function hasClass(className: unknown, name: string) {
  return typeof className === "string" && className.split(/\s+/).includes(name);
}

/**
 * The shared `react-markdown` component overrides used to render saved
 * repair-log / work-order markdown in the card. Kept in one place so the
 * sanitizer wiring and styling stay identical between the bordered block and
 * the inline variants.
 */
export function createMarkdownComponents(onImageClick?: ImageClickHandler): Components {
  return {
    p: ({ children }) => <p className="mb-2 leading-6 last:mb-0">{children}</p>,
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-all">
        {children}
      </a>
    ),
    h1: ({ children }) => <h1 className="mb-2 text-2xl font-semibold">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-2 text-xl font-semibold">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-2 text-lg font-semibold">{children}</h3>,
    ul: ({ children, className }) => (
      <ul className={cn("mb-2 list-disc pl-6", hasClass(className, "contains-task-list") && "list-none pl-0")}>{children}</ul>
    ),
    ol: ({ children }) => <ol className="mb-2 list-decimal pl-6">{children}</ol>,
    // Task-list items carry a `task-list-item` class and their own checkbox, so
    // hide the list bullet to avoid showing both a bullet and a checkbox.
    li: ({ children, className }) => (
      <li className={cn(hasClass(className, "task-list-item") && "list-none")}>{children}</li>
    ),
    img: ({ src, alt, width, height }) =>
      src ? (
        <button type="button" className="my-3 inline-block align-top cursor-zoom-in" onClick={() => onImageClick?.(src, alt)}>
          <img
            src={src}
            alt={alt ?? "Embedded image"}
            width={parseImageDimension(width)}
            height={parseImageDimension(height)}
            className="max-w-full rounded-md"
          />
        </button>
      ) : null,
    u: ({ children }) => <u className="underline">{children}</u>,
    blockquote: ({ children }) => (
      <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
    ),
    hr: () => <hr className="my-3 border-border" />,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>
  };
}

export function MarkdownContent({ value, onImageClick }: { value: string | null; onImageClick?: ImageClickHandler }) {
  const normalized = normalizeMarkdownInput(value);
  const content = normalized || "-";
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSanitizeAllowlist]}
      components={createMarkdownComponents(onImageClick)}
    >
      {content}
    </ReactMarkdown>
  );
}

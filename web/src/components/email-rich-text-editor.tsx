import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Link2, List, ListOrdered, Redo2, RemoveFormatting, Underline, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isSafeEmailHref, sanitizeEmailHtml } from "@/lib/email-html";

type EmailRichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

/** Turn what someone types into the link box into a usable href. */
export function normalizeLinkInput(input: string) {
  const value = input.trim();
  if (!value) return "";
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/^\+?[\d\s().-]{7,}$/.test(value)) return `tel:${value.replace(/[^\d+]/g, "")}`;
  return `https://${value.replace(/^\/+/, "")}`;
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground/80 transition hover:bg-white hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-white text-primary shadow-sm ring-1 ring-border"
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
}

function LinkBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const currentHref = (editor.getAttributes("link").href as string | undefined) ?? "";
  const hasSelection = !editor.state.selection.empty;
  const [url, setUrl] = useState(currentHref.replace(/^mailto:|^tel:/i, ""));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const apply = () => {
    const href = normalizeLinkInput(url);
    if (!href || !isSafeEmailHref(href)) {
      setError("Enter a web address, email address or phone number.");
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!hasSelection && !currentHref) {
      const label = text.trim() || url.trim();
      chain.insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      chain.setLink({ href }).run();
    }
    onClose();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-sm">
      {!hasSelection && !currentHref && (
        <input
          className="h-9 min-w-0 flex-1 basis-40 rounded-md border border-input bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          placeholder="Text to show (optional)"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
      )}
      <input
        ref={inputRef}
        className="h-9 min-w-0 flex-[2] basis-52 rounded-md border border-input bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        placeholder="Link: website, email or phone number"
        aria-label="Link address"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      />
      <div className="flex gap-2">
        <button type="button" className="h-9 rounded-md bg-primary px-3 font-medium text-primary-foreground hover:opacity-90" onClick={apply}>
          {currentHref ? "Update link" : "Add link"}
        </button>
        {currentHref && (
          <button type="button" className="h-9 rounded-md border border-border bg-white px-3 hover:bg-muted" onClick={remove}>
            Remove
          </button>
        )}
        <button type="button" className="h-9 rounded-md px-3 text-muted-foreground hover:bg-muted" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function EmailRichTextEditor({ value, onChange, disabled, className, ariaLabel = "Email message" }: EmailRichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          protocols: ["mailto", "tel"],
          HTMLAttributes: { rel: null, target: null, class: null },
          isAllowedUri: (url) => isSafeEmailHref(url)
        }
      })
    ],
    content: sanitizeEmailHtml(value),
    editable: !disabled,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "email-editor-content min-h-full px-4 py-4 text-[15px] leading-relaxed outline-none sm:px-5",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel
      }
    },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getHTML())
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      link: current?.isActive("link") ?? false,
      canUndo: current?.can().undo() ?? false,
      canRedo: current?.can().redo() ?? false
    })
  });

  if (!editor) return null;
  const off = disabled;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/60 px-2 py-1 sm:px-3">
        <ToolbarButton label="Bold" active={state?.bold} disabled={off} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={state?.italic} disabled={off} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Underline" active={state?.underline} disabled={off} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <Underline className="h-4 w-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Bulleted list" active={state?.bulletList} disabled={off} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={state?.orderedList} disabled={off} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Link" active={state?.link || linkOpen} disabled={off} onClick={() => setLinkOpen((open) => !open)}>
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Undo" disabled={off || !state?.canUndo} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Redo" disabled={off || !state?.canRedo} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Clear formatting" disabled={off} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting className="h-4 w-4" />
        </ToolbarButton>
      </div>
      {linkOpen && <LinkBar editor={editor} onClose={() => setLinkOpen(false)} />}
      <div className="min-h-0 flex-1 cursor-text overflow-y-auto bg-white" onClick={() => editor.chain().focus().run()}>
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}

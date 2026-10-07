"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { MDXEditor, type MDXEditorMethods } from "@mdxeditor/editor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Check, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AIMarkdownEditorProps = {
  markdown: string;
  onChange: (value: string) => void;
  onGenerate?: (prompt: string) => Promise<string>;
  onDirectGenerate?: () => Promise<string>;
  replaceOnGenerate?: boolean;
  contentEditableClassName?: string;
  plugins?: ComponentProps<typeof MDXEditor>["plugins"];
  className?: string;
};

function prependMarkdown(generated: string, existing: string) {
  const top = generated.trim();
  const bottom = existing.trim();
  if (!top) return existing;
  if (!bottom) return top;
  return `${top}\n\n${bottom}`;
}

export function AIMarkdownEditor({ markdown, onChange, onGenerate, onDirectGenerate, replaceOnGenerate = false, contentEditableClassName, plugins, className }: AIMarkdownEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const currentMarkdownRef = useRef(markdown);
  const [toolbarElement, setToolbarElement] = useState<HTMLElement | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [mode, setMode] = useState<"prompt" | "direct">("prompt");
  const canGenerate = Boolean(onGenerate || onDirectGenerate);
  const trimmedPrompt = prompt.trim();

  useEffect(() => {
    if (markdown === currentMarkdownRef.current) return;
    currentMarkdownRef.current = markdown;
    editorRef.current?.setMarkdown(markdown);
  }, [markdown]);

  useLayoutEffect(() => {
    setToolbarElement(editorContainerRef.current?.querySelector<HTMLElement>(".mdxeditor-toolbar") ?? null);
  }, [editorVersion, plugins]);

  const handleChange = (value: string) => {
    currentMarkdownRef.current = value;
    onChange(value);
  };

  const generate = async (previousOutput = "") => {
    if (!onGenerate || !trimmedPrompt || loading) return;
    setLoading(true);
    setError("");
    try {
      const nextPrompt = previousOutput.trim()
        ? `Refine the previous output using this instruction:\n${trimmedPrompt}\n\nPrevious output:\n${previousOutput.trim()}`
        : trimmedPrompt;
      setPreview((await onGenerate(nextPrompt)).trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate text");
    } finally {
      setLoading(false);
    }
  };

  const directGenerate = async () => {
    if (!onDirectGenerate || loading) return;
    setMode("direct");
    setOpen(true);
    setPreview("");
    setError("");
    setLoading(true);
    try {
      setPreview((await onDirectGenerate()).trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate text");
    } finally {
      setLoading(false);
    }
  };

  const accept = () => {
    if (!preview.trim()) return;
    handleChange(mode === "prompt" && replaceOnGenerate ? preview.trim() : prependMarkdown(preview, currentMarkdownRef.current));
    setEditorVersion((value) => value + 1);
    setOpen(false);
    setPrompt("");
    setPreview("");
    setError("");
  };

  const close = () => {
    setOpen(false);
    setPreview("");
    setError("");
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div ref={editorContainerRef} className="rounded-md border border-input bg-white p-2">
        {canGenerate && toolbarElement && createPortal(
          <div className="order-first flex shrink-0 items-center gap-1">
            {onGenerate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                disabled={loading}
                onClick={() => {
                  setMode("prompt");
                  setPreview("");
                  setError("");
                  setOpen(mode === "prompt" ? !open : true);
                }}
                aria-label="Proofread"
                title="Proofread"
              >
                <PenLine className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            {onDirectGenerate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                disabled={loading}
                onClick={() => void directGenerate()}
                aria-label="Direct Gen"
                title="Direct Gen"
              >
                Direct Gen
              </Button>
            )}
          </div>,
          toolbarElement
        )}
        <MDXEditor
          ref={editorRef}
          key={`markdown-editor-${editorVersion}`}
          markdown={markdown}
          contentEditableClassName={contentEditableClassName}
          onChange={handleChange}
          plugins={plugins}
        />
      </div>

      {open && canGenerate && (
        <div className="rounded-md border border-border bg-white p-3 shadow-sm">
          <div className="flex items-start gap-2">
            <PenLine className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {mode === "prompt" && (
              <>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={preview ? 2 : 1}
                  placeholder="What should AI fix or improve?"
                  className="min-h-10 flex-1 resize-y rounded-md border border-input bg-muted/40 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <Button type="button" variant={preview ? "outline" : "default"} onClick={() => void generate(preview)} disabled={loading || !trimmedPrompt}>
                  {loading ? "Creating..." : preview ? "Refine" : "Create"}
                </Button>
              </>
            )}
            {mode === "direct" && loading && <p role="status" className="flex-1 py-2 text-sm text-muted-foreground">Creating...</p>}
            {preview && (
              <Button type="button" onClick={accept} disabled={loading}>
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                {mode === "prompt" && replaceOnGenerate ? "Replace" : "Insert"}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-10 w-10 p-0" onClick={close} disabled={loading} aria-label="Close AI preview">
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          {preview && (
            <div className="mt-3 rounded-md border border-border p-3">
              <div className="prose prose-sm max-w-none text-sm leading-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {preview}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

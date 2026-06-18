"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
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

export function AIMarkdownEditor({ markdown, onChange, onGenerate, contentEditableClassName, plugins, className }: AIMarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const currentMarkdownRef = useRef(markdown);
  const [editorVersion, setEditorVersion] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canGenerate = Boolean(onGenerate);
  const trimmedPrompt = prompt.trim();

  useEffect(() => {
    if (markdown === currentMarkdownRef.current) return;
    currentMarkdownRef.current = markdown;
    editorRef.current?.setMarkdown(markdown);
  }, [markdown]);

  const handleChange = (value: string) => {
    currentMarkdownRef.current = value;
    onChange(value);
  };

  const generate = async (previousOutput = "") => {
    if (!onGenerate || !trimmedPrompt) return;
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

  const accept = () => {
    if (!preview.trim()) return;
    handleChange(prependMarkdown(preview, markdown));
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
      <div className="relative rounded-md border border-input bg-white p-2 [&_.mdxeditor-toolbar]:pl-10">
        {canGenerate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute left-3 top-3 z-10 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((value) => !value)}
            aria-label="AI writing tool"
            title="AI writing tool"
          >
            <PenLine className="h-4 w-4" aria-hidden="true" />
          </Button>
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
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={preview ? 2 : 1}
              placeholder="Tell AI what to write"
              className="min-h-10 flex-1 resize-y rounded-md border border-input bg-muted/40 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <Button type="button" variant={preview ? "outline" : "default"} onClick={() => void generate(preview)} disabled={loading || !trimmedPrompt}>
              {loading ? "Creating..." : preview ? "Refine" : "Create"}
            </Button>
            {preview && (
              <Button type="button" onClick={accept}>
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                Insert
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-10 w-10 p-0" onClick={close} aria-label="Close AI writing tool">
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

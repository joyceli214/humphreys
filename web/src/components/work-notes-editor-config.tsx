import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  InsertImage,
  InsertThematicBreak,
  ListsToggle,
  UndoRedo,
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps
} from "@mdxeditor/editor";
import { apiClient } from "@/lib/api/client";

/**
 * Converts browser-unfriendly image formats (webp/avif/heic/heif) to JPEG via a
 * canvas so the uploaded markdown image renders everywhere.
 */
export async function convertImageFileToJpeg(file: File) {
  const objectURL = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = objectURL;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to prepare image canvas");
    ctx.drawImage(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("Failed to convert image");
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

// Max upload size enforced by the server (uploads/handler.go). Surface it client-side for a friendlier error.
export const MARKDOWN_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export async function normalizeImageFileForUpload(file: File) {
  const contentType = file.type.toLowerCase();

  if (contentType === "image/svg+xml") {
    throw new Error("SVG images are not supported. Please upload a JPG, PNG or HEIC photo.");
  }
  if (file.size > MARKDOWN_IMAGE_MAX_BYTES) {
    throw new Error("Image is larger than 10 MB. Please upload a smaller photo.");
  }

  const needsJpegConversion =
    contentType === "image/webp" ||
    contentType === "image/avif" ||
    contentType === "image/heic" ||
    contentType === "image/heif";

  if (!needsJpegConversion) return file;

  try {
    return await convertImageFileToJpeg(file);
  } catch {
    if (contentType === "image/heic" || contentType === "image/heif") {
      throw new Error("Couldn't process this HEIC photo. Please convert it to JPG/PNG and try again.");
    }
    if (contentType === "image/webp") {
      throw new Error("WebP images are not supported. Please upload JPG/PNG/HEIC.");
    }
    throw new Error("Couldn't process this image. Please upload a JPG or PNG photo.");
  }
}

export async function markdownImageUploadHandler(file: File) {
  const normalizedFile = await normalizeImageFileForUpload(file);
  const { url } = await apiClient.uploadMarkdownImage(normalizedFile);
  return url;
}

/**
 * A dependency-free plain-text code-block editor. Registering it as a catch-all
 * descriptor lets the editor render any ``` fenced block (from AI output or a
 * paste) without crashing — and without pulling the heavy CodeMirror bundle in.
 */
function PlainTextCodeEditor({ code, focusEmitter }: CodeBlockEditorProps) {
  const { setCode } = useCodeBlockEditorContext();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    focusEmitter.subscribe(() => textareaRef.current?.focus());
  }, [focusEmitter]);
  return (
    <textarea
      ref={textareaRef}
      defaultValue={code}
      onChange={(event) => setCode(event.target.value)}
      spellCheck={false}
      rows={Math.min(Math.max(code.split("\n").length, 2), 12)}
      className="my-2 w-full resize-y rounded-md border border-input bg-muted/40 p-2 font-mono text-sm leading-5"
    />
  );
}

const plainTextCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 100,
  match: () => true,
  Editor: PlainTextCodeEditor
};

/**
 * Wraps a built-in MDXEditor toolbar button that renders no accessible name and
 * sets a `title`/`aria-label` on the underlying <button> (only if missing).
 * Uses `display:contents` so the toolbar layout is unchanged.
 */
function LabeledToolbarButton({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const button = ref.current?.querySelector("button");
    if (!button) return;
    if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", label);
    if (!button.getAttribute("title")) button.setAttribute("title", label);
  });
  return (
    <span ref={ref} className="contents">
      {children}
    </span>
  );
}

export const workNotesEditorPlugins = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  imagePlugin({
    imageUploadHandler: markdownImageUploadHandler,
    disableImageSettingsButton: true
  }),
  // Register code-block + table descriptors so AI/pasted markdown containing
  // ``` fences or GFM tables can't crash the editor on import. A lightweight
  // textarea code editor is used instead of CodeMirror to keep the bundle small.
  codeBlockPlugin({ defaultCodeBlockLanguage: "", codeBlockEditorDescriptors: [plainTextCodeBlockDescriptor] }),
  tablePlugin(),
  markdownShortcutPlugin(),
  toolbarPlugin({
    toolbarContents: () => (
      <>
        <UndoRedo />
        <BoldItalicUnderlineToggles />
        <ListsToggle />
        <CreateLink />
        <LabeledToolbarButton label="Insert image">
          <InsertImage />
        </LabeledToolbarButton>
        <LabeledToolbarButton label="Insert divider">
          <InsertThematicBreak />
        </LabeledToolbarButton>
        <BlockTypeSelect />
      </>
    )
  })
];

export const workNotesEditorContentClassName =
  "min-h-28 px-3 py-2 text-base md:text-sm leading-6 " +
  "[&_p]:mb-2 [&_p:last-child]:mb-0 " +
  "[&_strong]:font-semibold [&_em]:italic [&_u]:underline " +
  "[&_a]:text-primary [&_a]:underline " +
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 " +
  "[&_li]:my-1 " +
  "[&_img]:my-3 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold " +
  "[&_hr]:my-3 [&_hr]:border-border";

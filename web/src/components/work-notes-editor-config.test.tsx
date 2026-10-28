// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MDXEditor } from "@mdxeditor/editor";
import { MARKDOWN_IMAGE_MAX_BYTES, normalizeImageFileForUpload, workNotesEditorPlugins } from "./work-notes-editor-config";

// jsdom lacks the layout/range APIs CodeMirror and Radix tooltips poke at.
// Stub the ones that would otherwise throw while mounting.
beforeStubs();
function beforeStubs() {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }) as unknown as typeof window.matchMedia;
  }
}

const MARKDOWN_WITH_FENCE_AND_TABLE = [
  "Repair notes:",
  "",
  "```",
  "resistor = 10k",
  "```",
  "",
  "| Part | Qty |",
  "| ---- | --- |",
  "| Cap  | 2   |"
].join("\n");

describe("workNotesEditorPlugins", () => {
  it("registers code-block and table descriptors so fences/tables cannot crash import", () => {
    // The real regression: before registering codeBlockPlugin/tablePlugin,
    // MDXEditor threw while importing markdown containing a fenced block or a
    // GFM table. Mounting with such markdown must not throw.
    expect(() =>
      render(
        <MDXEditor markdown={MARKDOWN_WITH_FENCE_AND_TABLE} plugins={workNotesEditorPlugins} onChange={() => {}} />
      )
    ).not.toThrow();
  });
});

describe("normalizeImageFileForUpload", () => {
  it("rejects SVG uploads", async () => {
    const svg = new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" });
    await expect(normalizeImageFileForUpload(svg)).rejects.toThrow(/SVG/i);
  });

  it("rejects files larger than 10 MB before upload", async () => {
    const big = new File([new Uint8Array(MARKDOWN_IMAGE_MAX_BYTES + 1)], "huge.jpg", { type: "image/jpeg" });
    await expect(normalizeImageFileForUpload(big)).rejects.toThrow(/10 MB/i);
  });

  it("surfaces a clear error when a HEIC photo can't be converted", async () => {
    const heic = new File([new Uint8Array(8)], "photo.heic", { type: "image/heic" });
    await expect(normalizeImageFileForUpload(heic)).rejects.toThrow(/HEIC/i);
  });

  it("passes through a normal JPEG untouched", async () => {
    const jpg = new File([new Uint8Array(8)], "photo.jpg", { type: "image/jpeg" });
    await expect(normalizeImageFileForUpload(jpg)).resolves.toBe(jpg);
  });
});

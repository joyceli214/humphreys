import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "./markdown";

describe("markdownToPlainText", () => {
  it("renders unchecked task items as ☐ with no extra bullet", () => {
    expect(markdownToPlainText("- [ ] Replace filter")).toBe("☐ Replace filter");
  });

  it("renders checked task items as ☑ with no extra bullet", () => {
    expect(markdownToPlainText("- [x] Replace filter")).toBe("☑ Replace filter");
    expect(markdownToPlainText("- [X] Done it")).toBe("☑ Done it");
  });

  it("keeps regular bullets as • and does not confuse them with checklists", () => {
    expect(markdownToPlainText("- Plain item")).toBe("• Plain item");
  });

  it("handles a mixed checklist block", () => {
    const input = ["- [ ] One", "- [x] Two", "- Three"].join("\n");
    expect(markdownToPlainText(input)).toBe(["☐ One", "☑ Two", "• Three"].join("\n"));
  });

  it("strips <u> tags to their text", () => {
    expect(markdownToPlainText("Replace <u>main</u> board")).toBe("Replace main board");
  });
});

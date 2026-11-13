import { describe, expect, it } from "vitest";
import { countBlanks, findBlanks, sendButtonState } from "@/lib/ai-tools/email-blanks";

describe("findBlanks", () => {
  it("finds single-brace blanks with their ranges", () => {
    const text = "Hi {Name},\nAmount: {Amount for #12}";
    const blanks = findBlanks(text);
    expect(blanks.map((b) => b.token)).toEqual(["{Name}", "{Amount for #12}"]);
    expect(text.slice(blanks[1].start, blanks[1].end)).toBe("{Amount for #12}");
  });

  it("ignores double-brace template variables, empty braces, multi-line and over-long tokens", () => {
    const long = `{${"a".repeat(61)}}`;
    expect(findBlanks("{{customer_name}} {} {a\nb} " + long)).toEqual([]);
    expect(findBlanks("{{x}} {Qty}").map((b) => b.token)).toEqual(["{Qty}"]);
  });

  it("counts blanks across fields", () => {
    expect(countBlanks("{Subject}", "Hi {Name}, {Qty} and {Qty}")).toBe(4);
    expect(countBlanks("", "nothing here")).toBe(0);
  });
});

describe("sendButtonState", () => {
  it("asks to fill blanks first", () => {
    expect(sendButtonState({ blanks: 3, hasTo: true })).toEqual({ label: "Fill 3 blanks", disabled: true });
    expect(sendButtonState({ blanks: 1, hasTo: false })).toEqual({ label: "Fill 1 blank", disabled: true });
  });

  it("asks for a recipient when To is empty", () => {
    expect(sendButtonState({ blanks: 0, hasTo: false })).toEqual({ label: "Add a recipient", disabled: true });
  });

  it("reads Send email, with the split position when split", () => {
    expect(sendButtonState({ blanks: 0, hasTo: true })).toEqual({ label: "Send email", disabled: false });
    expect(sendButtonState({ blanks: 0, hasTo: true, split: { index: 0, total: 2 } })).toEqual({ label: "Send email 1 of 2", disabled: false });
  });
});

import { describe, expect, it } from "vitest";
import { appendMention, contactMention, customerName, findTrigger, hasMention, insertMention, jobMention } from "@/components/ai-tools/ask/ask-shortcuts";

const at = (value: string, inserted: string[] = []) => findTrigger(value, value.length, inserted);

describe("findTrigger", () => {
  it("opens at the start of the text or after whitespace", () => {
    expect(at("/")).toEqual({ kind: "/", start: 0, query: "" });
    expect(at("/upd")).toEqual({ kind: "/", start: 0, query: "upd" });
    expect(at("hello /par")).toEqual({ kind: "/", start: 6, query: "par" });
    expect(at("jobs for @Sta")).toEqual({ kind: "@", start: 9, query: "Sta" });
    expect(at("line one\n#15")).toEqual({ kind: "#", start: 9, query: "15" });
    expect(at("tab\t#")).toEqual({ kind: "#", start: 4, query: "" });
  });

  it("ignores triggers inside a word", () => {
    for (const text of ["10/15", "and/or", "hello/world", "foo@bar", "abc#15", "set 10/15 to"]) expect(at(text)).toBeNull();
  });

  it("closes when the caret leaves the token", () => {
    expect(at("/upd ")).toBeNull();
    expect(at("#15 ")).toBeNull();
    expect(findTrigger("/upd more", 9)).toBeNull();
    expect(findTrigger("#15 and", 3)).toEqual({ kind: "#", start: 0, query: "15" });
    expect(findTrigger("", 0)).toBeNull();
  });

  it("lets an @ query hold a full name but not a leading space or a new line", () => {
    expect(at("@Staff Te")).toEqual({ kind: "@", start: 0, query: "Staff Te" });
    expect(at("meet @ 5pm")).toBeNull();
    expect(at("@Staff\nhello")).toBeNull();
    expect(at("@a b c d e")).toBeNull();
  });

  it("does not reopen on a mention already inserted from the menu", () => {
    expect(at("@Staff Test ", ["@Staff Test"])).toBeNull();
    expect(at("@Staff Test h", ["@Staff Test"])).toBeNull();
    expect(at("@Staff Test", ["@Staff Test"])).toBeNull();
    expect(at("#15", ["#15"])).toBeNull();
    expect(at("#150", ["#15"])).toEqual({ kind: "#", start: 0, query: "150" });
    expect(at("@Staff Test @Te", ["@Staff Test"])).toEqual({ kind: "@", start: 12, query: "Te" });
  });
});

describe("insertMention / appendMention", () => {
  it("replaces the typed token with the mention and a space", () => {
    expect(insertMention("jobs for @sta", { start: 9 }, 13, "@Staff Test")).toEqual({ value: "jobs for @Staff Test ", caret: 21 });
    expect(insertMention("charges on #15 please", { start: 11 }, 14, "#15")).toEqual({ value: "charges on #15 please", caret: 15 });
  });

  it("appends further picks with a space between", () => {
    expect(appendMention("@Staff Test ", 12, "@Test Customer A")).toEqual({ value: "@Staff Test @Test Customer A ", caret: 29 });
    expect(appendMention("#15", 3, "#31221")).toEqual({ value: "#15 #31221 ", caret: 11 });
  });
});

describe("hasMention", () => {
  it("matches the whole mention only", () => {
    expect(hasMention("sum #15 now", "#15")).toBe(true);
    expect(hasMention("#15, #16", "#15")).toBe(true);
    expect(hasMention("sum #150", "#15")).toBe(false);
    expect(hasMention("abc#15", "#15")).toBe(false);
    expect(hasMention("@Staff Test @Test Customer A ", "@Staff Test")).toBe(true);
    expect(hasMention("@Staff Tester", "@Staff Test")).toBe(false);
    expect(hasMention("anything", "")).toBe(false);
  });
});

describe("mention text", () => {
  it("builds plain-text mentions", () => {
    expect(jobMention(15)).toBe("#15");
    expect(contactMention("  Staff   Test ")).toBe("@Staff Test");
    expect(customerName({ label: "Test Customer A (000) - a@test.local", first_name: "Test Customer", last_name: "A" })).toBe("Test Customer A");
    expect(customerName({ label: "Customer #9", first_name: null, last_name: null })).toBe("Customer #9");
  });
});

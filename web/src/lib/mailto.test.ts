import { describe, expect, it } from "vitest";
import { MAILTO_MAX_LENGTH, buildMailto, draftClipboardText } from "@/lib/mailto";

describe("buildMailto", () => {
  it("builds recipient, subject and body", () => {
    const res = buildMailto("jane@example.com", "Your receiver", "Hi Jane");
    expect(res).toEqual({ href: "mailto:jane@example.com?subject=Your%20receiver&body=Hi%20Jane", tooLong: false });
  });

  it("normalises every newline style to CRLF (%0D%0A)", () => {
    const { href } = buildMailto("a@b.co", "S", "one\ntwo\r\nthree\rfour");
    expect(href).toContain("body=one%0D%0Atwo%0D%0Athree%0D%0Afour");
    expect(href).not.toMatch(/%0A(?<!%0D%0A)/);
    expect(href.match(/%0D%0A/g)).toHaveLength(3);
  });

  it("encodes ampersands, question marks, equals, hashes and plus signs", () => {
    const { href } = buildMailto("a@b.co", "Parts & labour?", "a=1 & b=2 #3 +4 100%");
    expect(href).toBe("mailto:a@b.co?subject=Parts%20%26%20labour%3F&body=a%3D1%20%26%20b%3D2%20%233%20%2B4%20100%25");
    // Exactly one raw "&" separates subject from body.
    expect(href.split("&")).toHaveLength(2);
  });

  it("encodes accents and CJK as UTF-8 and round-trips", () => {
    const subject = "Réparation terminée";
    const body = "こんにちは 修理完了 — café";
    const { href } = buildMailto("a@b.co", subject, body);
    expect(href).toContain("R%C3%A9paration");
    expect(href).toContain("%E3%81%93");
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toBe(subject);
    expect(params.get("body")).toBe(body);
  });

  it("encodes unusual characters in the recipient but keeps @ readable", () => {
    expect(buildMailto("o'neil+tag@example.com", "S", "B").href.startsWith("mailto:o'neil%2Btag@example.com?")).toBe(true);
    expect(buildMailto("x@y.co?cc=evil@z.co", "S", "B").href.startsWith("mailto:x@y.co%3Fcc%3Devil@z.co?")).toBe(true);
  });

  it("allows an empty recipient", () => {
    expect(buildMailto("", "Hello", "Body")).toEqual({ href: "mailto:?subject=Hello&body=Body", tooLong: false });
    expect(buildMailto("   ", "Hello", "Body").href).toBe("mailto:?subject=Hello&body=Body");
  });

  it("falls back to recipient + subject only when the full URL is too long", () => {
    const body = "x".repeat(MAILTO_MAX_LENGTH);
    const res = buildMailto("jane@example.com", "Long one", body);
    expect(res).toEqual({ href: "mailto:jane@example.com?subject=Long%20one", tooLong: true });
  });

  it("measures length after encoding (CJK expands 9x)", () => {
    const body = "修".repeat(250); // 750 raw chars of UTF-8, 2250 encoded
    expect(buildMailto("a@b.co", "S", body).tooLong).toBe(true);
    expect(buildMailto("a@b.co", "S", "修".repeat(100)).tooLong).toBe(false);
  });

  it("keeps a URL of exactly the limit and rejects one char over", () => {
    const base = "mailto:a@b.co?subject=S&body=".length;
    expect(buildMailto("a@b.co", "S", "x".repeat(MAILTO_MAX_LENGTH - base)).tooLong).toBe(false);
    expect(buildMailto("a@b.co", "S", "x".repeat(MAILTO_MAX_LENGTH - base + 1)).tooLong).toBe(true);
  });
});

describe("draftClipboardText", () => {
  it("includes subject and full body", () => {
    expect(draftClipboardText("Subj", "Line 1\nLine 2")).toBe("Subject: Subj\n\nLine 1\nLine 2");
  });
});

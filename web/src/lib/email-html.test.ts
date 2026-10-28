// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { emailHtmlToPlainText, emailTextToHtml, finalizeEmailHtml, readableLinkText, sanitizeEmailHtml } from "./email-html";
import { normalizeLinkInput } from "@/components/email-rich-text-editor";

const SHOP_TEMPLATE_BODY = [
  "Hi Janice Mccord,",
  "",
  "We have started work on your Bose Wave Radio 3 Wave music system III.",
  "",
  "Job details:",
  "Job ID: 31225",
  "Work done:",
  "• Diagnosed not-playable fault.",
  "• Replaced supercapacitor on motherboard.",
  "",
  "Thank you,",
  "",
  "Dave",
  "Humphreys Vintage Audio Repair.",
  "[16610 Bayview Ave. Unit #7",
  "Newmarket ON](https://maps.app.goo.gl/zkQtLiy92m1N7MGs7)",
  'Phone: [+1 416-923-3777](tel:+14169233777 "+1 416-923-3777")',
  "[http://www.humphreysrepaircentre.com](http://www.humphreysrepaircentre.com)",
  "",
  'Whatsapp:[+1 4169233777](https://wa.me/14169233777?text=Hi%20Dave%2C%20I%20would%20like%20to%20consult "+1 4169233777")',
  "",
  "Hours:",
  "Monday to Friday 10AM - 5PM",
  "Saturday 9AM -12PM"
].join("\n");

describe("emailTextToHtml", () => {
  const html = emailTextToHtml(SHOP_TEMPLATE_BODY);

  it("turns greeting and blank-line separated text into paragraphs with line breaks", () => {
    expect(html.startsWith("<p>Hi Janice Mccord,</p>")).toBe(true);
    expect(html).toContain("<p>Job details:<br>Job ID: 31225<br>Work done:</p>");
  });

  it("turns bullet lines into a real list", () => {
    expect(html).toContain("<ul><li><p>Diagnosed not-playable fault.</p></li><li><p>Replaced supercapacitor on motherboard.</p></li></ul>");
    expect(html).not.toContain("•");
  });

  it("turns markdown links (including multi-line link text and titles) into readable anchors", () => {
    expect(html).toContain('<a href="https://maps.app.goo.gl/zkQtLiy92m1N7MGs7">16610 Bayview Ave. Unit #7 Newmarket ON</a>');
    expect(html).toContain('Phone: <a href="tel:+14169233777">+1 416-923-3777</a>');
    expect(html).toContain('<a href="http://www.humphreysrepaircentre.com">www.humphreysrepaircentre.com</a>');
    expect(html).toContain('Whatsapp: <a href="https://wa.me/14169233777?text=Hi%20Dave%2C%20I%20would%20like%20to%20consult">+1 4169233777</a>');
    expect(html).not.toMatch(/\]\(/);
  });

  it("separates the signature from the sign-off with a line", () => {
    expect(html).toContain("<p>Thank you,</p><hr><p>Dave<br>Humphreys Vintage Audio Repair.");
  });

  it("gives bare and URL-text links readable labels", () => {
    expect(emailTextToHtml("Chat: https://wa.me/14169233777?text=Hi%20there")).toBe(
      '<p>Chat: <a href="https://wa.me/14169233777?text=Hi%20there">Message us on WhatsApp</a></p>'
    );
    expect(emailTextToHtml("Visit www.example.com.")).toBe('<p>Visit <a href="https://www.example.com">www.example.com</a>.</p>');
    expect(readableLinkText("tel:+14165550000", "tel:+14165550000")).toBe("+14165550000");
  });

  it("escapes HTML in the template text and drops unsafe links", () => {
    const out = emailTextToHtml('Hi <script>alert(1)</script> [click](javascript:alert) **bold** *it*');
    expect(out).toBe("<p>Hi &lt;script&gt;alert(1)&lt;/script&gt; click <strong>bold</strong> <em>it</em></p>");
  });

  it("numbers ordered lists", () => {
    expect(emailTextToHtml("Steps:\n1. One\n2. Two")).toBe("<p>Steps:</p><ol><li><p>One</p></li><li><p>Two</p></li></ol>");
  });
});

describe("sanitizeEmailHtml", () => {
  it("keeps only simple email formatting", () => {
    const dirty =
      '<h1 style="color:red">Title</h1><p onclick="x()">Hi <strong>there</strong> <u>u</u> <em>e</em><img src=x onerror=alert(1)></p>' +
      '<script>alert(1)</script><ul><li>a</li></ul><ol><li>b</li></ol><hr><br>' +
      '<a href="javascript:alert(1)">bad</a><a href="https://ok.example" target="_blank" class="c">ok</a>' +
      '<a href="mailto:a@b.co">m</a><a href="tel:+1416">t</a><a href="/relative">rel</a>';
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).toBe(
      "Title<p>Hi <strong>there</strong> <u>u</u> <em>e</em></p><ul><li>a</li></ul><ol><li>b</li></ol><hr><br>" +
        '<a>bad</a><a href="https://ok.example">ok</a><a href="mailto:a@b.co">m</a><a href="tel:+1416">t</a><a>rel</a>'
    );
  });

  it("finalizes editor HTML for email clients", () => {
    expect(finalizeEmailHtml("<p>Hi</p><p></p><ul><li><p>One</p></li></ul>")).toBe("<p>Hi</p><p><br></p><ul><li>One</li></ul>");
  });
});

describe("emailHtmlToPlainText", () => {
  it("produces a readable plain-text fallback", () => {
    const text = emailHtmlToPlainText(emailTextToHtml(SHOP_TEMPLATE_BODY));
    expect(text).toContain("Hi Janice Mccord,\n\nWe have started work");
    expect(text).toContain("Work done:\n\n• Diagnosed not-playable fault.\n• Replaced supercapacitor on motherboard.");
    expect(text).toContain("Phone: +1 416-923-3777\n");
    expect(text).toContain("Whatsapp: +1 4169233777 (https://wa.me/14169233777?text=");
    expect(text).toContain("www.humphreysrepaircentre.com (http://www.humphreysrepaircentre.com)");
    expect(text).toContain("Thank you,\n\n--\n\nDave");
  });
});

describe("normalizeLinkInput", () => {
  it("accepts websites, emails and phone numbers", () => {
    expect(normalizeLinkInput("example.com")).toBe("https://example.com");
    expect(normalizeLinkInput("https://x.co")).toBe("https://x.co");
    expect(normalizeLinkInput("dave@example.com")).toBe("mailto:dave@example.com");
    expect(normalizeLinkInput("+1 416-923-3777")).toBe("tel:+14169233777");
  });
});

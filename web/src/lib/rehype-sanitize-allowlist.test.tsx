// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { rehypeSanitizeAllowlist } from "./rehype-sanitize-allowlist";

function render(markdown: string) {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitizeAllowlist]}>
      {markdown}
    </ReactMarkdown>
  );
}

describe("rehypeSanitizeAllowlist", () => {
  it("strips <script> tags and their content", () => {
    const html = render("Hello <script>alert('xss')</script> world");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert('xss')");
    expect(html).toContain("Hello");
    expect(html).toContain("world");
  });

  it("strips inline event handlers but keeps the image", () => {
    const html = render('![pic](https://example.com/a.png)\n\n<img src="https://example.com/b.png" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("https://example.com/a.png");
  });

  it("drops <iframe> entirely", () => {
    const html = render('<iframe src="https://evil.example.com"></iframe>text');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("evil.example.com");
    expect(html).toContain("text");
  });

  it("neutralizes javascript: links (href removed, text kept)", () => {
    const html = render('<a href="javascript:alert(1)">click</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("drops <style>, <form> and <object>", () => {
    const html = render('<style>body{display:none}</style><form action="x"><object data="y"></object></form>keep');
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<object");
    expect(html).not.toContain("display:none");
    expect(html).toContain("keep");
  });

  it("keeps underline, links, blockquote and headings", () => {
    const html = render('<u>under</u>\n\n[link](https://example.com)\n\n> quote\n\n#### H4');
    expect(html).toContain("<u>under</u>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<h4>H4</h4>");
  });

  it("keeps task-list checkboxes (disabled) and strips a rogue text input", () => {
    const html = render("- [ ] todo\n- [x] done");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).toContain("checked");
    const rogue = render('<input type="text" value="x">after');
    expect(rogue).not.toContain('type="text"');
    expect(rogue).toContain("after");
  });

  it("keeps http(s) images but drops data: image sources", () => {
    const ok = render("![a](https://example.com/p.png)");
    expect(ok).toContain('src="https://example.com/p.png"');
    const data = render('<img src="data:image/svg+xml,<svg onload=alert(1)>">keep');
    expect(data).not.toContain("data:image");
    expect(data).toContain("keep");
  });

  it("keeps fenced code and GFM tables", () => {
    const html = render("```\ncode here\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("code here");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });
});

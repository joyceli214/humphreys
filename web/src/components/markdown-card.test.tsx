// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownContent } from "./markdown-card";

describe("MarkdownContent", () => {
  it("renders a task-list checkbox without a bullet (no double marker)", () => {
    const { container } = render(<MarkdownContent value={"- [ ] Replace filter\n- [x] Test unit"} />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    // Every task-list item has its bullet suppressed (no bullet + checkbox).
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    items.forEach((li) => expect(li.className).toContain("list-none"));
    // The wrapping <ul> also drops its disc so no bullet shows.
    expect(container.querySelector("ul")?.className).toContain("list-none");
  });

  it("still shows bullets for ordinary list items", () => {
    const { container } = render(<MarkdownContent value={"- Plain one\n- Plain two"} />);
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    items.forEach((li) => expect(li.className).not.toContain("list-none"));
  });

  it("renders underline and strips dangerous markup (sanitized)", () => {
    const { container } = render(
      <MarkdownContent value={'<u>under</u>\n\n<script>alert(1)</script><iframe src="https://evil.example"></iframe>'} />
    );
    expect(container.querySelector("u")?.textContent).toBe("under");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("renders a zoomable image and fires the click handler", () => {
    const onImageClick = vi.fn();
    const { container } = render(
      <MarkdownContent value={"![a photo](https://example.com/p.png)"} onImageClick={onImageClick} />
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.com/p.png");
    container.querySelector("button")?.click();
    expect(onImageClick).toHaveBeenCalledWith("https://example.com/p.png", "a photo");
  });
});

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai-tools/mass-update-tab", () => ({ MassUpdateTab: () => <div>mass update panel</div> }));
vi.mock("@/components/ai-tools/advanced-search-tab", () => ({ AdvancedSearchTab: () => <div>advanced search panel</div> }));
vi.mock("@/components/ai-tools/email-drafts-tab", () => ({ EmailDraftsTab: () => <div>email drafts panel</div> }));

import AIToolsPage from "@/pages/ai-tools-page";
import { AI_TOOLS_WINDOW_NAME } from "@/lib/ai-tools/access";

afterEach(cleanup);

describe("AIToolsPage", () => {
  it("is titled Management (heading and document title)", () => {
    render(<AIToolsPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Management$/);
    expect(document.title).toBe("Management");
    expect(screen.queryByText(/AI Tools/)).toBeNull();
  });

  it("shows Advanced Search instead of the old Job Summary tab", () => {
    render(<AIToolsPage />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Mass Update",
      "Advanced Search",
      "Customer Email Drafts"
    ]);
    expect(screen.queryByRole("tab", { name: /job summary/i })).toBeNull();
    expect(screen.queryByText(/job summary/i)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Advanced Search" }));
    expect(screen.getByRole("tab", { name: "Advanced Search" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("advanced search panel")).toBeVisible();
  });

  it("scrolls without a height cap: sticky header/tab bar, no max-h or overflow clipping around the panels", () => {
    const { container } = render(<AIToolsPage />);
    const sticky = screen.getByTestId("ai-tools-sticky-header");
    expect(sticky).toHaveClass("sticky", "top-0");
    expect(sticky).toContainElement(screen.getByRole("tablist"));
    const panel = screen.getByRole("tabpanel");
    for (let el: HTMLElement | null = panel; el && el !== container; el = el.parentElement) {
      expect(el.className).not.toMatch(/\bmax-h-|\boverflow-hidden\b|\boverflow-y-|(?:^|\s)h-(?:screen|\[)/);
    }
  });

  it("fills the whole pane: no max-width centering, full-height flex column down to the active panel", () => {
    const { container } = render(<AIToolsPage />);
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/\bmax-w-|\bmx-auto\b/);
    }
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("flex", "flex-col", "min-h-[100dvh]");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveClass("flex", "flex-1", "flex-col");
    for (const hidden of screen.getAllByRole("tabpanel", { hidden: true }).filter((p) => p !== panel)) {
      expect(hidden).toHaveAttribute("hidden");
      expect(hidden).toHaveClass("hidden");
      expect(hidden).not.toHaveClass("flex");
    }
  });

  it("hides Dock back outside the pop-out window", () => {
    render(<AIToolsPage />);
    expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  });

  it("shows Dock back in the named pop-out window", () => {
    const prev = window.name;
    window.name = AI_TOOLS_WINDOW_NAME;
    try {
      render(<AIToolsPage />);
      expect(screen.getByRole("button", { name: "Dock back" })).toBeInTheDocument();
    } finally {
      window.name = prev;
    }
  });
});

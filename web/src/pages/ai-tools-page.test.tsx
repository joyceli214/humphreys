import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailDraftTarget } from "@/lib/ai-tools/types";

vi.mock("@/components/ai-tools/mass-update-tab", () => ({ MassUpdateTab: () => <div>mass update panel</div> }));
vi.mock("@/components/ai-tools/advanced-search-tab", () => ({ AdvancedSearchTab: () => <div>advanced search panel</div> }));
vi.mock("@/components/ai-tools/email-drafts-tab", () => ({
  EmailDraftsTab: ({ target }: { target: EmailDraftTarget | null }) => (
    <div>email drafts panel{target ? ` target #${target.referenceId} ${target.type}` : ""}</div>
  )
}));

import AIToolsPage from "@/pages/ai-tools-page";
import { AI_TOOLS_WINDOW_NAME } from "@/lib/ai-tools/access";
import { PENDING_EMAIL_DRAFT_KEY, queueEmailDraft } from "@/lib/ai-tools/open-email-drafts";

const draftJob = { referenceId: 42, customerId: 7, customerName: "Jane Doe", equipment: "Receiver", status: "In Progress" };

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

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

  describe("Draft email handoff from a work order", () => {
    it("opens on Customer Email Drafts with the queued job when a draft is pending at load", () => {
      queueEmailDraft(draftJob, "progress_update");
      render(<AIToolsPage />);
      expect(screen.getByRole("tab", { name: "Customer Email Drafts" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("email drafts panel target #42 progress_update")).toBeVisible();
      expect(window.localStorage.getItem(PENDING_EMAIL_DRAFT_KEY)).toBeNull();
    });

    it("stays on Mass Update with no pending draft", () => {
      render(<AIToolsPage />);
      expect(screen.getByRole("tab", { name: "Mass Update" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("email drafts panel")).not.toBeVisible();
    });

    it("switches an already-open page to email drafts on the storage event", () => {
      render(<AIToolsPage />);
      expect(screen.getByRole("tab", { name: "Mass Update" })).toHaveAttribute("aria-selected", "true");

      queueEmailDraft(draftJob, "progress_update");
      act(() => {
        window.dispatchEvent(
          new StorageEvent("storage", { key: PENDING_EMAIL_DRAFT_KEY, newValue: window.localStorage.getItem(PENDING_EMAIL_DRAFT_KEY) })
        );
      });
      expect(screen.getByRole("tab", { name: "Customer Email Drafts" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("email drafts panel target #42 progress_update")).toBeVisible();

      // A second Draft email (another job) while already on the tab still updates the target.
      queueEmailDraft({ ...draftJob, referenceId: 43 }, "progress_update");
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(screen.getByText("email drafts panel target #43 progress_update")).toBeVisible();
    });

    it("ignores unrelated storage keys", () => {
      render(<AIToolsPage />);
      queueEmailDraft(draftJob, "progress_update");
      act(() => {
        window.dispatchEvent(new StorageEvent("storage", { key: "something-else", newValue: "1" }));
      });
      expect(screen.getByRole("tab", { name: "Mass Update" })).toHaveAttribute("aria-selected", "true");
    });
  });
});

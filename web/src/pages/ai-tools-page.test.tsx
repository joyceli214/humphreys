import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailDraftTarget } from "@/lib/ai-tools/types";

vi.mock("@/components/ai-tools/mass-update-tab", () => ({ MassUpdateTab: () => <div>mass update panel</div> }));
vi.mock("@/components/ai-tools/advanced-search-tab", () => ({ AdvancedSearchTab: () => <div>advanced search panel</div> }));
vi.mock("@/components/ai-tools/ask/ask-tab", () => ({ AskTab: () => <div>ask panel</div> }));
vi.mock("@/components/ai-tools/email-flow/email-tab", () => ({
  EmailTab: ({ target }: { target: EmailDraftTarget | null }) => (
    <div>email panel{target ? ` target #${target.referenceId} ${target.type}` : ""}</div>
  )
}));

import AIToolsPage from "@/pages/ai-tools-page";
import { AI_TOOLS_WINDOW_NAME } from "@/lib/ai-tools/access";
import { PENDING_EMAIL_DRAFT_KEY, queueEmailDraft } from "@/lib/ai-tools/open-email-drafts";

const draftJob = { referenceId: 42, customerId: 7, customerName: "Test Customer A", equipment: "Receiver", status: "In Progress" };

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function openMore() {
  const more = screen.getByRole("button", { name: "More" });
  fireEvent.click(more);
  return more;
}

describe("AIToolsPage", () => {
  it("is titled Management (heading and document title)", () => {
    render(<AIToolsPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Management$/);
    expect(document.title).toBe("Management");
  });

  it("has two tabs, Ask and Email, with Ask selected by default", () => {
    render(<AIToolsPage />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Ask", "Email"]);
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ask panel")).toBeVisible();
    expect(screen.getByText("email panel")).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("email panel")).toBeVisible();
  });

  it("keeps the header sticky and does not clip the panels", () => {
    const { container } = render(<AIToolsPage />);
    const sticky = screen.getByTestId("ai-tools-sticky-header");
    expect(sticky).toHaveClass("sticky", "top-0");
    expect(sticky).toContainElement(screen.getByRole("tablist"));
    const panel = screen.getByRole("tabpanel");
    for (let el: HTMLElement | null = panel; el && el !== container; el = el.parentElement) {
      expect(el.className).not.toMatch(/\bmax-h-|\boverflow-hidden\b|\boverflow-y-|(?:^|\s)h-(?:screen|\[)/);
    }
    expect(container.firstElementChild).toHaveClass("flex", "flex-col", "min-h-[100dvh]");
  });

  it("⋯ More reaches Mass Update and Advanced Search, with Back to Ask", () => {
    render(<AIToolsPage />);
    const more = openMore();
    expect(more).toHaveAttribute("aria-haspopup", "menu");
    expect(more).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Mass Update" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByText("mass update panel")).toBeVisible();
    expect(screen.getByText("ask panel")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText("ask panel")).toBeVisible();

    openMore();
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Advanced Search" }));
    expect(screen.getByText("advanced search panel")).toBeVisible();
  });

  it("links Email templates and Common contacts from the More menu", () => {
    render(<AIToolsPage />);
    openMore();
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Email templates" })).toHaveAttribute("href", "/email-templates");
    expect(within(menu).getByRole("menuitem", { name: "Common contacts" })).toHaveAttribute("href", "/email-common-contacts");
  });

  it("closes the More menu on Escape and returns focus to the button", () => {
    render(<AIToolsPage />);
    const more = openMore();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(more);
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
    it("opens on Email with the queued job when a draft is pending at load", () => {
      queueEmailDraft(draftJob, "progress_update");
      render(<AIToolsPage />);
      expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("email panel target #42 progress_update")).toBeVisible();
      expect(window.localStorage.getItem(PENDING_EMAIL_DRAFT_KEY)).toBeNull();
    });

    it("switches an already-open page to Email on the storage event, even from Mass Update", () => {
      render(<AIToolsPage />);
      openMore();
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Mass Update" }));
      queueEmailDraft(draftJob, "progress_update");
      act(() => {
        window.dispatchEvent(
          new StorageEvent("storage", { key: PENDING_EMAIL_DRAFT_KEY, newValue: window.localStorage.getItem(PENDING_EMAIL_DRAFT_KEY) })
        );
      });
      expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("email panel target #42 progress_update")).toBeVisible();
    });

    it("ignores unrelated storage keys", () => {
      render(<AIToolsPage />);
      queueEmailDraft(draftJob, "progress_update");
      act(() => {
        window.dispatchEvent(new StorageEvent("storage", { key: "something-else", newValue: "1" }));
      });
      expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute("aria-selected", "true");
    });
  });
});

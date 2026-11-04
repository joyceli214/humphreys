import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai-tools/mass-update-tab", () => ({ MassUpdateTab: () => <div>mass update panel</div> }));
vi.mock("@/components/ai-tools/advanced-search-tab", () => ({ AdvancedSearchTab: () => <div>advanced search panel</div> }));
vi.mock("@/components/ai-tools/email-drafts-tab", () => ({ EmailDraftsTab: () => <div>email drafts panel</div> }));

import AIToolsPage from "@/pages/ai-tools-page";

afterEach(cleanup);

describe("AIToolsPage", () => {
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
});

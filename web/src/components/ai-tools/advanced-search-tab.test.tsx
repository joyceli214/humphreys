import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AISearchResponse } from "@/lib/ai-tools/types";
import { EMPTY_SEARCH_FORM, formToFilters } from "@/lib/ai-tools/search-form";

const interpretAISearch = vi.fn();
const runAISearch = vi.fn();
const listWorkOrderStatuses = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    interpretAISearch: (...args: unknown[]) => interpretAISearch(...args),
    runAISearch: (...args: unknown[]) => runAISearch(...args),
    listWorkOrderStatuses: (...args: unknown[]) => listWorkOrderStatuses(...args)
  }
}));

import { AdvancedSearchTab } from "@/components/ai-tools/advanced-search-tab";

const EMPTY_RESULT: AISearchResponse = { filters: {}, rows: [], total: 0, limit: 200, offset: 0, group_by: "none", groups: [] };

beforeEach(() => {
  listWorkOrderStatuses.mockResolvedValue({
    items: [
      { id: 1, label: "Received" },
      { id: 2, label: "Ready for Pickup" }
    ]
  });
  runAISearch.mockResolvedValue(EMPTY_RESULT);
});

afterEach(() => {
  cleanup();
  interpretAISearch.mockReset();
  runAISearch.mockReset();
  listWorkOrderStatuses.mockReset();
});

describe("formToFilters", () => {
  it("omits empty fields and only sends the page limit for an empty form", () => {
    expect(formToFilters(EMPTY_SEARCH_FORM)).toEqual({ limit: 200 });
  });

  it("maps 'show original with follow-ups' to warranty only + include_linked", () => {
    expect(formToFilters({ ...EMPTY_SEARCH_FORM, warranty: "linked" })).toEqual({ warranty: "only", include_linked: true, limit: 200 });
    expect(formToFilters({ ...EMPTY_SEARCH_FORM, warranty: "exclude", minUnits: "abc" })).toEqual({ warranty: "exclude", limit: 200 });
  });
});

describe("AdvancedSearchTab", () => {
  it("sends the manually filled filter form as the search request body (no question needed)", async () => {
    render(<AdvancedSearchTab />);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "  Jane Doe " } });
    fireEvent.change(screen.getByLabelText("Model number"), { target: { value: "SR-5010" } });
    fireEvent.change(screen.getByLabelText("Serial number"), { target: { value: "ABC123" } });
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "Marantz" } });
    fireEvent.change(screen.getByLabelText("Equipment"), { target: { value: "receiver" } });
    fireEvent.click(await screen.findByRole("button", { name: "Ready for Pickup" }));
    fireEvent.change(screen.getByLabelText("Warranty"), { target: { value: "only" } });
    fireEvent.change(screen.getByLabelText("Customers with at least N units"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Created from"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Created to"), { target: { value: "2026-06-30" } });
    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "customer" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("0 jobs found")).toBeInTheDocument();
    expect(runAISearch).toHaveBeenCalledWith({
      customer_name: "Jane Doe",
      model: "SR-5010",
      serial: "ABC123",
      brand: "Marantz",
      equipment: "receiver",
      statuses: ["Ready for Pickup"],
      warranty: "only",
      min_units: 3,
      created_from: "2026-01-01",
      created_to: "2026-06-30",
      group_by: "customer",
      limit: 200
    });
    expect(screen.getByText(/No jobs match these filters/)).toBeInTheDocument();
    expect(interpretAISearch).not.toHaveBeenCalled();
  });

  it("fills the filters from Interpret, shows the explanation, and searches with any edits", async () => {
    interpretAISearch.mockResolvedValue({
      filters: { brand: "Marantz", equipment: "receiver", warranty: "only", include_linked: true, min_serial_jobs: 2, group_by: "serial" },
      explanation: "Warranty jobs on Marantz receivers, grouped by serial.",
      model: "test"
    });
    render(<AdvancedSearchTab />);
    fireEvent.change(screen.getByLabelText("What are you looking for?"), { target: { value: "warranty jobs on Marantz receivers" } });
    fireEvent.click(screen.getByRole("button", { name: "Interpret" }));

    expect(await screen.findByText(/Warranty jobs on Marantz receivers, grouped by serial\./)).toBeInTheDocument();
    expect(interpretAISearch).toHaveBeenCalledWith("warranty jobs on Marantz receivers");
    expect(screen.getByLabelText("Brand")).toHaveValue("Marantz");
    expect(screen.getByLabelText("Warranty")).toHaveValue("linked");
    expect(screen.getByLabelText("Group by")).toHaveValue("serial");
    expect(runAISearch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "Yamaha" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("0 jobs found");
    expect(runAISearch).toHaveBeenCalledWith({
      brand: "Yamaha",
      equipment: "receiver",
      warranty: "only",
      include_linked: true,
      min_serial_jobs: 2,
      group_by: "serial",
      limit: 200
    });
  });

  it("shows the server error when interpreting fails", async () => {
    interpretAISearch.mockRejectedValue(new Error("AI proposed an unsupported filter field \"email\" (502 /ai-tools/search/interpret)"));
    render(<AdvancedSearchTab />);
    fireEvent.change(screen.getByLabelText("What are you looking for?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Interpret" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/^AI proposed an unsupported filter field "email"$/);
    expect(within(alert).queryByText(/502/)).toBeNull();
  });
});

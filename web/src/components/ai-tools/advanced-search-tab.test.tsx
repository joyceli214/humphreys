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
    fireEvent.click(screen.getByRole("button", { name: "Status: Any" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Ready for Pickup" }));
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search statuses" }), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Status: Ready for Pickup" })).toBeInTheDocument();
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

  it("parses job numbers and the job ending into job_ids / job_suffix", async () => {
    render(<AdvancedSearchTab />);
    fireEvent.change(screen.getByLabelText("Job number(s)"), { target: { value: "31201, 31205 31201" } });
    fireEvent.change(screen.getByLabelText("Job number ends with"), { target: { value: " 07 " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("0 jobs found");
    expect(runAISearch).toHaveBeenCalledWith({ job_ids: [31201, 31205], job_suffix: "07", limit: 200 });
  });

  it("shows a clear error for invalid job numbers and blocks the search", () => {
    render(<AdvancedSearchTab />);
    fireEvent.change(screen.getByLabelText("Job number(s)"), { target: { value: "31201, abc" } });
    expect(screen.getByText(/"abc" is not a job number/)).toBeInTheDocument();
    expect(screen.getByLabelText("Job number(s)")).toHaveAttribute("aria-invalid", "true");
    const search = screen.getByRole("button", { name: "Search" });
    expect(search).toBeDisabled();
    fireEvent.submit(search.closest("form")!);
    expect(runAISearch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Job number(s)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Job number ends with"), { target: { value: "1x" } });
    expect(screen.getByText("Job number ending must contain digits only.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  });

  it("shows job_ids from Interpret in the Job number(s) field", async () => {
    interpretAISearch.mockResolvedValue({ filters: { job_ids: [31201, 31205] }, explanation: "Jobs 31201 and 31205.", model: "test" });
    render(<AdvancedSearchTab />);
    fireEvent.change(screen.getByLabelText("What are you looking for?"), { target: { value: "jobs 31201 31205" } });
    fireEvent.click(screen.getByRole("button", { name: "Interpret" }));
    await screen.findByText(/Jobs 31201 and 31205\./);
    expect(screen.getByLabelText("Job number(s)")).toHaveValue("31201, 31205");
  });

  it("caps every text box at the server limit with a live counter", () => {
    render(<AdvancedSearchTab />);
    const question = screen.getByLabelText("What are you looking for?");
    expect(question).toHaveAttribute("maxLength", "500");
    expect(screen.getByText("0 / 500")).toBeInTheDocument();
    fireEvent.change(question, { target: { value: "warranty jobs" } });
    expect(screen.getByText("13 / 500")).toBeInTheDocument();

    for (const label of ["Customer name", "Model number", "Serial number", "Brand", "Equipment", "Keyword (any field)"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("maxLength", "200");
    }
    expect(screen.getAllByText("0 / 200")).toHaveLength(6);
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "Marantz" } });
    expect(screen.getByText("7 / 200")).toBeInTheDocument();

    expect(screen.getByLabelText("Job number ends with")).toHaveAttribute("maxLength", "10");
    fireEvent.change(screen.getByLabelText("Job number ends with"), { target: { value: "123" } });
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    expect(screen.getByLabelText("Job number(s)")).toHaveAttribute("maxLength");
  });
});

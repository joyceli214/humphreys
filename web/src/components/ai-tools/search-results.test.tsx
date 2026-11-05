import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISearchResponse, AISearchRow } from "@/lib/ai-tools/types";
import { SearchResults } from "@/components/ai-tools/search-results";

afterEach(cleanup);

function row(overrides: Partial<AISearchRow>): AISearchRow {
  return {
    reference_id: 1,
    customer_id: 10,
    customer_name: "Jane Doe",
    equipment_name: "Receiver",
    brand_names: ["Marantz"],
    model_number: "SR-5010",
    serial_number: "S1",
    status_name: "Received",
    status_group: "to_do",
    created_at: "2026-03-15T12:00:00Z",
    is_warranty: false,
    original_job_id: null,
    warranty_job_ids: [],
    customer_job_count: 2,
    ...overrides
  };
}

const GROUPED: AISearchResponse = {
  filters: { group_by: "customer" },
  rows: [
    row({ reference_id: 101, warranty_job_ids: [102] }),
    row({ reference_id: 102, is_warranty: true, original_job_id: 101 }),
    row({ reference_id: 201, customer_id: 20, customer_name: "Bob Smith", model_number: "A-1", customer_job_count: 5 }),
    row({ reference_id: 301, customer_id: null, customer_name: "" })
  ],
  total: 4,
  limit: 200,
  offset: 0,
  group_by: "customer",
  groups: [
    { key: "10", label: "Jane Doe", unit_count: 2, job_ids: [101, 102] },
    { key: "20", label: "Bob Smith", unit_count: 5, job_ids: [201] }
  ]
};

describe("SearchResults", () => {
  it("renders one section per group with its header and unit count, plus ungrouped rows", () => {
    render(<SearchResults result={GROUPED} />);
    expect(screen.getByText("4 jobs found")).toBeInTheDocument();

    const jane = screen.getByRole("region", { name: "Customer: Jane Doe" });
    expect(within(jane).getByText("2 units")).toBeInTheDocument();
    expect(within(jane).getByRole("link", { name: "#101" })).toHaveAttribute("href", "/work-orders/101");
    expect(within(jane).getByRole("link", { name: "#102" })).toBeInTheDocument();
    expect(within(jane).getByText("Warranty of #101")).toBeInTheDocument();
    expect(within(jane).getByText("Follow-up: #102")).toBeInTheDocument();

    const bob = screen.getByRole("region", { name: "Customer: Bob Smith" });
    expect(within(bob).getByText("5 units")).toBeInTheDocument();
    expect(within(bob).getAllByRole("row")).toHaveLength(2); // header + 1 job
    expect(within(bob).getByText("A-1")).toBeInTheDocument();

    const other = screen.getByRole("region", { name: "No customer" });
    expect(within(other).getByRole("link", { name: "#301" })).toBeInTheDocument();
  });

  it("renders a single flat table when not grouped, and an empty state with no rows", () => {
    const flat = { ...GROUPED, group_by: "none" as const, groups: [] };
    const { unmount } = render(<SearchResults result={flat} />);
    expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Job",
      "Customer",
      "Equipment",
      "Model",
      "Serial",
      "Status",
      "Created",
      "Warranty"
    ]);
    unmount();

    render(<SearchResults result={{ ...flat, rows: [], total: 0 }} />);
    expect(screen.getByText(/No jobs match these filters/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("never caps or clips the results: no max-height/overflow-hidden; wide tables scroll horizontally", () => {
    const { container } = render(<SearchResults result={GROUPED} />);
    for (const table of screen.getAllByRole("table")) {
      expect(table.parentElement).toHaveClass("overflow-x-auto");
      for (let el: HTMLElement | null = table; el && el !== container; el = el.parentElement) {
        expect(el.className).not.toMatch(/\bmax-h-|\boverflow-hidden\b|\boverflow-y-(auto|scroll|hidden)\b|(?:^|\s)h-(?:\d|\[|screen)/);
      }
    }
  });
});

describe("SearchResults job links", () => {
  const originalParent = Object.getOwnPropertyDescriptor(window, "parent");

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalParent) Object.defineProperty(window, "parent", originalParent);
  });

  it("standalone: a plain click opens the job in a new tab", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<SearchResults result={GROUPED} />);
    const link = screen.getByRole("link", { name: "#101" });
    expect(fireEvent.click(link)).toBe(false); // default prevented
    expect(open).toHaveBeenCalledWith("/work-orders/101", "_blank");
  });

  it("embedded: a plain click posts to the parent portal and opens no tab", () => {
    const parentPost = vi.fn();
    const fakeParent = { location: { origin: window.location.origin }, closed: false, postMessage: parentPost };
    Object.defineProperty(window, "parent", { configurable: true, get: () => fakeParent });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<SearchResults result={GROUPED} />);
    expect(fireEvent.click(screen.getByRole("link", { name: "#201" }))).toBe(false);
    expect(parentPost).toHaveBeenCalledWith({ type: "humphreys-open-job", id: 201 }, window.location.origin);
    expect(open).not.toHaveBeenCalled();
  });

  it("modified clicks are left to the browser", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<SearchResults result={GROUPED} />);
    expect(fireEvent.click(screen.getByRole("link", { name: "#101" }), { ctrlKey: true })).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});

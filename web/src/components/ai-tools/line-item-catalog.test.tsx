import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getAILineItemCatalog = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: { getAILineItemCatalog: (...args: unknown[]) => getAILineItemCatalog(...args) }
}));

import { LineItemCatalog, catalogInstruction } from "@/components/ai-tools/line-item-catalog";

const ITEMS = [
  { name: "Belt Kit / Shipping", unit_price: 32, quantity_text: "1" },
  { name: "Audio Cable", unit_price: 1250.5, quantity_text: "", notes: "Used on most amps" }
];

afterEach(() => {
  cleanup();
  getAILineItemCatalog.mockReset();
});

describe("catalogInstruction", () => {
  it("builds an example instruction ending in 'to job '", () => {
    expect(catalogInstruction(ITEMS[0])).toBe('Add "Belt Kit / Shipping" at $32.00 (qty 1) to job ');
    expect(catalogInstruction(ITEMS[1])).toBe('Add "Audio Cable" at $1,250.50 (qty 1) to job ');
  });
});

describe("LineItemCatalog", () => {
  it("shows a loading state, then a table of items with a caption", async () => {
    getAILineItemCatalog.mockResolvedValue({ items: ITEMS });
    render(<LineItemCatalog onInsert={() => {}} />);
    expect(screen.getByText("Loading typical prices...")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Item", "Typical price", "Qty", "Insert"]);
    expect(within(table).getByText("Belt Kit / Shipping")).toBeInTheDocument();
    expect(within(table).getByText("$32.00")).toBeInTheDocument();
    expect(within(table).getByText("Used on most amps")).toBeInTheDocument();
    expect(screen.getByText("Typical prices from past jobs. The AI uses these when you name an item without a price.")).toBeInTheDocument();
  });

  it("calls onInsert with the example instruction for the row", async () => {
    getAILineItemCatalog.mockResolvedValue({ items: ITEMS });
    const onInsert = vi.fn();
    render(<LineItemCatalog onInsert={onInsert} />);
    fireEvent.click(await screen.findByRole("button", { name: "Insert Belt Kit / Shipping" }));
    expect(onInsert).toHaveBeenCalledWith('Add "Belt Kit / Shipping" at $32.00 (qty 1) to job ');
  });

  it("shows an error when the list cannot be loaded", async () => {
    getAILineItemCatalog.mockRejectedValue(new Error("boom (500 /ai-tools/line-item-catalog)"));
    render(<LineItemCatalog onInsert={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The typical prices could not be loaded.");
  });

  it("explains when there are no items yet", async () => {
    getAILineItemCatalog.mockResolvedValue({ items: [] });
    render(<LineItemCatalog onInsert={() => {}} />);
    expect(await screen.findByText("No typical prices are available yet.")).toBeInTheDocument();
  });
});

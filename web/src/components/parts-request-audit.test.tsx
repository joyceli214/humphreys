import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartsRequestHistory, PartsRequestWarnings } from "@/components/parts-request-audit";
import { apiClient } from "@/lib/api/client";
import type { PartsAuditEntry, PartsPurchaseRequest } from "@/lib/api/generated/types";

const request: PartsPurchaseRequest = {
  parts_purchase_request_id: 7, reference_id: 123, source: "supplier", source_url: null,
  status: "approved", total_price: 25, item_name: "Capacitor", quantity: 1,
  created_by_user_id: "creator-id", created_by_name: "Creator", created_at: null, updated_at: null,
  approved_at: null, ordered_at: null, arrived_at: null, used_at: null, cancelled_at: null, audit_flags: []
};
const requests = [request];
const entries: PartsAuditEntry[] = [
  { id: 1, parts_purchase_request_id: 7, reference_id: 123, action: "create", field: "status",
    old_value: null, new_value: "waiting_approval", changed_by_user_id: "creator-id", changed_by_name: "Creator",
    changed_at: "2026-10-09T12:00:00Z", after_approval: false },
  { id: 2, parts_purchase_request_id: 7, reference_id: 123, action: "update", field: "total_price",
    old_value: "10.00", new_value: "25.00", changed_by_user_id: "editor-id", changed_by_name: "Editor",
    changed_at: "2026-10-09T13:00:00Z", after_approval: true },
  { id: 3, parts_purchase_request_id: 8, reference_id: 123, action: "delete", field: "status",
    old_value: "approved", new_value: null, changed_by_user_id: "editor-id", changed_by_name: "Editor",
    changed_at: "2026-10-09T14:00:00Z", after_approval: false }
];

describe("parts request audit", () => {
  beforeEach(() => { vi.spyOn(apiClient, "getPartsPurchaseRequestHistory").mockResolvedValue(entries); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows both warning reasons and accepts requests without flags", () => {
    const { rerender } = render(<PartsRequestWarnings flags={["approved_without_review", "price_changed_after_approval"]} />);
    expect(screen.getByText("Approved without waiting for approval")).toBeVisible();
    expect(screen.getByText("Price changed after approval")).toBeVisible();
    rerender(<PartsRequestWarnings flags={undefined} />);
    expect(screen.queryByText("Price changed after approval")).toBeNull();
  });

  it("shows actor, time, old/new values and deleted request history, newest first", async () => {
    render(<PartsRequestHistory referenceID={123} requests={requests} />);
    fireEvent.click(screen.getByText("Parts request history"));
    await waitFor(() => expect(screen.getByRole("table")).toBeVisible());
    expect(apiClient.getPartsPurchaseRequestHistory).toHaveBeenCalledWith(123);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("delete")).toBeVisible();
    expect(within(rows[1]).getByText("$10.00")).toBeVisible();
    expect(within(rows[1]).getByText("$25.00")).toBeVisible();
    expect(within(rows[1]).getByText("Editor")).toHaveAttribute("title", "editor-id");
    expect(rows[1].querySelector("time")).toHaveAttribute("datetime", entries[1].changed_at);
    expect(within(rows[2]).getByText("waiting approval")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Request" }), { target: { value: "8" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "#8 · Deleted request" })).toBeInTheDocument();
  });

  it("refreshes history after a request change", async () => {
    const { rerender } = render(<PartsRequestHistory referenceID={123} requests={requests} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    rerender(<PartsRequestHistory referenceID={123} requests={[{ ...request, total_price: 30 }]} />);
    await waitFor(() => expect(apiClient.getPartsPurchaseRequestHistory).toHaveBeenCalledTimes(2));
  });

  it("shows a recoverable error instead of claiming history is empty", async () => {
    vi.mocked(apiClient.getPartsPurchaseRequestHistory).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce([]);
    render(<PartsRequestHistory referenceID={123} requests={requests} />);
    fireEvent.click(screen.getByText("Parts request history"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load parts request history.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No recorded changes.")).toBeVisible();
  });

  it("ignores a stale response when navigating to another work order", async () => {
    let resolveOld!: (value: PartsAuditEntry[]) => void;
    vi.mocked(apiClient.getPartsPurchaseRequestHistory)
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce([]);
    const { rerender } = render(<PartsRequestHistory referenceID={123} requests={requests} />);
    fireEvent.click(screen.getByText("Parts request history"));
    rerender(<PartsRequestHistory referenceID={456} requests={requests} />);
    expect(await screen.findByText("No recorded changes.")).toBeVisible();
    await act(async () => { resolveOld(entries); });
    expect(screen.queryByRole("table")).toBeNull();
  });
});

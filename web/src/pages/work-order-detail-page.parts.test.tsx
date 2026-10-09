import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError, apiClient } from "@/lib/api/client";
import type { PartsPurchaseRequest, WorkOrderDetail } from "@/lib/api/generated/types";
import WorkOrderDetailPage from "./work-order-detail-page";

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  hasPermission: (code: string): boolean => state.permissions.has(code),
  alerts: { error: vi.fn(), success: vi.fn() }
}));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ hasPermission: state.hasPermission, user: null }) }));
vi.mock("@/lib/alerts/alert-context", () => ({ useAlerts: () => state.alerts }));
vi.mock("@/components/ai-markdown-editor", () => ({ AIMarkdownEditor: () => null }));
// Keep action visibility in the rendered page without depending on menu positioning.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>
}));

// Render the form in its responsive container so the duplicate desktop/mobile
// layouts do not open two Radix portals in jsdom.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>
}));

const request: PartsPurchaseRequest = {
  parts_purchase_request_id: 7, reference_id: 123, source: "supplier", source_url: null,
  status: "waiting_approval", total_price: 25, item_name: "Capacitor", quantity: 1,
  created_by_user_id: "actor", created_by_name: "Actor", created_at: null, updated_at: "2026-10-09T12:00:00.123456Z",
  approved_at: null, ordered_at: null, arrived_at: null, used_at: null, cancelled_at: null, audit_flags: []
};
const detail = {
  reference_id: 123, warranty_job_ids: [], customer: {}, brand_ids: [], brand_names: [], worker_ids: [], worker_names: [],
  payment_method_ids: [], payment_method_names: [], line_items: [], deposit: 0
} as unknown as WorkOrderDetail;
function openPage() {
  return render(<><style>{".hidden { display: none; }"}</style><MemoryRouter initialEntries={["/work-orders/123"]}><Routes><Route path="/work-orders/:referenceId" element={<WorkOrderDetailPage />} /></Routes></MemoryRouter></>);
}

describe("parts request actions", () => {
  beforeEach(() => {
    state.permissions = new Set(["work_orders:read", "parts_purchase_requests:read", "parts_purchase_requests:update"]);
    state.alerts.error.mockReset();
    state.alerts.success.mockReset();
    vi.spyOn(apiClient, "getWorkOrderDetail").mockResolvedValue(detail);
    vi.spyOn(apiClient, "listDropdownManagement").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "listPartsPurchaseRequests").mockResolvedValue({ items: [request] });
    vi.spyOn(apiClient, "getPartsPurchaseRequestHistory").mockResolvedValue([]);
    vi.spyOn(apiClient, "generateWorkOrderAISummary").mockResolvedValue({ summary: "", model: "test", generated_at: "" });
    vi.spyOn(apiClient, "updatePartsPurchaseRequest").mockResolvedValue(request);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("sensitive read alone does not show approval or waiting-request cancellation", async () => {
    state.permissions.add("work_orders_sensitive:read");
    openPage();
    await screen.findAllByText("Capacitor");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel", exact: true })).toBeNull();
  });

  it("approve permission works without sensitive read and sends the original version", async () => {
    state.permissions.add("parts_purchase_requests:approve");
    openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(apiClient.updatePartsPurchaseRequest).toHaveBeenCalledWith(123, 7, expect.objectContaining({ status: "approved", updated_at: request.updated_at })));
    expect(screen.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  });

  it("refreshes a stale status change and asks the user to review it", async () => {
    state.permissions.add("parts_purchase_requests:approve");
    vi.mocked(apiClient.updatePartsPurchaseRequest).mockRejectedValueOnce(new APIError("stale", 409));
    vi.mocked(apiClient.listPartsPurchaseRequests).mockResolvedValueOnce({ items: [request] }).mockResolvedValue({ items: [{ ...request, status: "approved" }] });
    openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(state.alerts.error).toHaveBeenCalledWith("Parts request changed", expect.stringContaining("reopen it")));
    await screen.findByRole("button", { name: "Mark as Ordered" });
    expect(apiClient.listPartsPurchaseRequests).toHaveBeenCalledTimes(2);
    expect(state.alerts.success).not.toHaveBeenCalled();
  });

  it("keeps the version from opening the edit form and closes it on conflict", async () => {
    vi.mocked(apiClient.updatePartsPurchaseRequest).mockRejectedValueOnce(new APIError("stale", 409));
    openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    const [dialog] = await screen.findAllByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(apiClient.updatePartsPurchaseRequest).toHaveBeenCalledWith(123, 7, expect.objectContaining({ status: "waiting_approval", updated_at: request.updated_at })));
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
    expect(state.alerts.error).toHaveBeenCalledWith("Parts request changed", expect.stringContaining("reopen it"));
    expect(apiClient.listPartsPurchaseRequests).toHaveBeenCalledTimes(2);
  });

  it.each(["draft", "approved", "ordered", "arrived", "used"] as const)("offers cancellation from %s", async (status) => {
    vi.mocked(apiClient.listPartsPurchaseRequests).mockResolvedValue({ items: [{ ...request, status }] });
    openPage();
    await screen.findAllByText("Capacitor");
    expect(screen.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  });
});

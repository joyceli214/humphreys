import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api/client";
import type { WorkOrderDetail } from "@/lib/api/generated/types";
import { PortalWidthContext } from "@/components/layout/portal-width";
import WorkOrderDetailPage from "./work-order-detail-page";

// Stable identities: the page's load effects depend on these.
const state = vi.hoisted(() => {
  const permissions = new Set(["work_orders:read", "work_orders_sensitive:read", "parts_purchase_requests:read"]);
  return {
    auth: { hasPermission: (code: string) => permissions.has(code), user: null },
    alerts: { error: () => {}, success: () => {} }
  };
});
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/alerts/alert-context", () => ({ useAlerts: () => state.alerts }));
vi.mock("@/components/ai-markdown-editor", () => ({ AIMarkdownEditor: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />
}));

const detail = {
  reference_id: 123, warranty_job_ids: [], customer: {}, brand_ids: [], brand_names: [], worker_ids: [], worker_names: [],
  payment_method_ids: [], payment_method_names: [], line_items: [], deposit: 0
} as unknown as WorkOrderDetail;

function openPage(width: { availableWidth: number; contentWidth: number }) {
  return render(
    <>
      <style>{".hidden { display: none; }"}</style>
      <PortalWidthContext.Provider value={{ ...width, sidebarRef: () => {}, contentRef: () => {} }}>
        <MemoryRouter initialEntries={["/work-orders/123"]}>
          <Routes>
            <Route path="/work-orders/:referenceId" element={<WorkOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </PortalWidthContext.Provider>
    </>
  );
}

describe("work order layout follows portal width, not the viewport", () => {
  const originalWidth = window.innerWidth;
  beforeEach(() => {
    vi.spyOn(apiClient, "getWorkOrderDetail").mockResolvedValue(detail);
    vi.spyOn(apiClient, "listDropdownManagement").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "listPartsPurchaseRequests").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "getPartsPurchaseRequestHistory").mockResolvedValue([]);
    vi.spyOn(apiClient, "generateWorkOrderAISummary").mockResolvedValue({ summary: "", model: "test", generated_at: "" });
    // A wide desktop viewport: before the fix this alone decided the layout.
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1440 });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalWidth });
  });

  it("uses the existing mobile stack when the portal column is narrower than 1024 (Management docked)", async () => {
    openPage({ availableWidth: 900, contentWidth: 644 });
    await screen.findByText("Work Order #123");
    expect(screen.getByTestId("wo-layout-mobile")).toBeVisible();
    expect(screen.getByTestId("wo-layout-desktop")).not.toBeVisible();
  });

  it("uses the two-column grid when the portal column is at least 1024", async () => {
    openPage({ availableWidth: 1440, contentWidth: 1184 });
    await screen.findByText("Work Order #123");
    expect(screen.getByTestId("wo-layout-desktop")).toBeVisible();
    expect(screen.getByTestId("wo-layout-mobile")).not.toBeVisible();
  });
});

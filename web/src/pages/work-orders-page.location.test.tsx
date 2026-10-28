import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api/client";
import type { WorkOrderDetail, WorkOrderListItem } from "@/lib/api/generated/types";
import WorkOrdersPage from "./work-orders-page";

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  hasPermission: (code: string): boolean => state.permissions.has(code),
  alerts: { error: vi.fn(), success: vi.fn() }
}));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ hasPermission: state.hasPermission }) }));
vi.mock("@/lib/alerts/alert-context", () => ({ useAlerts: () => state.alerts }));

// Expose just enough of the location dropdown to assert whether it renders,
// whether "add location" is offered, and to trigger a location change.
vi.mock("@/components/work-order-dropdowns/single-searchable-dropdown", () => ({
  SingleSearchableDropdown: ({
    onChange,
    onAddLocation
  }: {
    onChange: (value: number | null) => void;
    onAddLocation?: unknown;
  }) => (
    <div>
      <button type="button" data-testid="loc-change" onClick={() => onChange(99)}>
        change-location
      </button>
      <span data-testid="has-add-location">{onAddLocation ? "yes" : "no"}</span>
    </div>
  )
}));
vi.mock("@/components/work-order-dropdowns/customer-searchable-dropdown", () => ({
  CustomerSearchableDropdown: () => null
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

const listItem = {
  reference_id: 123,
  customer_name: "Jane",
  customer_email: null,
  status: "Intake",
  status_group: "to_do",
  job_type: "Repair",
  item_name: "TV",
  brand_names: [],
  model_number: "X1",
  location_id: 5,
  location_shelf: "A",
  location_floor: 1,
  created_at: "2026-10-01"
} as unknown as WorkOrderListItem;

const updatedDetail = { location_id: 99, location_shelf: "B", location_floor: 2 } as unknown as WorkOrderDetail;

function openPage() {
  return render(
    <MemoryRouter initialEntries={["/work-orders"]}>
      <WorkOrdersPage />
    </MemoryRouter>
  );
}

describe("work orders list location editing", () => {
  beforeEach(() => {
    state.alerts.error.mockReset();
    state.alerts.success.mockReset();
    vi.spyOn(apiClient, "listWorkOrders").mockResolvedValue({ items: [listItem] });
    vi.spyOn(apiClient, "listDropdownManagement").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "updateWorkOrderLocation").mockResolvedValue(updatedDetail);
    vi.spyOn(apiClient, "updateWorkOrderEquipment").mockResolvedValue(updatedDetail);
    vi.spyOn(apiClient, "getWorkOrderDetail").mockResolvedValue(updatedDetail);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the dropdown for a location-only user, hides add-location, and calls the narrow route", async () => {
    state.permissions = new Set(["work_orders:read", "work_orders_location:update"]);
    openPage();
    const trigger = await screen.findByTestId("loc-change");
    expect(screen.getByTestId("has-add-location").textContent).toBe("no");

    fireEvent.click(trigger);
    await waitFor(() => expect(apiClient.updateWorkOrderLocation).toHaveBeenCalledWith(123, { location_id: 99 }));
    expect(apiClient.updateWorkOrderEquipment).not.toHaveBeenCalled();
    expect(apiClient.getWorkOrderDetail).not.toHaveBeenCalled();
  });

  it("shows the dropdown with add-location for a full work_orders:update user and uses the narrow route", async () => {
    state.permissions = new Set(["work_orders:read", "work_orders:update"]);
    openPage();
    const trigger = await screen.findByTestId("loc-change");
    expect(screen.getByTestId("has-add-location").textContent).toBe("yes");

    fireEvent.click(trigger);
    await waitFor(() => expect(apiClient.updateWorkOrderLocation).toHaveBeenCalledWith(123, { location_id: 99 }));
  });

  it("does not render the dropdown for a user without any update permission", async () => {
    state.permissions = new Set(["work_orders:read"]);
    openPage();
    await screen.findByText("Jane");
    expect(screen.queryByTestId("loc-change")).toBeNull();
  });
});

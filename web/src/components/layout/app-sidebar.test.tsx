import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/components/layout/app-sidebar";

type MockAuth = { loading: boolean; user: { id: string } | null; scope: string[] };
let auth: MockAuth;

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({ ...auth, hasPermission: (p: string) => auth.scope.includes(p) })
}));

const OWNER_SCOPE = ["work_orders:read", "work_orders:update", "work_orders_sensitive:read", "users:read", "roles:read"];
const STAFF_SCOPE = ["work_orders:read", "work_orders_location:update"];

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AppSidebar />
    </MemoryRouter>
  );
}

beforeEach(() => {
  auth = { loading: false, user: { id: "u1" }, scope: OWNER_SCOPE };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppSidebar Management row", () => {
  it("shows the Management button in its own row below the header for owners", () => {
    renderSidebar();

    const row = screen.getByTestId("sidebar-management-row");
    const button = within(row).getByRole("button", { name: "Management" });
    expect(button).toHaveClass("w-full");

    const header = screen.getByText("Control Center").closest("[data-testid='sidebar-header']") as HTMLElement;
    expect(header).toBeInTheDocument();
    expect(header).not.toContainElement(button);
    expect(within(header).queryByRole("button", { name: "Management" })).not.toBeInTheDocument();
    // The row sits directly after the header.
    expect(header.nextElementSibling).toBe(row);

    // Nav still renders from the mocked scope.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Parts Requests" })).toBeInTheDocument();
  });

  it("renders no Management row for staff", () => {
    auth.scope = STAFF_SCOPE;
    renderSidebar();

    expect(screen.queryByTestId("sidebar-management-row")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Management" })).not.toBeInTheDocument();
    expect(screen.getByText("Control Center")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Work Orders" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Parts Requests" })).not.toBeInTheDocument();
  });
});

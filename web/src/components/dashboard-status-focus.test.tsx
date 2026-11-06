import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardStatusCount } from "@/lib/api/generated/types";

const getUserPreference = vi.fn();
const saveUserPreference = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    getUserPreference: (...args: unknown[]) => getUserPreference(...args),
    saveUserPreference: (...args: unknown[]) => saveUserPreference(...args)
  }
}));

import { DashboardStatusFocus } from "@/components/dashboard-status-focus";
import {
  STATUS_FOCUS_PREFERENCE_KEY,
  STATUS_FOCUS_STORAGE_PREFIX,
  defaultStatusFocus,
  resolveStatusFocus,
  statusFocusPresets,
  statusFocusTotal
} from "@/lib/dashboard-status-focus";

// Seeded names (docs/sql/humphreys_cleanup_migration.sql) plus a shop-added staged status.
const STATUSES: DashboardStatusCount[] = [
  { status_id: 1, status: "Received", status_group: "to_do", count: 12 },
  { status_id: 2, status: "Finished", status_group: "completed", count: 7 },
  { status_id: 3, status: "Picked Up", status_group: "completed", count: 40 },
  { status_id: 4, status: "Waiting for pick up", status_group: "staged", count: 3 }
];

beforeEach(() => {
  getUserPreference.mockResolvedValue({ value: null });
  saveUserPreference.mockImplementation((_key: string, value: unknown) => Promise.resolve({ value }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("status focus helpers", () => {
  it("defaults to waiting-for-pickup + Finished and never matches 'Picked Up'", () => {
    expect(defaultStatusFocus(STATUSES)).toEqual([2, 4]);
    expect(statusFocusTotal(STATUSES, [2, 4])).toBe(10);
    expect(statusFocusPresets(STATUSES).map((p) => p.key)).toEqual(["waiting_pickup", "finished", "finished_or_waiting"]);
  });

  it("falls back to the first status when no preset matches, and drops deleted ids", () => {
    const only = [{ status_id: 9, status: "Received", status_group: "to_do", count: 1 }];
    expect(defaultStatusFocus(only)).toEqual([9]);
    expect(resolveStatusFocus([2, 99], STATUSES)).toEqual([2]);
    expect(resolveStatusFocus(null, STATUSES)).toEqual([2, 4]);
  });
});

describe("DashboardStatusFocus", () => {
  it("shows the default focus count and per-status breakdown", async () => {
    render(<DashboardStatusFocus statuses={STATUSES} loading={false} userKey="u1" />);
    const block = screen.getByRole("region", { name: "Status focus" });
    expect(within(block).getByText("Finished + Waiting for pick up")).toBeInTheDocument();
    expect(within(block).getByText("10")).toBeInTheDocument();
    await waitFor(() => expect(getUserPreference).toHaveBeenCalledWith(STATUS_FOCUS_PREFERENCE_KEY));
  });

  it("uses the saved per-user preference from the server", async () => {
    getUserPreference.mockResolvedValue({ value: { status_ids: [1] } });
    render(<DashboardStatusFocus statuses={STATUSES} loading={false} userKey="u1" />);
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(window.localStorage.getItem(STATUS_FOCUS_STORAGE_PREFIX + "u1")).toBe(JSON.stringify({ status_ids: [1] }));
  });

  it("lets the user choose statuses and saves the choice", async () => {
    render(<DashboardStatusFocus statuses={STATUSES} loading={false} userKey="u1" />);
    await waitFor(() => expect(getUserPreference).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Choose statuses" }));
    fireEvent.click(screen.getByRole("button", { name: "Finished" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Received/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("19")).toBeInTheDocument();
    await waitFor(() => expect(saveUserPreference).toHaveBeenCalledWith(STATUS_FOCUS_PREFERENCE_KEY, { status_ids: [1, 2] }));
    expect(window.localStorage.getItem(STATUS_FOCUS_STORAGE_PREFIX + "u1")).toBe(JSON.stringify({ status_ids: [1, 2] }));
  });

  it("keeps the local choice when the server save fails", async () => {
    saveUserPreference.mockRejectedValue(new Error("offline"));
    render(<DashboardStatusFocus statuses={STATUSES} loading={false} userKey="u2" />);
    await waitFor(() => expect(getUserPreference).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Choose statuses" }));
    fireEvent.click(screen.getByRole("button", { name: "Waiting for pickup" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Saved on this device only/)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(window.localStorage.getItem(STATUS_FOCUS_STORAGE_PREFIX + "u2")).toBe(JSON.stringify({ status_ids: [4] }));
  });

  it("always shows the settings button, and says it couldn't load when status_counts is missing", async () => {
    render(<DashboardStatusFocus statuses={undefined} loading={false} userKey="u1" />);
    const block = screen.getByRole("region", { name: "Status focus" });
    expect(within(block).getByRole("alert")).toHaveTextContent("Couldn't load statuses");
    expect(within(block).getByText("—")).toBeInTheDocument();
    expect(within(block).queryByText("0")).not.toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: "Choose statuses" }));
    expect(within(block).getByText(/Couldn't load statuses/)).toBeInTheDocument();
    expect(within(block).getByRole("button", { name: "Save" })).toBeDisabled();
    await waitFor(() => expect(getUserPreference).toHaveBeenCalled());
  });

  it("does not show a silent 0 when the dashboard load failed", async () => {
    render(<DashboardStatusFocus statuses={STATUSES} loading={false} error userKey="u1" />);
    const block = screen.getByRole("region", { name: "Status focus" });
    expect(within(block).getByRole("alert")).toHaveTextContent("Couldn't load statuses");
    expect(within(block).queryByText("10")).not.toBeInTheDocument();
    expect(within(block).getByRole("button", { name: "Choose statuses" })).toBeInTheDocument();
    await waitFor(() => expect(getUserPreference).toHaveBeenCalled());
  });

  it("keeps the settings button when the shop has no statuses", async () => {
    render(<DashboardStatusFocus statuses={[]} loading={false} userKey="u1" />);
    expect(screen.getByText("No statuses to count yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose statuses" })).toBeInTheDocument();
    await waitFor(() => expect(getUserPreference).toHaveBeenCalled());
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api/client";
import WorkOrderCreatePage from "./work-order-create-page";

const state = vi.hoisted(() => ({
  hasPermission: () => true,
  alerts: { error: vi.fn(), success: vi.fn() }
}));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ hasPermission: state.hasPermission }) }));
vi.mock("@/lib/alerts/alert-context", () => ({ useAlerts: () => state.alerts }));
vi.mock("@/components/ai-markdown-editor", () => ({ AIMarkdownEditor: () => null }));

async function openNewCustomer() {
  render(<MemoryRouter initialEntries={["/work-orders/create?mode=new_job"]}><WorkOrderCreatePage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Create New", exact: true }));
}

async function chooseProvince(province: string, current = "Select province") {
  fireEvent.click(screen.getByRole("button", { name: current, exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: province, exact: true }));
}

describe("new customer city suggestions", () => {
  beforeEach(() => {
    state.alerts.error.mockReset();
    state.alerts.success.mockReset();
    vi.spyOn(apiClient, "listWorkOrders").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "listDropdownManagement").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "listPaymentMethods").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "listItems").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "listBrands").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "listLocations").mockResolvedValue({ items: [] });
    vi.spyOn(apiClient, "listCities").mockResolvedValue({ items: [{ id: 42, label: "Scarborough" }] });
    vi.spyOn(apiClient, "createCity").mockResolvedValue({ id: 43, label: "New City" });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("requires a province, searches the API, selects labels, and resets when province changes", async () => {
    await openNewCustomer();
    expect(screen.getByRole("button", { name: "Select province first" })).toBeDisabled();
    expect(apiClient.listCities).not.toHaveBeenCalled();
    await chooseProvince("Ontario");
    fireEvent.click(screen.getByRole("button", { name: "Select city or municipality" }));
    await screen.findByRole("button", { name: "Scarborough", exact: true });
    expect(apiClient.listCities).toHaveBeenCalledWith("Ontario", "");
    expect(screen.getByRole("button", { name: "+ Add new...", exact: true })).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "scar" } });
    await waitFor(() => expect(apiClient.listCities).toHaveBeenCalledWith("Ontario", "scar"));
    fireEvent.click(screen.getByRole("button", { name: "Scarborough", exact: true }));
    expect(screen.getByRole("button", { name: "Scarborough", exact: true })).toBeVisible();
    vi.mocked(apiClient.listCities).mockResolvedValue({ items: [{ id: 99, label: "Montréal" }] });
    await chooseProvince("Quebec", "Ontario");
    expect(screen.queryByRole("button", { name: "Scarborough", exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select city or municipality" }));
    await screen.findByRole("button", { name: "Montréal", exact: true });
    expect(apiClient.listCities).toHaveBeenLastCalledWith("Quebec", "");
  });

  it("creates and selects a new city label", async () => {
    await openNewCustomer();
    await chooseProvince("Ontario");
    fireEvent.click(screen.getByRole("button", { name: "Select city or municipality" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Add new...", exact: true }));
    fireEvent.change(screen.getByPlaceholderText("New item"), { target: { value: "New City" } });
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    await screen.findByRole("button", { name: "New City", exact: true });
    expect(apiClient.createCity).toHaveBeenCalledWith("Ontario", "New City");
  });

  it("allows free text after city list and creation failures", async () => {
    vi.mocked(apiClient.listCities).mockRejectedValue(new Error("Unavailable"));
    vi.mocked(apiClient.createCity).mockRejectedValue(new Error("Unavailable"));
    await openNewCustomer();
    await chooseProvince("Ontario");
    fireEvent.click(screen.getByRole("button", { name: "Select city or municipality" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add new...", exact: true }));
    fireEvent.change(screen.getByPlaceholderText("New item"), { target: { value: "My City" } });
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    await waitFor(() => expect(state.alerts.error).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "+ Other...", exact: true }));
    fireEvent.change(screen.getByPlaceholderText("Other item"), { target: { value: "My City" } });
    fireEvent.click(screen.getByRole("button", { name: "OK", exact: true }));
    expect(screen.getByRole("button", { name: "My City", exact: true })).toBeVisible();
  });

  it("ignores a city creation result after switching provinces", async () => {
    let finishCreate!: (city: { id: number; label: string }) => void;
    vi.mocked(apiClient.createCity).mockReturnValue(new Promise((resolve) => { finishCreate = resolve; }));
    await openNewCustomer();
    await chooseProvince("Ontario");
    fireEvent.click(screen.getByRole("button", { name: "Select city or municipality" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add new...", exact: true }));
    fireEvent.change(screen.getByPlaceholderText("New item"), { target: { value: "Ontario City" } });
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    await waitFor(() => expect(apiClient.createCity).toHaveBeenCalled());
    await chooseProvince("Quebec", "Ontario");
    finishCreate({ id: 55, label: "Ontario City" });
    await waitFor(() => expect(state.alerts.success).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Select city or municipality" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Ontario City", exact: true })).toBeNull();
  });
});

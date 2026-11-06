import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAV_ENTRIES, visibleNavEntries } from "@/lib/auth/authorization";

const listEmailCommonContacts = vi.fn();
const createEmailCommonContact = vi.fn();
const updateEmailCommonContact = vi.fn();
const deleteEmailCommonContact = vi.fn();
const alerts = { success: vi.fn(), error: vi.fn() };
const state = { scope: ["work_orders:read", "work_orders:update"] as string[] };

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    listEmailCommonContacts: (...args: unknown[]) => listEmailCommonContacts(...args),
    createEmailCommonContact: (...args: unknown[]) => createEmailCommonContact(...args),
    updateEmailCommonContact: (...args: unknown[]) => updateEmailCommonContact(...args),
    deleteEmailCommonContact: (...args: unknown[]) => deleteEmailCommonContact(...args)
  }
}));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ hasPermission: (p: string) => state.scope.includes(p) }) }));
vi.mock("@/lib/alerts/alert-context", () => ({ useAlerts: () => alerts }));

import EmailCommonContactsPage from "@/pages/email-common-contacts-page";

function contact(id: number, name: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, email, role: "staff", is_active: true, is_pinned: false, sort_order: 0,
    created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...extra
  };
}

beforeEach(() => {
  listEmailCommonContacts.mockResolvedValue({
    items: [contact(1, "Zed", "zed@shop.test"), contact(2, "Big Boss", "boss@shop.test", { role: "boss", is_pinned: true })],
    max_contacts: 100
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.scope = ["work_orders:read", "work_orders:update"];
});

describe("Common contacts nav", () => {
  it("sits right after Dropdown in Config and needs work_orders:update", () => {
    const index = NAV_ENTRIES.findIndex((entry) => entry.href === "/dropdown-management");
    expect(NAV_ENTRIES[index + 1]).toMatchObject({ href: "/email-common-contacts", label: "Common contacts", group: "config", readPermission: "work_orders:update" });
    expect(visibleNavEntries(["work_orders:read"]).some((entry) => entry.href === "/email-common-contacts")).toBe(false);
  });
});

describe("EmailCommonContactsPage", () => {
  it("blocks users without work_orders:update", () => {
    state.scope = ["work_orders:read"];
    render(<EmailCommonContactsPage />);
    expect(screen.getByText(/do not have permission/)).toBeInTheDocument();
    expect(listEmailCommonContacts).not.toHaveBeenCalled();
  });

  it("lists contacts pinned first with role badges", async () => {
    render(<EmailCommonContactsPage />);
    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]).getByText("Big Boss")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Boss 老闆")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Pinned")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Zed")).toBeInTheDocument();
  });

  it("adds a contact through the dialog and validates the email", async () => {
    createEmailCommonContact.mockResolvedValue(contact(3, "Books", "books@shop.test", { role: "other" }));
    render(<EmailCommonContactsPage />);
    await screen.findByText("Zed");
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Books" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "nope" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/plain email address/);
    expect(createEmailCommonContact).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "books@shop.test" } });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "other" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(createEmailCommonContact).toHaveBeenCalledWith({ name: "Books", email: "books@shop.test", role: "other", sort_order: 0, is_pinned: false })
    );
    expect(await screen.findByText("books@shop.test")).toBeInTheDocument();
  });

  it("shows the server error (e.g. duplicate email) inside the dialog", async () => {
    createEmailCommonContact.mockRejectedValue(new Error("a common contact with this email already exists (409 /catalog/email-common-contacts)"));
    render(<EmailCommonContactsPage />);
    await screen.findByText("Zed");
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Dup" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "zed@shop.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/already exists/);
  });

  it("deactivates and pins via PATCH", async () => {
    updateEmailCommonContact.mockImplementation((id: number, payload: Record<string, unknown>) =>
      Promise.resolve(contact(id, "Zed", "zed@shop.test", payload))
    );
    render(<EmailCommonContactsPage />);
    const zedRow = (await screen.findByText("Zed")).closest("tr")!;
    fireEvent.click(within(zedRow).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(updateEmailCommonContact).toHaveBeenCalledWith(1, { is_active: false }));
    expect(await within(screen.getByText("Zed").closest("tr")!).findByText("Inactive")).toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    deleteEmailCommonContact.mockResolvedValue(undefined);
    render(<EmailCommonContactsPage />);
    const zedRow = (await screen.findByText("Zed")).closest("tr")!;
    fireEvent.click(within(zedRow).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteEmailCommonContact).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText("Zed")).toBeNull());
  });
});

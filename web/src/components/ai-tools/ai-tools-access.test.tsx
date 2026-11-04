import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIToolsButton } from "@/components/ai-tools/ai-tools-button";
import { AIToolsGuard } from "@/components/ai-tools/ai-tools-guard";
import { ManagementPaneProvider, ManagementSplit } from "@/components/ai-tools/management-pane";
import { AI_TOOLS_WINDOW_NAME, canUseAITools } from "@/lib/ai-tools/access";

type MockAuth = { loading: boolean; user: { id: string } | null; scope: string[] };
let auth: MockAuth;

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({ ...auth, hasPermission: (p: string) => auth.scope.includes(p) })
}));

const OWNER_SCOPE = ["work_orders:read", "work_orders:update", "work_orders_sensitive:read", "users:read", "roles:read"];
const STAFF_SCOPE = ["work_orders:read", "work_orders_location:update"];

beforeEach(() => {
  auth = { loading: false, user: { id: "u1" }, scope: OWNER_SCOPE };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("canUseAITools", () => {
  it("allows owner/admin scope and denies staff scope", () => {
    expect(canUseAITools(OWNER_SCOPE)).toBe(true);
    expect(canUseAITools(STAFF_SCOPE)).toBe(false);
    expect(canUseAITools([])).toBe(false);
  });
});

describe("AIToolsButton", () => {
  it("is visible to owners/admins and opens a named separate window", () => {
    const focus = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({ focus } as unknown as Window);
    render(<AIToolsButton />);

    const button = screen.getByRole("button", { name: "Management" });
    expect(button).toHaveTextContent(/^Management$/);
    expect(button).toHaveAttribute("title", "Management");
    expect(screen.queryByText("✦ AI")).not.toBeInTheDocument();
    fireEvent.click(button);

    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0];
    expect(url).toBe("/ai-tools");
    expect(name).toBe(AI_TOOLS_WINDOW_NAME);
    expect(features).toContain("width=1100");
    expect(features).toContain("height=800");
    expect(focus).toHaveBeenCalled();
  });

  it("is hidden from staff", () => {
    auth.scope = STAFF_SCOPE;
    render(<AIToolsButton />);
    expect(screen.queryByRole("button", { name: "Management" })).not.toBeInTheDocument();
  });

  it("is hidden when signed out", () => {
    auth = { loading: false, user: null, scope: [] };
    render(<AIToolsButton />);
    expect(screen.queryByText("Management")).not.toBeInTheDocument();
  });

  it("has no aria-pressed outside a ManagementPaneProvider", () => {
    render(<AIToolsButton />);
    expect(screen.getByRole("button", { name: "Management" })).not.toHaveAttribute("aria-pressed");
  });
});

describe("AIToolsButton inside ManagementPaneProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1400 });
  });

  function renderWithPane() {
    return render(
      <ManagementPaneProvider>
        <AIToolsButton />
        <ManagementSplit>
          <p>Portal content</p>
        </ManagementSplit>
      </ManagementPaneProvider>
    );
  }

  it("toggles the in-portal pane instead of opening a window", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithPane();

    const button = screen.getByRole("button", { name: "Management" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("management-pane")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("management-pane")).toBeInTheDocument();
    const frame = screen.getByTestId("management-pane").querySelector("iframe");
    expect(frame).toHaveAttribute("title", "Management");
    expect(frame).toHaveAttribute("src", "/ai-tools");
    expect(screen.getByText("Portal content")).toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("management-pane")).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("is hidden from staff", () => {
    auth.scope = STAFF_SCOPE;
    renderWithPane();
    expect(screen.queryByRole("button", { name: "Management" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("management-pane")).not.toBeInTheDocument();
  });
});

function renderGuardedRoute() {
  return render(
    <MemoryRouter initialEntries={["/ai-tools"]}>
      <Routes>
        <Route
          path="/ai-tools"
          element={
            <AIToolsGuard>
              <p>AI tools content</p>
            </AIToolsGuard>
          }
        />
        <Route path="/dashboard" element={<p>Dashboard page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AIToolsGuard (/ai-tools route)", () => {
  it("renders the page for owners/admins", () => {
    renderGuardedRoute();
    expect(screen.getByText("AI tools content")).toBeInTheDocument();
  });

  it("redirects staff away without rendering the page", async () => {
    auth.scope = STAFF_SCOPE;
    renderGuardedRoute();
    expect(screen.queryByText("AI tools content")).not.toBeInTheDocument();
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("shows the session loader while auth is resolving", () => {
    auth = { loading: true, user: null, scope: [] };
    renderGuardedRoute();
    expect(screen.getByText("Loading session...")).toBeInTheDocument();
    expect(screen.queryByText("AI tools content")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no session", () => {
    auth = { loading: false, user: null, scope: [] };
    renderGuardedRoute();
    expect(screen.queryByText("AI tools content")).not.toBeInTheDocument();
  });
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedShell } from "@/components/layout/protected-shell";

type MockAuth = { loading: boolean; user: { id: string; full_name: string } | null; scope: string[] };
let auth: MockAuth;

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({ ...auth, hasPermission: (p: string) => auth.scope.includes(p), logout: vi.fn() })
}));

const OWNER_SCOPE = ["work_orders:read", "work_orders:update", "work_orders_sensitive:read", "users:read", "roles:read"];
const STAFF_SCOPE = ["work_orders:read", "work_orders_location:update"];

// Minimal ResizeObserver stub: tests push widths to observed elements by test id.
type Observed = { el: Element; cb: ResizeObserverCallback; observer: ResizeObserver };
let observed: Observed[] = [];
class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    observed.push({ el, cb: this.cb, observer: this as unknown as ResizeObserver });
  }
  unobserve() {}
  disconnect() {
    observed = observed.filter((o) => o.observer !== (this as unknown as ResizeObserver));
  }
}

function resize(testId: string, width: number) {
  act(() => {
    for (const o of observed.filter((x) => x.el.getAttribute("data-testid") === testId)) {
      o.cb([{ target: o.el, contentRect: { width } } as unknown as ResizeObserverEntry], o.observer);
    }
  });
}

/** Simulates the browser: the sidebar wrapper is 256px when shown, 0 when hidden. */
function layoutPortal(available: number) {
  const sidebar = isVisible("shell-sidebar") ? 256 : 0;
  resize("shell-sidebar", sidebar);
  resize("portal-column", available - sidebar);
}

function isVisible(testId: string) {
  return !screen.getByTestId(testId).classList.contains("hidden");
}

function renderShell() {
  return render(
    <>
      <style>{".hidden { display: none; }"}</style>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ProtectedShell>
          <p>Portal page</p>
        </ProtectedShell>
      </MemoryRouter>
    </>
  );
}

const originalRO = globalThis.ResizeObserver;
const originalWidth = window.innerWidth;

beforeEach(() => {
  observed = [];
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1400 });
  auth = { loading: false, user: { id: "u1", full_name: "Justin" }, scope: OWNER_SCOPE };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.ResizeObserver = originalRO;
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalWidth });
});

describe("ProtectedShell portal-width layout", () => {
  it("wide portal (Management closed on a desktop viewport) keeps the permanent sidebar", () => {
    renderShell();
    layoutPortal(1400);

    expect(screen.getByTestId("shell-sidebar")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
  });

  it("narrow portal beside docked Management on a wide viewport uses the mobile hamburger layout", () => {
    renderShell();
    // 1400px viewport, Management docked at ~45%: only ~760px left for the portal.
    layoutPortal(760);

    expect(screen.getByTestId("shell-sidebar")).not.toBeVisible();
    const menu = screen.getByRole("button", { name: "Open menu" });
    expect(menu).toBeVisible();

    // After the sidebar hides, the content column re-measures; the decision must not flip back.
    resize("shell-sidebar", 0);
    resize("portal-column", 760 - 256 * 0.45);
    expect(screen.getByTestId("shell-sidebar")).not.toBeVisible();

    fireEvent.click(menu);
    expect(screen.getByRole("button", { name: "Close menu overlay" })).toBeInTheDocument();
  });

  it("returns to the permanent sidebar once the portal is wide again", () => {
    renderShell();
    layoutPortal(700);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeVisible();

    layoutPortal(1200);
    expect(screen.getByTestId("shell-sidebar")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
  });

  it("applies the same rule without Management (staff)", () => {
    auth.scope = STAFF_SCOPE;
    renderShell();
    layoutPortal(600);
    expect(screen.getByTestId("shell-sidebar")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeVisible();

    layoutPortal(1024);
    expect(screen.getByTestId("shell-sidebar")).toBeVisible();
  });

  it("falls back to the viewport width before the first measurement", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 500 });
    renderShell();
    expect(screen.getByTestId("shell-sidebar")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeVisible();
  });
});

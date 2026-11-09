import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ManagementPaneProvider,
  ManagementSplit,
  useManagementPane
} from "@/components/ai-tools/management-pane";
import { AI_TOOLS_WINDOW_NAME } from "@/lib/ai-tools/access";
import { DOCK_STORAGE_KEY, RATIO_STORAGE_KEY } from "@/lib/ai-tools/split-pane";

const originalWidth = window.innerWidth;

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

function Harness() {
  const pane = useManagementPane();
  return (
    <>
      <button type="button" onClick={pane.toggle}>
        Toggle harness
      </button>
      <button type="button" onClick={pane.show}>
        Show harness
      </button>
    </>
  );
}

function renderSplit() {
  return render(
    <ManagementPaneProvider>
      <ManagementSplit>
        <div>
          <p>Portal content</p>
          <Harness />
        </div>
      </ManagementSplit>
    </ManagementPaneProvider>
  );
}

function openPane() {
  fireEvent.click(screen.getByRole("button", { name: "Toggle harness" }));
}

beforeEach(() => {
  window.localStorage.clear();
  setWidth(1400);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setWidth(originalWidth);
});

describe("ManagementSplit", () => {
  it("show() opens the pane and keeps it open when already open", () => {
    renderSplit();
    fireEvent.click(screen.getByRole("button", { name: "Show harness" }));
    expect(screen.getByTitle("Management")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show harness" }));
    expect(screen.getByTitle("Management")).toBeInTheDocument();
  });


  it("renders only children when closed", () => {
    renderSplit();
    expect(screen.getByText("Portal content")).toBeInTheDocument();
    expect(screen.queryByTestId("management-split")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Management")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("toggle opens the pane with the iframe and separator, toggling again closes", () => {
    renderSplit();
    openPane();

    const split = screen.getByTestId("management-split");
    expect(split).toHaveAttribute("data-dock", "right");
    const iframe = screen.getByTitle("Management");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe).toHaveAttribute("src", "/ai-tools");
    const sep = screen.getByRole("separator", { name: "Resize Management pane" });
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByTestId("management-pane")).toHaveStyle({ width: "40%" });
    expect(screen.getByText("Portal content")).toBeInTheDocument();

    openPane();
    expect(screen.queryByTestId("management-split")).not.toBeInTheDocument();
    expect(screen.getByText("Portal content")).toBeInTheDocument();
  });

  it("does not remount portal content when opening, re-docking or closing", () => {
    const mounts = vi.fn();
    function MountProbe() {
      React.useEffect(() => mounts(), []);
      return null;
    }
    render(
      <ManagementPaneProvider>
        <ManagementSplit>
          <MountProbe />
          <Harness />
        </ManagementSplit>
      </ManagementPaneProvider>
    );
    openPane();
    fireEvent.click(screen.getByRole("button", { name: "Dock left" }));
    openPane();
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("close button closes the pane", () => {
    renderSplit();
    openPane();
    fireEvent.click(screen.getByRole("button", { name: "Close Management" }));
    expect(screen.queryByTestId("management-split")).not.toBeInTheDocument();
  });

  it("dock toggle switches sides, reorders panes and persists", () => {
    renderSplit();
    openPane();
    const split = screen.getByTestId("management-split");
    expect(split.lastElementChild).toBe(screen.getByTestId("management-pane"));

    fireEvent.click(screen.getByRole("button", { name: "Dock left" }));
    expect(split).toHaveAttribute("data-dock", "left");
    expect(split.firstElementChild).toBe(screen.getByTestId("management-pane"));
    expect(window.localStorage.getItem(DOCK_STORAGE_KEY)).toBe("left");

    fireEvent.click(screen.getByRole("button", { name: "Dock right" }));
    expect(split).toHaveAttribute("data-dock", "right");
    expect(window.localStorage.getItem(DOCK_STORAGE_KEY)).toBe("right");
  });

  it("restores dock and ratio from localStorage", () => {
    window.localStorage.setItem(DOCK_STORAGE_KEY, "left");
    window.localStorage.setItem(RATIO_STORAGE_KEY, "0.6");
    renderSplit();
    openPane();
    expect(screen.getByTestId("management-split")).toHaveAttribute("data-dock", "left");
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "60");
  });

  it("keyboard arrows resize the pane (docked right), persist and clamp", () => {
    renderSplit();
    openPane();
    const sep = screen.getByRole("separator");

    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "45");
    expect(Number(window.localStorage.getItem(RATIO_STORAGE_KEY))).toBeCloseTo(0.45);

    fireEvent.keyDown(sep, { key: "ArrowRight" });
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep).toHaveAttribute("aria-valuenow", "35");

    for (let i = 0; i < 10; i++) fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep).toHaveAttribute("aria-valuenow", "25");
    for (let i = 0; i < 20; i++) fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "75");
    expect(Number(window.localStorage.getItem(RATIO_STORAGE_KEY))).toBeCloseTo(0.75);

    fireEvent.keyDown(sep, { key: "Home" });
    expect(sep).toHaveAttribute("aria-valuenow", "25");
    fireEvent.keyDown(sep, { key: "End" });
    expect(sep).toHaveAttribute("aria-valuenow", "75");
  });

  it("ArrowLeft shrinks the pane when docked left", () => {
    window.localStorage.setItem(DOCK_STORAGE_KEY, "left");
    renderSplit();
    openPane();
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "35");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep).toHaveAttribute("aria-valuenow", "45");
  });

  it("pointer drag on the separator resizes the pane", () => {
    renderSplit();
    openPane();
    const split = screen.getByTestId("management-split");
    vi.spyOn(split, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: 800,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect);
    const sep = screen.getByRole("separator");
    const iframe = screen.getByTitle("Management");

    fireEvent.pointerDown(sep, { clientX: 600, pointerId: 1 });
    expect(iframe).toHaveStyle({ pointerEvents: "none" });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 300 }));
    });
    // docked right: (1000 - 300) / 1000 = 0.7
    expect(sep).toHaveAttribute("aria-valuenow", "70");

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 50 }));
    });
    expect(sep).toHaveAttribute("aria-valuenow", "75");

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 50 }));
    });
    expect(iframe).not.toHaveStyle({ pointerEvents: "none" });
    expect(Number(window.localStorage.getItem(RATIO_STORAGE_KEY))).toBeCloseTo(0.75);

    // further moves after pointerup are ignored
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 600 }));
    });
    expect(sep).toHaveAttribute("aria-valuenow", "75");
  });

  it("Pop out opens the named window and closes the pane", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ focus: vi.fn() } as unknown as Window);
    renderSplit();
    openPane();
    fireEvent.click(screen.getByRole("button", { name: "Pop out" }));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe("/ai-tools");
    expect(open.mock.calls[0][1]).toBe(AI_TOOLS_WINDOW_NAME);
    expect(screen.queryByTestId("management-split")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Management")).not.toBeInTheDocument();
  });

  it("renders a full-screen overlay without a separator on narrow screens", () => {
    setWidth(600);
    renderSplit();
    openPane();

    const pane = screen.getByTestId("management-pane");
    expect(pane).toHaveAttribute("data-narrow", "true");
    expect(pane.className).toContain("fixed");
    expect(pane.className).toContain("inset-0");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByTitle("Management")).toHaveAttribute("src", "/ai-tools");
    expect(screen.getByText("Portal content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Management" }));
    expect(screen.queryByTestId("management-pane")).not.toBeInTheDocument();
  });
});

describe("useManagementPane outside a provider", () => {
  it("returns a safe no-op object", () => {
    let value: ReturnType<typeof useManagementPane> | undefined;
    function Probe() {
      value = useManagementPane();
      return null;
    }
    render(<Probe />);
    expect(value?.available).toBe(false);
    expect(value?.open).toBe(false);
    expect(() => {
      value?.toggle();
      value?.close();
      value?.setDock("left");
      value?.setRatio(0.5);
    }).not.toThrow();
  });
});

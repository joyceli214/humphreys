import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagementPaneProvider, ManagementSplit, useManagementPane } from "@/components/ai-tools/management-pane";
import { AI_TOOLS_WINDOW_NAME } from "@/lib/ai-tools/access";
import { DOCK_MANAGEMENT_MESSAGE, OPEN_JOB_MESSAGE } from "@/lib/ai-tools/management-messages";
import { DOCK_STORAGE_KEY, RATIO_STORAGE_KEY } from "@/lib/ai-tools/split-pane";
import { OPEN_PANE_ON_LOAD_KEY } from "@/lib/ai-tools/dock";

const originalWidth = window.innerWidth;
const ORIGIN = window.location.origin;

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
      <span data-testid="open-state">{pane.open ? "open" : "closed"}</span>
    </>
  );
}

function renderSplit(onOpenJob = vi.fn()) {
  const utils = render(
    <ManagementPaneProvider onOpenJob={onOpenJob}>
      <ManagementSplit>
        <div>
          <p>Portal content</p>
          <Harness />
        </div>
      </ManagementSplit>
    </ManagementPaneProvider>
  );
  return { ...utils, onOpenJob };
}

const isOpen = () => screen.getByTestId("open-state").textContent === "open";
const openPane = () => fireEvent.click(screen.getByRole("button", { name: "Toggle harness" }));
const frameWindow = () => (screen.getByTitle("Management") as HTMLIFrameElement).contentWindow!;

function post(data: unknown, source: unknown, origin = ORIGIN) {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

function fakePopup(props: Record<string, unknown> = {}) {
  return { name: AI_TOOLS_WINDOW_NAME, opener: window, closed: false, close: vi.fn(), focus: vi.fn(), ...props };
}

beforeEach(() => {
  window.localStorage.clear();
  setWidth(1400);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setWidth(originalWidth);
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
});

describe("open-job messages from the pane iframe", () => {
  it("navigates the portal and keeps the pane open", () => {
    const { onOpenJob } = renderSplit();
    openPane();
    post({ type: OPEN_JOB_MESSAGE, id: 31178 }, frameWindow());
    expect(onOpenJob).toHaveBeenCalledWith(31178);
    expect(isOpen()).toBe(true);
    expect(screen.getByTestId("management-split")).toBeInTheDocument();
  });

  it("rejects a foreign origin", () => {
    const { onOpenJob } = renderSplit();
    openPane();
    post({ type: OPEN_JOB_MESSAGE, id: 1 }, frameWindow(), "https://evil.example");
    post({ type: OPEN_JOB_MESSAGE, id: 1 }, frameWindow(), "null");
    expect(onOpenJob).not.toHaveBeenCalled();
  });

  it("rejects a source that is not the pane iframe or our pop-out", () => {
    const { onOpenJob } = renderSplit();
    openPane();
    post({ type: OPEN_JOB_MESSAGE, id: 1 }, window);
    post({ type: OPEN_JOB_MESSAGE, id: 1 }, null);
    post({ type: OPEN_JOB_MESSAGE, id: 1 }, { name: "other" });
    post({ type: OPEN_JOB_MESSAGE, id: 1 }, fakePopup({ opener: {} }));
    const stray = document.createElement("iframe");
    document.body.appendChild(stray);
    post({ type: OPEN_JOB_MESSAGE, id: 1 }, stray.contentWindow);
    stray.remove();
    expect(onOpenJob).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads", () => {
    const { onOpenJob } = renderSplit();
    openPane();
    const src = frameWindow();
    for (const data of [
      { type: OPEN_JOB_MESSAGE, id: "5" },
      { type: OPEN_JOB_MESSAGE, id: -5 },
      { type: OPEN_JOB_MESSAGE, id: 5.5 },
      { type: OPEN_JOB_MESSAGE, id: 5, extra: 1 },
      { type: "other", id: 5 },
      "humphreys-open-job"
    ]) {
      post(data, src);
    }
    expect(onOpenJob).not.toHaveBeenCalled();
  });

  it("ignores messages after the pane iframe is gone", () => {
    const { onOpenJob } = renderSplit();
    openPane();
    const src = frameWindow();
    openPane(); // close
    post({ type: OPEN_JOB_MESSAGE, id: 1 }, src);
    expect(onOpenJob).not.toHaveBeenCalled();
  });

  it("an iframe cannot request docking", () => {
    renderSplit();
    openPane();
    fireEvent.click(screen.getByRole("button", { name: "Close Management" }));
    expect(isOpen()).toBe(false);
    post({ type: DOCK_MANAGEMENT_MESSAGE }, window);
    expect(isOpen()).toBe(false);
  });
});

describe("messages from the pop-out window", () => {
  it("open-job from the pop-out we opened navigates the portal", () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const { onOpenJob } = renderSplit();
    openPane();
    fireEvent.click(screen.getByRole("button", { name: "Pop out" }));
    post({ type: OPEN_JOB_MESSAGE, id: 42 }, popup);
    expect(onOpenJob).toHaveBeenCalledWith(42);
  });

  it("accepts a pop-out opened before a portal reload (named window whose opener is this window)", () => {
    const { onOpenJob } = renderSplit();
    post({ type: OPEN_JOB_MESSAGE, id: 7 }, fakePopup());
    expect(onOpenJob).toHaveBeenCalledWith(7);
  });

  it("dock message re-opens the split pane with the saved side and width", () => {
    window.localStorage.setItem(DOCK_STORAGE_KEY, "left");
    window.localStorage.setItem(RATIO_STORAGE_KEY, "0.6");
    renderSplit();
    expect(isOpen()).toBe(false);
    post({ type: DOCK_MANAGEMENT_MESSAGE }, fakePopup());
    expect(isOpen()).toBe(true);
    expect(screen.getByTestId("management-split")).toHaveAttribute("data-dock", "left");
    expect(screen.getByTestId("management-pane")).toHaveStyle({ width: "60%" });
  });

  it("dock message is rejected from a foreign origin, unknown source or with extra keys", () => {
    renderSplit();
    post({ type: DOCK_MANAGEMENT_MESSAGE }, fakePopup(), "https://evil.example");
    post({ type: DOCK_MANAGEMENT_MESSAGE }, fakePopup({ name: "x" }));
    post({ type: DOCK_MANAGEMENT_MESSAGE }, fakePopup({ opener: null }));
    post({ type: DOCK_MANAGEMENT_MESSAGE, side: "left" }, fakePopup());
    expect(isOpen()).toBe(false);
  });

  it("opening the pane in the main window closes the existing pop-out", () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    renderSplit();
    openPane();
    fireEvent.click(screen.getByRole("button", { name: "Pop out" }));
    expect(isOpen()).toBe(false);
    expect(popup.close).not.toHaveBeenCalled();
    openPane();
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it("a pop-out known only from its messages is also closed when the pane opens", () => {
    renderSplit();
    const popup = fakePopup();
    post({ type: OPEN_JOB_MESSAGE, id: 3 }, popup);
    openPane();
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it("opens the pane on load when the dock-back flag is fresh", () => {
    window.localStorage.setItem(OPEN_PANE_ON_LOAD_KEY, String(Date.now()));
    renderSplit();
    expect(isOpen()).toBe(true);
    expect(window.localStorage.getItem(OPEN_PANE_ON_LOAD_KEY)).toBeNull();
  });
});

describe("docked layout: independent scrolling", () => {
  it.each(["right", "left"] as const)("docked %s: both sides are viewport-high and scroll on their own", (dock) => {
    window.localStorage.setItem(DOCK_STORAGE_KEY, dock);
    renderSplit();
    openPane();
    const split = screen.getByTestId("management-split");
    expect(split).toHaveClass("h-[100dvh]", "overflow-hidden", "min-h-0");
    const content = screen.getByTestId("management-content");
    const pane = screen.getByTestId("management-pane");
    for (const side of [content, pane]) {
      expect(side).toHaveClass("h-[100dvh]", "min-h-0", "overflow-y-auto");
      expect(side.className).not.toMatch(/\bsticky\b|max-h-/);
    }
    expect(screen.getByRole("separator")).toHaveClass("h-[100dvh]");
    const order = Array.from(split.children).map((el) => el.getAttribute("data-testid") ?? el.getAttribute("role"));
    expect(order).toEqual(
      dock === "left"
        ? ["management-pane", "separator", "management-content"]
        : ["management-content", "separator", "management-pane"]
    );
  });

  it("keeps the layout while dragging the divider", () => {
    renderSplit();
    openPane();
    fireEvent.pointerDown(screen.getByRole("separator"), { pointerId: 1, clientX: 800 });
    expect(screen.getByTestId("management-content")).toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("management-pane")).toHaveClass("overflow-y-auto");
    fireEvent.pointerUp(window);
  });

  it("locks document scrolling only while docked and restores it", () => {
    document.body.style.overflow = "scroll";
    renderSplit();
    expect(screen.getByTestId("management-content")).not.toHaveClass("overflow-y-auto");
    openPane();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    openPane();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("does not lock document scrolling in the narrow overlay", () => {
    setWidth(600);
    renderSplit();
    openPane();
    expect(document.body.style.overflow).toBe("");
  });
});

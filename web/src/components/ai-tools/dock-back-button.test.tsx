import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockBackButton } from "@/components/ai-tools/dock-back-button";
import { AI_TOOLS_WINDOW_NAME } from "@/lib/ai-tools/access";
import { DOCK_MANAGEMENT_MESSAGE } from "@/lib/ai-tools/management-messages";
import { takeOpenPaneOnLoad } from "@/lib/ai-tools/dock";

const ORIGIN = "https://portal.example";

function fakeWin(props: Record<string, unknown> = {}) {
  const w: Record<string, unknown> = {
    location: { origin: ORIGIN, assign: vi.fn() },
    closed: false,
    name: "",
    opener: null,
    close: vi.fn(),
    focus: vi.fn(),
    postMessage: vi.fn(),
    ...props
  };
  if (!("parent" in props)) w.parent = w;
  return w as unknown as Window & {
    close: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
    location: { assign: ReturnType<typeof vi.fn> };
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const button = () => screen.queryByRole("button", { name: "Dock back" });

describe("DockBackButton visibility", () => {
  it("shows in the pop-out (same-origin opener)", () => {
    render(<DockBackButton win={fakeWin({ opener: fakeWin() })} />);
    expect(button()).toBeInTheDocument();
  });

  it("shows in the named pop-out window even if the opener is gone", () => {
    render(<DockBackButton win={fakeWin({ name: AI_TOOLS_WINDOW_NAME })} />);
    expect(button()).toBeInTheDocument();
  });

  it("is hidden when embedded in the pane iframe", () => {
    render(<DockBackButton win={fakeWin({ parent: fakeWin() })} />);
    expect(button()).toBeNull();
  });

  it("is hidden in a standalone tab", () => {
    render(<DockBackButton win={fakeWin()} />);
    expect(button()).toBeNull();
  });

  it("is hidden in the real test window (standalone)", () => {
    render(<DockBackButton />);
    expect(button()).toBeNull();
  });
});

describe("DockBackButton click", () => {
  it("posts the dock message to the opener and closes the pop-out", () => {
    const opener = fakeWin();
    const win = fakeWin({ opener, name: AI_TOOLS_WINDOW_NAME });
    render(<DockBackButton win={win} />);
    fireEvent.click(button()!);
    expect(opener.postMessage).toHaveBeenCalledWith({ type: DOCK_MANAGEMENT_MESSAGE }, ORIGIN);
    expect(win.close).toHaveBeenCalled();
  });

  it("without an opener: navigates this window to the portal with the pane flagged open", () => {
    const win = fakeWin({ name: AI_TOOLS_WINDOW_NAME });
    render(<DockBackButton win={win} />);
    fireEvent.click(button()!);
    expect(win.close).not.toHaveBeenCalled();
    expect(win.location.assign).toHaveBeenCalledWith("/");
    expect(takeOpenPaneOnLoad()).toBe(true);
  });
});

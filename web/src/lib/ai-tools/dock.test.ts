import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_PANE_FLAG_TTL_MS,
  OPEN_PANE_ON_LOAD_KEY,
  dockBack,
  setOpenPaneOnLoad,
  takeOpenPaneOnLoad
} from "@/lib/ai-tools/dock";
import { DOCK_MANAGEMENT_MESSAGE } from "@/lib/ai-tools/management-messages";

const ORIGIN = "https://portal.example";

function fakeWin(props: Record<string, unknown> = {}) {
  const w: Record<string, unknown> = {
    location: { origin: ORIGIN, assign: vi.fn() },
    closed: false,
    name: "humphreys-ai-tools",
    opener: null,
    close: vi.fn(),
    focus: vi.fn(),
    postMessage: vi.fn(),
    ...props
  };
  w.parent = w;
  return w as unknown as Window & {
    close: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
    location: { origin: string; assign: ReturnType<typeof vi.fn> };
  };
}

beforeEach(() => window.localStorage.clear());

describe("open-pane-on-load flag", () => {
  it("is consumed once within the TTL", () => {
    setOpenPaneOnLoad(1000);
    expect(takeOpenPaneOnLoad(1500)).toBe(true);
    expect(takeOpenPaneOnLoad(1500)).toBe(false);
  });

  it("expires and ignores garbage", () => {
    setOpenPaneOnLoad(1000);
    expect(takeOpenPaneOnLoad(1000 + OPEN_PANE_FLAG_TTL_MS + 1)).toBe(false);
    window.localStorage.setItem(OPEN_PANE_ON_LOAD_KEY, "nope");
    expect(takeOpenPaneOnLoad()).toBe(false);
    expect(window.localStorage.getItem(OPEN_PANE_ON_LOAD_KEY)).toBeNull();
  });
});

describe("dockBack", () => {
  it("with a same-origin opener: posts the exact dock message, focuses it and closes the pop-out", () => {
    const opener = fakeWin({ name: "" });
    const win = fakeWin({ opener });
    expect(dockBack(win)).toBe("opener");
    expect(opener.postMessage).toHaveBeenCalledWith({ type: DOCK_MANAGEMENT_MESSAGE }, ORIGIN);
    expect(opener.focus).toHaveBeenCalled();
    expect(win.close).toHaveBeenCalled();
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it("opener gone: sets the flag, clears the pop-out name and navigates to the portal root", () => {
    const win = fakeWin({ opener: fakeWin({ closed: true }) });
    expect(dockBack(win)).toBe("navigated");
    expect(win.close).not.toHaveBeenCalled();
    expect(win.location.assign).toHaveBeenCalledWith("/");
    expect(win.name).toBe("");
    expect(takeOpenPaneOnLoad()).toBe(true);
  });
});

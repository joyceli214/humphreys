import { describe, expect, it, vi } from "vitest";
import { handleJobLinkClick, jobPath, openJobInPortal } from "@/lib/ai-tools/open-job";
import { OPEN_JOB_MESSAGE } from "@/lib/ai-tools/management-messages";

const ORIGIN = "https://portal.example";

function fakeWin(props: Record<string, unknown> = {}) {
  const w: Record<string, unknown> = {
    location: { origin: ORIGIN, assign: vi.fn() },
    closed: false,
    name: "",
    opener: null,
    open: vi.fn(),
    focus: vi.fn(),
    postMessage: vi.fn(),
    ...props
  };
  if (!("parent" in props)) w.parent = w;
  return w as unknown as Window & {
    open: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
    location: { origin: string; assign: ReturnType<typeof vi.fn> };
  };
}

function click(overrides: Partial<Record<"button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey", unknown>> = {}) {
  return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...overrides } as never as {
    button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: ReturnType<typeof vi.fn>;
  };
}

describe("openJobInPortal", () => {
  it("embedded: posts { type, id } to the same-origin parent with an explicit origin, no new tab", () => {
    const parent = fakeWin();
    const win = fakeWin({ parent });
    expect(openJobInPortal(42, win)).toBe("embedded");
    expect(parent.postMessage).toHaveBeenCalledWith({ type: OPEN_JOB_MESSAGE, id: 42 }, ORIGIN);
    expect(win.open).not.toHaveBeenCalled();
    expect(parent.location.assign).not.toHaveBeenCalled();
  });

  it("pop-out: posts to the same-origin opener and focuses it", () => {
    const opener = fakeWin();
    const win = fakeWin({ opener, name: "humphreys-ai-tools" });
    expect(openJobInPortal(7, win)).toBe("opener");
    expect(opener.postMessage).toHaveBeenCalledWith({ type: OPEN_JOB_MESSAGE, id: 7 }, ORIGIN);
    expect(opener.focus).toHaveBeenCalled();
    expect(win.open).not.toHaveBeenCalled();
  });

  it("pop-out: falls back to opener.location.assign if postMessage throws", () => {
    const opener = fakeWin({ postMessage: vi.fn(() => { throw new Error("nope"); }) });
    const win = fakeWin({ opener });
    expect(openJobInPortal(7, win)).toBe("opener");
    expect(opener.location.assign).toHaveBeenCalledWith(jobPath(7));
    expect(opener.focus).toHaveBeenCalled();
  });

  it("standalone: opens a new tab", () => {
    const win = fakeWin();
    expect(openJobInPortal(9, win)).toBe("new-tab");
    expect(win.open).toHaveBeenCalledWith("/work-orders/9", "_blank");
  });

  it("closed or cross-origin opener: opens a new tab", () => {
    const closed = fakeWin({ opener: fakeWin({ closed: true }) });
    expect(openJobInPortal(9, closed)).toBe("new-tab");
    const crossOpener = {
      closed: false,
      postMessage: vi.fn(),
      get location(): Location {
        throw new DOMException("Blocked", "SecurityError");
      }
    };
    const cross = fakeWin({ opener: crossOpener });
    expect(openJobInPortal(9, cross)).toBe("new-tab");
    expect(crossOpener.postMessage).not.toHaveBeenCalled();
  });

  it("cross-origin parent: does not post to it", () => {
    const parent = {
      postMessage: vi.fn(),
      get location(): Location {
        throw new DOMException("Blocked", "SecurityError");
      }
    };
    const win = fakeWin({ parent });
    expect(openJobInPortal(3, win)).toBe("new-tab");
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});

describe("handleJobLinkClick", () => {
  it("embedded: prevents default and posts to the parent", () => {
    const parent = fakeWin();
    const win = fakeWin({ parent });
    const event = click();
    expect(handleJobLinkClick(event, 5, win)).toBe("embedded");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.open).not.toHaveBeenCalled();
  });

  it("pop-out: prevents default and routes to the opener", () => {
    const opener = fakeWin();
    const event = click();
    expect(handleJobLinkClick(event, 5, fakeWin({ opener }))).toBe("opener");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(opener.postMessage).toHaveBeenCalled();
  });

  it("standalone: prevents default and opens a new tab", () => {
    const win = fakeWin();
    const event = click();
    expect(handleJobLinkClick(event, 5, win)).toBe("new-tab");
    expect(win.open).toHaveBeenCalledWith("/work-orders/5", "_blank");
  });

  it.each([{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }])(
    "leaves modified click %o to the browser",
    (mod) => {
      const parent = fakeWin();
      const event = click(mod);
      expect(handleJobLinkClick(event, 5, fakeWin({ parent }))).toBeNull();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(parent.postMessage).not.toHaveBeenCalled();
    }
  );
});

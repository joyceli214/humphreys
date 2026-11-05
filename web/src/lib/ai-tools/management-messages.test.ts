import { describe, expect, it } from "vitest";
import {
  DOCK_MANAGEMENT_MESSAGE,
  OPEN_JOB_MESSAGE,
  isDockManagementMessage,
  isFromOwnOrigin,
  isManagementPopout,
  isOpenJobMessage,
  isOwnManagementPopout,
  sameOriginOpener,
  sameOriginParent
} from "@/lib/ai-tools/management-messages";
import { AI_TOOLS_WINDOW_NAME } from "@/lib/ai-tools/access";

const ORIGIN = "https://portal.example";

type FakeWin = Record<string, unknown>;
function fakeWin(props: FakeWin = {}): Window {
  const w: FakeWin = { location: { origin: ORIGIN }, closed: false, name: "", opener: null, ...props };
  if (!("parent" in props)) w.parent = w;
  return w as unknown as Window;
}
function crossOriginWin(): Window {
  return {
    closed: false,
    get location(): Location {
      throw new DOMException("Blocked", "SecurityError");
    }
  } as unknown as Window;
}

describe("isOpenJobMessage", () => {
  it("accepts exactly { type, id } with a positive safe integer id", () => {
    expect(isOpenJobMessage({ type: OPEN_JOB_MESSAGE, id: 31178 })).toBe(true);
    expect(isOpenJobMessage({ id: 1, type: OPEN_JOB_MESSAGE })).toBe(true);
  });

  it.each([
    ["null", null],
    ["string payload", "humphreys-open-job"],
    ["array", [OPEN_JOB_MESSAGE, 1]],
    ["wrong type", { type: "humphreys-open", id: 1 }],
    ["dock type", { type: DOCK_MANAGEMENT_MESSAGE, id: 1 }],
    ["missing id", { type: OPEN_JOB_MESSAGE }],
    ["extra key", { type: OPEN_JOB_MESSAGE, id: 1, path: "/evil" }],
    ["string id", { type: OPEN_JOB_MESSAGE, id: "12" }],
    ["negative id", { type: OPEN_JOB_MESSAGE, id: -5 }],
    ["zero id", { type: OPEN_JOB_MESSAGE, id: 0 }],
    ["float id", { type: OPEN_JOB_MESSAGE, id: 1.5 }],
    ["NaN id", { type: OPEN_JOB_MESSAGE, id: Number.NaN }],
    ["Infinity id", { type: OPEN_JOB_MESSAGE, id: Number.POSITIVE_INFINITY }],
    ["unsafe id", { type: OPEN_JOB_MESSAGE, id: Number.MAX_SAFE_INTEGER + 1 }],
    ["class instance", Object.assign(Object.create({ inherited: true }), { type: OPEN_JOB_MESSAGE, id: 1 })]
  ])("rejects %s", (_label, data) => {
    expect(isOpenJobMessage(data)).toBe(false);
  });
});

describe("isDockManagementMessage", () => {
  it("accepts exactly { type: dock }", () => {
    expect(isDockManagementMessage({ type: DOCK_MANAGEMENT_MESSAGE })).toBe(true);
  });

  it.each([
    ["null", null],
    ["string", DOCK_MANAGEMENT_MESSAGE],
    ["extra key", { type: DOCK_MANAGEMENT_MESSAGE, side: "left" }],
    ["open-job type", { type: OPEN_JOB_MESSAGE }],
    ["empty object", {}]
  ])("rejects %s", (_label, data) => {
    expect(isDockManagementMessage(data)).toBe(false);
  });
});

describe("isFromOwnOrigin", () => {
  const win = fakeWin();
  it("accepts the same origin only", () => {
    expect(isFromOwnOrigin({ origin: ORIGIN }, win)).toBe(true);
    expect(isFromOwnOrigin({ origin: "https://evil.example" }, win)).toBe(false);
    expect(isFromOwnOrigin({ origin: "null" }, win)).toBe(false);
    expect(isFromOwnOrigin({ origin: "" }, win)).toBe(false);
  });
});

describe("window relationships", () => {
  it("sameOriginParent: only for a same-origin parent that is not itself", () => {
    expect(sameOriginParent(fakeWin())).toBeNull();
    const parent = fakeWin();
    expect(sameOriginParent(fakeWin({ parent }))).toBe(parent);
    expect(sameOriginParent(fakeWin({ parent: crossOriginWin() }))).toBeNull();
  });

  it("sameOriginOpener: only for an open, same-origin opener", () => {
    const opener = fakeWin();
    expect(sameOriginOpener(fakeWin({ opener }))).toBe(opener);
    expect(sameOriginOpener(fakeWin({ opener: fakeWin({ closed: true }) }))).toBeNull();
    expect(sameOriginOpener(fakeWin({ opener: crossOriginWin() }))).toBeNull();
    expect(sameOriginOpener(fakeWin())).toBeNull();
  });

  it("isOwnManagementPopout: named pop-out whose opener is this window", () => {
    const portal = fakeWin();
    expect(isOwnManagementPopout(fakeWin({ name: AI_TOOLS_WINDOW_NAME, opener: portal }), portal)).toBe(true);
    expect(isOwnManagementPopout(fakeWin({ name: "other", opener: portal }), portal)).toBe(false);
    expect(isOwnManagementPopout(fakeWin({ name: AI_TOOLS_WINDOW_NAME, opener: fakeWin() }), portal)).toBe(false);
    expect(isOwnManagementPopout(null, portal)).toBe(false);
    expect(isOwnManagementPopout(portal, portal)).toBe(false);
  });

  it("isManagementPopout: pop-out yes, embedded and standalone no", () => {
    expect(isManagementPopout(fakeWin({ opener: fakeWin() }))).toBe(true);
    expect(isManagementPopout(fakeWin({ name: AI_TOOLS_WINDOW_NAME }))).toBe(true);
    expect(isManagementPopout(fakeWin({ parent: fakeWin() }))).toBe(false);
    expect(isManagementPopout(fakeWin({ parent: fakeWin(), name: AI_TOOLS_WINDOW_NAME }))).toBe(false);
    expect(isManagementPopout(fakeWin())).toBe(false);
    expect(isManagementPopout(fakeWin({ opener: crossOriginWin() }))).toBe(false);
  });
});

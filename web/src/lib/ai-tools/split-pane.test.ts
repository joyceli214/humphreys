import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RATIO,
  DOCK_STORAGE_KEY,
  MAX_RATIO,
  MIN_RATIO,
  NARROW_BREAKPOINT,
  RATIO_STORAGE_KEY,
  clampRatio,
  isNarrow,
  loadDock,
  loadRatio,
  saveDock,
  saveRatio,
  type SplitPaneStorage
} from "@/lib/ai-tools/split-pane";

function memoryStorage(initial: Record<string, string> = {}): SplitPaneStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    }
  };
}

const throwingStorage: SplitPaneStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota");
  }
};

describe("constants", () => {
  it("exposes the expected bounds, default, breakpoint and keys", () => {
    expect(MIN_RATIO).toBe(0.25);
    expect(MAX_RATIO).toBe(0.75);
    expect(DEFAULT_RATIO).toBe(0.4);
    expect(NARROW_BREAKPOINT).toBe(900);
    expect(DOCK_STORAGE_KEY).toBe("humphreys.management.dock");
    expect(RATIO_STORAGE_KEY).toBe("humphreys.management.ratio");
  });
});

describe("clampRatio", () => {
  it("keeps values inside the range", () => {
    expect(clampRatio(0.25)).toBe(0.25);
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0.75)).toBe(0.75);
  });

  it("clamps values outside the range", () => {
    expect(clampRatio(0)).toBe(MIN_RATIO);
    expect(clampRatio(-3)).toBe(MIN_RATIO);
    expect(clampRatio(0.9)).toBe(MAX_RATIO);
    expect(clampRatio(Infinity)).toBe(MAX_RATIO);
    expect(clampRatio(-Infinity)).toBe(MIN_RATIO);
  });

  it("falls back to the default for NaN", () => {
    expect(clampRatio(Number.NaN)).toBe(DEFAULT_RATIO);
  });
});

describe("dock persistence", () => {
  it("defaults to right when nothing is stored", () => {
    expect(loadDock(memoryStorage())).toBe("right");
  });

  it("loads stored left/right values", () => {
    expect(loadDock(memoryStorage({ [DOCK_STORAGE_KEY]: "left" }))).toBe("left");
    expect(loadDock(memoryStorage({ [DOCK_STORAGE_KEY]: "right" }))).toBe("right");
  });

  it("defaults to right for invalid stored values", () => {
    expect(loadDock(memoryStorage({ [DOCK_STORAGE_KEY]: "top" }))).toBe("right");
    expect(loadDock(memoryStorage({ [DOCK_STORAGE_KEY]: "" }))).toBe("right");
  });

  it("saves the dock under its key and round-trips", () => {
    const storage = memoryStorage();
    saveDock("left", storage);
    expect(storage.data[DOCK_STORAGE_KEY]).toBe("left");
    expect(loadDock(storage)).toBe("left");
  });

  it("swallows storage errors", () => {
    expect(loadDock(throwingStorage)).toBe("right");
    expect(() => saveDock("left", throwingStorage)).not.toThrow();
  });
});

describe("ratio persistence", () => {
  it("defaults when nothing is stored", () => {
    expect(loadRatio(memoryStorage())).toBe(DEFAULT_RATIO);
  });

  it("loads a valid stored ratio", () => {
    expect(loadRatio(memoryStorage({ [RATIO_STORAGE_KEY]: "0.6" }))).toBe(0.6);
  });

  it("clamps out-of-range stored ratios", () => {
    expect(loadRatio(memoryStorage({ [RATIO_STORAGE_KEY]: "0.1" }))).toBe(MIN_RATIO);
    expect(loadRatio(memoryStorage({ [RATIO_STORAGE_KEY]: "5" }))).toBe(MAX_RATIO);
  });

  it("defaults for invalid stored ratios", () => {
    for (const bad of ["abc", "", "  ", "NaN", "Infinity", "0.5px"]) {
      expect(loadRatio(memoryStorage({ [RATIO_STORAGE_KEY]: bad }))).toBe(DEFAULT_RATIO);
    }
  });

  it("saves a clamped ratio and round-trips", () => {
    const storage = memoryStorage();
    saveRatio(0.55, storage);
    expect(storage.data[RATIO_STORAGE_KEY]).toBe("0.55");
    expect(loadRatio(storage)).toBe(0.55);
    saveRatio(2, storage);
    expect(storage.data[RATIO_STORAGE_KEY]).toBe(String(MAX_RATIO));
  });

  it("swallows storage errors", () => {
    expect(loadRatio(throwingStorage)).toBe(DEFAULT_RATIO);
    expect(() => saveRatio(0.5, throwingStorage)).not.toThrow();
  });
});

describe("default storage (window.localStorage)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("uses localStorage when no storage is passed", () => {
    saveDock("left");
    saveRatio(0.3);
    expect(window.localStorage.getItem(DOCK_STORAGE_KEY)).toBe("left");
    expect(window.localStorage.getItem(RATIO_STORAGE_KEY)).toBe("0.3");
    expect(loadDock()).toBe("left");
    expect(loadRatio()).toBe(0.3);
  });
});

describe("isNarrow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is true below the breakpoint and false at or above it", () => {
    expect(isNarrow(899)).toBe(true);
    expect(isNarrow(900)).toBe(false);
    expect(isNarrow(1440)).toBe(false);
  });

  it("defaults to window.innerWidth", () => {
    const original = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
      expect(isNarrow()).toBe(true);
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
      expect(isNarrow()).toBe(false);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });
});

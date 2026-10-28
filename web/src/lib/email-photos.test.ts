import { describe, expect, it } from "vitest";
import {
  extractPhotoUrls,
  formatMegabytes,
  normalizePhotoUrl,
  selectAllPhotos,
  summarizePhotoSelection,
  togglePhotoSelection,
  type EmailPhoto
} from "./email-photos";

const signed = (key: string, sig: string) =>
  `http://localhost:9000/humphreys/markdown/31225/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${sig}`;

function photo(id: string, sendBytes: number, overrides: Partial<EmailPhoto> = {}): EmailPhoto {
  return {
    id,
    url: `https://x/${id}.jpg`,
    name: `${id}.jpg`,
    source: "Work done",
    original_bytes: sendBytes * 4,
    send_bytes: sendBytes,
    original_type: "image/jpeg",
    width: 1600,
    height: 1200,
    supported: true,
    ...overrides
  };
}

describe("extractPhotoUrls", () => {
  it("finds markdown and html images across fields, in order, without duplicates", () => {
    const problem = `Broken tray ![front](${signed("a.jpg", "111")}) and ![](<${signed("b.png", "222")}> "title")`;
    const workDone = `* Fixed\n\n![again](${signed("a.jpg", "333")})\n<img src="${signed("c.jpg", "444")}" alt="c">`;
    const log = `Tested ![d](${signed("d.jpg", "555")}) [not an image](https://example.com/x.jpg) ![rel](/relative.jpg)`;
    expect(extractPhotoUrls([problem, null, workDone, log])).toEqual([
      signed("a.jpg", "111"),
      signed("b.png", "222"),
      signed("c.jpg", "444"),
      signed("d.jpg", "555")
    ]);
  });

  it("normalizes signed links so the same photo matches", () => {
    expect(normalizePhotoUrl(signed("a%20b.jpg", "1"))).toBe("http://localhost:9000/humphreys/markdown/31225/a b.jpg");
    expect(normalizePhotoUrl(signed("a.jpg", "1"))).toBe(normalizePhotoUrl(signed("a.jpg", "2")));
  });
});

describe("summarizePhotoSelection", () => {
  const limits = { maxPhotos: 3, maxTotalBytes: 10_000_000 };
  const photos = [photo("a", 2_000_000), photo("b", 5_000_000), photo("c", 4_000_000), photo("d", 500_000), photo("svg", 0, { supported: false, reason: "SVG" })];

  it("counts real send sizes and stays ok under 80%", () => {
    const summary = summarizePhotoSelection(photos, ["a", "b"], limits);
    expect(summary).toMatchObject({ count: 2, totalBytes: 7_000_000, level: "ok", blockedReason: null });
    expect(summary.label).toBe("2 photos selected · 7.0 MB of 10.0 MB");
  });

  it("warns above 80% and blocks over the limit", () => {
    expect(summarizePhotoSelection(photos, ["b", "c"], limits).level).toBe("warn");
    const over = summarizePhotoSelection(photos, ["b", "c", "a"], limits);
    expect(over.level).toBe("over");
    expect(over.blockedReason).toContain("too big");
  });

  it("blocks too many photos, unsupported photos and pending sizes", () => {
    expect(summarizePhotoSelection(photos, ["a", "b", "c", "d"], { ...limits, maxTotalBytes: 100_000_000 }).blockedReason).toContain("up to 3");
    expect(summarizePhotoSelection(photos, ["svg"], limits).blockedReason).toContain("can't be attached");
    expect(summarizePhotoSelection(photos, ["a"], limits, true).blockedReason).toContain("Still checking");
    expect(summarizePhotoSelection(photos, [], limits, true).blockedReason).toBeNull();
  });

  it("formats sizes", () => {
    expect(formatMegabytes(2_400_000)).toBe("2.4 MB");
    expect(formatMegabytes(45_000)).toBe("45 KB");
    expect(formatMegabytes(0)).toBe("0.0 MB");
  });
});

describe("selection helpers", () => {
  const limits = { maxPhotos: 2, maxTotalBytes: 6_000_000 };
  it("toggles, respecting the cap and unsupported photos", () => {
    expect(togglePhotoSelection([], photo("a", 1), limits)).toEqual(["a"]);
    expect(togglePhotoSelection(["a"], photo("a", 1), limits)).toEqual([]);
    expect(togglePhotoSelection(["a", "b"], photo("c", 1), limits)).toEqual(["a", "b"]);
    expect(togglePhotoSelection([], photo("x", 1, { supported: false }), limits)).toEqual([]);
  });

  it("select all stops at the cap and never goes over the size limit", () => {
    const photos = [photo("big", 5_000_000), photo("bad", 1, { supported: false }), photo("b", 2_000_000), photo("c", 500_000)];
    expect(selectAllPhotos(photos, limits)).toEqual(["big", "c"]);
    expect(selectAllPhotos(photos, { maxPhotos: 10, maxTotalBytes: 100_000_000 })).toEqual(["big", "b", "c"]);
  });
});

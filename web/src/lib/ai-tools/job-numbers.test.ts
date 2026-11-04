import { describe, expect, it } from "vitest";
import { parseJobNumbers, validateJobSuffix } from "@/lib/ai-tools/job-numbers";

describe("parseJobNumbers", () => {
  it("returns no ids and no error for blank input", () => {
    expect(parseJobNumbers("")).toEqual({ ids: [], error: "" });
    expect(parseJobNumbers("  , ")).toEqual({ ids: [], error: "" });
  });

  it("splits on commas and whitespace, dedupes and keeps order", () => {
    expect(parseJobNumbers("31201, 31205 31201\n42")).toEqual({ ids: [31201, 31205, 42], error: "" });
    expect(parseJobNumbers("1,2,,3")).toEqual({ ids: [1, 2, 3], error: "" });
  });

  it("rejects non-digit tokens with a clear message", () => {
    const res = parseJobNumbers("31201, abc, #5");
    expect(res.ids).toEqual([]);
    expect(res.error).toBe('"abc" is not a job number. Use digits only, separated by commas or spaces.');
  });

  it("rejects zero and numbers that are too large", () => {
    expect(parseJobNumbers("0").error).toMatch(/"0" is not a valid job number/);
    expect(parseJobNumbers("99999999999").error).toMatch(/"99999999999" is not a valid job number/);
  });

  it("rejects more than 50 distinct job numbers", () => {
    const many = Array.from({ length: 51 }, (_, i) => i + 1).join(",");
    expect(parseJobNumbers(many).error).toBe("Too many job numbers (max 50).");
    const fifty = Array.from({ length: 50 }, (_, i) => i + 1).join(" ");
    expect(parseJobNumbers(fifty).ids).toHaveLength(50);
  });
});

describe("validateJobSuffix", () => {
  it("accepts blank or digits only", () => {
    expect(validateJobSuffix("")).toBe("");
    expect(validateJobSuffix(" 07 ")).toBe("");
    expect(validateJobSuffix("1a")).toBe("Job number ending must contain digits only.");
  });
});

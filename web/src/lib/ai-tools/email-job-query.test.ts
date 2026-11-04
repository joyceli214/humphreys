import { describe, expect, it } from "vitest";
import { EMAIL_SEARCH_LIMIT, emailJobQuery } from "@/lib/ai-tools/email-job-query";

describe("emailJobQuery", () => {
  it("uses customer name search when the input has letters", () => {
    expect(emailJobQuery("  Jane   Doe ")).toEqual({ filters: { customer_name: "Jane Doe", limit: EMAIL_SEARCH_LIMIT }, shortDigits: false });
    expect(emailJobQuery("o'brien 2")?.filters).toEqual({ customer_name: "o'brien 2", limit: EMAIL_SEARCH_LIMIT });
  });

  it("uses job_suffix for digits only, allowing a leading #", () => {
    expect(emailJobQuery("31200")).toEqual({ filters: { job_suffix: "31200", limit: EMAIL_SEARCH_LIMIT }, shortDigits: false });
    expect(emailJobQuery("#200")?.filters).toEqual({ job_suffix: "200", limit: EMAIL_SEARCH_LIMIT });
  });

  it("flags fewer than 3 digits but still searches", () => {
    expect(emailJobQuery("12")).toEqual({ filters: { job_suffix: "12", limit: EMAIL_SEARCH_LIMIT }, shortDigits: true });
  });

  it("caps job_suffix at 10 digits and customer name at 200 chars", () => {
    expect(emailJobQuery("123456789012")?.filters.job_suffix).toBe("3456789012");
    expect(emailJobQuery("a".repeat(250))?.filters.customer_name).toHaveLength(200);
  });

  it("returns null for empty or unsearchable input", () => {
    expect(emailJobQuery("")).toBeNull();
    expect(emailJobQuery("  # ")).toBeNull();
    expect(emailJobQuery("12-34")).toBeNull();
  });
});

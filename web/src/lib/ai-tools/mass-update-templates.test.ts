import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  TEMPLATES,
  catalogTemplateValues,
  composeTemplate,
  emptyValues,
  getTemplate,
  jobsPhrase,
  type TemplateId
} from "@/lib/ai-tools/mass-update-templates";

const ALL_IDS = Object.keys(TEMPLATES) as TemplateId[];

describe("mass update templates", () => {
  it("has no hard-coded job numbers or sample values in any example label or empty composition", () => {
    for (const cap of CAPABILITIES) {
      for (const id of cap.templates) {
        const tpl = getTemplate(id);
        expect(tpl.label).not.toMatch(/\d/);
        expect(composeTemplate(id, emptyValues(id))).not.toMatch(/\d/);
      }
    }
  });

  it("composes empty slots without placeholder markers", () => {
    for (const id of ALL_IDS) {
      const text = composeTemplate(id, emptyValues(id));
      expect(text).not.toMatch(/[[\]_{}<>…]|\.\.\./);
      expect(text).not.toMatch(/\s{2,}|\s[.,%]/);
    }
  });

  it("formats job lists naturally", () => {
    expect(jobsPhrase("")).toBe("jobs");
    expect(jobsPhrase(" 31201 ")).toBe("job 31201");
    expect(jobsPhrase("31201, 31205")).toBe("jobs 31201 and 31205");
    expect(jobsPhrase("1 2,3")).toBe("jobs 1, 2 and 3");
  });

  it("composes filled slots into an instruction", () => {
    expect(composeTemplate("status", { jobs: "5, 6", status: "Ready for pickup" })).toBe("Set jobs 5 and 6 to Ready for pickup.");
    expect(composeTemplate("add-item", { item: "Belt Kit", price: "32", qty: "2", jobs: "7" })).toBe(
      'Add "Belt Kit" at $32 (qty 2) to job 7.'
    );
    expect(composeTemplate("labour-total", { jobs: "8", amount: "$294" })).toBe("Set the labour total on job 8 to $294.");
    expect(composeTemplate("labour-discount", { jobs: "9", percent: "10" })).toBe("Give job 9 a 10% labour discount.");
    expect(composeTemplate("location", { jobs: "1 2", location: "A-1" })).toBe("Move jobs 1 and 2 to location A-1.");
    expect(composeTemplate("work-done", { jobs: "3" })).toBe("Generate Work Done for job 3.");
    expect(composeTemplate("remove-item", { item: "Audio Cable", jobs: "4" })).toBe('Remove the "Audio Cable" line from job 4.');
  });

  it("prefills the add-item template from a catalog item", () => {
    expect(catalogTemplateValues({ name: "Audio Cable", unit_price: 1250.5, quantity_text: "" })).toEqual({
      item: "Audio Cable",
      price: "1250.50",
      qty: "1",
      jobs: ""
    });
  });
});

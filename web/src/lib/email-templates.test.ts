// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { WorkOrderDetail } from "@/lib/api/generated/types";
import { renderEmailTemplate } from "./email-templates";
import { emailTextToHtml } from "./email-html";

function workOrder(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    reference_id: 31225,
    customer: { first_name: "Janice", last_name: "Mccord", email: "jemccord@bell.net" },
    brand_names: ["Bose"],
    item_name: "Wave Radio 3",
    model_number: "Wave music system III",
    problem_description: "CD not playable",
    work_done: "* Diagnosed not-playable fault.\n* Replaced supercapacitor on motherboard.\n* Performed CD drive service.\n* Confirmed CD and radio function properly.",
    parts_total: null,
    delivery_total: null,
    labour_total: null,
    labour_discount_type: null,
    deposit: 0,
    ...overrides
  } as unknown as WorkOrderDetail;
}

describe("renderEmailTemplate work_done bullets", () => {
  it("keeps every markdown bullet instead of pairing '*' markers as italics", () => {
    const { body } = renderEmailTemplate({ subject_template: "x", body_template: "Work done: {{work_done}}" }, workOrder());
    expect(body).toBe(
      "Work done: \n• Diagnosed not-playable fault.\n• Replaced supercapacitor on motherboard.\n• Performed CD drive service.\n• Confirmed CD and radio function properly."
    );
  });

  it("renders the bullets as a list in the email HTML", () => {
    const { body } = renderEmailTemplate({ subject_template: "x", body_template: "Hi {{customer_name}},\n\nWork done: {{work_done}}" }, workOrder());
    expect(emailTextToHtml(body)).toBe(
      "<p>Hi Janice Mccord,</p><p>Work done:</p><ul><li><p>Diagnosed not-playable fault.</p></li><li><p>Replaced supercapacitor on motherboard.</p></li><li><p>Performed CD drive service.</p></li><li><p>Confirmed CD and radio function properly.</p></li></ul>"
    );
  });

  it("still strips inline emphasis inside a single line", () => {
    const { body } = renderEmailTemplate({ subject_template: "x", body_template: "{{problem_description}}" }, workOrder({ problem_description: "CD *not* playable, **urgent** snake_case_word" }));
    expect(body).toBe("CD not playable, urgent snake_case_word");
  });

  it("drops inline photos from field values (photos are attached separately)", () => {
    const { body } = renderEmailTemplate(
      { subject_template: "x", body_template: "Problem: {{problem_description}}" },
      workOrder({ problem_description: "CD not playable\n\n![Front panel](https://s3.example/a.jpg?sig=1)\n\n<img src=\"https://s3.example/b.jpg\" alt=\"Back\">" })
    );
    expect(body).toBe("Problem: CD not playable");
  });
});

describe("job-card slot helpers", () => {
  it("round-trips every Supplier / Shop default through split + join", async () => {
    const { DEFAULT_EMAIL_TEMPLATES, EMAIL_TEMPLATE_GROUPS, joinJobCards, splitJobCards } = await import("./email-templates");
    for (const group of EMAIL_TEMPLATE_GROUPS.filter((g) => g.kind !== "customer")) {
      for (const key of group.keys) {
        const body = DEFAULT_EMAIL_TEMPLATES[key].body_template;
        expect(body.match(/\{\{job_cards\}\}/g)).toHaveLength(1);
        const { before, after } = splitJobCards(body);
        expect(joinJobCards(before, after)).toBe(body);
      }
    }
    for (const key of ["job_started", "job_completed"] as const) {
      expect(DEFAULT_EMAIL_TEMPLATES[key].body_template).not.toContain("job_cards");
    }
  });

  it("keeps exactly one slot even if the text around it is emptied or has an escaped copy", async () => {
    const { joinJobCards, splitJobCards } = await import("./email-templates");
    expect(joinJobCards("", "")).toBe("{{job_cards}}");
    expect(joinJobCards("Hi {{job\\_cards}}", "Bye")).toBe("Hi\n\n{{job_cards}}\n\nBye");
    expect(splitJobCards("No slot")).toEqual({ before: "No slot", after: "" });
    expect(splitJobCards("A\n\n{{ job\\_cards }}\n\nB {{job_cards}}")).toEqual({ before: "A", after: "B" });
  });

  it("ships no preview example data in the defaults", async () => {
    const { DEFAULT_EMAIL_TEMPLATES } = await import("./email-templates");
    const all = JSON.stringify(DEFAULT_EMAIL_TEMPLATES);
    for (const bad of ["HE-2207", "555", "example.test", "10421", "Alex Martin"]) expect(all).not.toContain(bad);
  });
});

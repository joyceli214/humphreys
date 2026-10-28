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

import { describe, expect, it } from "vitest";
import type { PartsPurchaseRequest, WorkOrderDetail } from "@/lib/api/generated/types";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/email-templates";
import {
  SHOP_APPROVAL_PART_STATUSES,
  SUPPLIER_PART_STATUSES,
  applyShopSignature,
  buildCustomerDraft,
  buildShopDraft,
  buildSupplierDraft,
  joinRecipientNames,
  shopApprovalCards,
  shopUpdateCards,
  type ShopJob,
  maskEmailHint,
  mergeSupplierParts,
  renderTemplateWithBlanks,
  shopNameFromSignOff,
  signOffFromTemplate,
  type EmailJob,
  type JobParts
} from "@/lib/ai-tools/email-flow";
import { findBlanks } from "@/lib/ai-tools/email-blanks";

function detail(id: number, extra: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    labour_discount_type: null, labour_discount_value: null, labour_discount_amount: 0,
    reference_id: id, original_job_id: null, warranty_job_ids: [], created_at: null, updated_at: null,
    status_id: 1, status_key: null, status_name: "In Progress", status_group: "in_progress", status_updated_at: null,
    job_type_id: null, job_type_key: null, job_type_name: null, location_id: null, location_code: null,
    location_shelf: null, location_floor: null,
    customer: {
      customer_id: 1, first_name: "Testy", last_name: "Customer", email: "testy@shop.test", address_line_1: null,
      address_line_2: null, city: null, province: null, postal_code: null, home_phone: null, work_phone: null, remark: null
    },
    item_id: null, item_name: "Receiver", brand_ids: [], brand_names: [], model_number: null, serial_number: null,
    other_remarks: null, remote_control_qty: 0, cable_qty: 0, cord_qty: 0, dvd_vhs_qty: 0, album_cd_cassette_qty: 0,
    problem_description: "No sound", worker_ids: [], worker_names: [], work_done: null, payment_method_ids: [],
    payment_method_names: [], parts_total: null, delivery_total: null, labour_total: null, deposit: 0, line_items: [],
    ...extra
  };
}

function job(id: number, d: WorkOrderDetail | null = detail(id)): EmailJob {
  return { referenceId: id, customerName: "Testy Customer", equipment: "Receiver", status: "In Progress", detail: d };
}

const TEMPLATES = {
  job_started: DEFAULT_EMAIL_TEMPLATES.job_started,
  job_completed: DEFAULT_EMAIL_TEMPLATES.job_completed
};

function part(reference_id: number, item_name: string, quantity: number, status: PartsPurchaseRequest["status"]): PartsPurchaseRequest {
  return {
    audit_flags: [], approved_at: null, ordered_at: null, arrived_at: null, used_at: null, cancelled_at: null,
    parts_purchase_request_id: reference_id * 100 + quantity, reference_id, source: "supplier", source_url: null,
    status, total_price: 0, item_name, quantity, created_by_user_id: "u", created_by_name: null, created_at: null, updated_at: null
  };
}

describe("sign-off", () => {
  it("takes the closing paragraph after the last template variable line", () => {
    expect(signOffFromTemplate(DEFAULT_EMAIL_TEMPLATES.job_started.body_template)).toBe("Thank you,\nHumphreys Electronics");
    expect(shopNameFromSignOff("Thank you,\nHumphreys Electronics")).toBe("Humphreys Electronics");
    expect(shopNameFromSignOff("Thanks")).toBeNull();
  });

  it("falls back to a plain thank-you when the template has no closing text", () => {
    expect(signOffFromTemplate("Hi {{customer_name}}")).toBe("Thank you");
  });
});

describe("renderTemplateWithBlanks", () => {
  it("turns empty template values into yellow blanks for the job", () => {
    const out = renderTemplateWithBlanks(DEFAULT_EMAIL_TEMPLATES.job_started, detail(12));
    expect(out.body).toContain("Work done: {Work done for #12}");
    expect(out.body).toContain("Serial: {Serial for #12}");
    expect(out.body).toContain("Hi Testy Customer,");
    expect(out.body).not.toMatch(/\{\{/);
  });

  it("keeps a zero deposit as $0.00 instead of a blank", () => {
    const out = renderTemplateWithBlanks(DEFAULT_EMAIL_TEMPLATES.job_started, detail(12, { labour_total: 100 }));
    expect(out.body).toContain("Deposit: $0.00");
  });
});

describe("buildCustomerDraft", () => {
  it("renders the live job_started template for one-job progress updates", () => {
    const out = buildCustomerDraft({ type: "progress_update", jobs: [job(12)], templates: TEMPLATES });
    expect(out.subject).toBe("Job #12 update");
    expect(out.body).toContain("We have started work on your Receiver.");
  });

  it("renders job_completed for one-job pickup reminders", () => {
    const out = buildCustomerDraft({ type: "ready_for_pickup", jobs: [job(12)], templates: TEMPLATES });
    expect(out.subject).toBe("Job #12 ready for pickup");
    expect(out.body).toContain("is complete");
  });

  it("builds one block per job with per-job blanks and a combined total", () => {
    const jobs = [job(12, detail(12, { labour_total: 100, work_done: "Replaced belt" })), job(13)];
    const out = buildCustomerDraft({ type: "estimate", jobs, templates: TEMPLATES });
    expect(out.subject).toBe("Estimate for jobs #12, #13");
    expect(out.body).toMatch(/^Hi Testy,/);
    expect(out.body).toContain("Job #12 · Receiver");
    expect(out.body).toContain("Work done: Replaced belt");
    expect(out.body).toContain("Estimate: $113.00");
    expect(out.body).toContain("Work done: {Work done for #13}");
    expect(out.body).toContain("Estimate: {Amount for #13}");
    expect(out.body).toContain("Combined estimate: {Combined estimate}");
    expect(out.body.match(/\{Amount for #13\}/g)).toHaveLength(1);
    expect(out.body.endsWith("Thank you,\nHumphreys Electronics")).toBe(true);
  });

  it("uses {Name} when the first name is unknown, and blanks for custom", () => {
    const out = buildCustomerDraft({ type: "custom", jobs: [job(12, null)], templates: TEMPLATES });
    expect(out.subject).toBe("{Subject}");
    expect(out.body).toBe("Hi {Name},\n\n{Your message}\n\nThank you,\nHumphreys Electronics");
  });

  it("labels multi-job totals per type", () => {
    const jobs = [job(12, detail(12, { labour_total: 100 })), job(13, detail(13, { labour_total: 100 }))];
    expect(buildCustomerDraft({ type: "progress_update", jobs, templates: TEMPLATES }).body).toContain("Total so far: $226.00");
    expect(buildCustomerDraft({ type: "ready_for_pickup", jobs, templates: TEMPLATES }).body).toContain("Balance due: $226.00");
  });
});

describe("mergeSupplierParts", () => {
  const jobs: JobParts[] = [
    { referenceId: 21, customerName: "Test Customer A", parts: [part(21, "Drive Belt", 2, "approved"), part(21, "Fuse", 1, "arrived")] },
    { referenceId: 22, customerName: "Test Customer B", parts: [part(22, "drive  belt", 1, "waiting_approval"), part(22, "Lamp", 3, "cancelled")] },
    { referenceId: 23, customerName: "Test Customer A", parts: [] }
  ];

  it("merges the same part across jobs into one row and sums qty", () => {
    const merged = mergeSupplierParts(jobs, SUPPLIER_PART_STATUSES.parts_inquiry);
    expect(merged.rows).toHaveLength(2);
    expect(merged.rows[0]).toMatchObject({ part: "Drive Belt", qty: 3, forJob: "#21 ×2, #22 ×1" });
    expect(merged.rows[1]).toMatchObject({ part: null, qty: null, forJob: "#23" });
  });

  it("uses the documented status default and counts what was left out", () => {
    expect(SUPPLIER_PART_STATUSES.parts_inquiry).toEqual(["waiting_approval", "approved"]);
    expect(SUPPLIER_PART_STATUSES.order_followup).toEqual(["approved", "ordered"]);
    const merged = mergeSupplierParts(jobs, SUPPLIER_PART_STATUSES.parts_inquiry);
    expect(merged.excluded).toBe(2);
    expect(merged.excludedStatuses).toEqual(["arrived", "cancelled"]);
  });

  it("puts by-hand blanks for jobs whose parts can't be read", () => {
    const merged = mergeSupplierParts([{ referenceId: 30, customerName: "X", parts: null }], SUPPLIER_PART_STATUSES.parts_inquiry);
    expect(merged.rows).toEqual([{ part: null, qty: null, forJob: "#30", jobIds: [30], customers: ["X"] }]);
  });
});

describe("buildSupplierDraft", () => {
  const jobs: JobParts[] = [
    { referenceId: 21, customerName: "Test Customer A", parts: [part(21, "Drive belt", 2, "approved")] },
    { referenceId: 22, customerName: "Test Customer B", parts: [part(22, "Drive belt", 1, "approved")] },
    { referenceId: 23, customerName: "Test Customer A", parts: null }
  ];
  const signOff = "Thank you,\nHumphreys Electronics";
  const inquiry = DEFAULT_EMAIL_TEMPLATES.supplier_parts_inquiry;
  const followup = DEFAULT_EMAIL_TEMPLATES.supplier_order_followup;

  it("fills the supplier template: merged table at {{job_cards}}, account blank, no customer names", () => {
    const out = buildSupplierDraft({ type: "parts_inquiry", template: inquiry, supplierName: "Test Supplier", jobs, showNames: false, signOff });
    expect(out.subject).toBe("Parts inquiry – Jobs #21, #22, #23 (Acct {Account #})");
    expect(out.body).toBe(
      [
        "Hi Test Supplier,",
        "",
        "Could you please confirm price and stock for these parts?",
        "",
        "Part | Qty | For job #",
        "Drive belt | 3 | #21 ×2, #22 ×1",
        "{Part for #23} | {Qty} | #23",
        "",
        "Please reply with price and lead time.",
        "",
        "Thanks,",
        "Justin",
        "Humphreys Electronics"
      ].join("\n")
    );
    expect(out.body).not.toContain("Test Customer");
    expect(findBlanks(out.body).map((b) => b.token)).toEqual(["{Part for #23}", "{Qty}"]);
  });

  it("adds a Customer column only when names are shown", () => {
    const out = buildSupplierDraft({ type: "order_followup", template: followup, supplierName: "Test Supplier", jobs, showNames: true, signOff });
    expect(out.body).toContain("Could you let us know where these parts are and when they will ship?");
    expect(out.body).toContain("Part | Qty | For job # | Customer");
    expect(out.body).toContain("Drive belt | 3 | #21 ×2, #22 ×1 | Test Customer A, Test Customer B");
  });

  it("uses the saved template text (markdown escapes undone, unknown fields blank)", () => {
    const template = { subject_template: "Order {{job\\_numbers}}", body_template: "Hello {{supplier\\_name}} \\*now\\*\n\n{{job\\_cards}}\n\nRe {{customer_name}}" };
    const out = buildSupplierDraft({ type: "order_followup", template, supplierName: null, jobs: jobs.slice(0, 1), showNames: false, signOff });
    expect(out.subject).toBe("Order #21");
    expect(out.body).toBe("Hello team *now*\n\nPart | Qty | For job #\nDrive belt | 2 | #21\n\nRe {Customer name}");
  });

  it("never contains preview example data", () => {
    for (const type of ["parts_inquiry", "order_followup", "custom"] as const) {
      const out = buildSupplierDraft({ type, template: inquiry, supplierName: null, jobs, showNames: false, signOff });
      for (const bad of ["HE-2207", "555", "example.test"]) {
        expect(out.body).not.toContain(bad);
        expect(out.subject).not.toContain(bad);
      }
    }
  });

  it("starts blank for Custom", () => {
    const out = buildSupplierDraft({ type: "custom", template: null, supplierName: null, jobs, showNames: false, signOff: "Thanks" });
    expect(out).toMatchObject({ subject: "{Subject}", body: "Hello team,\n\n{Your message}\n\nThanks" });
  });
});

describe("several supplier To", () => {
  it("joins supplier names for the greeting and supplier_name", () => {
    const template = { ...DEFAULT_EMAIL_TEMPLATES.supplier_parts_inquiry, subject_template: "To {{supplier_name}}", body_template: "Hello {{supplier_name}}" };
    const out = buildSupplierDraft({ type: "parts_inquiry", template, supplierName: ["Parts A", "Parts B"], jobs: [], showNames: false, signOff: "Thanks" });
    expect(out.subject).toBe("To Parts A, Parts B");
    expect(out.body).toBe("Hello Parts A, Parts B");
    expect(buildSupplierDraft({ type: "custom", template: null, supplierName: [], jobs: [], showNames: false, signOff: "Thanks" }).body.startsWith("Hello team,")).toBe(true);
    expect(joinRecipientNames(["  A ", "", "B"])).toBe("A, B");
    expect(joinRecipientNames([])).toBeNull();
  });
});

describe("Shop drafts", () => {
  const shopJob = (referenceId: number, parts: PartsPurchaseRequest[] | null, status = "In Progress"): ShopJob => ({
    referenceId,
    customerName: `Customer ${referenceId}`,
    equipment: `Item ${referenceId}`,
    status,
    parts
  });
  const priced = (id: number, name: string, qty: number, status: string, price: number) => ({ ...part(id, name, qty, status), total_price: price });
  const approval = DEFAULT_EMAIL_TEMPLATES.shop_approval;
  const update = DEFAULT_EMAIL_TEMPLATES.shop_update;
  const signOff = "Thank you,\nHumphreys Electronics";

  it("Ask for approval: stacked cards per part, cost only when the job has exactly one priced part", () => {
    const jobs = [
      shopJob(275, [priced(275, "Filter capacitor", 2, "waiting_approval", 197.1), priced(275, "Old fuse", 1, "arrived", 5)]),
      shopJob(276, [priced(276, "Diode", 1, "draft", 3), priced(276, "Belt", 1, "waiting_approval", 9)]),
      shopJob(277, [])
    ];
    const out = buildShopDraft({ type: "approval", template: approval, recipientName: "Dave", jobs, signOff });
    expect(out.subject).toBe("Approval needed – Jobs #275, #276, #277");
    expect(out.body).toBe(
      [
        "Hi Dave,",
        "",
        "Please approve the parts and work below.",
        "",
        "#275 · Item 275\nCustomer 275\nPart: Filter capacitor\nQty: 2\nCost: $197.10",
        "",
        "#276 · Item 276\nCustomer 276\nPart: Diode\nQty: 1\nCost: {Cost}",
        "",
        "#276 · Item 276\nCustomer 276\nPart: Belt\nQty: 1\nCost: {Cost}",
        "",
        "#277 · Item 277\nCustomer 277\nPart: {Part}\nQty: {Qty}\nCost: {Cost}",
        "",
        "Reply “yes” and we can order / start.",
        "",
        "Thanks,",
        "Justin",
        "Humphreys Electronics"
      ].join("\n")
    );
    expect(out.excluded).toBe(1);
    expect(out.excludedStatuses).toEqual(["arrived"]);
    expect(SHOP_APPROVAL_PART_STATUSES).toEqual(["draft", "waiting_approval"]);
  });

  it("Ask for approval falls back to blanks when parts can't be read", () => {
    const out = shopApprovalCards([shopJob(30, null)]);
    expect(out.text).toBe("#30 · Item 30\nCustomer 30\nPart: {Part}\nQty: {Qty}\nCost: {Cost}");
  });

  it("Ask for an update: status and an {Update} blank per job; Dave signs unless To is Justin's", () => {
    const jobs = [shopJob(275, null, "Waiting on parts"), shopJob(27501, null, "")];
    const toTeam = buildShopDraft({ type: "update", template: update, recipientName: "Front Desk", jobs, signOff });
    expect(toTeam.subject).toBe("Please update – Jobs #275, #27501");
    expect(toTeam.body).toContain("#275 · Item 275\nCustomer 275\nStatus: Waiting on parts\nUpdate: {Update}\n\n#27501 · Item 27501\nCustomer 27501\nStatus: {Status}\nUpdate: {Update}");
    expect(toTeam.body.endsWith("Thanks,\nJustin\nHumphreys Electronics")).toBe(true);
    const toJustin = buildShopDraft({ type: "update", template: update, recipientName: "Justin Tech", jobs, signOff });
    expect(toJustin.body.endsWith("Thanks,\nDave\nHumphreys Electronics")).toBe(true);
    expect(shopUpdateCards([])).toContain("Update: {Update}");
  });

  it("signature swap touches only the default sign-off", () => {
    expect(applyShopSignature("Hi\n\nThanks,\nDave\nHumphreys Electronics", "Dave")).toBe("Hi\n\nThanks,\nJustin\nHumphreys Electronics");
    expect(applyShopSignature("Hi\n\nThanks,\nJustin\nHumphreys Electronics", "justin")).toBe("Hi\n\nThanks,\nDave\nHumphreys Electronics");
    expect(applyShopSignature("Hi\n\nCheers,\nJustin", "Justin")).toBe("Hi\n\nCheers,\nJustin");
    expect(applyShopSignature("Thanks,\nDave\nHumphreys Electronics\nP.S. call me", null)).toBe("Thanks,\nDave\nHumphreys Electronics\nP.S. call me");
  });

  it("several To: Dave signs when any To name is Justin's (never tested on the joined string)", () => {
    const sig = (name: string) => `Hi\n\nThanks,\n${name}\nHumphreys Electronics`;
    expect(applyShopSignature(sig("Justin"), ["Dave", "Justin"])).toBe(sig("Dave"));
    expect(applyShopSignature(sig("Justin"), ["Dave Boss", "justin tech"])).toBe(sig("Dave"));
    expect(applyShopSignature(sig("Dave"), ["Dave", "Front Desk"])).toBe(sig("Justin"));
    expect(applyShopSignature(sig("Dave"), [])).toBe(sig("Justin"));
    // The joined string "Dave, Justin" does not start with Justin; a list is what decides.
    expect(applyShopSignature(sig("Justin"), "Dave, Justin")).toBe(sig("Justin"));
    // Customised sign-off left alone with several To too.
    expect(applyShopSignature("Hi\n\nCheers,\nJustin", ["Dave", "Justin"])).toBe("Hi\n\nCheers,\nJustin");
  });

  it("several To: greeting / subject join names in pick order and Dave signs when Justin is among them", () => {
    const jobs = [shopJob(275, null, "Waiting on parts")];
    const template = { ...update, subject_template: "For {{recipient_name}} – Jobs {{job_numbers}}" };
    const both = buildShopDraft({ type: "update", template, recipientName: ["Dave", "Justin"], jobs, signOff });
    expect(both.subject).toBe("For Dave, Justin – Jobs #275");
    expect(both.body.startsWith("Hi Dave, Justin,")).toBe(true);
    expect(both.body.endsWith("Thanks,\nDave\nHumphreys Electronics")).toBe(true);
    const single = buildShopDraft({ type: "update", template, recipientName: ["Front Desk"], jobs, signOff });
    expect(single.body.endsWith("Thanks,\nJustin\nHumphreys Electronics")).toBe(true);
    expect(buildShopDraft({ type: "update", template, recipientName: [], jobs, signOff }).body.startsWith("Hi {Name},")).toBe(true);
    expect(buildShopDraft({ type: "custom", template: null, recipientName: ["Dave", "Justin"], jobs: [], signOff }).body.startsWith("Hi Dave, Justin,")).toBe(true);
  });

  it("Custom starts blank with the recipient name", () => {
    const out = buildShopDraft({ type: "custom", template: null, recipientName: null, jobs: [], signOff });
    expect(out).toMatchObject({ subject: "{Subject}", body: "Hi {Name},\n\n{Your message}\n\nThank you,\nHumphreys Electronics" });
  });
});

describe("maskEmailHint", () => {
  it("masks like the server and rejects non-addresses", () => {
    expect(maskEmailHint("jane@shop.test")).toBe("j***@shop.test");
    expect(maskEmailHint("not an email")).toBe("");
    expect(maskEmailHint(null)).toBe("");
  });
});

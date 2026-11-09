import { describe, expect, it } from "vitest";
import { EMPTY_RECIPIENTS, recipientLabels, recipientPayload } from "@/lib/ai-tools/email-recipients";

const contacts = [
  { id: 1, name: "Big Boss", email: "boss@shop.test", role: "boss" as const, is_pinned: true },
  { id: 2, name: "", email: "books@shop.test", role: "other" as const, is_pinned: false }
];

describe("email recipients", () => {
  it("defaults to the customer only", () => {
    expect(recipientPayload(EMPTY_RECIPIENTS, true)).toEqual({ to_customer: true });
    expect(recipientLabels(EMPTY_RECIPIENTS, true, "j***@example.com", contacts)).toEqual({ to: ["j***@example.com"], cc: [] });
  });

  it("puts contacts, staff and typed addresses on Cc when the customer is To", () => {
    const sel = { toCustomer: true, contactIds: [1, 2], staffCc: ["amy@shop.test"], typed: ["x@example.com"] };
    expect(recipientPayload(sel, true)).toEqual({
      to_customer: true,
      cc_contact_ids: [1, 2],
      cc_emails: ["amy@shop.test", "x@example.com"]
    });
    expect(recipientLabels(sel, true, "j***@example.com", contacts).cc).toEqual([
      "Big Boss <boss@shop.test>",
      "books@shop.test",
      "amy@shop.test",
      "x@example.com"
    ]);
  });

  it("moves contacts and typed addresses to To when the customer is unchecked or has no email", () => {
    const sel = { toCustomer: true, contactIds: [1], staffCc: ["amy@shop.test"], typed: ["x@example.com"] };
    const expected = { to_customer: false, to_contact_ids: [1], to_emails: ["x@example.com"], cc_emails: ["amy@shop.test"] };
    expect(recipientPayload(sel, false)).toEqual(expected);
    expect(recipientPayload({ ...sel, toCustomer: false }, true)).toEqual(expected);
    expect(recipientLabels({ ...sel, toCustomer: false }, true, "j***@example.com", contacts)).toEqual({
      to: ["Big Boss <boss@shop.test>", "x@example.com"],
      cc: ["amy@shop.test"]
    });
  });

  it("has no To when nothing but staff is picked", () => {
    const sel = { toCustomer: false, contactIds: [], staffCc: ["amy@shop.test"], typed: [] };
    expect(recipientLabels(sel, true, "j***@example.com", contacts).to).toEqual([]);
  });
});

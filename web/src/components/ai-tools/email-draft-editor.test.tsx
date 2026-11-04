import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailDraftEditor } from "@/components/ai-tools/email-draft-editor";

afterEach(cleanup);

const LONG_SUBJECT = "Your repair for job #31201 is ready for pickup at the shop - please bring your claim ticket";

function renderEditor(onChange = vi.fn()) {
  render(
    <EmailDraftEditor
      draft={{ subject: LONG_SUBJECT, body: "Hi" }}
      onChange={onChange}
      recipientHint="j***@example.com"
      busy={false}
      canOpenInEditor
      onOpenInEditor={vi.fn()}
      onRegenerate={vi.fn()}
      canRegenerate
    />
  );
  return onChange;
}

describe("EmailDraftEditor header", () => {
  it("shows the full subject in a wrapping, editable field on its own row", () => {
    const onChange = renderEditor();
    const subject = screen.getByLabelText("Subject:");
    // A textarea wraps long subjects instead of clipping them like a one-line input.
    expect(subject.tagName).toBe("TEXTAREA");
    expect(subject).toHaveValue(LONG_SUBJECT);
    expect(subject.className).toMatch(/whitespace-pre-wrap|break-words/);

    fireEvent.change(subject, { target: { value: "New subject" } });
    expect(onChange).toHaveBeenCalledWith({ subject: "New subject", body: "Hi" });
  });

  it("keeps the subject single-line: Enter does not insert a newline", () => {
    renderEditor();
    const subject = screen.getByLabelText("Subject:");
    const event = fireEvent.keyDown(subject, { key: "Enter" });
    // fireEvent returns false when preventDefault was called.
    expect(event).toBe(false);
  });

  it("strips line breaks pasted into the subject", () => {
    const onChange = renderEditor();
    fireEvent.change(screen.getByLabelText("Subject:"), { target: { value: "Line one\nLine two" } });
    expect(onChange).toHaveBeenCalledWith({ subject: "Line one Line two", body: "Hi" });
  });

  it("shows the masked recipient hint from the server", () => {
    renderEditor();
    expect(screen.getByText(/To: j\*\*\*@example.com/)).toBeInTheDocument();
  });

  it("says when the customer has no email on file and disables Send", () => {
    render(
      <EmailDraftEditor
        draft={{ subject: "S", body: "B" }}
        onChange={vi.fn()}
        recipientHint=""
        busy={false}
        canOpenInEditor={false}
        onOpenInEditor={vi.fn()}
        onRegenerate={vi.fn()}
        canRegenerate
        onSend={vi.fn()}
        sendBlockedReason="Send is disabled: no email address on file for this customer."
      />
    );
    expect(screen.getByText("customer has no email on file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send email" })).toBeDisabled();
  });
});

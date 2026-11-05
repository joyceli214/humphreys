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
      onOpenInEmailApp={vi.fn()}
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
        onOpenInEmailApp={vi.fn()}
        onRegenerate={vi.fn()}
        canRegenerate
        onSend={vi.fn()}
        sendBlockedReason="Send is disabled: no email address on file for this customer."
      />
    );
    expect(screen.getByText("customer has no email on file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send email" })).toBeDisabled();
  });

  it("replaces 'Open in Email Customer editor' with 'Open in email app'", () => {
    const onOpen = vi.fn();
    render(
      <EmailDraftEditor
        draft={{ subject: "S", body: "B" }}
        onChange={vi.fn()}
        recipientHint="j***@example.com"
        busy={false}
        onOpenInEmailApp={onOpen}
        onRegenerate={vi.fn()}
        canRegenerate
        onSend={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /Email Customer editor/ })).toBeNull();
    expect(screen.queryByText(/Email Customer editor/)).toBeNull();
    const open = screen.getByRole("button", { name: "Open in email app" });
    expect(open).toBeEnabled();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Send email" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing is sent until you press Send email and confirm. 'Open in email app' opens your device's email app with this draft; add photos there."
      )
    ).toBeInTheDocument();
  });

  it("disables 'Open in email app' for an incomplete draft and shows Copy draft only when given", () => {
    const onCopy = vi.fn();
    const props = { onChange: vi.fn(), recipientHint: "", busy: false, onOpenInEmailApp: vi.fn(), onRegenerate: vi.fn(), canRegenerate: true };
    const { rerender } = render(<EmailDraftEditor {...props} draft={{ subject: "S", body: " " }} />);
    expect(screen.getByRole("button", { name: "Open in email app" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Copy draft" })).toBeNull();

    rerender(<EmailDraftEditor {...props} draft={{ subject: "S", body: "B" }} onCopyDraft={onCopy} emailAppNotes={<p>a note</p>} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy draft" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("a note")).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_EMAIL_DRAFT_KEY_PREFIX,
  AI_EMAIL_DRAFT_TTL_MS,
  jobEmailHandoffPath,
  openJobWithDraft,
  saveAIEmailDraft,
  takeAIEmailDraft,
  templateForDraftType
} from "@/lib/ai-tools/email-handoff";

afterEach(() => {
  window.localStorage.clear();
});

const DRAFT = { referenceId: 31178, template: "job_started" as const, subject: "Estimate", body: "Hi Paul" };

describe("AI email draft handoff", () => {
  it("round-trips a draft keyed by job id and consumes it once", () => {
    expect(saveAIEmailDraft(DRAFT, 1000)).toBe(true);
    expect(window.localStorage.getItem(`${AI_EMAIL_DRAFT_KEY_PREFIX}31178`)).not.toBeNull();
    expect(takeAIEmailDraft(31178, 2000)).toMatchObject(DRAFT);
    expect(takeAIEmailDraft(31178, 2000)).toBeNull();
  });

  it("does not leak a draft to another job", () => {
    saveAIEmailDraft(DRAFT, 1000);
    expect(takeAIEmailDraft(99999, 1000)).toBeNull();
    expect(takeAIEmailDraft(31178, 1000)).not.toBeNull();
  });

  it("ignores expired and malformed entries", () => {
    saveAIEmailDraft(DRAFT, 0);
    expect(takeAIEmailDraft(31178, AI_EMAIL_DRAFT_TTL_MS + 1)).toBeNull();
    window.localStorage.setItem(`${AI_EMAIL_DRAFT_KEY_PREFIX}31178`, "{not json");
    expect(takeAIEmailDraft(31178)).toBeNull();
    window.localStorage.setItem(`${AI_EMAIL_DRAFT_KEY_PREFIX}31178`, JSON.stringify({ ...DRAFT, template: "bogus", createdAt: Date.now() }));
    expect(takeAIEmailDraft(31178)).toBeNull();
  });

  it("maps draft types onto the send endpoint's templates", () => {
    expect(templateForDraftType("ready_for_pickup")).toBe("job_completed");
    expect(templateForDraftType("estimate")).toBe("job_started");
    expect(templateForDraftType("progress_update")).toBe("job_started");
    expect(templateForDraftType("custom")).toBe("job_started");
  });

  it("navigates the opener window to the job when available", () => {
    const assign = vi.fn();
    const focus = vi.fn();
    const open = vi.fn();
    const fakeWin = { opener: { closed: false, location: { assign }, focus }, open } as unknown as Window;
    openJobWithDraft(31178, fakeWin);
    expect(assign).toHaveBeenCalledWith(jobEmailHandoffPath(31178));
    expect(jobEmailHandoffPath(31178)).toBe("/work-orders/31178?ai_email=1");
    expect(focus).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to a new tab when there is no opener", () => {
    const open = vi.fn();
    openJobWithDraft(31178, { opener: null, open } as unknown as Window);
    expect(open).toHaveBeenCalledWith("/work-orders/31178?ai_email=1", "_blank");
  });
});

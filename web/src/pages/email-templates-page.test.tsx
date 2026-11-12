import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listEmailTemplates = vi.fn();
const updateEmailTemplate = vi.fn();
const sendTestEmailTemplate = vi.fn();
const alerts = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    listEmailTemplates: (...a: unknown[]) => listEmailTemplates(...a),
    updateEmailTemplate: (...a: unknown[]) => updateEmailTemplate(...a),
    sendTestEmailTemplate: (...a: unknown[]) => sendTestEmailTemplate(...a)
  }
}));
vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({ hasPermission: (p: string) => p === "work_orders:update", user: { email: "tester@shop.test" } })
}));
vi.mock("@/lib/alerts/alert-context", () => ({ useAlerts: () => alerts }));

// MDXEditor does not run in jsdom: a textarea stand-in with the same props.
vi.mock("@mdxeditor/editor", () => {
  const MDXEditor = forwardRef(function MDXEditor(
    { markdown, onChange }: { markdown: string; onChange: (v: string) => void },
    ref: React.Ref<unknown>
  ) {
    const el = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({
      setMarkdown: (v: string) => el.current && (el.current.value = v),
      getMarkdown: () => el.current?.value ?? "",
      insertMarkdown: () => undefined,
      focus: () => undefined
    }));
    return <textarea aria-label="Rich text" ref={el} defaultValue={markdown} onChange={(e) => onChange(e.target.value)} />;
  });
  const noop = () => ({});
  const Nothing = () => null;
  return {
    MDXEditor,
    directivesPlugin: noop,
    linkDialogPlugin: noop,
    linkPlugin: noop,
    listsPlugin: noop,
    markdownShortcutPlugin: noop,
    toolbarPlugin: noop,
    BoldItalicUnderlineToggles: Nothing,
    CreateLink: Nothing,
    ListsToggle: Nothing,
    UndoRedo: Nothing
  };
});
vi.mock("@mdxeditor/editor/style.css", () => ({}));

import EmailTemplatesPage from "@/pages/email-templates-page";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/email-templates";

function apiItems() {
  return Object.values(DEFAULT_EMAIL_TEMPLATES).map((t) => ({ ...t, updated_at: "2026-11-11T00:00:00Z" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listEmailTemplates.mockResolvedValue({ items: apiItems() });
  updateEmailTemplate.mockImplementation((key: string, payload: { subject_template: string; body_template: string }) =>
    Promise.resolve({ ...DEFAULT_EMAIL_TEMPLATES[key as keyof typeof DEFAULT_EMAIL_TEMPLATES], ...payload, updated_at: "" })
  );
  sendTestEmailTemplate.mockResolvedValue({ sent: true });
});
afterEach(cleanup);

function renderPage(path = "/email-templates") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EmailTemplatesPage />
    </MemoryRouter>
  );
}

describe("EmailTemplatesPage groups", () => {
  it("lists Customer, Supplier and Shop groups with no Custom row or Add a draft", async () => {
    renderPage();
    const list = await screen.findByRole("navigation", { name: "Templates" });
    const groups = within(list).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Customer", "Supplier", "Shop"]);
    expect(within(groups[0]).getAllByRole("button").map((b) => b.textContent)).toEqual(["Job Started Email", "Job Completed Email"]);
    expect(within(groups[1]).getAllByRole("button").map((b) => b.textContent)).toEqual(["Parts inquiry", "Order follow-up"]);
    expect(within(groups[2]).getAllByRole("button").map((b) => b.textContent)).toEqual(["Ask for approval", "Ask for an update"]);
    expect(screen.queryByRole("button", { name: /^Custom/ })).toBeNull();
    expect(screen.queryByText(/Add a draft/i)).toBeNull();
    expect(screen.getByText("Customize Customer, Supplier, and Shop emails. Fields you insert fill in from the job.")).toBeInTheDocument();
    // Customer still opens first, without a job-card slot.
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Job Started Email");
    expect(screen.queryByText("Job cards — added automatically from the jobs you pick")).toBeNull();
  });

  it("deep-links ?key= to a template and ?kind= to the first of that kind", async () => {
    renderPage("/email-templates?key=shop_update");
    expect(await screen.findByRole("heading", { level: 2, name: "Ask for an update" })).toBeInTheDocument();
    expect(screen.getByText("An Update blank for each job")).toBeInTheDocument();
    cleanup();
    renderPage("/email-templates?kind=supplier");
    expect(await screen.findByRole("heading", { level: 2, name: "Parts inquiry" })).toBeInTheDocument();
    expect(screen.getByText("Part and Qty for each job")).toBeInTheDocument();
    cleanup();
    renderPage("/email-templates?key=nope");
    expect(await screen.findByRole("heading", { level: 2, name: "Job Started Email" })).toBeInTheDocument();
  });

  it("shows the locked slot between two editors and saves it back exactly once", async () => {
    renderPage("/email-templates?key=shop_approval");
    const slot = await screen.findByRole("note", { name: "Job cards slot" });
    expect(slot).toHaveTextContent("Job cards — added automatically from the jobs you pick");
    expect(slot).toHaveTextContent("Part, Qty, and Cost");
    expect(slot).toHaveAttribute("contenteditable", "false");
    expect(screen.getByText(/A card for each job \(Part, Qty, Cost\) is added when you write the email/)).toBeInTheDocument();

    const [before, after] = screen.getAllByLabelText("Rich text") as HTMLTextAreaElement[];
    expect(before.value).not.toContain("job_cards");
    expect(after.value).not.toContain("job_cards");
    fireEvent.change(before, { target: { value: "Hi team, please approve." } });
    fireEvent.change(after, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateEmailTemplate).toHaveBeenCalledTimes(1));
    const [key, payload] = updateEmailTemplate.mock.calls[0];
    expect(key).toBe("shop_approval");
    expect(payload.body_template).toBe("Hi team, please approve.\n\n{{job_cards}}");
  });

  it("Reset Default restores the new template's default copy", async () => {
    listEmailTemplates.mockResolvedValue({
      items: apiItems().map((t) => (t.key === "supplier_order_followup" ? { ...t, body_template: "Changed\n\n{{job_cards}}" } : t))
    });
    renderPage("/email-templates?key=supplier_order_followup");
    await screen.findByRole("note", { name: "Job cards slot" });
    await waitFor(() => expect((screen.getAllByLabelText("Rich text")[0] as HTMLTextAreaElement).value).toBe("Changed"));
    fireEvent.click(screen.getByRole("button", { name: "Reset Default" }));
    await waitFor(() =>
      expect((screen.getAllByLabelText("Rich text")[0] as HTMLTextAreaElement).value).toContain("Could you let us know where these parts are")
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateEmailTemplate).toHaveBeenCalled());
    expect(updateEmailTemplate.mock.calls[0][1].body_template).toBe(DEFAULT_EMAIL_TEMPLATES.supplier_order_followup.body_template);
  });
});

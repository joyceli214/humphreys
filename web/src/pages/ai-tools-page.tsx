import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { MassUpdateTab } from "@/components/ai-tools/mass-update-tab";
import { AdvancedSearchTab } from "@/components/ai-tools/advanced-search-tab";
import { EmailDraftsTab } from "@/components/ai-tools/email-drafts-tab";
import { DockBackButton } from "@/components/ai-tools/dock-back-button";
import { PENDING_EMAIL_DRAFT_KEY, takePendingEmailDraft } from "@/lib/ai-tools/open-email-drafts";
import type { EmailDraftTarget } from "@/lib/ai-tools/types";

// The former "Job Summary" tab (components/ai-tools/job-summary-tab.tsx) is
// intentionally kept in the repo, unused, for reuse on the dashboard later.

type TabKey = "mass-update" | "advanced-search" | "email-drafts";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "mass-update", label: "Mass Update" },
  { key: "advanced-search", label: "Advanced Search" },
  { key: "email-drafts", label: "Customer Email Drafts" }
];

// The active panel grows to fill the remaining height. Inactive panels use the
// `hidden` class too, because a `flex` class would otherwise override [hidden].
function panelClass(active: boolean) {
  return active ? "flex min-w-0 flex-1 flex-col" : "hidden";
}

export default function AIToolsPage() {
  const [tab, setTab] = useState<TabKey>("mass-update");
  const [emailTarget, setEmailTarget] = useState<EmailDraftTarget | null>(null);

  useEffect(() => {
    document.title = "Management";
  }, []);

  // "Draft email" on a work-order page queues a job for the email drafts tab.
  // Take it on load, and when this page is already open (split pane or
  // pop-out) via the cross-document storage event / regaining focus.
  useEffect(() => {
    const take = () => {
      const target = takePendingEmailDraft();
      if (!target) return;
      setEmailTarget(target);
      setTab("email-drafts");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === PENDING_EMAIL_DRAFT_KEY && event.newValue != null) take();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") take();
    };
    take();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", take);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", take);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#faf7f4] text-neutral-800">
      {/* Fills the whole window / pane width and height; each tab lays itself out responsively. */}
      <div className="flex w-full min-w-0 flex-1 flex-col px-4 pb-6 sm:px-7">
        {/* Header + tab bar stay visible; the page itself scrolls without any height cap. */}
        <div data-testid="ai-tools-sticky-header" className="sticky top-0 z-20 bg-[#faf7f4] pt-6">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">Management</h1>
              <p className="mt-0.5 text-sm text-neutral-500">Admin and owner only. The AI proposes, you approve.</p>
            </div>
            <DockBackButton />
          </header>

          <div role="tablist" aria-label="AI tools" className="mt-4 flex gap-1 border-b border-[#e0d9d1]">
            {TABS.map((entry) => {
              const active = entry.key === tab;
              return (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  id={`ai-tab-${entry.key}`}
                  aria-selected={active}
                  aria-controls={`ai-panel-${entry.key}`}
                  onClick={() => setTab(entry.key)}
                  className={cn(
                    "-mb-px border-b-2 px-3.5 py-2 text-sm",
                    active
                      ? "border-[#c2571a] font-semibold text-neutral-900"
                      : "border-transparent text-neutral-500 hover:text-neutral-800"
                  )}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Panels stay mounted so switching tabs keeps in-progress work. */}
        <div className="mt-4 flex min-w-0 flex-1 flex-col">
          <section
            role="tabpanel"
            id="ai-panel-mass-update"
            aria-labelledby="ai-tab-mass-update"
            hidden={tab !== "mass-update"}
            className={panelClass(tab === "mass-update")}
          >
            <MassUpdateTab />
          </section>
          <section
            role="tabpanel"
            id="ai-panel-advanced-search"
            aria-labelledby="ai-tab-advanced-search"
            hidden={tab !== "advanced-search"}
            className={panelClass(tab === "advanced-search")}
          >
            <AdvancedSearchTab />
          </section>
          <section
            role="tabpanel"
            id="ai-panel-email-drafts"
            aria-labelledby="ai-tab-email-drafts"
            hidden={tab !== "email-drafts"}
            className={panelClass(tab === "email-drafts")}
          >
            <EmailDraftsTab target={emailTarget} />
          </section>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { MassUpdateTab } from "@/components/ai-tools/mass-update-tab";
import { AdvancedSearchTab } from "@/components/ai-tools/advanced-search-tab";
import { AskTab } from "@/components/ai-tools/ask/ask-tab";
import { EmailTab } from "@/components/ai-tools/email-flow/email-tab";
import { COMMON_CONTACTS_PATH, EMAIL_TEMPLATES_PATH } from "@/lib/ai-tools/email-flow";
import { DockBackButton } from "@/components/ai-tools/dock-back-button";
import { FOCUS } from "@/components/ai-tools/mgmt-ui";
import { PENDING_EMAIL_DRAFT_KEY, takePendingEmailDraft } from "@/lib/ai-tools/open-email-drafts";
import type { EmailDraftTarget } from "@/lib/ai-tools/types";

// The former "Job Summary" tab (components/ai-tools/job-summary-tab.tsx) is
// intentionally kept in the repo, unused, for reuse on the dashboard later.

type MainTab = "ask" | "email";
type View = MainTab | "mass-update" | "advanced-search";

const TABS: Array<{ key: MainTab; label: string }> = [
  { key: "ask", label: "Ask" },
  { key: "email", label: "Email" }
];

const MORE_TITLES: Record<"mass-update" | "advanced-search", string> = {
  "mass-update": "Mass Update",
  "advanced-search": "Advanced Search"
};

// The active panel grows to fill the remaining height. Inactive panels use the
// `hidden` class too, because a `flex` class would otherwise override [hidden].
function panelClass(active: boolean) {
  return active ? "flex min-w-0 flex-1 flex-col" : "hidden";
}

const MENU_ITEM = cn("flex min-h-[46px] w-full items-center rounded-lg px-3.5 text-left text-[17px] text-[#1f2328] hover:bg-[#f2eee9]", FOCUS);

export default function AIToolsPage() {
  const [view, setView] = useState<View>("ask");
  const [lastTab, setLastTab] = useState<MainTab>("ask");
  const [emailTarget, setEmailTarget] = useState<EmailDraftTarget | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Management";
  }, []);

  // "Draft email" on a work-order page queues a job for the Email tab (Customer,
  // job added to Who). Take it on load, and when this page is already open
  // (split pane or pop-out) via the cross-document storage event / regaining focus.
  useEffect(() => {
    const take = () => {
      const target = takePendingEmailDraft();
      if (!target) return;
      setEmailTarget(target);
      setView("email");
      setLastTab("email");
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

  // Close the More menu on outside click.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: MouseEvent) => {
      const t = event.target as Node;
      if (!menuRef.current?.contains(t) && !moreButton.current?.contains(t)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen]);

  useEffect(() => {
    if (moreOpen) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [moreOpen]);

  const closeMore = (refocus = true) => {
    setMoreOpen(false);
    if (refocus) moreButton.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMore();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  };

  const openView = (next: "mass-update" | "advanced-search") => {
    setView(next);
    closeMore(false);
  };

  const showTab = (tab: MainTab) => {
    setView(tab);
    setLastTab(tab);
  };

  const inMore = view === "mass-update" || view === "advanced-search";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#f7f4f1] text-[#1f2328]">
      {/* Fills the whole window / pane width and height; each panel lays itself out responsively. */}
      <div className="flex w-full min-w-0 flex-1 flex-col px-4 sm:px-7">
        {/* Header + tab bar stay visible; the page itself scrolls without any height cap. */}
        <div data-testid="ai-tools-sticky-header" className="sticky top-0 z-20 -mx-4 border-b border-[#d5d9de] bg-[#f7f4f1] px-4 pt-[max(8px,env(safe-area-inset-top))] sm:-mx-7 sm:px-7">
          <header className="relative flex min-h-[48px] items-center justify-between gap-3">
            <h1 className="text-[17px] font-bold text-[#b8501a]">Management</h1>
            <div className="flex items-center gap-1">
              <button
                ref={moreButton}
                type="button"
                aria-label="More"
                title="More"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-controls="mgmt-more-menu"
                onClick={() => setMoreOpen((v) => !v)}
                className={cn("grid h-11 w-11 place-items-center rounded-[10px] text-[#3b424b] hover:bg-[#ebe6e1]", FOCUS)}
              >
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </button>
              <DockBackButton />
            </div>
            {moreOpen && (
              <div
                ref={menuRef}
                id="mgmt-more-menu"
                role="menu"
                aria-label="More"
                onKeyDown={onMenuKeyDown}
                className="absolute right-0 top-full z-30 min-w-[230px] rounded-xl border border-[#d5d9de] bg-white p-1.5 shadow-lg"
              >
                <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => openView("mass-update")}>
                  Mass Update
                </button>
                <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => openView("advanced-search")}>
                  Advanced Search
                </button>
                <a role="menuitem" href={EMAIL_TEMPLATES_PATH} target="_blank" rel="noopener noreferrer" className={MENU_ITEM} onClick={() => closeMore(false)}>
                  Email templates
                </a>
                <a role="menuitem" href={COMMON_CONTACTS_PATH} target="_blank" rel="noopener noreferrer" className={MENU_ITEM} onClick={() => closeMore(false)}>
                  Common contacts
                </a>
              </div>
            )}
          </header>

          {inMore ? (
            <div className="flex min-h-[56px] items-center gap-2 pb-2">
              <button
                type="button"
                onClick={() => showTab(lastTab)}
                className={cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-2 text-[16px] font-bold text-[#135f6f] hover:bg-[#ebe6e1]", FOCUS)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to {lastTab === "ask" ? "Ask" : "Email"}
              </button>
              <span className="text-[17px] font-semibold">{MORE_TITLES[view]}</span>
            </div>
          ) : (
            <div role="tablist" aria-label="Management" className="mb-3 mt-0.5 grid grid-cols-2 rounded-[12px] bg-[#e7e2dc] p-1">
              {TABS.map((entry) => {
                const active = entry.key === view;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="tab"
                    id={`ai-tab-${entry.key}`}
                    aria-selected={active}
                    aria-controls={`ai-panel-${entry.key}`}
                    onClick={() => showTab(entry.key)}
                    className={cn(
                      "min-h-[44px] rounded-[9px] text-[17px] font-semibold",
                      active ? "bg-white text-[#b8501a] shadow" : "text-[#4a5260] hover:text-[#1f2328]",
                      FOCUS
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Panels stay mounted so switching keeps in-progress work. */}
        <div className="mt-4 flex min-w-0 flex-1 flex-col">
          {TABS.map((entry) => (
            <section
              key={entry.key}
              role="tabpanel"
              id={`ai-panel-${entry.key}`}
              aria-labelledby={`ai-tab-${entry.key}`}
              hidden={view !== entry.key}
              className={panelClass(view === entry.key)}
            >
              {entry.key === "ask" ? <AskTab /> : <EmailTab target={emailTarget} />}
            </section>
          ))}
          <section aria-label="Mass Update" hidden={view !== "mass-update"} className={cn(panelClass(view === "mass-update"), "pb-6")}>
            <MassUpdateTab />
          </section>
          <section aria-label="Advanced Search" hidden={view !== "advanced-search"} className={cn(panelClass(view === "advanced-search"), "pb-6")}>
            <AdvancedSearchTab />
          </section>
        </div>
      </div>
    </div>
  );
}

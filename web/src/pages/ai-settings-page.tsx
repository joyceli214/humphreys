"use client";

import { RotateCcw, Save, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAlerts } from "@/lib/alerts/alert-context";
import { apiClient } from "@/lib/api/client";
import type { AISettings } from "@/lib/api/generated/types";
import { DEFAULT_AI_SETTINGS } from "@/lib/ai-settings";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PromptKey = "summary" | "work_done";

const PROMPTS: Array<{
  key: PromptKey;
  label: string;
  description: string;
  requiredPlaceholders: string[];
  rows: number;
}> = [
  {
    key: "summary",
    label: "Work Order Summary",
    description: "Generates the AI summary block on a work order.",
    requiredPlaceholders: ["{{work_order_data}}"],
    rows: 22
  },
  {
    key: "work_done",
    label: "Work Done",
    description: "Turns repair logs into customer-facing work done text.",
    requiredPlaceholders: ["{{repair_logs_summary}}"],
    rows: 22
  }
];

export default function AISettingsPage() {
  const alerts = useAlerts();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("work_orders:update");
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [selectedKey, setSelectedKey] = useState<PromptKey>("summary");
  const [apiKey, setAPIKey] = useState("");
  const [model, setModel] = useState(DEFAULT_AI_SETTINGS.openrouter_model);
  const [summaryPrompt, setSummaryPrompt] = useState(DEFAULT_AI_SETTINGS.work_order_summary_prompt);
  const [workDonePrompt, setWorkDonePrompt] = useState(DEFAULT_AI_SETTINGS.work_done_prompt);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const next = await apiClient.getAISettings();
        applySettings(next);
      } catch (err) {
        alerts.error("Failed to load AI settings", err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [alerts, canManage]);

  const dirty = useMemo(() => {
    if (!settings) return false;
    return (
      apiKey.trim() !== "" ||
      clearKey ||
      model !== settings.openrouter_model ||
      summaryPrompt !== settings.work_order_summary_prompt ||
      workDonePrompt !== settings.work_done_prompt
    );
  }, [apiKey, clearKey, model, settings, summaryPrompt, workDonePrompt]);

  const selectedPrompt = PROMPTS.find((prompt) => prompt.key === selectedKey) ?? PROMPTS[0];
  const selectedValue = promptValue(selectedKey, summaryPrompt, workDonePrompt);
  const selectedDirty = settings ? isPromptDirty(selectedKey, settings, summaryPrompt, workDonePrompt) : false;
  const providerDirty = settings ? apiKey.trim() !== "" || clearKey || model !== settings.openrouter_model : false;

  const saveSettings = async () => {
    const nextModel = model.trim();
    const nextSummaryPrompt = summaryPrompt.trim();
    const nextWorkDonePrompt = workDonePrompt.trim();

    if (!nextModel) {
      alerts.error("Model required", "Enter an OpenRouter model.");
      return;
    }
    if (!nextSummaryPrompt.includes("{{work_order_data}}")) {
      alerts.error("Missing placeholder", "Work order summary prompt must include {{work_order_data}}.");
      return;
    }
    if (!nextWorkDonePrompt.includes("{{repair_logs_summary}}")) {
      alerts.error("Missing placeholder", "Work done prompt must include {{repair_logs_summary}}.");
      return;
    }

    setSaving(true);
    try {
      const payload: Parameters<typeof apiClient.updateAISettings>[0] = {
        openrouter_model: nextModel,
        work_order_summary_prompt: nextSummaryPrompt,
        work_done_prompt: nextWorkDonePrompt
      };
      if (apiKey.trim() || clearKey) {
        payload.openrouter_api_key = clearKey ? "" : apiKey.trim();
      }
      const saved = await apiClient.updateAISettings(payload);
      applySettings(saved);
      setProviderOpen(false);
      alerts.success("AI settings saved");
    } catch (err) {
      alerts.error("Failed to save AI settings", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  };

  const applySettings = (next: AISettings) => {
    setSettings(next);
    setAPIKey("");
    setClearKey(false);
    setModel(next.openrouter_model);
    setSummaryPrompt(next.work_order_summary_prompt);
    setWorkDonePrompt(next.work_done_prompt);
  };

  const setSelectedValue = (value: string) => {
    if (selectedKey === "summary") setSummaryPrompt(value);
    if (selectedKey === "work_done") setWorkDonePrompt(value);
  };

  const resetSelectedPrompt = () => {
    if (selectedKey === "summary") setSummaryPrompt(DEFAULT_AI_SETTINGS.work_order_summary_prompt);
    if (selectedKey === "work_done") setWorkDonePrompt(DEFAULT_AI_SETTINGS.work_done_prompt);
  };

  const insertPlaceholder = (placeholder: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? selectedValue.length;
    const end = textarea?.selectionEnd ?? selectedValue.length;
    const nextValue = selectedValue.slice(0, start) + placeholder + selectedValue.slice(end);
    setSelectedValue(nextValue);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  };

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">You do not have permission to manage AI settings.</p>;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AI Settings</h1>
          <p className="text-sm text-muted-foreground">Customize prompts used for work order AI actions.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setProviderOpen(true)} disabled={loading}>
            <Settings2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Settings
            {providerDirty && <span className="ml-2 h-2 w-2 rounded-full bg-amber-500" aria-label="Unsaved provider changes" />}
          </Button>
          <Button type="button" onClick={() => void saveSettings()} disabled={saving || loading || !dirty}>
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading AI settings...</p>}

      {!loading && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-border bg-white p-3">
            <p className="mb-2 text-sm font-medium text-muted-foreground">Prompts</p>
            <div className="space-y-1">
              {PROMPTS.map((prompt) => {
                const promptDirty = settings ? isPromptDirty(prompt.key, settings, summaryPrompt, workDonePrompt) : false;

                return (
                  <button
                    key={prompt.key}
                    type="button"
                    onClick={() => setSelectedKey(prompt.key)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                      selectedKey === prompt.key ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{prompt.label}</span>
                    {promptDirty && <Badge className="bg-amber-100 text-amber-800">Unsaved</Badge>}
                  </button>
                );
              })}
            </div>
          </aside>

          <article className="rounded-lg border border-border bg-white p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{selectedPrompt.label}</h2>
                <p className="text-sm text-muted-foreground">{selectedPrompt.description}</p>
                {selectedPrompt.requiredPlaceholders.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Required placeholder:</span>
                    {selectedPrompt.requiredPlaceholders.map((placeholder) => (
                      <button
                        key={placeholder}
                        type="button"
                        onClick={() => insertPlaceholder(placeholder)}
                        className="rounded-md border border-border bg-white px-2 py-1 font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {placeholder}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {selectedDirty && <Badge className="bg-amber-100 text-amber-800">Unsaved</Badge>}
                <Button type="button" variant="outline" size="sm" onClick={resetSelectedPrompt} disabled={saving}>
                  <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  Reset Default
                </Button>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              value={selectedValue}
              onChange={(event) => setSelectedValue(event.target.value)}
              rows={selectedPrompt.rows}
              className="w-full resize-y rounded-md border border-input bg-white px-3 py-2 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </article>
        </div>
      )}

      <Dialog open={providerOpen} onOpenChange={setProviderOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">AI Provider Settings</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Configure the OpenRouter credentials and model used by AI prompt actions.
          </DialogDescription>
          <div className="mt-5 space-y-4">
            <Field
              label="OpenRouter API Key"
              help={settings?.has_openrouter_api_key ? "A key is configured. Enter a new key to replace it." : "No key is configured."}
            >
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setAPIKey(event.target.value);
                  if (event.target.value.trim()) setClearKey(false);
                }}
                placeholder={settings?.has_openrouter_api_key ? "Configured" : "sk-or-..."}
                autoComplete="off"
              />
              <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={clearKey}
                  onChange={(event) => {
                    setClearKey(event.target.checked);
                    if (event.target.checked) setAPIKey("");
                  }}
                />
                Clear saved key and use environment fallback
              </label>
            </Field>
            <Field label="Model" help="Example: google/gemma-3-27b-it:free">
              <Input value={model} onChange={(event) => setModel(event.target.value)} />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setProviderOpen(false)} disabled={saving}>
              Close
            </Button>
            <Button type="button" onClick={() => void saveSettings()} disabled={saving || !dirty}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-muted-foreground">{help}</span>}
    </label>
  );
}

function promptValue(key: PromptKey, summaryPrompt: string, workDonePrompt: string) {
  if (key === "summary") return summaryPrompt;
  return workDonePrompt;
}

function isPromptDirty(key: PromptKey, settings: AISettings, summaryPrompt: string, workDonePrompt: string) {
  if (key === "summary") return summaryPrompt !== settings.work_order_summary_prompt;
  return workDonePrompt !== settings.work_done_prompt;
}

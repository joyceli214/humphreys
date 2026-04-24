"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { apiClient } from "@/lib/api/client";
import type { EmailTemplate, EmailTemplateKey } from "@/lib/api/generated/types";
import { DEFAULT_EMAIL_TEMPLATES, EMAIL_TEMPLATE_VARIABLES, type EmailTemplateVariable } from "@/lib/email-templates";
import { useAlerts } from "@/lib/alerts/alert-context";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function EmailTemplatesPage() {
  const alerts = useAlerts();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("work_orders:update");
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState<EmailTemplateKey>("job_started");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const res = await apiClient.listEmailTemplates();
        setTemplates(res.items);
      } catch (err) {
        alerts.error("Failed to load email templates", err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [alerts, canManage]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.key === selectedKey) ?? null,
    [selectedKey, templates]
  );

  useEffect(() => {
    const fallback = DEFAULT_EMAIL_TEMPLATES[selectedKey];
    setSubject(selectedTemplate?.subject_template ?? fallback.subject_template);
    setBody(selectedTemplate?.body_template ?? fallback.body_template);
  }, [selectedKey, selectedTemplate]);

  const dirty = selectedTemplate ? subject !== selectedTemplate.subject_template || body !== selectedTemplate.body_template : false;

  const saveTemplate = async () => {
    const nextSubject = subject.trim();
    const nextBody = body.trim();
    if (!nextSubject) {
      alerts.error("Subject required", "Enter a subject template.");
      return;
    }
    if (!nextBody) {
      alerts.error("Message required", "Enter an email body template.");
      return;
    }

    setSaving(true);
    try {
      const saved = await apiClient.updateEmailTemplate(selectedKey, {
        subject_template: nextSubject,
        body_template: nextBody
      });
      setTemplates((prev) => prev.map((template) => (template.key === saved.key ? saved : template)));
      setSubject(saved.subject_template);
      setBody(saved.body_template);
      alerts.success("Email template saved");
    } catch (err) {
      alerts.error("Failed to save email template", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    const fallback = DEFAULT_EMAIL_TEMPLATES[selectedKey];
    setSubject(fallback.subject_template);
    setBody(fallback.body_template);
  };

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">You do not have permission to manage email templates.</p>;
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Email Templates</h1>
        <p className="text-sm text-muted-foreground">Customize customer emails with work order fields.</p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading email templates...</p>}

      {!loading && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-border bg-white p-3">
            <p className="mb-2 text-sm font-medium text-muted-foreground">Templates</p>
            <div className="space-y-1">
              {templates.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => setSelectedKey(template.key)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                    selectedKey === template.key ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="truncate">{template.label}</span>
                  {selectedKey === template.key && dirty && <Badge className="bg-amber-100 text-amber-800">Unsaved</Badge>}
                </button>
              ))}
            </div>
          </aside>

          <article className="rounded-lg border border-border bg-white p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{selectedTemplate?.label ?? DEFAULT_EMAIL_TEMPLATES[selectedKey].label}</h2>
                <p className="text-sm text-muted-foreground">Type @ to search and insert work order fields.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={resetToDefault} disabled={saving}>
                  Reset Default
                </Button>
                <Button type="button" size="sm" onClick={() => void saveTemplate()} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Subject</label>
                <TemplateFieldEditor
                  value={subject}
                  onChange={setSubject}
                  variables={EMAIL_TEMPLATE_VARIABLES}
                  singleLine
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Message</label>
                <TemplateFieldEditor
                  value={body}
                  onChange={setBody}
                  variables={EMAIL_TEMPLATE_VARIABLES}
                  minHeightClassName="min-h-[420px]"
                />
              </div>
            </div>
          </article>

        </div>
      )}
    </section>
  );
}

type TemplateFieldEditorProps = {
  value: string;
  onChange: (value: string) => void;
  variables: EmailTemplateVariable[];
  singleLine?: boolean;
  minHeightClassName?: string;
};

type TriggerState = {
  node: Text;
  start: number;
  end: number;
  query: string;
};

function TemplateFieldEditor({
  value,
  onChange,
  variables,
  singleLine = false,
  minHeightClassName = "min-h-10"
}: TemplateFieldEditorProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; top: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredVariables = useMemo(() => {
    if (!trigger) return [];
    const query = trigger.query.trim().toLowerCase();
    const matches = variables.filter((variable) => {
      const key = templateVariableKey(variable.token).toLowerCase();
      return !query || variable.label.toLowerCase().includes(query) || key.includes(query);
    });
    return query ? matches.slice(0, 8) : matches;
  }, [trigger, variables]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (serializeTemplateEditor(editor) === value) return;
    renderTemplateEditorValue(editor, value, variables);
    setTrigger(null);
  }, [value, variables]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trigger?.query]);

  const syncValue = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(serializeTemplateEditor(editor));
    updateTrigger(editor);
  };

  const updateTrigger = (editor: HTMLDivElement) => {
    const nextTrigger = findTemplateTrigger(editor);
    setTrigger(nextTrigger);
    setDropdownPosition(nextTrigger ? getTriggerDropdownPosition(wrapperRef.current, nextTrigger) : null);
  };

  const insertVariable = (variable: EmailTemplateVariable) => {
    const editor = editorRef.current;
    if (!editor || !trigger) return;

    const range = document.createRange();
    range.setStart(trigger.node, trigger.start);
    range.setEnd(trigger.node, trigger.end);
    range.deleteContents();

    const pill = createVariablePill(variable);
    const spacer = document.createTextNode(" ");
    range.insertNode(spacer);
    range.insertNode(pill);

    const selection = window.getSelection();
    const nextRange = document.createRange();
    nextRange.setStart(spacer, spacer.length);
    nextRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(nextRange);

    setTrigger(null);
    onChange(serializeTemplateEditor(editor));
    editor.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (trigger && filteredVariables.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % filteredVariables.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + filteredVariables.length) % filteredVariables.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertVariable(filteredVariables[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setTrigger(null);
        return;
      }
    }

    if (singleLine && event.key === "Enter") {
      event.preventDefault();
      return;
    }

    if (event.key === "Backspace" && removePreviousVariablePill()) {
      event.preventDefault();
      syncValue();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    insertPlainText(singleLine ? text.replace(/\s+/g, " ") : text);
    syncValue();
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline={!singleLine}
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        className={`w-full rounded-md border border-input bg-white px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring ${minHeightClassName} whitespace-pre-wrap`}
        onInput={syncValue}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => window.setTimeout(() => setTrigger(null), 120)}
      />
      {trigger && dropdownPosition && filteredVariables.length > 0 && (
        <div
          className="absolute z-20 mt-1 max-h-72 w-72 max-w-[calc(100%-1rem)] overflow-y-auto rounded-md border border-border bg-white p-1 shadow-lg"
          style={{ left: dropdownPosition.left, top: dropdownPosition.top }}
        >
          {filteredVariables.map((variable, index) => (
            <button
              key={variable.token}
              type="button"
              className={`flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm ${
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                insertVariable(variable);
              }}
            >
              <span>{variable.label}</span>
              <span className="text-xs text-muted-foreground">@{templateVariableKey(variable.token)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function renderTemplateEditorValue(editor: HTMLDivElement, value: string, variables: EmailTemplateVariable[]) {
  editor.replaceChildren();
  const variableByKey = new Map(variables.map((variable) => [templateVariableKey(variable.token), variable]));
  const pattern = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      editor.appendChild(document.createTextNode(value.slice(cursor, match.index)));
    }
    const key = match[1];
    editor.appendChild(createVariablePill(variableByKey.get(key) ?? { token: `{{${key}}}`, label: key }));
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    editor.appendChild(document.createTextNode(value.slice(cursor)));
  }
}

function createVariablePill(variable: EmailTemplateVariable) {
  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.templateVariable = templateVariableKey(variable.token);
  pill.className = "mx-0.5 inline-flex select-none items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800";
  pill.textContent = variable.label;
  return pill;
}

function serializeTemplateEditor(root: HTMLElement): string {
  const serializeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node instanceof HTMLBRElement) return "\n";
    if (node instanceof HTMLElement && node.dataset.templateVariable) return `{{${node.dataset.templateVariable}}}`;
    if (node instanceof HTMLDivElement || node instanceof HTMLParagraphElement) {
      return `${Array.from(node.childNodes).map(serializeNode).join("")}\n`;
    }
    return Array.from(node.childNodes).map(serializeNode).join("");
  };

  return Array.from(root.childNodes).map(serializeNode).join("").replace(/\u00a0/g, " ");
}

function findTemplateTrigger(root: HTMLElement): TriggerState | null {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

  const node = range.startContainer as Text;
  const before = node.data.slice(0, range.startOffset);
  const atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;
  const prefix = before.slice(0, atIndex);
  if (prefix.length > 0 && !/\s$/.test(prefix)) return null;
  const query = before.slice(atIndex + 1);
  if (/[\n\r{}]/.test(query)) return null;
  return { node, start: atIndex, end: range.startOffset, query };
}

function getTriggerDropdownPosition(wrapper: HTMLDivElement | null, trigger: TriggerState) {
  if (!wrapper) return { left: 0, top: 0 };

  const range = document.createRange();
  range.setStart(trigger.node, trigger.start);
  range.setEnd(trigger.node, Math.max(trigger.start + 1, trigger.end));
  const rect = range.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const maxLeft = Math.max(0, wrapperRect.width - 288);

  return {
    left: Math.min(Math.max(0, rect.left - wrapperRect.left), maxLeft),
    top: rect.bottom - wrapperRect.top
  };
}

function removePreviousVariablePill() {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  const container = range.startContainer;

  if (container.nodeType === Node.TEXT_NODE) {
    if (range.startOffset > 0) return false;
    const previous = previousContentNode(container);
    if (isVariablePill(previous)) {
      previous.remove();
      return true;
    }
    return false;
  }

  if (container instanceof HTMLElement) {
    const previous = container.childNodes.item(range.startOffset - 1);
    if (isVariablePill(previous)) {
      previous.remove();
      return true;
    }
  }
  return false;
}

function previousContentNode(node: Node) {
  let current: Node | null = node;
  while (current && !current.previousSibling) current = current.parentNode;
  return current?.previousSibling ?? null;
}

function isVariablePill(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && Boolean(node.dataset.templateVariable);
}

function insertPlainText(text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStart(node, node.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function templateVariableKey(token: string) {
  return token.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
}

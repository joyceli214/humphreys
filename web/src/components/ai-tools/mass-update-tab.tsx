import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type {
  LineItemCatalogItem,
  MassUpdateApplyResult,
  MassUpdateExpectedUpdatedAt,
  MassUpdatePreviewResponse
} from "@/lib/ai-tools/types";
import {
  catalogTemplateValues,
  composeTemplate,
  emptyValues,
  type TemplateId,
  type TemplateValues
} from "@/lib/ai-tools/mass-update-templates";
import { MassUpdateTemplateSlots } from "@/components/ai-tools/mass-update-template-slots";
import { AI_TEXT_MAX } from "@/lib/ai-tools/limits";
import { AI_TEXTAREA_CLASS, AIButton, AICard, AICardTitle, AIErrorBox, AIPill, errorMessage } from "@/components/ai-tools/ai-ui";
import { CharCounterInput } from "@/components/ai-tools/char-counter-input";
import { MassUpdatePreviewTable, defaultSelectedRowIndexes } from "@/components/ai-tools/mass-update-preview-table";
import { MassUpdateResults, plural } from "@/components/ai-tools/mass-update-results";
import { MassUpdateCapabilities } from "@/components/ai-tools/mass-update-capabilities";
import { MassUpdateMoneySummary } from "@/components/ai-tools/mass-update-money-summary";
import { LineItemCatalog } from "@/components/ai-tools/line-item-catalog";

/** Adds `addition` on a new line (if there is text already), kept within the server cap. */
function appendLine(current: string, addition: string) {
  const joined = current.trim() ? `${current.replace(/\s+$/, "")}\n${addition}` : addition;
  return joined.slice(0, AI_TEXT_MAX);
}

/** The example being filled in: its slot values plus any text kept above the composed line. */
type ActiveTemplate = { id: TemplateId; values: TemplateValues; prefix: string };

export function MassUpdateTab() {
  const [instruction, setInstruction] = useState("");
  const [template, setTemplate] = useState<ActiveTemplate | null>(null);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [catalogItems, setCatalogItems] = useState<LineItemCatalogItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listWorkOrderStatuses()
      .then((res) => {
        if (!cancelled) setStatusOptions(res.items.map((item) => item.label));
      })
      .catch(() => {
        // The status slot falls back to a plain text box.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Shows the template's slots and composes the instruction from them. */
  const activate = (next: ActiveTemplate) => {
    setTemplate(next);
    setInstruction(appendLine(next.prefix, composeTemplate(next.id, next.values)));
  };

  const setSlot = (key: string, value: string) => {
    if (!template) return;
    const values = { ...template.values, [key]: value };
    // Picking a catalog item in the add-item template fills in its typical price and qty when blank.
    if (template.id === "add-item" && key === "item") {
      const match = catalogItems.find((item) => item.name === value);
      if (match) {
        const prefill = catalogTemplateValues(match);
        if (!values.price) values.price = prefill.price;
        if (!values.qty) values.qty = prefill.qty;
      }
    }
    activate({ ...template, values });
  };

  /** Typing in the instruction box directly detaches the slots and keeps the text as typed. */
  const editInstruction = (text: string) => {
    setTemplate(null);
    setInstruction(text);
  };
  const [preview, setPreview] = useState<MassUpdatePreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<MassUpdateApplyResult[] | null>(null);

  const runPreview = async () => {
    const text = instruction.trim();
    if (!text) {
      setError("Please describe the changes you want to make.");
      return;
    }
    setPreviewing(true);
    setError("");
    setResults(null);
    try {
      const res = await apiClient.previewAIMassUpdate(text);
      setPreview(res);
      setSelected(defaultSelectedRowIndexes(res.rows));
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err, "The preview could not be created. Please try again."));
    } finally {
      setPreviewing(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    const chosen = preview.rows.filter((row, index) => row.valid && selected.has(index));
    if (chosen.length === 0) return;
    const operations = chosen.map((row) => row.operation);
    // The server rejects any job whose updated_at no longer matches the preview.
    const expectedUpdatedAt: MassUpdateExpectedUpdatedAt = {};
    for (const row of chosen) expectedUpdatedAt[row.reference_id] = row.updated_at ?? null;
    setApplying(true);
    setError("");
    try {
      const res = await apiClient.applyAIMassUpdate(operations, expectedUpdatedAt);
      setResults(res.results);
      setPreview(null);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err, "The changes could not be applied. Please try again."));
    } finally {
      setApplying(false);
    }
  };

  const cancel = () => {
    setPreview(null);
    setSelected(new Set());
    setError("");
  };

  const rows = preview?.rows ?? [];
  const jobCount = new Set(rows.map((row) => row.reference_id)).size;
  const selectedCount = rows.filter((row, index) => row.valid && selected.has(index)).length;
  const invalidCount = rows.filter((row) => !row.valid).length;
  const hasWorkDone = rows.some((row) => row.valid && row.operation.op === "generate_work_done");
  const replaceCount = rows.filter((row) => row.valid && row.has_existing_work_done).length;
  const busy = previewing || applying;

  return (
    // Stacks on narrow panes; from md up the instruction takes the wide column and the
    // examples + catalog sit beside it. The preview always spans the full width.
    <div className="grid w-full flex-1 grid-cols-1 content-start gap-4 md:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 md:col-start-2 md:row-start-1">
        <MassUpdateCapabilities onExample={(id) => activate({ id, values: emptyValues(id), prefix: "" })} disabled={busy} />
      </div>

      <div className="min-w-0 space-y-4 md:col-start-1 md:row-span-2 md:row-start-1">
        <AICard>
          <label htmlFor="ai-mass-update-instruction" className="block text-sm font-semibold text-neutral-800">
            Describe the changes you want to make
          </label>
          <p id="ai-mass-update-help" className="mt-1 text-xs text-neutral-500">
            Write in plain English and include the job numbers. You will see a preview of every change before anything is saved.
          </p>
          {template && (
            <MassUpdateTemplateSlots
              templateId={template.id}
              values={template.values}
              onChange={setSlot}
              onClose={() => setTemplate(null)}
              statusOptions={statusOptions}
              catalogItems={catalogItems}
              disabled={busy}
            />
          )}
          <CharCounterInput
            multiline
            id="ai-mass-update-instruction"
            limit={AI_TEXT_MAX}
            rows={4}
            aria-describedby="ai-mass-update-help"
            className={`${AI_TEXTAREA_CLASS} mt-2 resize-y`}
            placeholder="For example: set the labour total on two jobs, or move a job to a new status. Pick an example to fill in the details."
            value={instruction}
            onValueChange={editInstruction}
            disabled={previewing || applying}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AIButton onClick={() => void runPreview()} disabled={previewing || applying || !instruction.trim()}>
              {previewing ? "Preparing preview..." : "Preview changes"}
            </AIButton>
            <AIPill>Nothing is saved until you apply</AIPill>
          </div>
        </AICard>

        {error && <AIErrorBox>{error}</AIErrorBox>}

        {results && <MassUpdateResults results={results} onDismiss={() => setResults(null)} />}
      </div>

      <div className="min-w-0 md:col-start-2 md:row-start-2">
        <LineItemCatalog
          onInsert={(item) => activate({ id: "add-item", values: catalogTemplateValues(item), prefix: instruction })}
          onLoaded={setCatalogItems}
          disabled={busy}
        />
      </div>

      {preview && (
        <AICard className="min-w-0 md:col-span-2">
          <AICardTitle>
            Preview: {plural(rows.length, "change")} across {plural(jobCount, "job")}
          </AICardTitle>
          {preview.message && (
            <p data-testid="preview-message" role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {preview.message}
            </p>
          )}
          {replaceCount > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              {plural(replaceCount, "job")} already {replaceCount === 1 ? "has" : "have"} Work Done and {replaceCount === 1 ? "was" : "were"} left
              unselected. Tick {replaceCount === 1 ? "it" : "them"} to replace the existing text.
            </p>
          )}
          {invalidCount > 0 && (
            <p className="mt-2 text-xs text-red-700">
              {plural(invalidCount, "change")} cannot be applied and {invalidCount === 1 ? "has" : "have"} been left unselected.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">
              No changes were suggested. Try rewording your request and include the job numbers you want to change.
            </p>
          ) : (
            <>
              <div className="mt-3">
                <MassUpdateMoneySummary rows={rows} selected={selected} />
              </div>
              <div className="mt-3 overflow-x-auto">
                <MassUpdatePreviewTable rows={rows} selected={selected} onChange={setSelected} disabled={applying} />
              </div>
              {hasWorkDone && (
                <p className="mt-2 text-xs text-neutral-600">Work Done text is saved exactly as shown only when you click Apply.</p>
              )}
            </>
          )}
          <div className="mt-4 flex items-center gap-2">
            <AIButton onClick={() => void apply()} disabled={applying || selectedCount === 0}>
              {applying ? "Applying changes..." : selectedCount === 0 ? "Apply selected changes" : `Apply ${plural(selectedCount, "selected change")}`}
            </AIButton>
            <AIButton variant="outline" onClick={cancel} disabled={applying}>
              Discard preview
            </AIButton>
          </div>
        </AICard>
      )}
    </div>
  );
}

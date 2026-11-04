import { useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { MassUpdateApplyResult, MassUpdateExpectedUpdatedAt, MassUpdatePreviewResponse } from "@/lib/ai-tools/types";
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

export function MassUpdateTab() {
  const [instruction, setInstruction] = useState("");
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
    <div className="space-y-4">
      <MassUpdateCapabilities onExample={(text) => setInstruction(text.slice(0, AI_TEXT_MAX))} disabled={busy} />

      <AICard>
        <label htmlFor="ai-mass-update-instruction" className="block text-sm font-semibold text-neutral-800">
          Describe the changes you want to make
        </label>
        <p id="ai-mass-update-help" className="mt-1 text-xs text-neutral-500">
          Write in plain English and include the job numbers. You will see a preview of every change before anything is saved.
        </p>
        <CharCounterInput
          multiline
          id="ai-mass-update-instruction"
          limit={AI_TEXT_MAX}
          rows={3}
          aria-describedby="ai-mass-update-help"
          className={`${AI_TEXTAREA_CLASS} mt-2 resize-y`}
          placeholder="For example: Set the labour total to $80 on jobs 31201 and 31205. Move job 31201 to Ready for Pickup on Shelf B."
          value={instruction}
          onValueChange={setInstruction}
          disabled={previewing || applying}
        />
        <div className="mt-3 flex items-center gap-2">
          <AIButton onClick={() => void runPreview()} disabled={previewing || applying || !instruction.trim()}>
            {previewing ? "Preparing preview..." : "Preview changes"}
          </AIButton>
          <AIPill>Nothing is saved until you apply</AIPill>
        </div>
      </AICard>

      <LineItemCatalog onInsert={(text) => setInstruction((current) => appendLine(current, text))} disabled={busy} />

      {error && <AIErrorBox>{error}</AIErrorBox>}

      {results && <MassUpdateResults results={results} onDismiss={() => setResults(null)} />}

      {preview && (
        <AICard>
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

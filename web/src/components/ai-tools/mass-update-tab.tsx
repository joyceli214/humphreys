import { useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { MassUpdateApplyResult, MassUpdateExpectedUpdatedAt, MassUpdatePreviewResponse } from "@/lib/ai-tools/types";
import { AI_TEXTAREA_CLASS, AIButton, AICard, AICardTitle, AIErrorBox, AIPill, errorMessage } from "@/components/ai-tools/ai-ui";
import { MassUpdatePreviewTable, selectableRowIndexes } from "@/components/ai-tools/mass-update-preview-table";
import { MassUpdateResults } from "@/components/ai-tools/mass-update-results";

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
      setError("Describe what should change.");
      return;
    }
    setPreviewing(true);
    setError("");
    setResults(null);
    try {
      const res = await apiClient.previewAIMassUpdate(text);
      setPreview(res);
      setSelected(selectableRowIndexes(res.rows));
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err, "Could not build a preview."));
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
      setError(errorMessage(err, "Could not apply changes."));
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

  return (
    <div className="space-y-4">
      <AICard>
        <label htmlFor="ai-mass-update-instruction" className="block text-sm font-semibold text-neutral-800">
          What should change?
        </label>
        <textarea
          id="ai-mass-update-instruction"
          rows={3}
          className={`${AI_TEXTAREA_CLASS} mt-2 resize-y`}
          placeholder='e.g. Set labour to $80 on jobs 31201 and 31205. Move 31201 to Ready for Pickup, location Shelf B.'
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          disabled={previewing || applying}
        />
        <div className="mt-3 flex items-center gap-2">
          <AIButton onClick={() => void runPreview()} disabled={previewing || applying || !instruction.trim()}>
            {previewing ? "Building preview..." : "Preview changes"}
          </AIButton>
          <AIPill>nothing is saved yet</AIPill>
        </div>
      </AICard>

      {error && <AIErrorBox>{error}</AIErrorBox>}

      {results && <MassUpdateResults results={results} onDismiss={() => setResults(null)} />}

      {preview && (
        <AICard>
          <AICardTitle>
            Preview: {jobCount} job{jobCount === 1 ? "" : "s"}, {rows.length} change{rows.length === 1 ? "" : "s"}
          </AICardTitle>
          {invalidCount > 0 && (
            <p className="mt-2 text-xs text-red-700">
              {invalidCount} change{invalidCount === 1 ? "" : "s"} can't be applied and {invalidCount === 1 ? "is" : "are"} left unchecked.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">The AI didn't propose any changes. Try rephrasing the instruction.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <MassUpdatePreviewTable rows={rows} selected={selected} onChange={setSelected} disabled={applying} />
            </div>
          )}
          <div className="mt-4 flex items-center gap-2">
            <AIButton onClick={() => void apply()} disabled={applying || selectedCount === 0}>
              {applying ? "Applying..." : `Apply ${selectedCount} selected change${selectedCount === 1 ? "" : "s"}`}
            </AIButton>
            <AIButton variant="outline" onClick={cancel} disabled={applying}>
              Cancel
            </AIButton>
          </div>
        </AICard>
      )}
    </div>
  );
}

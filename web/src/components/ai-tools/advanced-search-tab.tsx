import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { AISearchResponse } from "@/lib/ai-tools/types";
import { EMPTY_SEARCH_FORM, filtersToForm, formToFilters, hasSearchFormErrors, type SearchFormState } from "@/lib/ai-tools/search-form";
import { AIErrorBox, errorMessage } from "@/components/ai-tools/ai-ui";
import { SearchQuestionCard } from "@/components/ai-tools/search-question-card";
import { SearchFiltersCard } from "@/components/ai-tools/search-filters-card";
import { SearchResults } from "@/components/ai-tools/search-results";

export function AdvancedSearchTab() {
  const [question, setQuestion] = useState("");
  const [explanation, setExplanation] = useState("");
  const [form, setForm] = useState<SearchFormState>(EMPTY_SEARCH_FORM);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [interpreting, setInterpreting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AISearchResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listWorkOrderStatuses()
      .then((res) => {
        if (!cancelled) setStatusOptions(res.items.map((item) => item.label));
      })
      .catch(() => {
        // Statuses chosen by the AI still show; the picker just has no extra options.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const interpret = async () => {
    const text = question.trim();
    if (!text) return;
    setInterpreting(true);
    setError("");
    try {
      const res = await apiClient.interpretAISearch(text);
      setForm(filtersToForm(res.filters));
      setExplanation(res.explanation);
    } catch (err) {
      setExplanation("");
      setError(errorMessage(err, "Could not interpret the question."));
    } finally {
      setInterpreting(false);
    }
  };

  const search = async () => {
    if (hasSearchFormErrors(form)) return;
    setSearching(true);
    setError("");
    try {
      setResult(await apiClient.runAISearch(formToFilters(form)));
    } catch (err) {
      setResult(null);
      setError(errorMessage(err, "Search failed."));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <SearchQuestionCard
        question={question}
        onQuestionChange={setQuestion}
        onInterpret={() => void interpret()}
        interpreting={interpreting}
        disabled={searching}
        explanation={explanation}
      />
      <SearchFiltersCard
        form={form}
        onChange={setForm}
        statusOptions={statusOptions}
        onSearch={() => void search()}
        searching={searching}
        disabled={interpreting}
      />
      {error && <AIErrorBox>{error}</AIErrorBox>}
      {result && <SearchResults result={result} />}
    </div>
  );
}

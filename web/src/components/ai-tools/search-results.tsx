import type { AISearchGroupBy, AISearchResponse, AISearchRow } from "@/lib/ai-tools/types";
import { AICard, AICardTitle, AINotice } from "@/components/ai-tools/ai-ui";
import { SearchResultsTable } from "@/components/ai-tools/search-results-table";

const GROUP_LABEL: Record<Exclude<AISearchGroupBy, "none">, string> = {
  customer: "Customer",
  model: "Model",
  serial: "Serial"
};

type Section = { key: string; title: string; unitCount: number | null; rows: AISearchRow[] };

/** Splits rows into the server's groups (in order) plus an "Other" bucket for ungrouped rows. */
export function buildSections(result: AISearchResponse): Section[] {
  const groupBy = result.group_by;
  if (groupBy === "none" || !result.groups?.length) {
    return [{ key: "all", title: "", unitCount: null, rows: result.rows }];
  }
  const byId = new Map(result.rows.map((row) => [row.reference_id, row]));
  const used = new Set<number>();
  const sections: Section[] = result.groups.map((group) => {
    const rows = group.job_ids.map((id) => byId.get(id)).filter((row): row is AISearchRow => Boolean(row));
    rows.forEach((row) => used.add(row.reference_id));
    return {
      key: `${groupBy}:${group.key}`,
      title: `${GROUP_LABEL[groupBy]}: ${group.label || group.key}`,
      unitCount: group.unit_count,
      rows
    };
  });
  const rest = result.rows.filter((row) => !used.has(row.reference_id));
  if (rest.length > 0) {
    sections.push({ key: "other", title: `No ${GROUP_LABEL[groupBy].toLowerCase()}`, unitCount: null, rows: rest });
  }
  return sections;
}

export function SearchResults({ result }: { result: AISearchResponse }) {
  const { rows, total } = result;
  const sections = buildSections(result);

  return (
    <AICard>
      <AICardTitle>
        {total} job{total === 1 ? "" : "s"} found
      </AICardTitle>
      {rows.length < total && (
        <div className="mt-2">
          <AINotice>
            Showing the first {rows.length} of {total}. Narrow the filters to see the rest.
          </AINotice>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">No jobs match these filters. Try loosening them or rephrasing the question.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {sections.map((section) => (
            <section key={section.key} aria-label={section.title || "Results"}>
              {section.title && (
                <h4 className="flex items-baseline gap-2 border-b border-[#e8e2db] pb-1 text-sm font-semibold text-neutral-800">
                  <span>{section.title}</span>
                  {section.unitCount !== null && (
                    <span className="text-xs font-normal text-neutral-500">
                      {section.unitCount} unit{section.unitCount === 1 ? "" : "s"}
                    </span>
                  )}
                </h4>
              )}
              <div className="overflow-x-auto">
                <SearchResultsTable rows={section.rows} />
              </div>
            </section>
          ))}
        </div>
      )}
    </AICard>
  );
}

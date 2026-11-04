// Parsing/validation for the Advanced Search "Job number(s)" and
// "Job number ends with" inputs; mirrors cleanJobIDs / cleanJobSuffix on the server.

import { SEARCH_MAX_JOB_IDS } from "@/lib/ai-tools/limits";

const MAX_INT32 = 2147483647;

export type ParsedJobNumbers = { ids: number[]; error: string };

/** Splits comma/whitespace separated job numbers; dedupes, keeping order. */
export function parseJobNumbers(raw: string): ParsedJobNumbers {
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  const ids: number[] = [];
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      return { ids: [], error: `"${token}" is not a job number. Use digits only, separated by commas or spaces.` };
    }
    const n = Number(token);
    if (n <= 0 || n > MAX_INT32) {
      return { ids: [], error: `"${token}" is not a valid job number.` };
    }
    if (ids.includes(n)) continue;
    if (ids.length === SEARCH_MAX_JOB_IDS) {
      return { ids: [], error: `Too many job numbers (max ${SEARCH_MAX_JOB_IDS}).` };
    }
    ids.push(n);
  }
  return { ids, error: "" };
}

/** Returns "" when blank or digits only, otherwise a user-facing error. */
export function validateJobSuffix(raw: string): string {
  const s = raw.trim();
  return s === "" || /^\d+$/.test(s) ? "" : "Job number ending must contain digits only.";
}

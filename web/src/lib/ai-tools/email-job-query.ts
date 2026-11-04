import type { AISearchFilters } from "@/lib/ai-tools/types";

export const EMAIL_SEARCH_LIMIT = 20;
/** Backend caps (aiSearchMaxText / aiSearchMaxJobSuffix). */
const MAX_NAME_CHARS = 200;
const MAX_SUFFIX_DIGITS = 10;
export const MIN_SUFFIX_DIGITS = 3;

export type EmailJobQuery = { filters: AISearchFilters; shortDigits: boolean };

/**
 * Turns the Step 1 search box into search filters:
 * - any letter -> customer name contains
 * - digits only (optional leading #) -> job number ends with those digits
 * Returns null when there is nothing to search for.
 */
export function emailJobQuery(raw: string): EmailJobQuery | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (/\p{L}/u.test(text)) {
    return { filters: { customer_name: text.slice(0, MAX_NAME_CHARS), limit: EMAIL_SEARCH_LIMIT }, shortDigits: false };
  }
  const digits = text.replace(/^#\s*/, "");
  if (!/^\d+$/.test(digits)) return null;
  return {
    filters: { job_suffix: digits.slice(-MAX_SUFFIX_DIGITS), limit: EMAIL_SEARCH_LIMIT },
    shortDigits: digits.length < MIN_SUFFIX_DIGITS
  };
}

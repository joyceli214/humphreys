// Client-side mirrors of the server text caps (api/internal/modules/workorders).
// Keep in sync with the Go constants named next to each value.

/** aiToolsMaxTextChars (ai_tools_limits.go): mass-update instruction, email notes. */
export const AI_TEXT_MAX = 2000;
/** emailRewriteMaxBody (ai_tools_email_rewrite.go): body sent to the ✎ AI help rewrite. */
export const EMAIL_REWRITE_BODY_MAX = 6000;
/** aiInterpretMaxQuestion (ai_tools_search_interpret.go). */
export const SEARCH_QUESTION_MAX = 500;
/** aiSearchMaxText (ai_tools_search.go): every free-text search filter. */
export const SEARCH_TEXT_MAX = 200;
/** aiSearchMaxJobIDs (ai_tools_search_jobs.go). */
export const SEARCH_MAX_JOB_IDS = 50;
/** aiSearchMaxJobSuffix (ai_tools_search_jobs.go), in digits. */
export const SEARCH_JOB_SUFFIX_MAX = 10;
/** Room for SEARCH_MAX_JOB_IDS ten-digit numbers plus ", " separators. */
export const SEARCH_JOB_IDS_INPUT_MAX = SEARCH_MAX_JOB_IDS * 12;

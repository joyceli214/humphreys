// Wire types for the admin-only /api/ai-tools endpoints
// (api/internal/modules/workorders/ai_tools*.go).

import type { SelectedEmailJob } from "@/lib/ai-tools/email-selection";

export type MassUpdateOpType =
  | "set_labour_total"
  | "set_labour_discount"
  | "set_line_item_price"
  | "add_line_item"
  | "remove_line_item"
  | "set_status"
  | "set_location"
  | "generate_work_done";

export type MassUpdateOp = {
  reference_id: number;
  op: MassUpdateOpType | string;
  labour_total?: number;
  discount_type?: string;
  discount_value?: number;
  line_item_id?: number;
  unit_price?: number;
  item_name?: string;
  quantity_text?: string;
  status_name?: string;
  location_name?: string;
  /** generate_work_done: the text generated at preview, saved as-is on apply. */
  work_done_text?: string;
};

export type MassUpdatePreviewRow = {
  operation: MassUpdateOp;
  reference_id: number;
  customer_name: string;
  field: string;
  before: string;
  after: string;
  lower_than_before: boolean;
  valid: boolean;
  error?: string;
  /** Change to the job total in dollars (positive = total goes up). Treated as 0 when missing. */
  amount_delta?: number;
  /** The job's updated_at when previewed (null if never set); sent back on apply. */
  updated_at: string | null;
  /** generate_work_done rows: the job already has Work Done text, so applying replaces it. */
  has_existing_work_done?: boolean;
  /** That existing Work Done embeds images (they are removed when replaced). */
  existing_work_done_has_images?: boolean;
  /** Whether the row starts ticked. False for valid rows that would replace existing Work Done. */
  default_selected?: boolean;
  /** Non-blocking notice shown with the row. */
  warning?: string;
};

/** reference_id -> updated_at from the preview. Jobs missing here are rejected on apply. */
export type MassUpdateExpectedUpdatedAt = Record<number, string | null>;

export type MassUpdatePreviewResponse = {
  rows: MassUpdatePreviewRow[];
  model: string;
  /** Summary of partial failures (e.g. some Work Done generations failed); absent when all previewed. */
  message?: string;
};

export type MassUpdateApplyResult = {
  reference_id: number;
  success: boolean;
  applied: string[] | null;
  error?: string;
};

export type MassUpdateApplyResponse = {
  results: MassUpdateApplyResult[];
};

/** Typical line item from past jobs (GET /ai-tools/line-item-catalog). */
export type LineItemCatalogItem = {
  name: string;
  unit_price: number;
  quantity_text: string;
  notes?: string;
};

export type LineItemCatalogResponse = {
  items: LineItemCatalogItem[];
};

export type StaleBucket = "unhandled" | "finished_not_picked_up";

export type StaleJobRow = {
  reference_id: number;
  customer_name: string;
  item_name: string;
  status_name: string;
  days_idle: number;
  bucket: StaleBucket | string;
  suggested_next_step?: string;
};

export type JobSummaryStaleResponse = {
  unhandled_count: number;
  finished_not_picked_up_count: number;
  threshold_workdays: number;
  rows: StaleJobRow[];
};

export type JobSummaryResponse = JobSummaryStaleResponse & {
  summary: string;
  truncated: boolean;
  model: string;
};

/** POST /ai-tools/ask/interpret: the Management Ask chat classifies a message (no data, no writes). */
export type AskIntent = "customer_jobs" | "update_jobs" | "parts_requests" | "charges_summary" | "unknown";

export type AskInterpretResponse = {
  intent: AskIntent;
  customer_query: string;
  reference_ids: number[];
  parts_query: string;
  parts_statuses: string[];
  reply: string;
  model: string;
  /** Server-built Mass Update instruction naming the resolved jobs. update_jobs is previewed only with this (never the typed text). */
  preview_instruction?: string;
  /** True when the jobs (or customer) came from this account's last Ask answer. */
  context_used?: boolean;
  /** Set when the server checked which job numbers exist. */
  found_ids?: number[];
  missing_ids?: number[];
  /** Short line shown above the answer, e.g. "Found #275. No job #15." */
  notice?: string;
};

/** ✎ AI help actions for POST /ai-tools/email-rewrite. */
export type EmailRewriteAction = "fix_grammar" | "more_detail" | "shorter" | "friendlier";

export type EmailRewriteResponse = { body: string; model: string };

export type EmailDraftType = "estimate" | "progress_update" | "ready_for_pickup" | "custom";

export type EmailDraftResponse = {
  subject: string;
  body: string;
  type: EmailDraftType;
  model: string;
  /** Jobs the draft covers (all for one customer). */
  work_order_ids: number[];
  customer_name: string;
  /** Masked address, e.g. "j***@gmail.com"; "" when the customer has no email on file. */
  recipient_hint: string;
  has_recipient_email: boolean;
  /**
   * Full customer address, only present for callers who may send customer
   * email (work_orders:update + work_orders_sensitive:read). Used for mailto:.
   */
  customer_email?: string;
  /** True when the jobs span customers; customer_email is the first job's customer. */
  customer_email_mixed?: boolean;
};

/** A job pre-selected when jumping from Job Summary (or a work-order page) to the email drafts tab. */
export type EmailDraftTarget = {
  referenceId: number;
  label: string;
  type: EmailDraftType;
  /** Full selected-jobs entry (customer id, equipment, status) when the sender has it. */
  job?: SelectedEmailJob;
};

// Advanced Search (ai_tools_search*.go). Results carry the customer's display
// name only; the API never returns customer email or phone.

export type AISearchWarranty = "any" | "only" | "exclude";
export type AISearchGroupBy = "none" | "customer" | "model" | "serial";

/** Whitelisted filter object shared by /search/interpret and /search. */
export type AISearchFilters = {
  /** Exact job numbers (reference_id), max 50. */
  job_ids?: number[];
  /** Job number (reference_id) ends with these digits. */
  job_suffix?: string;
  text?: string;
  customer_name?: string;
  model?: string;
  serial?: string;
  brand?: string;
  equipment?: string;
  statuses?: string[];
  warranty?: AISearchWarranty;
  include_linked?: boolean;
  min_units?: number;
  min_model_jobs?: number;
  min_serial_jobs?: number;
  created_from?: string;
  created_to?: string;
  group_by?: AISearchGroupBy;
  limit?: number;
  offset?: number;
};

export type AISearchInterpretResponse = {
  filters: AISearchFilters;
  explanation: string;
  model: string;
};

export type AISearchRow = {
  reference_id: number;
  customer_id: number | null;
  customer_name: string;
  equipment_name: string;
  brand_names: string[];
  model_number: string;
  serial_number: string;
  status_name: string;
  status_group: string;
  created_at: string | null;
  is_warranty: boolean;
  original_job_id: number | null;
  warranty_job_ids: number[];
  customer_job_count: number;
};

export type AISearchGroup = {
  key: string;
  label: string;
  unit_count: number;
  job_ids: number[];
};

export type AISearchResponse = {
  filters: AISearchFilters;
  rows: AISearchRow[];
  total: number;
  limit: number;
  offset: number;
  group_by: AISearchGroupBy;
  groups: AISearchGroup[];
};

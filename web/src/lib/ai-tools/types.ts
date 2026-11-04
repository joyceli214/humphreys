// Wire types for the admin-only /api/ai-tools endpoints
// (api/internal/modules/workorders/ai_tools*.go).

export type MassUpdateOpType =
  | "set_labour_total"
  | "set_labour_discount"
  | "set_line_item_price"
  | "add_line_item"
  | "remove_line_item"
  | "set_status"
  | "set_location";

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
};

export type MassUpdatePreviewResponse = {
  rows: MassUpdatePreviewRow[];
  truncated: boolean;
  model: string;
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
};

/** A job pre-selected when jumping from Job Summary to the email drafts tab. */
export type EmailDraftTarget = {
  referenceId: number;
  label: string;
  type: EmailDraftType;
};

// Advanced Search (ai_tools_search*.go). Results carry the customer's display
// name only; the API never returns customer email or phone.

export type AISearchWarranty = "any" | "only" | "exclude";
export type AISearchGroupBy = "none" | "customer" | "model" | "serial";

/** Whitelisted filter object shared by /search/interpret and /search. */
export type AISearchFilters = {
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

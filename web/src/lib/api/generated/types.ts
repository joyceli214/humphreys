export type UserStatus = "active" | "disabled" | "deleted";

export interface Permission {
  id: string;
  code: string;
  resource: string;
  action: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions?: Permission[];
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  status: UserStatus;
  roles: Role[];
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  access_token: string;
  csrf_token: string;
  expires_in: number;
  scope: string[];
  user: User;
}

export type EmailTemplateKey = "job_started" | "job_completed";

export interface EmailTemplate {
  key: EmailTemplateKey;
  label: string;
  subject_template: string;
  body_template: string;
  updated_at: string;
}

export interface WorkOrderListItem {
  reference_id: number;
  created_at: string | null;
  updated_at: string | null;
  status: string;
  job_type: string;
  location_id: number | null;
  location_code: string | null;
  location_shelf: string | null;
  location_floor: number | null;
  customer_name: string | null;
  customer_email: string | null;
  item_name: string | null;
  brand_names: string[];
  model_number: string | null;
  serial_number: string | null;
  labour_total: number | null;
}

export interface WorkOrderCustomer {
  customer_id: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  province: string | null;
  home_phone: string | null;
  work_phone: string | null;
  extension_text: string | null;
}

export interface WorkOrderLineItem {
  line_item_id: number;
  item_name: string | null;
  unit_price: number | null;
  quantity_text: string | null;
  line_total_text: string | null;
}

export interface WorkOrderDetail {
  reference_id: number;
  original_job_id: number | null;
  warranty_job_ids: number[];
  created_at: string | null;
  updated_at: string | null;
  status_id: number | null;
  status_key: string | null;
  status_name: string | null;
  status_updated_at: string | null;
  job_type_id: number | null;
  job_type_key: string | null;
  job_type_name: string | null;
  location_id: number | null;
  location_code: string | null;
  location_shelf: string | null;
  location_floor: number | null;
  customer: WorkOrderCustomer;
  item_id: number | null;
  item_name: string | null;
  brand_ids: number[];
  brand_names: string[];
  model_number: string | null;
  serial_number: string | null;
  other_remarks: string | null;
  remote_control_qty: number;
  cable_qty: number;
  cord_qty: number;
  dvd_vhs_qty: number;
  album_cd_cassette_qty: number;
  problem_description: string | null;
  worker_ids: number[];
  worker_names: string[];
  work_done: string | null;
  payment_method_ids: number[];
  payment_method_names: string[];
  parts_total: number | null;
  delivery_total: number | null;
  labour_total: number | null;
  deposit: number;
  line_items: WorkOrderLineItem[];
}

export interface RepairLog {
  repair_log_id: number;
  reference_id: number;
  repair_date: string | null;
  hours_used: number;
  details: string;
  created_by_user_id: string;
  created_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PartsPurchaseRequest {
  parts_purchase_request_id: number;
  reference_id: number;
  source: "online" | "supplier";
  source_url: string | null;
  status: "draft" | "waiting_approval" | "ordered" | "used";
  total_price: number;
  item_name: string;
  quantity: number;
  created_by_user_id: string;
  created_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LookupOption {
  id: number;
  label: string;
}

export interface ManagedLookupOption {
  id: number;
  label: string;
  is_active: boolean;
}

export interface DropdownManagementEntry {
  key: string;
  label: string;
  is_frozen: boolean;
  options: ManagedLookupOption[];
}

export interface CustomerLookupOption {
  id: number;
  label: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  home_phone?: string | null;
  work_phone?: string | null;
  extension_text?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  province?: string | null;
}

export interface DashboardWorkOrderItem {
  reference_id: number;
  customer_name: string | null;
  item_name: string | null;
  status: string;
  status_updated_at: string | null;
}

export interface DashboardOverdueItem {
  reference_id: number;
  customer_name: string | null;
  item_name: string | null;
  late_days: number;
  status_updated_at: string | null;
}

export interface DashboardPartsReviewItem {
  parts_purchase_request_id: number;
  reference_id: number;
  item_name: string;
  total_price: number;
  created_at: string | null;
}

export interface DashboardActivityItem {
  person_id: string;
  person_name: string;
  reference_id: number;
  details: string;
  logged_at: string | null;
}

export interface DashboardData {
  ready_total: number;
  overdue_total: number;
  ready_items: DashboardWorkOrderItem[];
  overdue_items: DashboardOverdueItem[];
  parts_review_items: DashboardPartsReviewItem[];
  activity_items: DashboardActivityItem[];
}

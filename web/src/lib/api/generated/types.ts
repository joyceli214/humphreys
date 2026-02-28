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
  expires_in: number;
  scope: string[];
  user: User;
}

export interface WorkOrderListItem {
  reference_id: number;
  created_at: string | null;
  updated_at: string | null;
  status: string;
  job_type: string;
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
  created_at: string | null;
  updated_at: string | null;
  status_key: string | null;
  status_name: string | null;
  job_type_key: string | null;
  job_type_name: string | null;
  customer: WorkOrderCustomer;
  item_id: number | null;
  item_name: string | null;
  brand_names: string[];
  model_number: string | null;
  serial_number: string | null;
  remote_control_qty: number;
  cable_qty: number;
  cord_qty: number;
  album_cd_cassette_qty: number;
  problem_description: string | null;
  worker_names: string[];
  work_done: string | null;
  payment_method_names: string[];
  parts_total: number | null;
  delivery_total: number | null;
  labour_total: number | null;
  deposit: number;
  line_items: WorkOrderLineItem[];
}

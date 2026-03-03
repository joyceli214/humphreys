import type {
  AuthResponse,
  CustomerLookupOption,
  LookupOption,
  PartsPurchaseRequest,
  Permission,
  RepairLog,
  Role,
  User,
  WorkOrderDetail,
  WorkOrderListItem
} from "@/lib/api/generated/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

export class APIClient {
  private accessToken: string | null = null;
  private csrfToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  private refreshRequestInFlight: Promise<AuthResponse> | null = null;
  private recentRefresh: { ts: number; data: AuthResponse } | null = null;
  private lookupCache = new Map<string, { ts: number; data: LookupOption[] }>();

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  setCSRFToken(token: string | null) {
    this.csrfToken = token;
  }

  private async request<T>(path: string, init?: RequestInit, allowRefreshRetry = true): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    const csrf =
      this.csrfToken ??
      (typeof document !== "undefined" ? document.cookie.split(";").find((c) => c.trim().startsWith("csrf_token="))?.split("=")[1] : "");
    if (csrf && init?.method && ["POST", "PATCH", "DELETE"].includes(init.method.toUpperCase())) {
      headers.set("X-CSRF-Token", csrf);
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const errMessage = typeof body.error === "string" ? body.error : "";
      const isInvalidToken = res.status === 401 && errMessage === "invalid token";

      if (allowRefreshRetry && isInvalidToken && path !== "/auth/refresh" && path !== "/auth/login") {
        const didRefresh = await this.refreshAccessToken();
        if (didRefresh) {
          return this.request<T>(path, init, false);
        }
      }

      throw new Error(body.error ? `${body.error} (${res.status} ${path})` : `Request failed (${res.status} ${path})`);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  login(email: string, password: string) {
    return this.request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }).then((auth) => {
      this.csrfToken = auth.csrf_token;
      return auth;
    });
  }

  refresh() {
    const now = Date.now();
    if (this.recentRefresh && now - this.recentRefresh.ts < 3000) {
      return Promise.resolve(this.recentRefresh.data);
    }
    if (this.refreshRequestInFlight) {
      return this.refreshRequestInFlight;
    }

    this.refreshRequestInFlight = this.request<AuthResponse>("/auth/refresh", { method: "POST" }, false)
      .then((auth) => {
        this.csrfToken = auth.csrf_token;
        this.recentRefresh = { ts: Date.now(), data: auth };
        return auth;
      })
      .finally(() => {
        this.refreshRequestInFlight = null;
      });

    return this.refreshRequestInFlight;
  }

  me() {
    return this.request<User>("/auth/me");
  }

  logout() {
    return this.request<void>("/auth/logout", { method: "POST" });
  }

  listUsers(params: URLSearchParams) {
    return this.request<{ items: User[] }>(`/users?${params.toString()}`);
  }

  createUser(payload: { email: string; password: string; full_name: string; status: string; role_ids: string[] }) {
    return this.request<User>("/users", { method: "POST", body: JSON.stringify(payload) });
  }

  updateUser(id: string, payload: { email: string; full_name: string; password?: string }) {
    return this.request<User>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  }

  updateUserStatus(id: string, status: string) {
    return this.request<User>(`/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  }

  setUserRoles(id: string, role_ids: string[]) {
    return this.request<User>(`/users/${id}/roles`, { method: "PATCH", body: JSON.stringify({ role_ids }) });
  }

  listRoles() {
    return this.request<{ items: Role[] }>("/roles");
  }

  createRole(payload: { name: string; description: string }) {
    return this.request<Role>("/roles", { method: "POST", body: JSON.stringify(payload) });
  }

  updateRole(id: string, payload: { name: string; description: string }) {
    return this.request<Role>(`/roles/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  }

  deleteRole(id: string) {
    return this.request<void>(`/roles/${id}`, { method: "DELETE" });
  }

  setRolePermissions(id: string, permission_ids: string[]) {
    return this.request<Role>(`/roles/${id}/permissions`, { method: "PATCH", body: JSON.stringify({ permission_ids }) });
  }

  listResources() {
    return this.request<{ items: Array<{ id: string; name: string; description: string }> }>("/resources");
  }

  listPermissions() {
    return this.request<{ items: Permission[] }>("/permissions");
  }

  listWorkOrders(params: URLSearchParams) {
    return this.request<{ items: WorkOrderListItem[] }>(`/work-orders?${params.toString()}`);
  }

  listWorkOrderCustomers(q = "") {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    const target = params.size > 0 ? `/work-orders/customers?${params.toString()}` : "/work-orders/customers";
    return this.request<{ items: CustomerLookupOption[] }>(target);
  }

  createWorkOrder(payload: {
    creation_mode?: "new_job" | "stock";
    customer_id?: number;
    new_customer?: {
      name: string;
      email?: string;
      home_phone?: string;
      work_phone?: string;
      extension_text?: string;
      address_line_1?: string;
      address_line_2?: string;
      city?: string;
      province?: string;
    };
    customer_updates?: {
      name?: string;
      email?: string;
      home_phone?: string;
      work_phone?: string;
      extension_text?: string;
      address_line_1?: string;
      address_line_2?: string;
      city?: string;
      province?: string;
    };
    item_id?: number;
    brand_ids?: number[];
    model_number?: string;
    serial_number?: string;
    remote_control_qty: number;
    cable_qty: number;
    cord_qty: number;
    dvd_vhs_qty: number;
    album_cd_cassette_qty: number;
    deposit: number;
    deposit_payment_method_id?: number;
  }) {
    return this.request<WorkOrderDetail>("/work-orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getWorkOrderDetail(referenceID: number) {
    return this.request<WorkOrderDetail>(`/work-orders/${referenceID}`);
  }

  deleteWorkOrder(referenceID: number) {
    return this.request<void>(`/work-orders/${referenceID}`, {
      method: "DELETE"
    });
  }

  updateWorkOrderStatus(referenceID: number, payload: { status_id: number | null }) {
    return this.request<WorkOrderDetail>(`/work-orders/${referenceID}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  updateWorkOrderEquipment(
    referenceID: number,
    payload: {
      model_number: string | null;
      serial_number: string | null;
      status_id: number | null;
      job_type_id: number | null;
      item_id: number | null;
      brand_ids: number[];
      remote_control_qty: number;
      cable_qty: number;
      cord_qty: number;
      dvd_vhs_qty: number;
      album_cd_cassette_qty: number;
    }
  ) {
    return this.request<WorkOrderDetail>(`/work-orders/${referenceID}/equipment`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  updateWorkOrderWorkNotes(
    referenceID: number,
    payload: {
      problem_description: string | null;
      worker_ids: number[];
      work_done: string | null;
      payment_method_ids: number[];
    }
  ) {
    return this.request<WorkOrderDetail>(`/work-orders/${referenceID}/work-notes`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  updateWorkOrderTotals(
    referenceID: number,
    payload: {
      delivery_total: number | null;
      labour_total: number | null;
      deposit: number;
    }
  ) {
    return this.request<WorkOrderDetail>(`/work-orders/${referenceID}/totals`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  updateWorkOrderLineItems(
    referenceID: number,
    payload: {
      line_items: Array<{
        line_item_id?: number;
        item_name: string | null;
        unit_price: number | null;
        quantity_text: string | null;
        line_total_text: string | null;
      }>;
    }
  ) {
    return this.request<WorkOrderDetail>(`/work-orders/${referenceID}/line-items`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  updateWorkOrderCustomer(
    referenceID: number,
    payload: {
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      home_phone: string | null;
      work_phone: string | null;
      extension_text: string | null;
      address_line_1: string | null;
      address_line_2: string | null;
      city: string | null;
      province: string | null;
    }
  ) {
    return this.request<WorkOrderDetail>(`/work-orders/${referenceID}/customer`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  listRepairLogs(referenceID: number) {
    return this.request<{ items: RepairLog[] }>(`/work-orders/${referenceID}/repair-logs`);
  }

  createRepairLog(referenceID: number, payload: { repair_date: string | null; hours_used: number; details: string }) {
    return this.request<RepairLog>(`/work-orders/${referenceID}/repair-logs`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  updateRepairLog(referenceID: number, repairLogID: number, payload: { repair_date?: string | null; hours_used?: number; details?: string }) {
    return this.request<RepairLog>(`/work-orders/${referenceID}/repair-logs/${repairLogID}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  deleteRepairLog(referenceID: number, repairLogID: number) {
    return this.request<void>(`/work-orders/${referenceID}/repair-logs/${repairLogID}`, {
      method: "DELETE"
    });
  }

  listPartsPurchaseRequests(referenceID: number) {
    return this.request<{ items: PartsPurchaseRequest[] }>(`/work-orders/${referenceID}/parts-purchase-requests`);
  }

  listAllPartsPurchaseRequests() {
    return this.request<{ items: PartsPurchaseRequest[] }>("/parts-purchase-requests");
  }

  createPartsPurchaseRequest(
    referenceID: number,
    payload: {
      source: "online" | "supplier";
      source_url: string | null;
      status: "draft" | "waiting_approval" | "ordered" | "used";
      total_price: number;
      item_name: string;
      quantity: number;
    }
  ) {
    return this.request<PartsPurchaseRequest>(`/work-orders/${referenceID}/parts-purchase-requests`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  updatePartsPurchaseRequest(
    referenceID: number,
    partsPurchaseRequestID: number,
    payload: {
      source: "online" | "supplier";
      source_url: string | null;
      status: "draft" | "waiting_approval" | "ordered" | "used";
      total_price: number;
      item_name: string;
      quantity: number;
    }
  ) {
    return this.request<PartsPurchaseRequest>(`/work-orders/${referenceID}/parts-purchase-requests/${partsPurchaseRequestID}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  deletePartsPurchaseRequest(referenceID: number, partsPurchaseRequestID: number) {
    return this.request<void>(`/work-orders/${referenceID}/parts-purchase-requests/${partsPurchaseRequestID}`, {
      method: "DELETE"
    });
  }

  listWorkOrderStatuses(q = "") {
    return this.cachedLookup("/catalog/work-order-statuses", q);
  }

  listJobTypes(q = "") {
    return this.cachedLookup("/catalog/job-types", q);
  }

  listItems(q = "") {
    return this.cachedLookup("/catalog/items", q);
  }

  listBrands(q = "") {
    return this.cachedLookup("/catalog/brands", q);
  }

  listWorkers(q = "") {
    return this.cachedLookup("/catalog/workers", q);
  }

  listPaymentMethods(q = "") {
    return this.cachedLookup("/catalog/payment-methods", q);
  }

  createWorkOrderStatus(label: string) {
    return this.createLookup("/catalog/work-order-statuses", label);
  }

  createJobType(label: string) {
    return this.createLookup("/catalog/job-types", label);
  }

  createItem(label: string) {
    return this.createLookup("/catalog/items", label);
  }

  createBrand(label: string) {
    return this.createLookup("/catalog/brands", label);
  }

  createWorker(label: string) {
    return this.createLookup("/catalog/workers", label);
  }

  createPaymentMethod(label: string) {
    return this.createLookup("/catalog/payment-methods", label);
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      try {
        const auth = await this.refresh();
        this.setAccessToken(auth.access_token);
        return true;
      } catch {
        this.setAccessToken(null);
        this.setCSRFToken(null);
        this.recentRefresh = null;
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  private async cachedLookup(path: string, query: string): Promise<{ items: LookupOption[] }> {
    const normalized = query.trim().toLowerCase();
    const key = `${path}::${normalized}`;
    const cached = this.lookupCache.get(key);
    const now = Date.now();
    if (cached && now - cached.ts < LOOKUP_CACHE_TTL_MS) {
      return { items: cached.data };
    }

    const params = new URLSearchParams();
    if (normalized) params.set("q", normalized);
    const target = params.size > 0 ? `${path}?${params.toString()}` : path;
    const response = await this.request<{ items: LookupOption[] }>(target);
    this.lookupCache.set(key, { ts: now, data: response.items });
    return response;
  }

  private async createLookup(path: string, label: string): Promise<LookupOption> {
    const created = await this.request<LookupOption>(path, {
      method: "POST",
      body: JSON.stringify({ label })
    });
    this.invalidateLookupCache(path);
    return created;
  }

  private invalidateLookupCache(path: string) {
    const keys = Array.from(this.lookupCache.keys());
    for (const key of keys) {
      if (key.startsWith(`${path}::`)) {
        this.lookupCache.delete(key);
      }
    }
  }
}

export const apiClient = new APIClient();

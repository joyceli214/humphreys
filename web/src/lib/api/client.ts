import type { AuthResponse, Permission, Role, User, WorkOrderDetail, WorkOrderListItem } from "@/lib/api/generated/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export class APIClient {
  private accessToken: string | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    const csrf = typeof document !== "undefined" ? document.cookie.split(";").find((c) => c.trim().startsWith("csrf_token="))?.split("=")[1] : "";
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
      throw new Error(body.error ? `${body.error} (${res.status} ${path})` : `Request failed (${res.status} ${path})`);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  login(email: string, password: string) {
    return this.request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  }

  refresh() {
    return this.request<AuthResponse>("/auth/refresh", { method: "POST" });
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

  getWorkOrderDetail(referenceID: number) {
    return this.request<WorkOrderDetail>(`/work-orders/${referenceID}`);
  }
}

export const apiClient = new APIClient();

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

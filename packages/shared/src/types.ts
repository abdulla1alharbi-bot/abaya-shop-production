import type { AppRole } from "./permissions.js";

export type { AppRole };
/** Backward-compatible alias — use AppRole in new code. */
export type Role = AppRole;

export interface AuthUser {
  id: string;
  username: string;
  /** Optional contact email — not used for login */
  email: string | null;
  name: string;
  role: AppRole;
  phone: string | null;
  isActive: boolean;
  /** Effective permission ids for this session (from JWT). */
  permissions: string[];
  /** Only on user-admin responses; omitted in auth payload when not needed */
  extraPermissions?: string[];
  revokedPermissions?: string[];
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginatedMeta;
}

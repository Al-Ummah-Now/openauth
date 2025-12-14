/**
 * User Management Types
 */

export type UserStatus = "active" | "suspended" | "deleted"

export interface User {
  id: string
  tenant_id: string
  email: string
  name: string | null
  metadata: Record<string, unknown> | null
  status: UserStatus
  created_at: number
  updated_at: number
  last_login_at: number | null
  deleted_at: number | null
  /** When true, user must change password on next login */
  password_reset_required: boolean
}

export interface UserIdentity {
  id: string
  user_id: string
  tenant_id: string
  provider: string
  provider_user_id: string
  provider_data: Record<string, unknown> | null
  created_at: number
}

export interface UserWithIdentities extends User {
  identities: UserIdentity[]
}

export interface CreateUserParams {
  email: string
  name?: string
  metadata?: Record<string, unknown>
}

export interface UpdateUserParams {
  email?: string
  name?: string | null
  metadata?: Record<string, unknown> | null
}

export interface ListUsersParams {
  status?: UserStatus
  email?: string
  cursor?: string
  limit?: number
  sort_by?: "created_at" | "updated_at" | "email" | "name"
  sort_order?: "asc" | "desc"
}

export interface ListUsersResponse {
  users: User[]
  next_cursor: string | null
  has_more: boolean
  total_count?: number
}

export interface RevokeSessionsResponse {
  revoked_count: number
}

export interface SuspendUserResponse {
  user: User
  revoked_sessions: number
}

export const USER_STORAGE_KEYS = {
  user: (tenantId: string, userId: string): string[] => [
    "user",
    tenantId,
    userId,
  ],
  email: (tenantId: string, email: string): string[] => [
    "user",
    "email",
    tenantId,
    email.toLowerCase(),
  ],
  identity: (
    tenantId: string,
    provider: string,
    providerUserId: string,
  ): string[] => ["user", "identity", tenantId, provider, providerUserId],
  userPrefix: (tenantId: string): string[] => ["user", tenantId],
}

# Phase 2: User Management APIs Implementation

## Overview

Implement user CRUD operations with identity linking and session management.

## Database Migration

### `/packages/openauth/src/migrations/005_user_management.sql`

```sql
-- Migration 005: User Management Tables
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/005_user_management.sql

PRAGMA foreign_keys = ON;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    metadata TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER,
    deleted_at INTEGER,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Unique email per tenant (only for non-deleted users)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email
    ON users(tenant_id, email) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_updated ON users(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- User identities table
CREATE TABLE IF NOT EXISTS user_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_data TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_provider
    ON user_identities(tenant_id, provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_identities_tenant_provider
    ON user_identities(tenant_id, provider);
```

## Files to Create

### 1. `/packages/openauth/src/user/types.ts`

```typescript
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
  user: (tenantId: string, userId: string): string[] =>
    ["user", tenantId, userId],
  email: (tenantId: string, email: string): string[] =>
    ["user", "email", tenantId, email.toLowerCase()],
  identity: (tenantId: string, provider: string, providerUserId: string): string[] =>
    ["user", "identity", tenantId, provider, providerUserId],
  userPrefix: (tenantId: string): string[] => ["user", tenantId],
}
```

### 2. `/packages/openauth/src/user/errors.ts`

```typescript
export type UserErrorCode =
  | "user_not_found"
  | "user_already_exists"
  | "email_already_exists"
  | "invalid_user_id"
  | "invalid_email"
  | "user_suspended"
  | "user_deleted"
  | "identity_not_found"
  | "identity_already_linked"

export class UserError extends Error {
  constructor(
    public readonly code: UserErrorCode,
    message: string
  ) {
    super(message)
    this.name = "UserError"
  }
}

export class UserValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message)
    this.name = "UserValidationError"
  }
}
```

### 3. `/packages/openauth/src/user/d1-adapter.ts`

```typescript
import type {
  User,
  UserIdentity,
  UserStatus,
  ListUsersParams,
  ListUsersResponse,
} from "./types.js"

interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  run(): Promise<D1Result>
  all<T = unknown>(): Promise<D1Result<T>>
}

interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  meta: { changes: number }
}

interface UserRow {
  id: string
  tenant_id: string
  email: string
  name: string | null
  metadata: string | null
  status: string
  created_at: number
  updated_at: number
  last_login_at: number | null
  deleted_at: number | null
}

interface IdentityRow {
  id: string
  user_id: string
  tenant_id: string
  provider: string
  provider_user_id: string
  provider_data: string | null
  created_at: number
}

export interface D1UserAdapterConfig {
  db: D1Database
  usersTable?: string
  identitiesTable?: string
}

export class D1UserAdapter {
  private readonly db: D1Database
  private readonly usersTable: string
  private readonly identitiesTable: string

  constructor(config: D1UserAdapterConfig) {
    this.db = config.db
    this.usersTable = config.usersTable || "users"
    this.identitiesTable = config.identitiesTable || "user_identities"
  }

  async createUser(user: User): Promise<void> {
    const query = `
      INSERT INTO ${this.usersTable}
      (id, tenant_id, email, name, metadata, status, created_at, updated_at, last_login_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    await this.db
      .prepare(query)
      .bind(
        user.id,
        user.tenant_id,
        user.email,
        user.name,
        user.metadata ? JSON.stringify(user.metadata) : null,
        user.status,
        user.created_at,
        user.updated_at,
        user.last_login_at,
        user.deleted_at
      )
      .run()
  }

  async getUser(tenantId: string, userId: string): Promise<User | null> {
    const query = `
      SELECT * FROM ${this.usersTable}
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL
    `
    const row = await this.db
      .prepare(query)
      .bind(tenantId, userId)
      .first<UserRow>()
    return row ? this.rowToUser(row) : null
  }

  async updateUser(user: User): Promise<void> {
    const query = `
      UPDATE ${this.usersTable}
      SET email = ?, name = ?, metadata = ?, status = ?, updated_at = ?,
          last_login_at = ?, deleted_at = ?
      WHERE tenant_id = ? AND id = ?
    `
    await this.db
      .prepare(query)
      .bind(
        user.email,
        user.name,
        user.metadata ? JSON.stringify(user.metadata) : null,
        user.status,
        user.updated_at,
        user.last_login_at,
        user.deleted_at,
        user.tenant_id,
        user.id
      )
      .run()
  }

  async updateUserStatus(tenantId: string, userId: string, status: UserStatus): Promise<void> {
    const query = `
      UPDATE ${this.usersTable}
      SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `
    await this.db.prepare(query).bind(status, Date.now(), tenantId, userId).run()
  }

  async softDeleteUser(tenantId: string, userId: string, deletedAt: number): Promise<void> {
    const query = `
      UPDATE ${this.usersTable}
      SET status = 'deleted', deleted_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `
    await this.db.prepare(query).bind(deletedAt, deletedAt, tenantId, userId).run()
  }

  async updateLastLogin(tenantId: string, userId: string): Promise<void> {
    const now = Date.now()
    const query = `
      UPDATE ${this.usersTable}
      SET last_login_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `
    await this.db.prepare(query).bind(now, now, tenantId, userId).run()
  }

  async listUsers(tenantId: string, params: ListUsersParams): Promise<ListUsersResponse> {
    const {
      status,
      email,
      cursor,
      limit = 50,
      sort_by = "created_at",
      sort_order = "desc",
    } = params

    const validSortColumns = ["created_at", "updated_at", "email", "name"]
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : "created_at"
    const sortDir = sort_order === "asc" ? "ASC" : "DESC"

    const conditions: string[] = ["tenant_id = ?", "deleted_at IS NULL"]
    const bindings: any[] = [tenantId]

    if (status) {
      conditions.push("status = ?")
      bindings.push(status)
    }

    if (email) {
      conditions.push("email LIKE ?")
      bindings.push(`%${email.toLowerCase()}%`)
    }

    if (cursor) {
      const cursorQuery = `SELECT ${sortColumn} FROM ${this.usersTable} WHERE tenant_id = ? AND id = ?`
      const cursorRow = await this.db
        .prepare(cursorQuery)
        .bind(tenantId, cursor)
        .first<Record<string, any>>()

      if (cursorRow) {
        const op = sortDir === "DESC" ? "<" : ">"
        conditions.push(`(${sortColumn} ${op} ? OR (${sortColumn} = ? AND id ${op} ?))`)
        bindings.push(cursorRow[sortColumn], cursorRow[sortColumn], cursor)
      }
    }

    const whereClause = conditions.join(" AND ")
    const query = `
      SELECT * FROM ${this.usersTable}
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${sortDir}, id ${sortDir}
      LIMIT ?
    `
    bindings.push(limit + 1)

    const result = await this.db.prepare(query).bind(...bindings).all<UserRow>()
    const rows = result.results || []
    const hasMore = rows.length > limit

    if (hasMore) rows.pop()

    const users = rows.map((row) => this.rowToUser(row))

    const countQuery = `
      SELECT COUNT(*) as count FROM ${this.usersTable}
      WHERE tenant_id = ? AND deleted_at IS NULL
    `
    const countResult = await this.db.prepare(countQuery).bind(tenantId).first<{ count: number }>()

    return {
      users,
      next_cursor: hasMore && users.length > 0 ? users[users.length - 1].id : null,
      has_more: hasMore,
      total_count: countResult?.count,
    }
  }

  async revokeAllUserSessions(tenantId: string, userId: string): Promise<{ deletedCount: number }> {
    const query = `
      DELETE FROM account_sessions
      WHERE user_id = ? AND browser_session_id IN (
        SELECT id FROM browser_sessions WHERE tenant_id = ?
      )
    `
    const result = await this.db.prepare(query).bind(userId, tenantId).run()
    return { deletedCount: result.meta.changes }
  }

  async createIdentity(identity: UserIdentity): Promise<void> {
    const query = `
      INSERT INTO ${this.identitiesTable}
      (id, user_id, tenant_id, provider, provider_user_id, provider_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    await this.db
      .prepare(query)
      .bind(
        identity.id,
        identity.user_id,
        identity.tenant_id,
        identity.provider,
        identity.provider_user_id,
        identity.provider_data ? JSON.stringify(identity.provider_data) : null,
        identity.created_at
      )
      .run()
  }

  async getIdentity(tenantId: string, identityId: string): Promise<UserIdentity | null> {
    const query = `SELECT * FROM ${this.identitiesTable} WHERE tenant_id = ? AND id = ?`
    const row = await this.db.prepare(query).bind(tenantId, identityId).first<IdentityRow>()
    return row ? this.rowToIdentity(row) : null
  }

  async getUserIdentities(tenantId: string, userId: string): Promise<UserIdentity[]> {
    const query = `
      SELECT * FROM ${this.identitiesTable}
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY created_at DESC
    `
    const result = await this.db.prepare(query).bind(tenantId, userId).all<IdentityRow>()
    return (result.results || []).map((row) => this.rowToIdentity(row))
  }

  async deleteIdentity(tenantId: string, identityId: string): Promise<void> {
    const query = `DELETE FROM ${this.identitiesTable} WHERE tenant_id = ? AND id = ?`
    await this.db.prepare(query).bind(tenantId, identityId).run()
  }

  private rowToUser(row: UserRow): User {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      email: row.email,
      name: row.name,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      status: row.status as UserStatus,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_login_at: row.last_login_at,
      deleted_at: row.deleted_at,
    }
  }

  private rowToIdentity(row: IdentityRow): UserIdentity {
    return {
      id: row.id,
      user_id: row.user_id,
      tenant_id: row.tenant_id,
      provider: row.provider,
      provider_user_id: row.provider_user_id,
      provider_data: row.provider_data ? JSON.parse(row.provider_data) : null,
      created_at: row.created_at,
    }
  }
}

export function createD1UserAdapter(config: D1UserAdapterConfig): D1UserAdapter {
  return new D1UserAdapter(config)
}
```

### 4. `/packages/openauth/src/user/service.ts`

```typescript
import type { StorageAdapter } from "../storage/storage.js"
import type {
  User,
  UserIdentity,
  UserWithIdentities,
  CreateUserParams,
  UpdateUserParams,
  ListUsersParams,
  ListUsersResponse,
  RevokeSessionsResponse,
  SuspendUserResponse,
} from "./types.js"
import { USER_STORAGE_KEYS } from "./types.js"
import { UserError } from "./errors.js"
import type { D1UserAdapter } from "./d1-adapter.js"

export interface UserService {
  createUser(tenantId: string, params: CreateUserParams): Promise<User>
  getUser(tenantId: string, userId: string): Promise<User | null>
  getUserWithIdentities(tenantId: string, userId: string): Promise<UserWithIdentities | null>
  getUserByEmail(tenantId: string, email: string): Promise<User | null>
  updateUser(tenantId: string, userId: string, params: UpdateUserParams): Promise<User>
  deleteUser(tenantId: string, userId: string): Promise<void>
  listUsers(tenantId: string, params?: ListUsersParams): Promise<ListUsersResponse>
  suspendUser(tenantId: string, userId: string): Promise<SuspendUserResponse>
  unsuspendUser(tenantId: string, userId: string): Promise<User>
  revokeUserSessions(tenantId: string, userId: string): Promise<RevokeSessionsResponse>
  getUserIdentities(tenantId: string, userId: string): Promise<UserIdentity[]>
  linkIdentity(tenantId: string, userId: string, identity: Omit<UserIdentity, "id" | "user_id" | "tenant_id" | "created_at">): Promise<UserIdentity>
  unlinkIdentity(tenantId: string, userId: string, identityId: string): Promise<void>
  updateLastLogin(tenantId: string, userId: string): Promise<void>
}

export interface UserServiceConfig {
  storage: StorageAdapter
  d1Adapter?: D1UserAdapter
}

export class UserServiceImpl implements UserService {
  private readonly storage: StorageAdapter
  private readonly d1Adapter: D1UserAdapter | undefined

  constructor(config: UserServiceConfig) {
    this.storage = config.storage
    this.d1Adapter = config.d1Adapter
  }

  async createUser(tenantId: string, params: CreateUserParams): Promise<User> {
    const { email, name, metadata } = params
    const normalizedEmail = email.toLowerCase().trim()

    const existingUser = await this.getUserByEmail(tenantId, normalizedEmail)
    if (existingUser) {
      throw new UserError("email_already_exists", `Email '${normalizedEmail}' is already registered`)
    }

    const now = Date.now()
    const userId = `usr_${crypto.randomUUID().replace(/-/g, "")}`

    const user: User = {
      id: userId,
      tenant_id: tenantId,
      email: normalizedEmail,
      name: name?.trim() || null,
      metadata: metadata || null,
      status: "active",
      created_at: now,
      updated_at: now,
      last_login_at: null,
      deleted_at: null,
    }

    await this.storage.set(USER_STORAGE_KEYS.user(tenantId, userId), user)
    await this.storage.set(USER_STORAGE_KEYS.email(tenantId, normalizedEmail), { userId })

    if (this.d1Adapter) {
      await this.d1Adapter.createUser(user)
    }

    return user
  }

  async getUser(tenantId: string, userId: string): Promise<User | null> {
    const user = await this.storage.get(USER_STORAGE_KEYS.user(tenantId, userId))
    if (!user) return null
    const typedUser = user as User
    if (typedUser.deleted_at !== null) return null
    return typedUser
  }

  async getUserWithIdentities(tenantId: string, userId: string): Promise<UserWithIdentities | null> {
    const user = await this.getUser(tenantId, userId)
    if (!user) return null
    const identities = await this.getUserIdentities(tenantId, userId)
    return { ...user, identities }
  }

  async getUserByEmail(tenantId: string, email: string): Promise<User | null> {
    const normalizedEmail = email.toLowerCase().trim()
    const lookup = await this.storage.get(USER_STORAGE_KEYS.email(tenantId, normalizedEmail))
    if (!lookup) return null
    return this.getUser(tenantId, (lookup as { userId: string }).userId)
  }

  async updateUser(tenantId: string, userId: string, params: UpdateUserParams): Promise<User> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }
    if (existingUser.status === "deleted") {
      throw new UserError("user_deleted", "Cannot update a deleted user")
    }

    const oldEmail = existingUser.email
    let newEmail = params.email !== undefined ? params.email.toLowerCase().trim() : oldEmail

    if (newEmail !== oldEmail) {
      const emailConflict = await this.getUserByEmail(tenantId, newEmail)
      if (emailConflict && emailConflict.id !== userId) {
        throw new UserError("email_already_exists", `Email '${newEmail}' is already registered`)
      }
    }

    const updatedUser: User = {
      ...existingUser,
      email: newEmail,
      name: params.name !== undefined ? params.name : existingUser.name,
      metadata: params.metadata !== undefined ? params.metadata : existingUser.metadata,
      updated_at: Date.now(),
    }

    if (oldEmail !== newEmail) {
      await this.storage.remove(USER_STORAGE_KEYS.email(tenantId, oldEmail))
      await this.storage.set(USER_STORAGE_KEYS.email(tenantId, newEmail), { userId })
    }

    await this.storage.set(USER_STORAGE_KEYS.user(tenantId, userId), updatedUser)

    if (this.d1Adapter) {
      await this.d1Adapter.updateUser(updatedUser)
    }

    return updatedUser
  }

  async deleteUser(tenantId: string, userId: string): Promise<void> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }

    const now = Date.now()
    const deletedUser: User = {
      ...existingUser,
      status: "deleted",
      deleted_at: now,
      updated_at: now,
    }

    await this.storage.remove(USER_STORAGE_KEYS.email(tenantId, existingUser.email))
    await this.storage.set(USER_STORAGE_KEYS.user(tenantId, userId), deletedUser)

    if (this.d1Adapter) {
      await this.d1Adapter.softDeleteUser(tenantId, userId, now)
      await this.d1Adapter.revokeAllUserSessions(tenantId, userId)
    }
  }

  async listUsers(tenantId: string, params?: ListUsersParams): Promise<ListUsersResponse> {
    if (this.d1Adapter) {
      return this.d1Adapter.listUsers(tenantId, params || {})
    }
    // KV fallback implementation would go here
    return { users: [], next_cursor: null, has_more: false }
  }

  async suspendUser(tenantId: string, userId: string): Promise<SuspendUserResponse> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }
    if (existingUser.status === "deleted") {
      throw new UserError("user_deleted", "Cannot suspend a deleted user")
    }
    if (existingUser.status === "suspended") {
      return { user: existingUser, revoked_sessions: 0 }
    }

    const updatedUser: User = {
      ...existingUser,
      status: "suspended",
      updated_at: Date.now(),
    }

    await this.storage.set(USER_STORAGE_KEYS.user(tenantId, userId), updatedUser)

    let revokedSessions = 0
    if (this.d1Adapter) {
      await this.d1Adapter.updateUserStatus(tenantId, userId, "suspended")
      const result = await this.d1Adapter.revokeAllUserSessions(tenantId, userId)
      revokedSessions = result.deletedCount
    }

    return { user: updatedUser, revoked_sessions: revokedSessions }
  }

  async unsuspendUser(tenantId: string, userId: string): Promise<User> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }
    if (existingUser.status !== "suspended") {
      throw new UserError("user_not_found", "User is not suspended")
    }

    const updatedUser: User = {
      ...existingUser,
      status: "active",
      updated_at: Date.now(),
    }

    await this.storage.set(USER_STORAGE_KEYS.user(tenantId, userId), updatedUser)

    if (this.d1Adapter) {
      await this.d1Adapter.updateUserStatus(tenantId, userId, "active")
    }

    return updatedUser
  }

  async revokeUserSessions(tenantId: string, userId: string): Promise<RevokeSessionsResponse> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }

    let revokedCount = 0
    if (this.d1Adapter) {
      const result = await this.d1Adapter.revokeAllUserSessions(tenantId, userId)
      revokedCount = result.deletedCount
    }

    return { revoked_count: revokedCount }
  }

  async getUserIdentities(tenantId: string, userId: string): Promise<UserIdentity[]> {
    if (this.d1Adapter) {
      return this.d1Adapter.getUserIdentities(tenantId, userId)
    }
    return []
  }

  async linkIdentity(
    tenantId: string,
    userId: string,
    identity: Omit<UserIdentity, "id" | "user_id" | "tenant_id" | "created_at">
  ): Promise<UserIdentity> {
    const user = await this.getUser(tenantId, userId)
    if (!user) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }

    const existingIdentity = await this.storage.get(
      USER_STORAGE_KEYS.identity(tenantId, identity.provider, identity.provider_user_id)
    )
    if (existingIdentity) {
      throw new UserError("identity_already_linked", `Identity ${identity.provider}:${identity.provider_user_id} is already linked`)
    }

    const newIdentity: UserIdentity = {
      id: `idt_${crypto.randomUUID().replace(/-/g, "")}`,
      user_id: userId,
      tenant_id: tenantId,
      provider: identity.provider,
      provider_user_id: identity.provider_user_id,
      provider_data: identity.provider_data,
      created_at: Date.now(),
    }

    await this.storage.set(
      USER_STORAGE_KEYS.identity(tenantId, identity.provider, identity.provider_user_id),
      newIdentity
    )

    if (this.d1Adapter) {
      await this.d1Adapter.createIdentity(newIdentity)
    }

    return newIdentity
  }

  async unlinkIdentity(tenantId: string, userId: string, identityId: string): Promise<void> {
    if (this.d1Adapter) {
      const identity = await this.d1Adapter.getIdentity(tenantId, identityId)
      if (!identity || identity.user_id !== userId) {
        throw new UserError("identity_not_found", `Identity '${identityId}' not found`)
      }
      await this.storage.remove(
        USER_STORAGE_KEYS.identity(tenantId, identity.provider, identity.provider_user_id)
      )
      await this.d1Adapter.deleteIdentity(tenantId, identityId)
    }
  }

  async updateLastLogin(tenantId: string, userId: string): Promise<void> {
    const user = await this.getUser(tenantId, userId)
    if (!user) return

    const updatedUser: User = { ...user, last_login_at: Date.now() }
    await this.storage.set(USER_STORAGE_KEYS.user(tenantId, userId), updatedUser)

    if (this.d1Adapter) {
      await this.d1Adapter.updateLastLogin(tenantId, userId)
    }
  }
}

export function createUserService(config: UserServiceConfig): UserService {
  return new UserServiceImpl(config)
}
```

### 5. `/packages/openauth/src/user/api.ts`

```typescript
import { Hono } from "hono"
import type { UserService } from "./service.js"
import type { UserStatus } from "./types.js"
import { UserError, UserValidationError } from "./errors.js"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_REGEX = /^[a-zA-Z0-9_-]+$/

function validateEmail(email: unknown): string {
  if (typeof email !== "string" || !email.trim()) {
    throw new UserValidationError("email", "Email is required")
  }
  const normalized = email.toLowerCase().trim()
  if (!EMAIL_REGEX.test(normalized)) {
    throw new UserValidationError("email", "Invalid email format")
  }
  if (normalized.length > 255) {
    throw new UserValidationError("email", "Email must be 255 characters or less")
  }
  return normalized
}

function validateUserId(id: string): string {
  if (!id || !UUID_REGEX.test(id)) {
    throw new UserValidationError("id", "Invalid user ID format")
  }
  return id
}

function handleError(ctx: any, error: unknown) {
  if (error instanceof UserValidationError) {
    return ctx.json({ error: "validation_error", error_description: error.message, field: error.field }, 400)
  }
  if (error instanceof UserError) {
    const statusMap: Record<string, number> = {
      user_not_found: 404,
      identity_not_found: 404,
      email_already_exists: 409,
      identity_already_linked: 409,
      user_suspended: 403,
      user_deleted: 403,
    }
    return ctx.json({ error: error.code, error_description: error.message }, statusMap[error.code] || 400)
  }
  console.error("User API error:", error)
  return ctx.json({ error: "server_error", error_description: "Internal server error" }, 500)
}

export function userApiRoutes(service: UserService): Hono {
  const app = new Hono()

  // GET / - List users (paginated)
  app.get("/", async (ctx) => {
    try {
      const tenantId = ctx.get("tenantId")
      if (!tenantId) return ctx.json({ error: "tenant_required" }, 400)

      const url = new URL(ctx.req.url)
      const result = await service.listUsers(tenantId, {
        status: url.searchParams.get("status") as UserStatus | undefined,
        email: url.searchParams.get("email") || undefined,
        cursor: url.searchParams.get("cursor") || undefined,
        limit: Math.min(parseInt(url.searchParams.get("limit") || "50"), 100),
        sort_by: (url.searchParams.get("sort_by") || "created_at") as any,
        sort_order: (url.searchParams.get("sort_order") || "desc") as any,
      })
      return ctx.json(result)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // POST / - Create user
  app.post("/", async (ctx) => {
    try {
      const tenantId = ctx.get("tenantId")
      if (!tenantId) return ctx.json({ error: "tenant_required" }, 400)

      const body = await ctx.req.json()
      const user = await service.createUser(tenantId, {
        email: validateEmail(body.email),
        name: typeof body.name === "string" ? body.name.trim() : undefined,
        metadata: typeof body.metadata === "object" ? body.metadata : undefined,
      })
      return ctx.json(user, 201)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // GET /:id - Get user with identities
  app.get("/:id", async (ctx) => {
    try {
      const tenantId = ctx.get("tenantId")
      if (!tenantId) return ctx.json({ error: "tenant_required" }, 400)

      const id = validateUserId(ctx.req.param("id"))
      const user = await service.getUserWithIdentities(tenantId, id)
      if (!user) throw new UserError("user_not_found", `User '${id}' not found`)
      return ctx.json(user)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // PATCH /:id - Update user
  app.patch("/:id", async (ctx) => {
    try {
      const tenantId = ctx.get("tenantId")
      if (!tenantId) return ctx.json({ error: "tenant_required" }, 400)

      const id = validateUserId(ctx.req.param("id"))
      const body = await ctx.req.json()
      const updates: any = {}
      if (body.email !== undefined) updates.email = validateEmail(body.email)
      if (body.name !== undefined) updates.name = body.name === null ? null : String(body.name).trim()
      if (body.metadata !== undefined) updates.metadata = body.metadata

      const user = await service.updateUser(tenantId, id, updates)
      return ctx.json(user)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // DELETE /:id - Soft delete user
  app.delete("/:id", async (ctx) => {
    try {
      const tenantId = ctx.get("tenantId")
      if (!tenantId) return ctx.json({ error: "tenant_required" }, 400)

      const id = validateUserId(ctx.req.param("id"))
      await service.deleteUser(tenantId, id)
      return ctx.body(null, 204)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // POST /:id/suspend - Suspend user
  app.post("/:id/suspend", async (ctx) => {
    try {
      const tenantId = ctx.get("tenantId")
      if (!tenantId) return ctx.json({ error: "tenant_required" }, 400)

      const id = validateUserId(ctx.req.param("id"))
      const result = await service.suspendUser(tenantId, id)
      return ctx.json(result)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // POST /:id/unsuspend - Unsuspend user
  app.post("/:id/unsuspend", async (ctx) => {
    try {
      const tenantId = ctx.get("tenantId")
      if (!tenantId) return ctx.json({ error: "tenant_required" }, 400)

      const id = validateUserId(ctx.req.param("id"))
      const user = await service.unsuspendUser(tenantId, id)
      return ctx.json(user)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  // DELETE /:id/sessions - Revoke all sessions
  app.delete("/:id/sessions", async (ctx) => {
    try {
      const tenantId = ctx.get("tenantId")
      if (!tenantId) return ctx.json({ error: "tenant_required" }, 400)

      const id = validateUserId(ctx.req.param("id"))
      const result = await service.revokeUserSessions(tenantId, id)
      return ctx.json(result)
    } catch (error) {
      return handleError(ctx, error)
    }
  })

  return app
}

export const createUserApi = userApiRoutes
```

### 6. `/packages/openauth/src/user/index.ts`

```typescript
export type {
  User,
  UserIdentity,
  UserWithIdentities,
  UserStatus,
  CreateUserParams,
  UpdateUserParams,
  ListUsersParams,
  ListUsersResponse,
  RevokeSessionsResponse,
  SuspendUserResponse,
} from "./types.js"

export { USER_STORAGE_KEYS } from "./types.js"
export { UserError, UserValidationError } from "./errors.js"
export type { UserErrorCode } from "./errors.js"
export { createUserService, UserServiceImpl } from "./service.js"
export type { UserService, UserServiceConfig } from "./service.js"
export { createD1UserAdapter, D1UserAdapter } from "./d1-adapter.js"
export type { D1UserAdapterConfig } from "./d1-adapter.js"
export { userApiRoutes, createUserApi } from "./api.js"
```

## API Endpoints

| Method | Endpoint | Description | Scope |
|--------|----------|-------------|-------|
| GET | /api/users | List users (paginated) | users:read |
| POST | /api/users | Create user | users:write |
| GET | /api/users/:id | Get user with identities | users:read |
| PATCH | /api/users/:id | Update user | users:write |
| DELETE | /api/users/:id | Soft delete user | users:delete |
| POST | /api/users/:id/suspend | Suspend user + revoke sessions | users:delete |
| POST | /api/users/:id/unsuspend | Reactivate user | users:write |
| DELETE | /api/users/:id/sessions | Revoke all sessions | users:delete |

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| validation_error | 400 | Request validation failed |
| user_not_found | 404 | User does not exist |
| identity_not_found | 404 | Identity does not exist |
| email_already_exists | 409 | Email already registered |
| identity_already_linked | 409 | Identity already linked |
| user_suspended | 403 | Operation not allowed on suspended user |
| user_deleted | 403 | Operation not allowed on deleted user |

## Checklist

- [ ] Create migration `005_user_management.sql`
- [ ] Create `/packages/openauth/src/user/types.ts`
- [ ] Create `/packages/openauth/src/user/errors.ts`
- [ ] Create `/packages/openauth/src/user/d1-adapter.ts`
- [ ] Create `/packages/openauth/src/user/service.ts`
- [ ] Create `/packages/openauth/src/user/api.ts`
- [ ] Create `/packages/openauth/src/user/index.ts`
- [ ] Write unit tests for service
- [ ] Write integration tests for API
- [ ] Update main exports

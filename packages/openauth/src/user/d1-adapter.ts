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
  password_reset_required: number
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
      (id, tenant_id, email, name, metadata, status, created_at, updated_at, last_login_at, deleted_at, password_reset_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        user.deleted_at,
        user.password_reset_required ? 1 : 0,
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
          last_login_at = ?, deleted_at = ?, password_reset_required = ?
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
        user.password_reset_required ? 1 : 0,
        user.tenant_id,
        user.id,
      )
      .run()
  }

  async updateUserStatus(
    tenantId: string,
    userId: string,
    status: UserStatus,
  ): Promise<void> {
    const query = `
      UPDATE ${this.usersTable}
      SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `
    await this.db
      .prepare(query)
      .bind(status, Date.now(), tenantId, userId)
      .run()
  }

  async setPasswordResetRequired(
    tenantId: string,
    userId: string,
    required: boolean,
  ): Promise<void> {
    const query = `
      UPDATE ${this.usersTable}
      SET password_reset_required = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `
    await this.db
      .prepare(query)
      .bind(required ? 1 : 0, Date.now(), tenantId, userId)
      .run()
  }

  async softDeleteUser(
    tenantId: string,
    userId: string,
    deletedAt: number,
  ): Promise<void> {
    const query = `
      UPDATE ${this.usersTable}
      SET status = 'deleted', deleted_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `
    await this.db
      .prepare(query)
      .bind(deletedAt, deletedAt, tenantId, userId)
      .run()
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

  async listUsers(
    tenantId: string,
    params: ListUsersParams,
  ): Promise<ListUsersResponse> {
    const {
      status,
      email,
      cursor,
      limit = 50,
      sort_by = "created_at",
      sort_order = "desc",
    } = params

    const validSortColumns = ["created_at", "updated_at", "email", "name"]
    const sortColumn = validSortColumns.includes(sort_by)
      ? sort_by
      : "created_at"
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
        conditions.push(
          `(${sortColumn} ${op} ? OR (${sortColumn} = ? AND id ${op} ?))`,
        )
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

    const result = await this.db
      .prepare(query)
      .bind(...bindings)
      .all<UserRow>()
    const rows = result.results || []
    const hasMore = rows.length > limit

    if (hasMore) rows.pop()

    const users = rows.map((row) => this.rowToUser(row))

    const countQuery = `
      SELECT COUNT(*) as count FROM ${this.usersTable}
      WHERE tenant_id = ? AND deleted_at IS NULL
    `
    const countResult = await this.db
      .prepare(countQuery)
      .bind(tenantId)
      .first<{ count: number }>()

    return {
      users,
      next_cursor:
        hasMore && users.length > 0 ? users[users.length - 1].id : null,
      has_more: hasMore,
      total_count: countResult?.count,
    }
  }

  async revokeAllUserSessions(
    tenantId: string,
    userId: string,
  ): Promise<{ deletedCount: number }> {
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
        identity.created_at,
      )
      .run()
  }

  async getIdentity(
    tenantId: string,
    identityId: string,
  ): Promise<UserIdentity | null> {
    const query = `SELECT * FROM ${this.identitiesTable} WHERE tenant_id = ? AND id = ?`
    const row = await this.db
      .prepare(query)
      .bind(tenantId, identityId)
      .first<IdentityRow>()
    return row ? this.rowToIdentity(row) : null
  }

  async getUserIdentities(
    tenantId: string,
    userId: string,
  ): Promise<UserIdentity[]> {
    const query = `
      SELECT * FROM ${this.identitiesTable}
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY created_at DESC
    `
    const result = await this.db
      .prepare(query)
      .bind(tenantId, userId)
      .all<IdentityRow>()
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
      password_reset_required: row.password_reset_required === 1,
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

export function createD1UserAdapter(
  config: D1UserAdapterConfig,
): D1UserAdapter {
  return new D1UserAdapter(config)
}

/**
 * D1 Session Adapter
 *
 * Provides D1-based storage for session data, enabling:
 * - Admin queries (list all sessions for a user)
 * - Session cleanup (find expired sessions)
 * - Cross-browser session enumeration
 * - Durable session storage
 *
 * Per ARCHITECTURE_PLAN.md:
 * | Operation        | Primary Store | Rationale                 |
 * | Session Read     | KV            | Low latency (<10ms)       |
 * | Session Write    | KV + D1       | Dual-write for durability |
 * | Admin Queries    | D1            | Structured queries needed |
 *
 * @see /packages/openauth/src/migrations/003_session_management.sql
 * @packageDocumentation
 */

import type { BrowserSession, AccountSession } from "../contracts/types.js"

/**
 * D1Database interface (from @cloudflare/workers-types)
 */
export interface D1Database {
  prepare(query: string): D1PreparedStatement
  exec(query: string): Promise<D1ExecResult>
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(colName?: string): Promise<T | null>
  run(): Promise<D1Result>
  all<T = unknown>(): Promise<D1Result<T>>
}

export interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  error?: string
  meta?: {
    changes?: number
    last_row_id?: number
    duration?: number
  }
}

export interface D1ExecResult {
  count: number
  duration: number
}

/**
 * Column names for browser_sessions table
 * Must match 003_session_management.sql schema
 */
export const BROWSER_SESSION_COLUMNS = [
  "id",
  "tenant_id",
  "created_at",
  "last_activity",
  "user_agent",
  "ip_address",
  "version",
  "active_user_id",
] as const

/**
 * Column names for account_sessions table
 * Must match 003_session_management.sql schema
 */
export const ACCOUNT_SESSION_COLUMNS = [
  "id",
  "browser_session_id",
  "user_id",
  "is_active",
  "authenticated_at",
  "expires_at",
  "subject_type",
  "subject_properties",
  "refresh_token",
  "client_id",
] as const

/**
 * Configuration for D1SessionAdapter
 */
export interface D1SessionAdapterConfig {
  database: D1Database
  browserSessionsTable?: string
  accountSessionsTable?: string
}

/**
 * D1 row for browser_sessions table
 */
interface BrowserSessionRow {
  id: string
  tenant_id: string
  created_at: number
  last_activity: number
  user_agent: string | null
  ip_address: string | null
  version: number
  active_user_id: string | null
}

/**
 * D1 row for account_sessions table
 */
interface AccountSessionRow {
  id: string
  browser_session_id: string
  user_id: string
  is_active: number // SQLite stores booleans as 0/1
  authenticated_at: number
  expires_at: number
  subject_type: string
  subject_properties: string | null // JSON string
  refresh_token: string
  client_id: string
}

/**
 * D1-based session storage adapter
 */
export class D1SessionAdapter {
  private readonly db: D1Database
  private readonly browserTable: string
  private readonly accountTable: string

  constructor(config: D1SessionAdapterConfig) {
    this.db = config.database
    this.browserTable = config.browserSessionsTable || "browser_sessions"
    this.accountTable = config.accountSessionsTable || "account_sessions"
  }

  // ============================================
  // Browser Session Operations
  // ============================================

  /**
   * Create a new browser session in D1
   */
  async createBrowserSession(params: {
    id: string
    tenantId: string
    userAgent: string
    ipAddress: string
    createdAt: number
    lastActivity: number
  }): Promise<BrowserSession> {
    const query = `
      INSERT INTO ${this.browserTable}
      (id, tenant_id, created_at, last_activity, user_agent, ip_address, version, active_user_id)
      VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
    `

    await this.db
      .prepare(query)
      .bind(
        params.id,
        params.tenantId,
        params.createdAt,
        params.lastActivity,
        params.userAgent,
        params.ipAddress,
      )
      .run()

    return {
      id: params.id,
      tenant_id: params.tenantId,
      created_at: params.createdAt,
      last_activity: params.lastActivity,
      user_agent: params.userAgent,
      ip_address: params.ipAddress,
      version: 1,
      active_user_id: null,
      account_user_ids: [],
    }
  }

  /**
   * Get a browser session by ID
   */
  async getBrowserSession(sessionId: string): Promise<BrowserSession | null> {
    const query = `
      SELECT ${BROWSER_SESSION_COLUMNS.join(", ")}
      FROM ${this.browserTable}
      WHERE id = ?
    `

    const row = await this.db
      .prepare(query)
      .bind(sessionId)
      .first<BrowserSessionRow>()

    if (!row) return null

    // Get account user IDs
    const accountUserIds = await this.getAccountUserIds(sessionId)

    return this.rowToBrowserSession(row, accountUserIds)
  }

  /**
   * Update a browser session
   */
  async updateBrowserSession(
    sessionId: string,
    updates: Partial<{
      last_activity: number
      active_user_id: string | null
      version: number
    }>,
  ): Promise<void> {
    const setClauses: string[] = []
    const values: unknown[] = []

    if (updates.last_activity !== undefined) {
      setClauses.push("last_activity = ?")
      values.push(updates.last_activity)
    }

    if (updates.active_user_id !== undefined) {
      setClauses.push("active_user_id = ?")
      values.push(updates.active_user_id)
    }

    if (updates.version !== undefined) {
      setClauses.push("version = ?")
      values.push(updates.version)
    }

    if (setClauses.length === 0) return

    values.push(sessionId)

    const query = `
      UPDATE ${this.browserTable}
      SET ${setClauses.join(", ")}
      WHERE id = ?
    `

    await this.db
      .prepare(query)
      .bind(...values)
      .run()
  }

  /**
   * Delete a browser session
   */
  async deleteBrowserSession(sessionId: string): Promise<void> {
    // Account sessions are deleted via CASCADE in the schema
    const query = `DELETE FROM ${this.browserTable} WHERE id = ?`
    await this.db.prepare(query).bind(sessionId).run()
  }

  // ============================================
  // Account Session Operations
  // ============================================

  /**
   * Add an account session
   */
  async addAccountSession(params: {
    browserSessionId: string
    userId: string
    subjectType: string
    subjectProperties: Record<string, unknown>
    refreshToken: string
    clientId: string
    ttl: number
  }): Promise<AccountSession> {
    const id = crypto.randomUUID()
    const now = Date.now()
    const expiresAt = now + params.ttl * 1000

    const query = `
      INSERT INTO ${this.accountTable}
      (id, browser_session_id, user_id, is_active, authenticated_at, expires_at, subject_type, subject_properties, refresh_token, client_id)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `

    await this.db
      .prepare(query)
      .bind(
        id,
        params.browserSessionId,
        params.userId,
        now,
        expiresAt,
        params.subjectType,
        JSON.stringify(params.subjectProperties),
        params.refreshToken,
        params.clientId,
      )
      .run()

    return {
      id,
      browser_session_id: params.browserSessionId,
      user_id: params.userId,
      is_active: false,
      authenticated_at: now,
      expires_at: expiresAt,
      subject_type: params.subjectType,
      subject_properties: params.subjectProperties,
      refresh_token: params.refreshToken,
      client_id: params.clientId,
    }
  }

  /**
   * Get an account session
   */
  async getAccountSession(
    browserSessionId: string,
    userId: string,
  ): Promise<AccountSession | null> {
    const query = `
      SELECT ${ACCOUNT_SESSION_COLUMNS.join(", ")}
      FROM ${this.accountTable}
      WHERE browser_session_id = ? AND user_id = ?
    `

    const row = await this.db
      .prepare(query)
      .bind(browserSessionId, userId)
      .first<AccountSessionRow>()

    if (!row) return null

    return this.rowToAccountSession(row)
  }

  /**
   * List all account sessions for a browser session
   */
  async listAccountSessions(
    browserSessionId: string,
  ): Promise<AccountSession[]> {
    const query = `
      SELECT ${ACCOUNT_SESSION_COLUMNS.join(", ")}
      FROM ${this.accountTable}
      WHERE browser_session_id = ?
      ORDER BY authenticated_at DESC
    `

    const result = await this.db
      .prepare(query)
      .bind(browserSessionId)
      .all<AccountSessionRow>()

    return (result.results || []).map((row) => this.rowToAccountSession(row))
  }

  /**
   * Update account session active status
   */
  async setAccountActive(
    browserSessionId: string,
    userId: string,
    isActive: boolean,
  ): Promise<void> {
    const query = `
      UPDATE ${this.accountTable}
      SET is_active = ?
      WHERE browser_session_id = ? AND user_id = ?
    `

    await this.db
      .prepare(query)
      .bind(isActive ? 1 : 0, browserSessionId, userId)
      .run()
  }

  /**
   * Deactivate all accounts in a browser session
   */
  async deactivateAllAccounts(browserSessionId: string): Promise<void> {
    const query = `
      UPDATE ${this.accountTable}
      SET is_active = 0
      WHERE browser_session_id = ?
    `

    await this.db.prepare(query).bind(browserSessionId).run()
  }

  /**
   * Remove an account session
   */
  async removeAccountSession(
    browserSessionId: string,
    userId: string,
  ): Promise<void> {
    const query = `
      DELETE FROM ${this.accountTable}
      WHERE browser_session_id = ? AND user_id = ?
    `

    await this.db.prepare(query).bind(browserSessionId, userId).run()
  }

  /**
   * Remove all account sessions for a browser session
   */
  async removeAllAccountSessions(browserSessionId: string): Promise<void> {
    const query = `
      DELETE FROM ${this.accountTable}
      WHERE browser_session_id = ?
    `

    await this.db.prepare(query).bind(browserSessionId).run()
  }

  // ============================================
  // Admin Queries (D1-specific)
  // ============================================

  /**
   * List all sessions for a user across all browsers
   */
  async listUserSessions(params: {
    userId: string
    tenantId: string
    limit?: number
    offset?: number
  }): Promise<
    Array<
      AccountSession & {
        user_agent: string
        ip_address: string
        last_activity: number
      }
    >
  > {
    const limit = params.limit || 100
    const offset = params.offset || 0

    const query = `
      SELECT
        a.${ACCOUNT_SESSION_COLUMNS.join(", a.")},
        b.user_agent,
        b.ip_address,
        b.last_activity
      FROM ${this.accountTable} a
      JOIN ${this.browserTable} b ON a.browser_session_id = b.id
      WHERE a.user_id = ? AND b.tenant_id = ?
      ORDER BY a.authenticated_at DESC
      LIMIT ? OFFSET ?
    `

    const result = await this.db
      .prepare(query)
      .bind(params.userId, params.tenantId, limit, offset)
      .all<
        AccountSessionRow & {
          user_agent: string
          ip_address: string
          last_activity: number
        }
      >()

    return (result.results || []).map((row) => ({
      ...this.rowToAccountSession(row),
      user_agent: row.user_agent || "",
      ip_address: row.ip_address || "",
      last_activity: row.last_activity,
    }))
  }

  /**
   * List all browser sessions for a tenant
   */
  async listTenantSessions(params: {
    tenantId: string
    limit?: number
    offset?: number
    activeOnly?: boolean
  }): Promise<BrowserSession[]> {
    const limit = params.limit || 100
    const offset = params.offset || 0
    const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days

    let query = `
      SELECT ${BROWSER_SESSION_COLUMNS.join(", ")}
      FROM ${this.browserTable}
      WHERE tenant_id = ?
    `

    const bindValues: unknown[] = [params.tenantId]

    if (params.activeOnly) {
      query += ` AND last_activity > ?`
      bindValues.push(Date.now() - maxAge)
    }

    query += ` ORDER BY last_activity DESC LIMIT ? OFFSET ?`
    bindValues.push(limit, offset)

    const result = await this.db
      .prepare(query)
      .bind(...bindValues)
      .all<BrowserSessionRow>()

    const sessions: BrowserSession[] = []
    for (const row of result.results || []) {
      const accountUserIds = await this.getAccountUserIds(row.id)
      sessions.push(this.rowToBrowserSession(row, accountUserIds))
    }

    return sessions
  }

  /**
   * Get expired sessions for cleanup
   */
  async getExpiredSessions(params: {
    maxAgeMs: number
    limit?: number
  }): Promise<BrowserSession[]> {
    const limit = params.limit || 100
    const cutoff = Date.now() - params.maxAgeMs

    const query = `
      SELECT ${BROWSER_SESSION_COLUMNS.join(", ")}
      FROM ${this.browserTable}
      WHERE last_activity < ?
      ORDER BY last_activity ASC
      LIMIT ?
    `

    const result = await this.db
      .prepare(query)
      .bind(cutoff, limit)
      .all<BrowserSessionRow>()

    const sessions: BrowserSession[] = []
    for (const row of result.results || []) {
      const accountUserIds = await this.getAccountUserIds(row.id)
      sessions.push(this.rowToBrowserSession(row, accountUserIds))
    }

    return sessions
  }

  /**
   * Revoke all sessions for a user in a tenant
   */
  async revokeAllUserSessions(params: {
    userId: string
    tenantId: string
  }): Promise<{ deletedCount: number }> {
    // Find all browser sessions where this user has an account
    const findQuery = `
      SELECT DISTINCT b.id
      FROM ${this.browserTable} b
      JOIN ${this.accountTable} a ON b.id = a.browser_session_id
      WHERE a.user_id = ? AND b.tenant_id = ?
    `

    const result = await this.db
      .prepare(findQuery)
      .bind(params.userId, params.tenantId)
      .all<{ id: string }>()

    const sessionIds = (result.results || []).map((r) => r.id)

    if (sessionIds.length === 0) {
      return { deletedCount: 0 }
    }

    // Delete account sessions for this user
    const deleteAccountsQuery = `
      DELETE FROM ${this.accountTable}
      WHERE user_id = ? AND browser_session_id IN (
        SELECT id FROM ${this.browserTable} WHERE tenant_id = ?
      )
    `

    await this.db
      .prepare(deleteAccountsQuery)
      .bind(params.userId, params.tenantId)
      .run()

    return { deletedCount: sessionIds.length }
  }

  /**
   * Get session statistics for a tenant
   */
  async getSessionStats(params: { tenantId?: string }): Promise<{
    totalBrowserSessions: number
    totalAccountSessions: number
    activeSessions: number
    uniqueUsers: number
  }> {
    const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days
    const activeCutoff = Date.now() - maxAge

    let browserQuery: string
    let accountQuery: string
    let activeQuery: string
    let usersQuery: string
    const bindValues: unknown[] = []

    if (params.tenantId) {
      browserQuery = `SELECT COUNT(*) as count FROM ${this.browserTable} WHERE tenant_id = ?`
      accountQuery = `
        SELECT COUNT(*) as count FROM ${this.accountTable} a
        JOIN ${this.browserTable} b ON a.browser_session_id = b.id
        WHERE b.tenant_id = ?
      `
      activeQuery = `SELECT COUNT(*) as count FROM ${this.browserTable} WHERE tenant_id = ? AND last_activity > ?`
      usersQuery = `
        SELECT COUNT(DISTINCT a.user_id) as count FROM ${this.accountTable} a
        JOIN ${this.browserTable} b ON a.browser_session_id = b.id
        WHERE b.tenant_id = ?
      `
      bindValues.push(params.tenantId)
    } else {
      browserQuery = `SELECT COUNT(*) as count FROM ${this.browserTable}`
      accountQuery = `SELECT COUNT(*) as count FROM ${this.accountTable}`
      activeQuery = `SELECT COUNT(*) as count FROM ${this.browserTable} WHERE last_activity > ?`
      usersQuery = `SELECT COUNT(DISTINCT user_id) as count FROM ${this.accountTable}`
    }

    const [browserResult, accountResult, activeResult, usersResult] =
      await Promise.all([
        params.tenantId
          ? this.db
              .prepare(browserQuery)
              .bind(params.tenantId)
              .first<{ count: number }>()
          : this.db.prepare(browserQuery).first<{ count: number }>(),
        params.tenantId
          ? this.db
              .prepare(accountQuery)
              .bind(params.tenantId)
              .first<{ count: number }>()
          : this.db.prepare(accountQuery).first<{ count: number }>(),
        params.tenantId
          ? this.db
              .prepare(activeQuery)
              .bind(params.tenantId, activeCutoff)
              .first<{ count: number }>()
          : this.db
              .prepare(activeQuery)
              .bind(activeCutoff)
              .first<{ count: number }>(),
        params.tenantId
          ? this.db
              .prepare(usersQuery)
              .bind(params.tenantId)
              .first<{ count: number }>()
          : this.db.prepare(usersQuery).first<{ count: number }>(),
      ])

    return {
      totalBrowserSessions: browserResult?.count || 0,
      totalAccountSessions: accountResult?.count || 0,
      activeSessions: activeResult?.count || 0,
      uniqueUsers: usersResult?.count || 0,
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async getAccountUserIds(browserSessionId: string): Promise<string[]> {
    const query = `
      SELECT user_id
      FROM ${this.accountTable}
      WHERE browser_session_id = ?
      ORDER BY authenticated_at ASC
    `

    const result = await this.db
      .prepare(query)
      .bind(browserSessionId)
      .all<{ user_id: string }>()

    return (result.results || []).map((r) => r.user_id)
  }

  private rowToBrowserSession(
    row: BrowserSessionRow,
    accountUserIds: string[],
  ): BrowserSession {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      created_at: row.created_at,
      last_activity: row.last_activity,
      user_agent: row.user_agent || "",
      ip_address: row.ip_address || "",
      version: row.version,
      active_user_id: row.active_user_id,
      account_user_ids: accountUserIds,
    }
  }

  private rowToAccountSession(row: AccountSessionRow): AccountSession {
    return {
      id: row.id,
      browser_session_id: row.browser_session_id,
      user_id: row.user_id,
      is_active: row.is_active === 1,
      authenticated_at: row.authenticated_at,
      expires_at: row.expires_at,
      subject_type: row.subject_type,
      subject_properties: row.subject_properties
        ? JSON.parse(row.subject_properties)
        : {},
      refresh_token: row.refresh_token,
      client_id: row.client_id,
    }
  }
}

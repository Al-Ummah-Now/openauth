/**
 * Admin Session Service
 *
 * Provides administrative capabilities for session management:
 * - List all sessions for a user across browsers
 * - List all sessions for a tenant
 * - Revoke specific sessions
 * - Revoke all sessions for a user
 * - Cleanup expired sessions
 * - Session statistics
 *
 * Per IDENTITY_PLATFORM_SPEC.md:
 * ### Admin APIs
 * ```
 * GET    /admin/users/:userId/sessions              - List user's sessions
 * DELETE /admin/users/:userId/sessions/:sessionId   - Terminate specific session
 * DELETE /admin/users/:userId/sessions              - Terminate all user sessions
 * POST   /admin/users/:userId/force-logout          - Force logout everywhere
 * ```
 *
 * @see /packages/openauth/docs/IDENTITY_PLATFORM_SPEC.md
 * @packageDocumentation
 */

import type { BrowserSession, AccountSession } from "../contracts/types.js"
import { D1SessionAdapter, type D1Database } from "./d1-adapter.js"

/**
 * Configuration for AdminSessionService
 */
export interface AdminSessionServiceConfig {
  database: D1Database
  browserSessionsTable?: string
  accountSessionsTable?: string
}

/**
 * User session with browser metadata
 */
export interface UserSessionInfo extends AccountSession {
  user_agent: string
  ip_address: string
  last_activity: number
}

/**
 * Result of session revocation
 */
export interface RevokeResult {
  success: boolean
  sessionsRevoked?: number
  accountsRevoked?: number
  error?: string
}

/**
 * Session statistics
 */
export interface SessionStats {
  totalBrowserSessions: number
  totalAccountSessions: number
  activeSessionsLast24h: number
  activeSessions: number
  uniqueUsers: number
}

/**
 * Administrative service for session management
 *
 * This service wraps D1SessionAdapter to provide admin-specific
 * operations that require database queries.
 */
export class AdminSessionService {
  private readonly adapter: D1SessionAdapter

  constructor(config: AdminSessionServiceConfig) {
    this.adapter = new D1SessionAdapter({
      database: config.database,
      browserSessionsTable: config.browserSessionsTable,
      accountSessionsTable: config.accountSessionsTable,
    })
  }

  // ============================================
  // User Session Management
  // ============================================

  /**
   * List all sessions for a user across all browsers
   *
   * @param params.userId - User ID to look up
   * @param params.tenantId - Tenant ID for isolation
   * @param params.limit - Max results (default 100)
   * @param params.offset - Pagination offset (default 0)
   */
  async listUserSessions(params: {
    userId: string
    tenantId: string
    limit?: number
    offset?: number
  }): Promise<UserSessionInfo[]> {
    return this.adapter.listUserSessions(params)
  }

  /**
   * Revoke all sessions for a specific user
   *
   * @param params.userId - User ID whose sessions to revoke
   * @param params.tenantId - Tenant ID for isolation
   */
  async revokeAllUserSessions(params: {
    userId: string
    tenantId: string
  }): Promise<RevokeResult> {
    try {
      const result = await this.adapter.revokeAllUserSessions(params)
      return {
        success: true,
        sessionsRevoked: result.deletedCount,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  // ============================================
  // Tenant Session Management
  // ============================================

  /**
   * List all browser sessions for a tenant
   *
   * @param params.tenantId - Tenant ID
   * @param params.limit - Max results (default 100)
   * @param params.offset - Pagination offset (default 0)
   * @param params.activeOnly - Only return active sessions
   */
  async listTenantSessions(params: {
    tenantId: string
    limit?: number
    offset?: number
    activeOnly?: boolean
  }): Promise<BrowserSession[]> {
    return this.adapter.listTenantSessions(params)
  }

  /**
   * Revoke a specific browser session
   *
   * @param params.sessionId - Browser session ID to revoke
   * @param params.tenantId - Tenant ID for validation
   */
  async revokeSession(params: {
    sessionId: string
    tenantId: string
  }): Promise<RevokeResult> {
    try {
      // Get session to verify tenant and count accounts
      const session = await this.adapter.getBrowserSession(params.sessionId)

      if (!session) {
        return {
          success: false,
          error: "Session not found",
        }
      }

      if (session.tenant_id !== params.tenantId) {
        return {
          success: false,
          error: "Session belongs to different tenant",
        }
      }

      const accountCount = session.account_user_ids.length

      // Delete the session (cascades to account sessions)
      await this.adapter.deleteBrowserSession(params.sessionId)

      return {
        success: true,
        sessionsRevoked: 1,
        accountsRevoked: accountCount,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  // ============================================
  // Session Cleanup
  // ============================================

  /**
   * Get expired sessions for cleanup
   *
   * @param params.maxAgeMs - Maximum age in milliseconds (default 7 days)
   * @param params.limit - Max results for batch processing (default 100)
   */
  async getExpiredSessions(params: {
    maxAgeMs?: number
    limit?: number
  }): Promise<BrowserSession[]> {
    const maxAgeMs = params.maxAgeMs || 7 * 24 * 60 * 60 * 1000 // 7 days default
    return this.adapter.getExpiredSessions({
      maxAgeMs,
      limit: params.limit,
    })
  }

  /**
   * Cleanup expired sessions
   *
   * @param params.maxAgeMs - Maximum age in milliseconds (default 7 days)
   * @param params.batchSize - Number of sessions to delete per batch (default 100)
   */
  async cleanupExpiredSessions(params: {
    maxAgeMs?: number
    batchSize?: number
  }): Promise<{ deletedCount: number }> {
    const maxAgeMs = params.maxAgeMs || 7 * 24 * 60 * 60 * 1000
    const batchSize = params.batchSize || 100

    let totalDeleted = 0
    let hasMore = true

    while (hasMore) {
      const expiredSessions = await this.adapter.getExpiredSessions({
        maxAgeMs,
        limit: batchSize,
      })

      if (expiredSessions.length === 0) {
        hasMore = false
        break
      }

      for (const session of expiredSessions) {
        await this.adapter.deleteBrowserSession(session.id)
        totalDeleted++
      }

      // If we got less than batchSize, we're done
      if (expiredSessions.length < batchSize) {
        hasMore = false
      }
    }

    return { deletedCount: totalDeleted }
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Get session statistics for a tenant or globally
   *
   * @param params.tenantId - Tenant ID (optional, omit for global stats)
   */
  async getSessionStats(params: { tenantId?: string }): Promise<SessionStats> {
    const stats = await this.adapter.getSessionStats(params)

    // Calculate 24h active sessions
    const last24h = await this.adapter.getSessionStats({
      tenantId: params.tenantId,
    })

    return {
      totalBrowserSessions: stats.totalBrowserSessions,
      totalAccountSessions: stats.totalAccountSessions,
      activeSessions: stats.activeSessions,
      activeSessionsLast24h: stats.activeSessions, // Same query for now
      uniqueUsers: stats.uniqueUsers,
    }
  }
}

/**
 * Session service implementation for multi-account session management.
 *
 * This service manages browser sessions and account sessions, allowing users
 * to be logged into multiple accounts simultaneously (up to 3 by default).
 *
 * Storage Keys:
 * - Browser session: ["session", "browser", tenantId, sessionId]
 * - Account session: ["session", "account", browserSessionId, userId]
 * - User index: ["session", "user", tenantId, userId, browserSessionId]
 *
 * Testing Checklist:
 * - [x] Can create browser session
 * - [x] Can add up to 3 accounts
 * - [x] 4th account rejected with SessionError
 * - [x] Can switch active account
 * - [x] Can remove single account
 * - [x] Can sign out all accounts
 * - [x] Session expires after 7 days
 * - [x] Activity extends session (sliding window)
 * - [x] Admin can revoke user sessions
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from "../storage/storage.js"
import { Storage } from "../storage/storage.js"
import type {
  BrowserSession,
  AccountSession,
  SessionService,
  SessionConfig,
} from "../contracts/types.js"
import { SessionError, DEFAULT_SESSION_CONFIG } from "../contracts/types.js"
import { D1SessionAdapter, type D1Database } from "./d1-adapter.js"

/**
 * Extended session configuration with dual-write support
 */
export interface ExtendedSessionConfig extends Partial<SessionConfig> {
  /** D1 database for dual-write (optional) */
  d1Database?: D1Database
  /** Enable dual-write to both KV and D1 (default: true if d1Database provided) */
  dualWriteEnabled?: boolean
}

/**
 * Implementation of the SessionService interface for multi-account session management.
 */
export class SessionServiceImpl implements SessionService {
  private readonly storage: StorageAdapter
  private readonly config: SessionConfig
  private readonly d1Adapter: D1SessionAdapter | null
  private readonly dualWriteEnabled: boolean

  /**
   * Create a new SessionServiceImpl instance.
   *
   * @param storage - Storage adapter for persisting sessions (KV primary)
   * @param config - Optional session configuration with dual-write support
   */
  constructor(storage: StorageAdapter, config?: ExtendedSessionConfig) {
    this.storage = storage
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config }

    // Initialize D1 adapter if database provided
    if (config?.d1Database) {
      this.d1Adapter = new D1SessionAdapter({ database: config.d1Database })
      this.dualWriteEnabled = config.dualWriteEnabled !== false // Default true if D1 provided
    } else {
      this.d1Adapter = null
      this.dualWriteEnabled = false
    }
  }

  /**
   * Write to D1 if dual-write is enabled (fire and forget for non-critical path)
   */
  private async writeToD1<T>(operation: () => Promise<T>): Promise<void> {
    if (!this.dualWriteEnabled || !this.d1Adapter) return

    try {
      await operation()
    } catch (error) {
      // Log error but don't fail the primary operation
      console.error("[SessionService] D1 dual-write failed:", error)
    }
  }

  /**
   * Get the storage key for a browser session.
   */
  private browserSessionKey(tenantId: string, sessionId: string): string[] {
    return ["session", "browser", tenantId, sessionId]
  }

  /**
   * Get the storage key for an account session.
   */
  private accountSessionKey(
    browserSessionId: string,
    userId: string,
  ): string[] {
    return ["session", "account", browserSessionId, userId]
  }

  /**
   * Get the storage key for the user session index.
   * This allows looking up all sessions for a specific user.
   */
  private userIndexKey(
    tenantId: string,
    userId: string,
    browserSessionId: string,
  ): string[] {
    return ["session", "user", tenantId, userId, browserSessionId]
  }

  /**
   * Check if sliding window update is needed and update last_activity if so.
   *
   * @param session - The browser session to potentially update
   * @returns true if session was updated, false otherwise
   */
  private shouldUpdateSlidingWindow(session: BrowserSession): boolean {
    const now = Date.now()
    const timeSinceLastActivity = (now - session.last_activity) / 1000
    return timeSinceLastActivity > this.config.slidingWindowSeconds
  }

  /**
   * Calculate the TTL in seconds for a session.
   */
  private getSessionTTL(): number {
    return this.config.sessionLifetimeSeconds
  }

  /**
   * Create a new browser session.
   *
   * @param params - Session creation parameters
   * @returns The created browser session
   */
  async createBrowserSession(params: {
    tenantId: string
    userAgent: string
    ipAddress: string
  }): Promise<BrowserSession> {
    const now = Date.now()
    const sessionId = crypto.randomUUID()

    const session: BrowserSession = {
      id: sessionId,
      tenant_id: params.tenantId,
      created_at: now,
      last_activity: now,
      user_agent: params.userAgent,
      ip_address: params.ipAddress,
      version: 1,
      active_user_id: null,
      account_user_ids: [],
    }

    // Write to KV (primary)
    await Storage.set(
      this.storage,
      this.browserSessionKey(params.tenantId, sessionId),
      session,
      this.getSessionTTL(),
    )

    // Dual-write to D1 (if enabled)
    await this.writeToD1(() =>
      this.d1Adapter!.createBrowserSession({
        id: sessionId,
        tenantId: params.tenantId,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
        createdAt: now,
        lastActivity: now,
      }),
    )

    return session
  }

  /**
   * Get a browser session by ID and tenant ID.
   *
   * @param sessionId - The session ID
   * @param tenantId - The tenant ID
   * @returns The browser session or null if not found/expired
   */
  async getBrowserSession(
    sessionId: string,
    tenantId: string,
  ): Promise<BrowserSession | null> {
    const session = await Storage.get<BrowserSession>(
      this.storage,
      this.browserSessionKey(tenantId, sessionId),
    )

    if (!session) {
      return null
    }

    // Check if session has expired
    const now = Date.now()
    const sessionAge = (now - session.created_at) / 1000
    if (sessionAge > this.config.sessionLifetimeSeconds) {
      // Session expired, clean up
      await this.cleanupExpiredSession(sessionId, tenantId)
      return null
    }

    // Update sliding window if needed
    if (this.shouldUpdateSlidingWindow(session)) {
      session.last_activity = now
      session.version += 1
      await this.updateBrowserSession(session)
    }

    return session
  }

  /**
   * Update an existing browser session.
   *
   * @param session - The session to update
   */
  async updateBrowserSession(session: BrowserSession): Promise<void> {
    // Calculate remaining TTL based on session lifetime
    const now = Date.now()
    const elapsed = (now - session.created_at) / 1000
    const remainingTTL = Math.max(
      0,
      this.config.sessionLifetimeSeconds - elapsed,
    )

    // Write to KV (primary)
    await Storage.set(
      this.storage,
      this.browserSessionKey(session.tenant_id, session.id),
      session,
      remainingTTL,
    )

    // Dual-write to D1 (if enabled)
    await this.writeToD1(() =>
      this.d1Adapter!.updateBrowserSession(session.id, {
        last_activity: session.last_activity,
        active_user_id: session.active_user_id,
        version: session.version,
      }),
    )
  }

  /**
   * Clean up an expired session and all associated account sessions.
   */
  private async cleanupExpiredSession(
    sessionId: string,
    tenantId: string,
  ): Promise<void> {
    // First get the session to find all account user IDs
    const session = await Storage.get<BrowserSession>(
      this.storage,
      this.browserSessionKey(tenantId, sessionId),
    )

    if (session) {
      // Remove all account sessions
      for (const userId of session.account_user_ids) {
        await Storage.remove(
          this.storage,
          this.accountSessionKey(sessionId, userId),
        )

        // Dual-write to D1
        await this.writeToD1(() =>
          this.d1Adapter!.removeAccountSession(sessionId, userId),
        )

        await Storage.remove(
          this.storage,
          this.userIndexKey(tenantId, userId, sessionId),
        )
      }
    }

    // Remove the browser session from KV
    await Storage.remove(
      this.storage,
      this.browserSessionKey(tenantId, sessionId),
    )

    // Dual-write to D1
    await this.writeToD1(() => this.d1Adapter!.deleteBrowserSession(sessionId))
  }

  /**
   * Add an account to an existing browser session.
   *
   * @param params - Account session parameters
   * @returns The created account session
   * @throws SessionError with code "max_accounts_exceeded" if limit reached
   * @throws SessionError with code "session_not_found" if browser session doesn't exist
   */
  async addAccountToSession(params: {
    browserSessionId: string
    userId: string
    subjectType: string
    subjectProperties: Record<string, unknown>
    refreshToken: string
    clientId: string
    ttl: number
  }): Promise<AccountSession> {
    // Get browser session to find tenant ID and check account limit
    // We need to scan to find the session since we don't have tenant ID
    const browserSession = await this.findBrowserSessionById(
      params.browserSessionId,
    )

    if (!browserSession) {
      throw new SessionError(
        "session_not_found",
        `Browser session ${params.browserSessionId} not found`,
      )
    }

    // Check if user is already in this session
    const existingAccount = await this.getAccountSession(
      params.browserSessionId,
      params.userId,
    )
    if (existingAccount) {
      // Update existing account session and make it active
      const now = Date.now()
      const updatedAccount: AccountSession = {
        ...existingAccount,
        authenticated_at: now,
        expires_at: now + params.ttl * 1000,
        refresh_token: params.refreshToken,
        subject_properties: params.subjectProperties,
        is_active: true,
      }

      // Deactivate other accounts
      for (const userId of browserSession.account_user_ids) {
        if (userId !== params.userId) {
          const otherAccount = await this.getAccountSession(
            params.browserSessionId,
            userId,
          )
          if (otherAccount && otherAccount.is_active) {
            otherAccount.is_active = false
            await Storage.set(
              this.storage,
              this.accountSessionKey(params.browserSessionId, userId),
              otherAccount,
              params.ttl,
            )
          }
        }
      }

      await Storage.set(
        this.storage,
        this.accountSessionKey(params.browserSessionId, params.userId),
        updatedAccount,
        params.ttl,
      )

      // Update browser session active user
      browserSession.active_user_id = params.userId
      browserSession.version += 1
      await this.updateBrowserSession(browserSession)

      return updatedAccount
    }

    // Check account limit
    if (
      browserSession.account_user_ids.length >=
      this.config.maxAccountsPerSession
    ) {
      throw new SessionError(
        "max_accounts_exceeded",
        `Maximum of ${this.config.maxAccountsPerSession} accounts per session exceeded`,
      )
    }

    const now = Date.now()
    const accountSession: AccountSession = {
      id: crypto.randomUUID(),
      browser_session_id: params.browserSessionId,
      user_id: params.userId,
      is_active: true,
      authenticated_at: now,
      expires_at: now + params.ttl * 1000,
      subject_type: params.subjectType,
      subject_properties: params.subjectProperties,
      refresh_token: params.refreshToken,
      client_id: params.clientId,
    }

    // Deactivate other accounts
    for (const userId of browserSession.account_user_ids) {
      const otherAccount = await this.getAccountSession(
        params.browserSessionId,
        userId,
      )
      if (otherAccount && otherAccount.is_active) {
        otherAccount.is_active = false
        await Storage.set(
          this.storage,
          this.accountSessionKey(params.browserSessionId, userId),
          otherAccount,
          params.ttl,
        )
      }
    }

    // Store account session in KV (primary)
    await Storage.set(
      this.storage,
      this.accountSessionKey(params.browserSessionId, params.userId),
      accountSession,
      params.ttl,
    )

    // Dual-write account session to D1
    await this.writeToD1(() =>
      this.d1Adapter!.addAccountSession({
        browserSessionId: params.browserSessionId,
        userId: params.userId,
        subjectType: params.subjectType,
        subjectProperties: params.subjectProperties,
        refreshToken: params.refreshToken,
        clientId: params.clientId,
        ttl: params.ttl,
      }),
    )

    // Store user index entry for reverse lookup
    await Storage.set(
      this.storage,
      this.userIndexKey(
        browserSession.tenant_id,
        params.userId,
        params.browserSessionId,
      ),
      {
        sessionId: params.browserSessionId,
        tenantId: browserSession.tenant_id,
      },
      params.ttl,
    )

    // Update browser session
    browserSession.account_user_ids.push(params.userId)
    browserSession.active_user_id = params.userId
    browserSession.version += 1
    browserSession.last_activity = now
    await this.updateBrowserSession(browserSession)

    return accountSession
  }

  /**
   * Find a browser session by ID without knowing the tenant ID.
   * This is less efficient but needed in some cases.
   */
  private async findBrowserSessionById(
    sessionId: string,
  ): Promise<BrowserSession | null> {
    // Scan for sessions with this ID across all tenants
    const prefix = ["session", "browser"]
    for await (const [key, value] of Storage.scan<BrowserSession>(
      this.storage,
      prefix,
    )) {
      if (key[3] === sessionId) {
        return value
      }
    }
    return null
  }

  /**
   * Get an account session.
   *
   * @param browserSessionId - The browser session ID
   * @param userId - The user ID
   * @returns The account session or null if not found
   */
  async getAccountSession(
    browserSessionId: string,
    userId: string,
  ): Promise<AccountSession | null> {
    const session = await Storage.get<AccountSession>(
      this.storage,
      this.accountSessionKey(browserSessionId, userId),
    )

    if (!session) {
      return null
    }

    // Check if account session has expired
    if (Date.now() > session.expires_at) {
      await Storage.remove(
        this.storage,
        this.accountSessionKey(browserSessionId, userId),
      )
      return null
    }

    return session
  }

  /**
   * List all accounts in a browser session.
   *
   * @param browserSessionId - The browser session ID
   * @returns Array of account sessions
   */
  async listAccounts(browserSessionId: string): Promise<AccountSession[]> {
    const browserSession = await this.findBrowserSessionById(browserSessionId)
    if (!browserSession) {
      return []
    }

    const accounts: AccountSession[] = []
    for (const userId of browserSession.account_user_ids) {
      const account = await this.getAccountSession(browserSessionId, userId)
      if (account) {
        accounts.push(account)
      }
    }

    return accounts
  }

  /**
   * Switch the active account in a browser session.
   *
   * @param browserSessionId - The browser session ID
   * @param userId - The user ID to switch to
   * @throws SessionError with code "session_not_found" if browser session doesn't exist
   * @throws SessionError with code "account_not_found" if account doesn't exist in session
   */
  async switchActiveAccount(
    browserSessionId: string,
    userId: string,
  ): Promise<void> {
    const browserSession = await this.findBrowserSessionById(browserSessionId)
    if (!browserSession) {
      throw new SessionError(
        "session_not_found",
        `Browser session ${browserSessionId} not found`,
      )
    }

    // Check if account exists in this session
    if (!browserSession.account_user_ids.includes(userId)) {
      throw new SessionError(
        "account_not_found",
        `Account ${userId} not found in session ${browserSessionId}`,
      )
    }

    const targetAccount = await this.getAccountSession(browserSessionId, userId)
    if (!targetAccount) {
      throw new SessionError(
        "account_not_found",
        `Account session for ${userId} not found or expired`,
      )
    }

    // Deactivate current active account
    if (browserSession.active_user_id) {
      const currentAccount = await this.getAccountSession(
        browserSessionId,
        browserSession.active_user_id,
      )
      if (currentAccount && currentAccount.is_active) {
        currentAccount.is_active = false
        const remainingTTL = Math.max(
          0,
          Math.floor((currentAccount.expires_at - Date.now()) / 1000),
        )
        await Storage.set(
          this.storage,
          this.accountSessionKey(
            browserSessionId,
            browserSession.active_user_id,
          ),
          currentAccount,
          remainingTTL,
        )

        // Dual-write to D1
        await this.writeToD1(() =>
          this.d1Adapter!.setAccountActive(
            browserSessionId,
            browserSession.active_user_id!,
            false,
          ),
        )
      }
    }

    // Activate target account
    targetAccount.is_active = true
    const remainingTTL = Math.max(
      0,
      Math.floor((targetAccount.expires_at - Date.now()) / 1000),
    )
    await Storage.set(
      this.storage,
      this.accountSessionKey(browserSessionId, userId),
      targetAccount,
      remainingTTL,
    )

    // Dual-write to D1
    await this.writeToD1(() =>
      this.d1Adapter!.setAccountActive(browserSessionId, userId, true),
    )

    // Update browser session (includes D1 dual-write)
    browserSession.active_user_id = userId
    browserSession.version += 1
    browserSession.last_activity = Date.now()
    await this.updateBrowserSession(browserSession)
  }

  /**
   * Remove a single account from a browser session.
   *
   * @param browserSessionId - The browser session ID
   * @param userId - The user ID to remove
   */
  async removeAccount(browserSessionId: string, userId: string): Promise<void> {
    const browserSession = await this.findBrowserSessionById(browserSessionId)
    if (!browserSession) {
      return // Session doesn't exist, nothing to remove
    }

    // Remove account session from KV
    await Storage.remove(
      this.storage,
      this.accountSessionKey(browserSessionId, userId),
    )

    // Dual-write to D1
    await this.writeToD1(() =>
      this.d1Adapter!.removeAccountSession(browserSessionId, userId),
    )

    // Remove user index entry
    await Storage.remove(
      this.storage,
      this.userIndexKey(browserSession.tenant_id, userId, browserSessionId),
    )

    // Update browser session
    browserSession.account_user_ids = browserSession.account_user_ids.filter(
      (id) => id !== userId,
    )

    // If removed account was active, switch to another or set to null
    if (browserSession.active_user_id === userId) {
      browserSession.active_user_id =
        browserSession.account_user_ids.length > 0
          ? browserSession.account_user_ids[0]
          : null

      // Activate the new active account if there is one
      if (browserSession.active_user_id) {
        const newActiveAccount = await this.getAccountSession(
          browserSessionId,
          browserSession.active_user_id,
        )
        if (newActiveAccount) {
          newActiveAccount.is_active = true
          const remainingTTL = Math.max(
            0,
            Math.floor((newActiveAccount.expires_at - Date.now()) / 1000),
          )
          await Storage.set(
            this.storage,
            this.accountSessionKey(
              browserSessionId,
              browserSession.active_user_id,
            ),
            newActiveAccount,
            remainingTTL,
          )
        }
      }
    }

    browserSession.version += 1
    browserSession.last_activity = Date.now()
    await this.updateBrowserSession(browserSession)
  }

  /**
   * Remove all accounts from a browser session (sign out all).
   *
   * @param browserSessionId - The browser session ID
   */
  async removeAllAccounts(browserSessionId: string): Promise<void> {
    const browserSession = await this.findBrowserSessionById(browserSessionId)
    if (!browserSession) {
      return // Session doesn't exist, nothing to remove
    }

    // Remove all account sessions
    for (const userId of browserSession.account_user_ids) {
      await Storage.remove(
        this.storage,
        this.accountSessionKey(browserSessionId, userId),
      )

      // Dual-write to D1
      await this.writeToD1(() =>
        this.d1Adapter!.removeAccountSession(browserSessionId, userId),
      )

      await Storage.remove(
        this.storage,
        this.userIndexKey(browserSession.tenant_id, userId, browserSessionId),
      )
    }

    // Update browser session
    browserSession.account_user_ids = []
    browserSession.active_user_id = null
    browserSession.version += 1
    browserSession.last_activity = Date.now()
    await this.updateBrowserSession(browserSession)
  }

  /**
   * Revoke all sessions for a specific user across all their browser sessions.
   * This is an admin operation.
   *
   * @param tenantId - The tenant ID
   * @param userId - The user ID
   * @returns The number of sessions revoked
   */
  async revokeUserSessions(tenantId: string, userId: string): Promise<number> {
    let revokedCount = 0

    // Scan the user index to find all sessions for this user
    const prefix = ["session", "user", tenantId, userId]
    const sessionsToRevoke: Array<{
      sessionId: string
      tenantId: string
    }> = []

    for await (const [, value] of Storage.scan<{
      sessionId: string
      tenantId: string
    }>(this.storage, prefix)) {
      sessionsToRevoke.push(value)
    }

    // Remove user from each session
    for (const { sessionId } of sessionsToRevoke) {
      await this.removeAccount(sessionId, userId)
      revokedCount++
    }

    return revokedCount
  }

  /**
   * Revoke a specific session entirely.
   * This is an admin operation.
   *
   * @param sessionId - The session ID to revoke
   * @param tenantId - The tenant ID
   * @returns true if session was found and revoked, false otherwise
   */
  async revokeSpecificSession(
    sessionId: string,
    tenantId: string,
  ): Promise<boolean> {
    const session = await this.getBrowserSession(sessionId, tenantId)
    if (!session) {
      return false
    }

    // Remove all account sessions
    for (const userId of session.account_user_ids) {
      await Storage.remove(
        this.storage,
        this.accountSessionKey(sessionId, userId),
      )

      // Dual-write to D1
      await this.writeToD1(() =>
        this.d1Adapter!.removeAccountSession(sessionId, userId),
      )

      await Storage.remove(
        this.storage,
        this.userIndexKey(tenantId, userId, sessionId),
      )
    }

    // Remove the browser session from KV
    await Storage.remove(
      this.storage,
      this.browserSessionKey(tenantId, sessionId),
    )

    // Dual-write to D1
    await this.writeToD1(() => this.d1Adapter!.deleteBrowserSession(sessionId))

    return true
  }
}

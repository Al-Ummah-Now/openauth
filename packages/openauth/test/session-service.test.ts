import {
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
  setSystemTime,
} from "bun:test"
import { MemoryStorage } from "../src/storage/memory.js"
import { SessionServiceImpl } from "../src/session/service.js"
import {
  encryptSessionCookie,
  decryptSessionCookie,
  createCookieOptions,
  createCookiePayload,
  parseCookie,
  generateCookieSecret,
  hexToSecret,
  base64ToSecret,
  secretToHex,
} from "../src/session/cookie.js"
import { SessionError, DEFAULT_SESSION_CONFIG } from "../src/contracts/types.js"
import type {
  BrowserSession,
  AccountSession,
  SessionCookiePayload,
} from "../src/contracts/types.js"

describe("SessionServiceImpl", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let service: SessionServiceImpl
  const tenantId = "tenant-123"
  const userAgent = "Mozilla/5.0"
  const ipAddress = "192.168.1.1"

  beforeEach(() => {
    storage = MemoryStorage()
    service = new SessionServiceImpl(storage)
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  describe("createBrowserSession", () => {
    test("creates session with correct structure", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      expect(session.id).toBeTypeOf("string")
      expect(session.tenant_id).toBe(tenantId)
      expect(session.user_agent).toBe(userAgent)
      expect(session.ip_address).toBe(ipAddress)
      expect(session.created_at).toBe(Date.now())
      expect(session.last_activity).toBe(Date.now())
      expect(session.version).toBe(1)
      expect(session.active_user_id).toBeNull()
      expect(session.account_user_ids).toEqual([])
    })

    test("generates unique UUID for session ID", async () => {
      const session1 = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })
      const session2 = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      expect(session1.id).not.toBe(session2.id)
      expect(session1.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
      expect(session2.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    })

    test("stores session in storage with correct TTL", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      const retrieved = await service.getBrowserSession(session.id, tenantId)
      expect(retrieved).toEqual(session)
    })
  })

  describe("getBrowserSession", () => {
    test("returns session when it exists", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      const retrieved = await service.getBrowserSession(session.id, tenantId)
      expect(retrieved).toEqual(session)
    })

    test("returns null when session does not exist", async () => {
      const retrieved = await service.getBrowserSession(
        "nonexistent-id",
        tenantId,
      )
      expect(retrieved).toBeNull()
    })

    test("returns null when session has expired", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      // Fast forward past session lifetime (7 days + 1 second)
      setSystemTime(
        Date.now() +
          DEFAULT_SESSION_CONFIG.sessionLifetimeSeconds * 1000 +
          1000,
      )

      const retrieved = await service.getBrowserSession(session.id, tenantId)
      expect(retrieved).toBeNull()
    })

    test("updates last_activity when sliding window threshold is exceeded", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      const initialActivity = session.last_activity

      // Fast forward past sliding window (1 day + 1 second)
      setSystemTime(
        Date.now() + DEFAULT_SESSION_CONFIG.slidingWindowSeconds * 1000 + 1000,
      )

      const retrieved = await service.getBrowserSession(session.id, tenantId)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.last_activity).toBeGreaterThan(initialActivity)
      expect(retrieved!.version).toBe(2) // Version should increment
    })

    test("does not update last_activity when within sliding window", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      const initialActivity = session.last_activity

      // Fast forward less than sliding window
      setSystemTime(Date.now() + 1000 * 60 * 60) // 1 hour

      const retrieved = await service.getBrowserSession(session.id, tenantId)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.last_activity).toBe(initialActivity)
      expect(retrieved!.version).toBe(1) // Version should not increment
    })
  })

  describe("addAccountToSession", () => {
    let browserSession: BrowserSession

    beforeEach(async () => {
      browserSession = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })
    })

    test("adds account to session with correct structure", async () => {
      const account = await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: { email: "user1@example.com" },
        refreshToken: "refresh-token-1",
        clientId: "client-1",
        ttl: 3600,
      })

      expect(account.id).toBeTypeOf("string")
      expect(account.browser_session_id).toBe(browserSession.id)
      expect(account.user_id).toBe("user-1")
      expect(account.is_active).toBe(true)
      expect(account.authenticated_at).toBe(Date.now())
      expect(account.expires_at).toBe(Date.now() + 3600 * 1000)
      expect(account.subject_type).toBe("user")
      expect(account.subject_properties).toEqual({ email: "user1@example.com" })
      expect(account.refresh_token).toBe("refresh-token-1")
      expect(account.client_id).toBe("client-1")
    })

    test("updates browser session with new account", async () => {
      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: { email: "user1@example.com" },
        refreshToken: "refresh-token-1",
        clientId: "client-1",
        ttl: 3600,
      })

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.account_user_ids).toEqual(["user-1"])
      expect(updated!.active_user_id).toBe("user-1")
      expect(updated!.version).toBe(2)
    })

    test("allows up to 3 accounts", async () => {
      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-3",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-3",
        clientId: "client-1",
        ttl: 3600,
      })

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.account_user_ids).toHaveLength(3)
    })

    test("rejects 4th account with max_accounts_exceeded error", async () => {
      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-3",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-3",
        clientId: "client-1",
        ttl: 3600,
      })

      try {
        await service.addAccountToSession({
          browserSessionId: browserSession.id,
          userId: "user-4",
          subjectType: "user",
          subjectProperties: {},
          refreshToken: "refresh-4",
          clientId: "client-1",
          ttl: 3600,
        })
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError)
        expect((error as SessionError).code).toBe("max_accounts_exceeded")
      }
    })

    test("throws session_not_found error when browser session does not exist", async () => {
      try {
        await service.addAccountToSession({
          browserSessionId: "nonexistent-session",
          userId: "user-1",
          subjectType: "user",
          subjectProperties: {},
          refreshToken: "refresh-1",
          clientId: "client-1",
          ttl: 3600,
        })
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError)
        expect((error as SessionError).code).toBe("session_not_found")
      }
    })

    test("updates existing account when adding same user again", async () => {
      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: { email: "old@example.com" },
        refreshToken: "old-token",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: { email: "new@example.com" },
        refreshToken: "new-token",
        clientId: "client-1",
        ttl: 7200,
      })

      const account = await service.getAccountSession(
        browserSession.id,
        "user-1",
      )
      expect(account!.subject_properties).toEqual({ email: "new@example.com" })
      expect(account!.refresh_token).toBe("new-token")

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.account_user_ids).toHaveLength(1) // Should not duplicate
    })

    test("deactivates other accounts when adding new account", async () => {
      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })

      const account1 = await service.getAccountSession(
        browserSession.id,
        "user-1",
      )
      const account2 = await service.getAccountSession(
        browserSession.id,
        "user-2",
      )

      expect(account1!.is_active).toBe(false)
      expect(account2!.is_active).toBe(true)
    })
  })

  describe("getAccountSession", () => {
    let browserSession: BrowserSession

    beforeEach(async () => {
      browserSession = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })
    })

    test("returns account session when it exists", async () => {
      const account = await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      const retrieved = await service.getAccountSession(
        browserSession.id,
        "user-1",
      )
      expect(retrieved).toEqual(account)
    })

    test("returns null when account session does not exist", async () => {
      const retrieved = await service.getAccountSession(
        browserSession.id,
        "nonexistent-user",
      )
      expect(retrieved).toBeNull()
    })

    test("returns null when account session has expired", async () => {
      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      // Fast forward past expiration
      setSystemTime(Date.now() + 3601 * 1000)

      const retrieved = await service.getAccountSession(
        browserSession.id,
        "user-1",
      )
      expect(retrieved).toBeNull()
    })
  })

  describe("listAccounts", () => {
    let browserSession: BrowserSession

    beforeEach(async () => {
      browserSession = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })
    })

    test("returns empty array when no accounts exist", async () => {
      const accounts = await service.listAccounts(browserSession.id)
      expect(accounts).toEqual([])
    })

    test("returns all accounts in session", async () => {
      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })

      const accounts = await service.listAccounts(browserSession.id)
      expect(accounts).toHaveLength(2)
      expect(accounts.map((a) => a.user_id)).toContain("user-1")
      expect(accounts.map((a) => a.user_id)).toContain("user-2")
    })

    test("excludes expired accounts", async () => {
      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 7200,
      })

      // Fast forward past first account expiration but before second
      setSystemTime(Date.now() + 3601 * 1000)

      const accounts = await service.listAccounts(browserSession.id)
      expect(accounts).toHaveLength(1)
      expect(accounts[0].user_id).toBe("user-2")
    })

    test("returns empty array when browser session does not exist", async () => {
      const accounts = await service.listAccounts("nonexistent-session")
      expect(accounts).toEqual([])
    })
  })

  describe("switchActiveAccount", () => {
    let browserSession: BrowserSession

    beforeEach(async () => {
      browserSession = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })
    })

    test("switches active account successfully", async () => {
      await service.switchActiveAccount(browserSession.id, "user-1")

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.active_user_id).toBe("user-1")
    })

    test("increments browser session version", async () => {
      const beforeSwitch = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      const versionBefore = beforeSwitch!.version

      await service.switchActiveAccount(browserSession.id, "user-1")

      const afterSwitch = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(afterSwitch!.version).toBe(versionBefore + 1)
    })

    test("activates target account and deactivates current", async () => {
      await service.switchActiveAccount(browserSession.id, "user-1")

      const account1 = await service.getAccountSession(
        browserSession.id,
        "user-1",
      )
      const account2 = await service.getAccountSession(
        browserSession.id,
        "user-2",
      )

      expect(account1!.is_active).toBe(true)
      expect(account2!.is_active).toBe(false)
    })

    test("throws session_not_found when browser session does not exist", async () => {
      try {
        await service.switchActiveAccount("nonexistent-session", "user-1")
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError)
        expect((error as SessionError).code).toBe("session_not_found")
      }
    })

    test("throws account_not_found when user not in session", async () => {
      try {
        await service.switchActiveAccount(browserSession.id, "user-999")
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError)
        expect((error as SessionError).code).toBe("account_not_found")
      }
    })

    test("throws account_not_found when account session expired", async () => {
      // Fast forward past account expiration
      setSystemTime(Date.now() + 3601 * 1000)

      try {
        await service.switchActiveAccount(browserSession.id, "user-1")
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError)
        expect((error as SessionError).code).toBe("account_not_found")
      }
    })

    test("updates last_activity timestamp", async () => {
      const before = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      const activityBefore = before!.last_activity

      setSystemTime(Date.now() + 5000) // 5 seconds later

      await service.switchActiveAccount(browserSession.id, "user-1")

      const after = await service.getBrowserSession(browserSession.id, tenantId)
      expect(after!.last_activity).toBeGreaterThan(activityBefore)
    })
  })

  describe("removeAccount", () => {
    let browserSession: BrowserSession

    beforeEach(async () => {
      browserSession = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })
    })

    test("removes account from session", async () => {
      await service.removeAccount(browserSession.id, "user-1")

      const account = await service.getAccountSession(
        browserSession.id,
        "user-1",
      )
      expect(account).toBeNull()

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.account_user_ids).toEqual(["user-2"])
    })

    test("switches active account when removing active user", async () => {
      // user-2 is currently active
      await service.removeAccount(browserSession.id, "user-2")

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.active_user_id).toBe("user-1")

      const account1 = await service.getAccountSession(
        browserSession.id,
        "user-1",
      )
      expect(account1!.is_active).toBe(true)
    })

    test("sets active_user_id to null when removing last account", async () => {
      await service.removeAccount(browserSession.id, "user-1")
      await service.removeAccount(browserSession.id, "user-2")

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.active_user_id).toBeNull()
      expect(updated!.account_user_ids).toEqual([])
    })

    test("does nothing when session does not exist", async () => {
      await expect(
        service.removeAccount("nonexistent-session", "user-1"),
      ).resolves.toBeUndefined()
    })

    test("increments browser session version", async () => {
      const before = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      const versionBefore = before!.version

      await service.removeAccount(browserSession.id, "user-1")

      const after = await service.getBrowserSession(browserSession.id, tenantId)
      expect(after!.version).toBe(versionBefore + 1)
    })
  })

  describe("removeAllAccounts", () => {
    let browserSession: BrowserSession

    beforeEach(async () => {
      browserSession = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-3",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-3",
        clientId: "client-1",
        ttl: 3600,
      })
    })

    test("removes all accounts from session", async () => {
      await service.removeAllAccounts(browserSession.id)

      const account1 = await service.getAccountSession(
        browserSession.id,
        "user-1",
      )
      const account2 = await service.getAccountSession(
        browserSession.id,
        "user-2",
      )
      const account3 = await service.getAccountSession(
        browserSession.id,
        "user-3",
      )

      expect(account1).toBeNull()
      expect(account2).toBeNull()
      expect(account3).toBeNull()
    })

    test("clears account_user_ids array", async () => {
      await service.removeAllAccounts(browserSession.id)

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.account_user_ids).toEqual([])
    })

    test("sets active_user_id to null", async () => {
      await service.removeAllAccounts(browserSession.id)

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated!.active_user_id).toBeNull()
    })

    test("increments browser session version", async () => {
      const before = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      const versionBefore = before!.version

      await service.removeAllAccounts(browserSession.id)

      const after = await service.getBrowserSession(browserSession.id, tenantId)
      expect(after!.version).toBe(versionBefore + 1)
    })

    test("does nothing when session does not exist", async () => {
      await expect(
        service.removeAllAccounts("nonexistent-session"),
      ).resolves.toBeUndefined()
    })

    test("browser session still exists after removing all accounts", async () => {
      await service.removeAllAccounts(browserSession.id)

      const updated = await service.getBrowserSession(
        browserSession.id,
        tenantId,
      )
      expect(updated).not.toBeNull()
      expect(updated!.id).toBe(browserSession.id)
    })
  })

  describe("revokeUserSessions", () => {
    test("revokes user from all their browser sessions", async () => {
      // Create multiple browser sessions
      const session1 = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })
      const session2 = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      // Add same user to both sessions
      await service.addAccountToSession({
        browserSessionId: session1.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: session2.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      const revokedCount = await service.revokeUserSessions(tenantId, "user-1")
      expect(revokedCount).toBe(2)

      // Verify user removed from both sessions
      const account1 = await service.getAccountSession(session1.id, "user-1")
      const account2 = await service.getAccountSession(session2.id, "user-1")
      expect(account1).toBeNull()
      expect(account2).toBeNull()
    })

    test("returns 0 when user has no sessions", async () => {
      const revokedCount = await service.revokeUserSessions(
        tenantId,
        "nonexistent-user",
      )
      expect(revokedCount).toBe(0)
    })

    test("only revokes sessions for specified tenant", async () => {
      const session1 = await service.createBrowserSession({
        tenantId: "tenant-1",
        userAgent,
        ipAddress,
      })
      const session2 = await service.createBrowserSession({
        tenantId: "tenant-2",
        userAgent,
        ipAddress,
      })

      await service.addAccountToSession({
        browserSessionId: session1.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: session2.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      const revokedCount = await service.revokeUserSessions(
        "tenant-1",
        "user-1",
      )
      expect(revokedCount).toBe(1)

      // Verify user still exists in tenant-2 session
      const account2 = await service.getAccountSession(session2.id, "user-1")
      expect(account2).not.toBeNull()
    })

    test("does not affect other users in same session", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      await service.addAccountToSession({
        browserSessionId: session.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: session.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.revokeUserSessions(tenantId, "user-1")

      const account1 = await service.getAccountSession(session.id, "user-1")
      const account2 = await service.getAccountSession(session.id, "user-2")
      expect(account1).toBeNull()
      expect(account2).not.toBeNull()
    })
  })

  describe("revokeSpecificSession", () => {
    test("revokes entire browser session", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      await service.addAccountToSession({
        browserSessionId: session.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      const revoked = await service.revokeSpecificSession(session.id, tenantId)
      expect(revoked).toBe(true)

      const retrieved = await service.getBrowserSession(session.id, tenantId)
      expect(retrieved).toBeNull()
    })

    test("removes all account sessions when revoking", async () => {
      const session = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      await service.addAccountToSession({
        browserSessionId: session.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: session.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })

      await service.revokeSpecificSession(session.id, tenantId)

      const account1 = await service.getAccountSession(session.id, "user-1")
      const account2 = await service.getAccountSession(session.id, "user-2")
      expect(account1).toBeNull()
      expect(account2).toBeNull()
    })

    test("returns false when session does not exist", async () => {
      const revoked = await service.revokeSpecificSession(
        "nonexistent-session",
        tenantId,
      )
      expect(revoked).toBe(false)
    })

    test("does not affect other sessions", async () => {
      const session1 = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })
      const session2 = await service.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      await service.revokeSpecificSession(session1.id, tenantId)

      const retrieved1 = await service.getBrowserSession(session1.id, tenantId)
      const retrieved2 = await service.getBrowserSession(session2.id, tenantId)
      expect(retrieved1).toBeNull()
      expect(retrieved2).not.toBeNull()
    })
  })

  describe("custom session config", () => {
    test("respects custom maxAccountsPerSession", async () => {
      const customService = new SessionServiceImpl(storage, {
        maxAccountsPerSession: 2,
      })

      const session = await customService.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      await customService.addAccountToSession({
        browserSessionId: session.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-1",
        clientId: "client-1",
        ttl: 3600,
      })

      await customService.addAccountToSession({
        browserSessionId: session.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: {},
        refreshToken: "refresh-2",
        clientId: "client-1",
        ttl: 3600,
      })

      // Third account should fail
      try {
        await customService.addAccountToSession({
          browserSessionId: session.id,
          userId: "user-3",
          subjectType: "user",
          subjectProperties: {},
          refreshToken: "refresh-3",
          clientId: "client-1",
          ttl: 3600,
        })
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError)
        expect((error as SessionError).code).toBe("max_accounts_exceeded")
      }
    })

    test("respects custom sessionLifetimeSeconds", async () => {
      const customService = new SessionServiceImpl(storage, {
        sessionLifetimeSeconds: 10, // 10 seconds
      })

      const session = await customService.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      // Fast forward past custom lifetime
      setSystemTime(Date.now() + 11000)

      const retrieved = await customService.getBrowserSession(
        session.id,
        tenantId,
      )
      expect(retrieved).toBeNull()
    })

    test("respects custom slidingWindowSeconds", async () => {
      const customService = new SessionServiceImpl(storage, {
        slidingWindowSeconds: 5, // 5 seconds
      })

      const session = await customService.createBrowserSession({
        tenantId,
        userAgent,
        ipAddress,
      })

      const initialActivity = session.last_activity

      // Fast forward past custom sliding window
      setSystemTime(Date.now() + 6000)

      const retrieved = await customService.getBrowserSession(
        session.id,
        tenantId,
      )
      expect(retrieved!.last_activity).toBeGreaterThan(initialActivity)
      expect(retrieved!.version).toBe(2)
    })
  })
})

describe("Cookie Utilities", () => {
  let secret: Uint8Array

  beforeEach(() => {
    secret = generateCookieSecret()
  })

  describe("encryptSessionCookie", () => {
    test("encrypts payload correctly", async () => {
      const payload: SessionCookiePayload = {
        sid: "session-123",
        tid: "tenant-456",
        v: 1,
        iat: Date.now(),
      }

      const encrypted = await encryptSessionCookie(payload, secret)
      expect(encrypted).toBeTypeOf("string")
      expect(encrypted.length).toBeGreaterThan(0)
    })

    test("throws error with invalid secret length", async () => {
      const payload: SessionCookiePayload = {
        sid: "session-123",
        tid: "tenant-456",
        v: 1,
        iat: Date.now(),
      }

      const invalidSecret = new Uint8Array(16) // Wrong size

      try {
        await encryptSessionCookie(payload, invalidSecret)
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("exactly 32 bytes")
      }
    })

    test("produces different output for same payload", async () => {
      const payload: SessionCookiePayload = {
        sid: "session-123",
        tid: "tenant-456",
        v: 1,
        iat: Date.now(),
      }

      const encrypted1 = await encryptSessionCookie(payload, secret)
      const encrypted2 = await encryptSessionCookie(payload, secret)

      // Should be different due to IV
      expect(encrypted1).not.toBe(encrypted2)
    })
  })

  describe("decryptSessionCookie", () => {
    test("decrypts correctly", async () => {
      const payload: SessionCookiePayload = {
        sid: "session-123",
        tid: "tenant-456",
        v: 1,
        iat: Date.now(),
      }

      const encrypted = await encryptSessionCookie(payload, secret)
      const decrypted = await decryptSessionCookie(encrypted, secret)

      expect(decrypted).toEqual(payload)
    })

    test("returns null for invalid cookie", async () => {
      const result = await decryptSessionCookie("invalid-cookie", secret)
      expect(result).toBeNull()
    })

    test("returns null for empty cookie", async () => {
      const result = await decryptSessionCookie("", secret)
      expect(result).toBeNull()
    })

    test("returns null with wrong secret", async () => {
      const payload: SessionCookiePayload = {
        sid: "session-123",
        tid: "tenant-456",
        v: 1,
        iat: Date.now(),
      }

      const encrypted = await encryptSessionCookie(payload, secret)
      const wrongSecret = generateCookieSecret()
      const result = await decryptSessionCookie(encrypted, wrongSecret)

      expect(result).toBeNull()
    })

    test("returns null with invalid secret length", async () => {
      const invalidSecret = new Uint8Array(16) // Wrong size
      const result = await decryptSessionCookie("some-cookie", invalidSecret)
      expect(result).toBeNull()
    })

    test("validates payload structure", async () => {
      const invalidPayload = {
        sid: "session-123",
        // Missing required fields
      }

      const encoder = new TextEncoder()
      const payloadBytes = encoder.encode(JSON.stringify(invalidPayload))

      // Manually encrypt invalid payload
      const { CompactEncrypt } = await import("jose")
      const jwe = await new CompactEncrypt(payloadBytes)
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .encrypt(secret)

      const result = await decryptSessionCookie(jwe, secret)
      expect(result).toBeNull()
    })
  })

  describe("createCookieOptions", () => {
    test("returns correct default options", () => {
      const options = createCookieOptions()

      expect(options.httpOnly).toBe(true)
      expect(options.secure).toBe(true)
      expect(options.sameSite).toBe("lax")
      expect(options.maxAge).toBe(7 * 24 * 60 * 60) // 7 days
      expect(options.path).toBe("/")
      expect(options.domain).toBeUndefined()
    })

    test("includes domain when provided", () => {
      const options = createCookieOptions("example.com")

      expect(options.domain).toBe("example.com")
    })
  })

  describe("createCookiePayload", () => {
    test("creates payload with correct structure", () => {
      setSystemTime(new Date("2024-01-01T00:00:00Z"))

      const payload = createCookiePayload({
        sessionId: "session-123",
        tenantId: "tenant-456",
        version: 5,
      })

      expect(payload.sid).toBe("session-123")
      expect(payload.tid).toBe("tenant-456")
      expect(payload.v).toBe(5)
      expect(payload.iat).toBe(Date.now())

      setSystemTime()
    })
  })

  describe("parseCookie", () => {
    test("parses cookie from header", () => {
      const cookieHeader = "__session=value123; other=value456"
      const value = parseCookie(cookieHeader, "__session")

      expect(value).toBe("value123")
    })

    test("returns undefined for missing cookie", () => {
      const cookieHeader = "other=value456"
      const value = parseCookie(cookieHeader, "__session")

      expect(value).toBeUndefined()
    })

    test("returns undefined for null header", () => {
      const value = parseCookie(null, "__session")
      expect(value).toBeUndefined()
    })

    test("returns undefined for undefined header", () => {
      const value = parseCookie(undefined, "__session")
      expect(value).toBeUndefined()
    })

    test("handles cookie values with equals signs", () => {
      const cookieHeader = "__session=value=with=equals"
      const value = parseCookie(cookieHeader, "__session")

      expect(value).toBe("value=with=equals")
    })

    test("handles whitespace in cookie header", () => {
      const cookieHeader = "  __session=value123  ;  other=value456  "
      const value = parseCookie(cookieHeader, "__session")

      expect(value).toBe("value123")
    })
  })

  describe("generateCookieSecret", () => {
    test("generates 32-byte secret", () => {
      const secret = generateCookieSecret()
      expect(secret.length).toBe(32)
      expect(secret).toBeInstanceOf(Uint8Array)
    })

    test("generates different secrets each time", () => {
      const secret1 = generateCookieSecret()
      const secret2 = generateCookieSecret()

      expect(secret1).not.toEqual(secret2)
    })
  })

  describe("hexToSecret", () => {
    test("converts hex string to Uint8Array", () => {
      const hex =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      const secret = hexToSecret(hex)

      expect(secret.length).toBe(32)
      expect(secret[0]).toBe(0x01)
      expect(secret[1]).toBe(0x23)
      expect(secret[31]).toBe(0xef)
    })

    test("throws error for invalid length", () => {
      const hex = "0123456789abcdef" // Too short

      try {
        hexToSecret(hex)
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("exactly 64 characters")
      }
    })
  })

  describe("base64ToSecret", () => {
    test("converts base64 string to Uint8Array", () => {
      // Generate a secret and convert to base64
      const originalSecret = generateCookieSecret()
      const base64 = btoa(String.fromCharCode(...originalSecret))

      const secret = base64ToSecret(base64)

      expect(secret).toEqual(originalSecret)
    })

    test("handles base64url format", () => {
      const originalSecret = generateCookieSecret()
      const base64 = btoa(String.fromCharCode(...originalSecret))
      const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_")

      const secret = base64ToSecret(base64url)

      expect(secret).toEqual(originalSecret)
    })

    test("throws error for invalid length", () => {
      const base64 = btoa("short") // Too short

      try {
        base64ToSecret(base64)
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("exactly 32 bytes")
      }
    })
  })

  describe("secretToHex", () => {
    test("converts Uint8Array to hex string", () => {
      const secret = new Uint8Array([
        0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
      ])
      const hex = secretToHex(secret)

      expect(hex).toBe("0123456789abcdef")
    })

    test("round-trips with hexToSecret", () => {
      const originalHex =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      const secret = hexToSecret(originalHex)
      const hex = secretToHex(secret)

      expect(hex).toBe(originalHex)
    })
  })
})

/**
 * Session Dual-Write Tests
 *
 * Per ARCHITECTURE_PLAN.md, sessions should be written to BOTH KV and D1:
 * - KV: Primary store for fast reads (<10ms latency)
 * - D1: Secondary store for admin queries and durability
 *
 * This dual-write pattern ensures:
 * 1. Fast session reads via KV
 * 2. Admin can query all sessions via D1
 * 3. Session cleanup can find expired sessions via D1
 * 4. Durability - if KV fails, D1 has the data
 *
 * These tests will FAIL until dual-write is implemented.
 *
 * @see /packages/openauth/docs/ARCHITECTURE_PLAN.md
 */

import {
  expect,
  test,
  describe,
  beforeEach,
  mock,
  afterEach,
  setSystemTime,
} from "bun:test"
import { MemoryStorage } from "../src/storage/memory.js"
import { SessionServiceImpl } from "../src/session/service.js"

/**
 * Mock D1 Database that tracks all operations
 */
function createMockD1() {
  const operations: Array<{ type: string; query: string; args: any[] }> = []
  const browserSessions: Map<string, any> = new Map()
  const accountSessions: Map<string, any> = new Map()

  return {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        all: async () => {
          operations.push({ type: "SELECT", query, args })
          if (query.includes("browser_sessions")) {
            return { results: Array.from(browserSessions.values()) }
          }
          if (query.includes("account_sessions")) {
            return { results: Array.from(accountSessions.values()) }
          }
          return { results: [] }
        },
        first: async () => {
          operations.push({ type: "SELECT_ONE", query, args })
          if (query.includes("browser_sessions") && args[0]) {
            return browserSessions.get(args[0]) || null
          }
          if (query.includes("account_sessions") && args[0]) {
            return accountSessions.get(args[0]) || null
          }
          return null
        },
        run: async () => {
          if (query.includes("INSERT INTO browser_sessions")) {
            operations.push({ type: "INSERT_BROWSER", query, args })
            browserSessions.set(args[0], { id: args[0], tenant_id: args[1] })
          } else if (query.includes("INSERT INTO account_sessions")) {
            operations.push({ type: "INSERT_ACCOUNT", query, args })
            accountSessions.set(args[0], { id: args[0], user_id: args[2] })
          } else if (query.includes("UPDATE")) {
            operations.push({ type: "UPDATE", query, args })
          } else if (query.includes("DELETE")) {
            operations.push({ type: "DELETE", query, args })
            if (query.includes("browser_sessions")) {
              browserSessions.delete(args[0])
            }
            if (query.includes("account_sessions")) {
              accountSessions.delete(args[0])
            }
          }
          return { success: true, meta: { changes: 1 } }
        },
      }),
    }),
    exec: async () => ({}),
    batch: async () => [],
    _operations: operations,
    _browserSessions: browserSessions,
    _accountSessions: accountSessions,
    reset: () => {
      operations.length = 0
      browserSessions.clear()
      accountSessions.clear()
    },
  }
}

describe("Session Dual-Write (KV + D1)", () => {
  let kvStorage: ReturnType<typeof MemoryStorage>
  let d1Database: ReturnType<typeof createMockD1>
  let service: SessionServiceImpl

  beforeEach(() => {
    kvStorage = MemoryStorage()
    d1Database = createMockD1()
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    // Service should accept both KV and D1
    // This will fail until SessionServiceImpl supports D1
    service = new SessionServiceImpl(kvStorage, {
      d1Database: d1Database as any,
      dualWriteEnabled: true,
    })
  })

  afterEach(() => {
    setSystemTime()
  })

  describe("createBrowserSession dual-write", () => {
    test("writes to both KV and D1", async () => {
      const session = await service.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      // Verify KV write
      const kvData = await kvStorage.get([
        "session",
        "browser",
        "tenant-1",
        session.id,
      ])
      expect(kvData).not.toBeNull()
      expect(kvData?.id).toBe(session.id)

      // Verify D1 write
      const d1Inserts = d1Database._operations.filter(
        (op) => op.type === "INSERT_BROWSER",
      )
      expect(d1Inserts.length).toBe(1)
      expect(d1Inserts[0].args[0]).toBe(session.id)
    })

    test("KV write succeeds even if D1 fails (graceful degradation)", async () => {
      // Make D1 fail
      const failingD1 = {
        prepare: () => ({
          bind: () => ({
            run: async () => {
              throw new Error("D1 unavailable")
            },
          }),
        }),
      }

      const serviceWithFailingD1 = new SessionServiceImpl(kvStorage, {
        d1Database: failingD1 as any,
        dualWriteEnabled: true,
      })

      // Should still succeed (KV is primary)
      const session = await serviceWithFailingD1.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      expect(session.id).toBeDefined()

      // KV should have the data
      const kvData = await kvStorage.get([
        "session",
        "browser",
        "tenant-1",
        session.id,
      ])
      expect(kvData).not.toBeNull()
    })
  })

  describe("addAccountToSession dual-write", () => {
    test("writes account to both KV and D1", async () => {
      // First create browser session
      const browserSession = await service.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      d1Database.reset() // Clear operations to check account insert

      // Add account
      const accountSession = await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-123",
        subjectType: "user",
        subjectProperties: { email: "test@example.com" },
        refreshToken: "refresh-token",
        clientId: "app-1",
        ttl: 3600,
      })

      // Verify KV write
      const kvData = await kvStorage.get([
        "session",
        "account",
        browserSession.id,
        "user-123",
      ])
      expect(kvData).not.toBeNull()

      // Verify D1 write
      const d1Inserts = d1Database._operations.filter(
        (op) => op.type === "INSERT_ACCOUNT",
      )
      expect(d1Inserts.length).toBe(1)
    })
  })

  describe("switchActiveAccount dual-write", () => {
    test("updates active account in both KV and D1", async () => {
      // Setup: browser session with 2 accounts
      const browserSession = await service.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: { email: "user1@example.com" },
        refreshToken: "refresh-token-1",
        clientId: "app-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: { email: "user2@example.com" },
        refreshToken: "refresh-token-2",
        clientId: "app-1",
        ttl: 3600,
      })

      d1Database.reset()

      // Switch to user-1 (since user-2 is currently active)
      await service.switchActiveAccount(browserSession.id, "user-1")

      // Verify D1 updates occurred
      const d1Updates = d1Database._operations.filter(
        (op) => op.type === "UPDATE",
      )
      expect(d1Updates.length).toBeGreaterThan(0)
    })
  })

  describe("removeAccount dual-write", () => {
    test("removes account from both KV and D1", async () => {
      // Setup
      const browserSession = await service.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-123",
        subjectType: "user",
        subjectProperties: { email: "test@example.com" },
        refreshToken: "refresh-token",
        clientId: "app-1",
        ttl: 3600,
      })

      d1Database.reset()

      // Remove account
      await service.removeAccount(browserSession.id, "user-123")

      // Verify KV delete (storage returns undefined for missing keys)
      const kvData = await kvStorage.get([
        "session",
        "account",
        browserSession.id,
        "user-123",
      ])
      expect(kvData).toBeFalsy() // Can be null or undefined

      // Verify D1 delete
      const d1Deletes = d1Database._operations.filter(
        (op) => op.type === "DELETE",
      )
      expect(d1Deletes.length).toBeGreaterThan(0)
    })
  })

  describe("removeAllAccounts dual-write", () => {
    test("removes all accounts from both stores", async () => {
      // Setup
      const browserSession = await service.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: { email: "user1@example.com" },
        refreshToken: "refresh-token-1",
        clientId: "app-1",
        ttl: 3600,
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-2",
        subjectType: "user",
        subjectProperties: { email: "user2@example.com" },
        refreshToken: "refresh-token-2",
        clientId: "app-1",
        ttl: 3600,
      })

      d1Database.reset()

      // Remove all accounts (sign out all)
      await service.removeAllAccounts(browserSession.id)

      // Verify D1 deletes occurred
      const d1Deletes = d1Database._operations.filter(
        (op) => op.type === "DELETE",
      )
      // Should delete all account sessions
      expect(d1Deletes.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("Read operations (KV primary)", () => {
    test("getBrowserSession reads from KV only (not D1)", async () => {
      const browserSession = await service.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      d1Database.reset()

      // Read session (note: order is sessionId, tenantId)
      const session = await service.getBrowserSession(
        browserSession.id,
        "tenant-1",
      )

      expect(session).not.toBeNull()

      // Should NOT query D1 for normal reads (KV is primary)
      const d1Selects = d1Database._operations.filter((op) =>
        op.type.includes("SELECT"),
      )
      expect(d1Selects.length).toBe(0)
    })

    test("listAccounts reads from KV only", async () => {
      const browserSession = await service.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      await service.addAccountToSession({
        browserSessionId: browserSession.id,
        userId: "user-1",
        subjectType: "user",
        subjectProperties: { email: "user1@example.com" },
        refreshToken: "refresh-token",
        clientId: "app-1",
        ttl: 3600,
      })

      d1Database.reset()

      // Read accounts
      const accounts = await service.listAccounts(browserSession.id)

      expect(accounts.length).toBe(1)

      // Should NOT query D1
      const d1Selects = d1Database._operations.filter((op) =>
        op.type.includes("SELECT"),
      )
      expect(d1Selects.length).toBe(0)
    })
  })

  describe("Configuration options", () => {
    test("dual-write can be disabled", async () => {
      const serviceNoDualWrite = new SessionServiceImpl(kvStorage, {
        d1Database: d1Database as any,
        dualWriteEnabled: false, // Disabled
      })

      await serviceNoDualWrite.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      // D1 should not be written to
      expect(d1Database._operations.length).toBe(0)
    })

    test("works without D1 database (KV only mode)", async () => {
      const serviceKvOnly = new SessionServiceImpl(kvStorage)

      const session = await serviceKvOnly.createBrowserSession({
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
      })

      expect(session.id).toBeDefined()
    })
  })
})

describe("SessionServiceImpl config interface", () => {
  test("accepts d1Database in config", async () => {
    const kvStorage = MemoryStorage()
    const mockD1 = createMockD1()

    // This test verifies the config interface supports D1
    // Will fail until SessionConfig is updated
    const service = new SessionServiceImpl(kvStorage, {
      d1Database: mockD1 as any,
      dualWriteEnabled: true,
      maxAccountsPerSession: 3,
      sessionLifetimeSeconds: 7 * 24 * 60 * 60,
      slidingWindowSeconds: 24 * 60 * 60,
    })

    expect(service).toBeDefined()
  })
})

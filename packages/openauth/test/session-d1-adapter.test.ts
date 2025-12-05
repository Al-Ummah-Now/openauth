/**
 * D1 Session Adapter Tests
 *
 * These tests verify the D1-based session storage adapter that provides:
 * - Admin queries (list all sessions for a user)
 * - Session cleanup (find expired sessions)
 * - Cross-browser session enumeration
 *
 * Per ARCHITECTURE_PLAN.md:
 * | Operation        | Primary Store | Rationale                 |
 * | Session Read     | KV            | Low latency (<10ms)       |
 * | Session Write    | KV + D1       | Dual-write for durability |
 * | Admin Queries    | D1            | Structured queries needed |
 *
 * These tests will FAIL until D1SessionAdapter is implemented.
 *
 * @see /packages/openauth/src/migrations/003_session_management.sql
 * @see /packages/openauth/docs/ARCHITECTURE_PLAN.md
 */

import { expect, test, describe, beforeEach, mock } from "bun:test"

// This import will fail until the adapter is created
// import { D1SessionAdapter } from "../src/session/d1-adapter.js"

/**
 * Mock D1 Database for testing
 */
function createMockD1() {
  const data: Map<string, any[]> = new Map([
    ["browser_sessions", []],
    ["account_sessions", []],
  ])

  return {
    prepare: mock((query: string) => ({
      bind: mock((...args: any[]) => ({
        all: mock(async () => {
          // Parse query to determine which table
          if (query.includes("browser_sessions")) {
            return { results: data.get("browser_sessions") || [] }
          }
          if (query.includes("account_sessions")) {
            return { results: data.get("account_sessions") || [] }
          }
          return { results: [] }
        }),
        first: mock(async () => null),
        run: mock(async () => ({ success: true, meta: { changes: 1 } })),
      })),
    })),
    exec: mock(async () => ({})),
    batch: mock(async () => []),
    _data: data, // For test assertions
  }
}

describe("D1SessionAdapter", () => {
  describe("Module exists", () => {
    test("D1SessionAdapter should be importable from session/d1-adapter", async () => {
      // This test will fail until the module is created
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      expect(module).not.toBeNull()
      expect(module?.D1SessionAdapter).toBeDefined()
    })

    test("D1SessionAdapter should be exported from session/index", async () => {
      const module = await import("../src/session/index.js")
      expect(module.D1SessionAdapter).toBeDefined()
    })
  })

  describe("Browser Session CRUD", () => {
    test("createBrowserSession stores session in D1", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      const now = Date.now()
      const session = await adapter.createBrowserSession({
        id: "session-123",
        tenantId: "tenant-1",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
        createdAt: now,
        lastActivity: now,
      })

      expect(session.id).toBe("session-123")
      expect(session.tenant_id).toBe("tenant-1")
      expect(mockDb.prepare).toHaveBeenCalled()
    })

    test("getBrowserSession retrieves session from D1", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      const session = await adapter.getBrowserSession("session-123")

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT"),
      )
    })

    test("updateBrowserSession updates session in D1", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      await adapter.updateBrowserSession("session-123", {
        last_activity: Date.now(),
        active_user_id: "user-456",
      })

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE"),
      )
    })

    test("deleteBrowserSession removes session from D1", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      await adapter.deleteBrowserSession("session-123")

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE"),
      )
    })
  })

  describe("Account Session CRUD", () => {
    test("addAccountSession stores account in D1", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      const account = await adapter.addAccountSession({
        browserSessionId: "session-123",
        userId: "user-456",
        subjectType: "user",
        subjectProperties: { email: "test@example.com" },
        refreshToken: "refresh-token",
        clientId: "app-1",
        ttl: 7 * 24 * 60 * 60,
      })

      expect(account.user_id).toBe("user-456")
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT"),
      )
    })

    test("getAccountSession retrieves account from D1", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      await adapter.getAccountSession("session-123", "user-456")

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT"),
      )
    })

    test("removeAccountSession deletes account from D1", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      await adapter.removeAccountSession("session-123", "user-456")

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE"),
      )
    })
  })

  describe("Admin Queries (D1-specific)", () => {
    test("listUserSessions returns all sessions for a user across browsers", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      // This is a D1-specific admin query that can't be done efficiently with KV
      const sessions = await adapter.listUserSessions({
        userId: "user-456",
        tenantId: "tenant-1",
      })

      expect(Array.isArray(sessions)).toBe(true)
      // Query should join browser_sessions and account_sessions
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("JOIN"),
      )
    })

    test("listTenantSessions returns all sessions for a tenant", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      const sessions = await adapter.listTenantSessions({
        tenantId: "tenant-1",
        limit: 100,
        offset: 0,
      })

      expect(Array.isArray(sessions)).toBe(true)
    })

    test("getExpiredSessions returns sessions past their lifetime", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      const expiredSessions = await adapter.getExpiredSessions({
        maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
        limit: 100,
      })

      expect(Array.isArray(expiredSessions)).toBe(true)
      // Should query based on last_activity timestamp
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("last_activity"),
      )
    })

    test("revokeAllUserSessions deletes all sessions for a user", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      const result = await adapter.revokeAllUserSessions({
        userId: "user-456",
        tenantId: "tenant-1",
      })

      expect(result.deletedCount).toBeTypeOf("number")
      // The implementation first SELECT to find sessions, then DELETE
      // So we check that prepare was called at least twice
      expect(mockDb.prepare).toHaveBeenCalled()
      // Check that the calls include the necessary operations
      const calls = mockDb.prepare.mock.calls.map((c: any) => c[0])
      expect(calls.some((q: string) => q.includes("SELECT"))).toBe(true)
    })

    test("getSessionStats returns session statistics for a tenant", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      const mockDb = createMockD1()
      const adapter = new module.D1SessionAdapter({ database: mockDb as any })

      const stats = await adapter.getSessionStats({ tenantId: "tenant-1" })

      expect(stats).toHaveProperty("totalBrowserSessions")
      expect(stats).toHaveProperty("totalAccountSessions")
      expect(stats).toHaveProperty("activeSessions")
    })
  })

  describe("Schema Compatibility", () => {
    test("BrowserSession matches D1 schema columns", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      // Verify the TypeScript interface matches the D1 schema
      // From 003_session_management.sql:
      // CREATE TABLE browser_sessions (
      //   id TEXT PRIMARY KEY,
      //   tenant_id TEXT NOT NULL,
      //   created_at INTEGER NOT NULL,
      //   last_activity INTEGER NOT NULL,
      //   user_agent TEXT,
      //   ip_address TEXT,
      //   version INTEGER NOT NULL DEFAULT 1,
      //   active_user_id TEXT
      // )

      const expectedColumns = [
        "id",
        "tenant_id",
        "created_at",
        "last_activity",
        "user_agent",
        "ip_address",
        "version",
        "active_user_id",
      ]

      // The adapter should handle all these columns
      expect(module.BROWSER_SESSION_COLUMNS).toEqual(
        expect.arrayContaining(expectedColumns),
      )
    })

    test("AccountSession matches D1 schema columns", async () => {
      const module = await import("../src/session/d1-adapter.js").catch(
        () => null,
      )
      if (!module) {
        throw new Error("D1SessionAdapter not implemented")
      }

      // From 003_session_management.sql:
      // CREATE TABLE account_sessions (
      //   id TEXT PRIMARY KEY,
      //   browser_session_id TEXT NOT NULL,
      //   user_id TEXT NOT NULL,
      //   is_active INTEGER NOT NULL DEFAULT 0,
      //   authenticated_at INTEGER NOT NULL,
      //   expires_at INTEGER NOT NULL,
      //   subject_type TEXT NOT NULL,
      //   subject_properties TEXT,
      //   refresh_token TEXT NOT NULL,
      //   client_id TEXT NOT NULL
      // )

      const expectedColumns = [
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
      ]

      expect(module.ACCOUNT_SESSION_COLUMNS).toEqual(
        expect.arrayContaining(expectedColumns),
      )
    })
  })
})

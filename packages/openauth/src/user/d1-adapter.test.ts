import { describe, test, expect, beforeEach, mock } from "bun:test"
import { D1UserAdapter } from "./d1-adapter.js"
import type { User, UserIdentity, UserStatus } from "./types.js"

// Simple mock D1 database
function createMockD1Database() {
  const statements: Array<{
    query: string
    bindings: any[]
    firstResult?: any
    allResults?: any[]
    runResult?: { success: boolean; meta: { changes: number } }
  }> = []

  const db = {
    prepare: (query: string) => {
      const statement = {
        bindings: [] as any[],
        bind: (...values: any[]) => {
          statement.bindings = values
          return statement
        },
        first: async () => {
          const record = {
            query,
            bindings: statement.bindings,
            firstResult: null,
          }
          statements.push(record)
          return record.firstResult
        },
        run: async () => {
          const record = {
            query,
            bindings: statement.bindings,
            runResult: { success: true, meta: { changes: 0 } },
          }
          statements.push(record)
          return record.runResult
        },
        all: async () => {
          const record = { query, bindings: statement.bindings, allResults: [] }
          statements.push(record)
          return {
            results: record.allResults,
            success: true,
            meta: { changes: 0 },
          }
        },
      }
      return statement
    },
    _statements: statements,
  }

  return db
}

describe("D1UserAdapter", () => {
  let mockDb: ReturnType<typeof createMockD1Database>
  let adapter: D1UserAdapter
  const tenantId = "tenant_123"

  beforeEach(() => {
    mockDb = createMockD1Database()
    adapter = new D1UserAdapter({ db: mockDb as any })
  })

  describe("createUser()", () => {
    test("inserts user into database", async () => {
      const user: User = {
        id: "usr_123",
        tenant_id: tenantId,
        email: "test@example.com",
        name: "Test User",
        metadata: { role: "admin" },
        status: "active",
        created_at: Date.now(),
        updated_at: Date.now(),
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
        password_reset_required: false,
      }

      await adapter.createUser(user)

      const statement = mockDb._statements[0]
      expect(statement.query).toContain("INSERT INTO users")
      expect(statement.query).toContain("id, tenant_id, email, name, metadata")
      expect(statement.bindings).toEqual([
        user.id,
        user.tenant_id,
        user.email,
        user.name,
        JSON.stringify(user.metadata),
        user.status,
        user.created_at,
        user.updated_at,
        user.last_login_at,
        user.deleted_at,
        0, // password_reset_required
      ])
    })

    test("serializes metadata as JSON", async () => {
      const user: User = {
        id: "usr_123",
        tenant_id: tenantId,
        email: "test@example.com",
        name: null,
        metadata: { role: "admin", permissions: ["read", "write"] },
        status: "active",
        created_at: Date.now(),
        updated_at: Date.now(),
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
        password_reset_required: false,
      }

      await adapter.createUser(user)

      const statement = mockDb._statements[0]
      expect(statement.bindings[4]).toBe(JSON.stringify(user.metadata))
    })

    test("stores null metadata as null", async () => {
      const user: User = {
        id: "usr_123",
        tenant_id: tenantId,
        email: "test@example.com",
        name: null,
        metadata: null,
        status: "active",
        created_at: Date.now(),
        updated_at: Date.now(),
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
      }

      await adapter.createUser(user)

      const statement = mockDb._statements[0]
      expect(statement.bindings[4]).toBeNull()
    })

    test("uses custom table name when provided", async () => {
      const customMockDb = createMockD1Database()
      const customAdapter = new D1UserAdapter({
        db: customMockDb as any,
        usersTable: "custom_users",
      })

      const user: User = {
        id: "usr_123",
        tenant_id: tenantId,
        email: "test@example.com",
        name: null,
        metadata: null,
        status: "active",
        created_at: Date.now(),
        updated_at: Date.now(),
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
      }

      await customAdapter.createUser(user)

      const statement = customMockDb._statements[0]
      expect(statement.query).toContain("INSERT INTO custom_users")
    })
  })

  describe("getUser()", () => {
    test("retrieves user from database", async () => {
      const userRow = {
        id: "usr_123",
        tenant_id: tenantId,
        email: "test@example.com",
        name: "Test User",
        metadata: JSON.stringify({ role: "admin" }),
        status: "active",
        created_at: 1234567890,
        updated_at: 1234567890,
        last_login_at: null,
        deleted_at: null,
        password_reset_required: 0,
      }

      mockDb.prepare = (query: string) =>
        ({
          bindings: [] as any[],
          bind: function (...values: any[]) {
            this.bindings = values
            mockDb._statements.push({ query, bindings: this.bindings })
            return this
          },
          first: async () => userRow,
          run: async () => ({ success: true, meta: { changes: 0 } }),
          all: async () => ({
            results: [],
            success: true,
            meta: { changes: 0 },
          }),
        }) as any

      const user = await adapter.getUser(tenantId, "usr_123")

      const statement = mockDb._statements[0]
      expect(statement.query).toContain("SELECT * FROM users")
      expect(statement.query).toContain(
        "WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL",
      )
      expect(statement.bindings).toEqual([tenantId, "usr_123"])

      expect(user).toEqual({
        id: "usr_123",
        tenant_id: tenantId,
        email: "test@example.com",
        name: "Test User",
        metadata: { role: "admin" },
        status: "active",
        created_at: 1234567890,
        updated_at: 1234567890,
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
      })
    })

    test("parses metadata JSON", async () => {
      const userRow = {
        id: "usr_123",
        tenant_id: tenantId,
        email: "test@example.com",
        name: null,
        metadata: JSON.stringify({ complex: { nested: "data" } }),
        status: "active",
        created_at: 1234567890,
        updated_at: 1234567890,
        last_login_at: null,
        deleted_at: null,
        password_reset_required: 0,
      }

      mockDb.prepare = () =>
        ({
          bind: () => ({ first: async () => userRow }) as any,
        }) as any

      const user = await adapter.getUser(tenantId, "usr_123")

      expect(user?.metadata).toEqual({ complex: { nested: "data" } })
    })

    test("handles null metadata", async () => {
      const userRow = {
        password_reset_required: 0,
        id: "usr_123",
        tenant_id: tenantId,
        email: "test@example.com",
        name: null,
        metadata: null,
        status: "active",
        created_at: 1234567890,
        updated_at: 1234567890,
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
      }

      mockDb.prepare = () =>
        ({
          bind: () => ({ first: async () => userRow }) as any,
        }) as any

      const user = await adapter.getUser(tenantId, "usr_123")

      expect(user?.metadata).toBeNull()
    })

    test("returns null when user not found", async () => {
      mockDb.prepare = () =>
        ({
          bind: () => ({ first: async () => null }) as any,
        }) as any

      const user = await adapter.getUser(tenantId, "usr_nonexistent")

      expect(user).toBeNull()
    })

    test("excludes soft-deleted users", async () => {
      await adapter.getUser(tenantId, "usr_deleted")

      const statement = mockDb._statements[0]
      expect(statement.query).toContain("deleted_at IS NULL")
    })
  })

  describe("updateUser()", () => {
    test("updates user in database", async () => {
      const user: User = {
        id: "usr_123",
        tenant_id: tenantId,
        email: "updated@example.com",
        name: "Updated Name",
        metadata: { role: "user" },
        status: "active",
        created_at: 1234567890,
        updated_at: Date.now(),
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
      }

      await adapter.updateUser(user)

      const statement = mockDb._statements[0]
      expect(statement.query).toContain("UPDATE users")
      expect(statement.query).toContain(
        "SET email = ?, name = ?, metadata = ?, status = ?",
      )
      expect(statement.query).toContain("WHERE tenant_id = ? AND id = ?")
      expect(statement.bindings).toEqual([
        user.email,
        user.name,
        JSON.stringify(user.metadata),
        user.status,
        user.updated_at,
        user.last_login_at,
        user.deleted_at,
        0, // password_reset_required
        user.tenant_id,
        user.id,
      ])
    })
  })

  describe("updateUserStatus()", () => {
    test("updates only user status", async () => {
      const status: UserStatus = "suspended"
      const userId = "usr_123"

      await adapter.updateUserStatus(tenantId, userId, status)

      const statement = mockDb._statements[0]
      expect(statement.query).toContain("UPDATE users")
      expect(statement.query).toContain("SET status = ?, updated_at = ?")
      expect(statement.bindings[0]).toBe(status)
      expect(statement.bindings[1]).toBeGreaterThan(0) // updated_at timestamp
      expect(statement.bindings[2]).toBe(tenantId)
      expect(statement.bindings[3]).toBe(userId)
    })
  })

  describe("softDeleteUser()", () => {
    test("sets deleted_at and status to deleted", async () => {
      const userId = "usr_123"
      const deletedAt = Date.now()

      await adapter.softDeleteUser(tenantId, userId, deletedAt)

      const statement = mockDb._statements[0]
      expect(statement.query).toContain("UPDATE users")
      expect(statement.query).toContain(
        "SET status = 'deleted', deleted_at = ?, updated_at = ?",
      )
      expect(statement.bindings).toEqual([
        deletedAt,
        deletedAt,
        tenantId,
        userId,
      ])
    })
  })

  describe("updateLastLogin()", () => {
    test("updates last_login_at timestamp", async () => {
      const userId = "usr_123"

      await adapter.updateLastLogin(tenantId, userId)

      const statement = mockDb._statements[0]
      expect(statement.query).toContain("UPDATE users")
      expect(statement.query).toContain("SET last_login_at = ?, updated_at = ?")
      expect(statement.bindings[0]).toBeGreaterThan(0) // last_login_at
      expect(statement.bindings[1]).toBeGreaterThan(0) // updated_at
      expect(statement.bindings[2]).toBe(tenantId)
      expect(statement.bindings[3]).toBe(userId)
    })
  })

  describe("listUsers() - cursor-based pagination", () => {
    test("lists users with default parameters", async () => {
      const userRows = [
        {
          id: "usr_1",
          tenant_id: tenantId,
          email: "user1@example.com",
          name: "User 1",
          metadata: null,
          status: "active",
          created_at: 1234567890,
          updated_at: 1234567890,
          last_login_at: null,
          deleted_at: null,
        password_reset_required: false,
        },
        {
          id: "usr_2",
          tenant_id: tenantId,
          email: "user2@example.com",
          name: "User 2",
          metadata: null,
          status: "active",
          created_at: 1234567891,
          updated_at: 1234567891,
          last_login_at: null,
          deleted_at: null,
        password_reset_required: false,
        },
      ]

      let callCount = 0
      mockDb.prepare = (query: string) => {
        callCount++
        if (callCount === 1) {
          // Main query
          return {
            bind: () =>
              ({
                all: async () => ({
                  results: userRows,
                  success: true,
                  meta: { changes: 0 },
                }),
              }) as any,
          } as any
        } else {
          // Count query
          return {
            bind: () => ({ first: async () => ({ count: 2 }) }) as any,
          } as any
        }
      }

      const result = await adapter.listUsers(tenantId, {})

      expect(result.users).toHaveLength(2)
      expect(result.users[0].email).toBe("user1@example.com")
      expect(result.users[1].email).toBe("user2@example.com")
      expect(result.has_more).toBe(false)
      expect(result.next_cursor).toBeNull()
      expect(result.total_count).toBe(2)
    })

    test("applies status filter", async () => {
      const capturedQueries: string[] = []
      mockDb.prepare = (query: string) => {
        capturedQueries.push(query)
        return {
          bind: () =>
            ({
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }) as any,
        } as any
      }

      await adapter.listUsers(tenantId, { status: "suspended" })

      expect(capturedQueries[0]).toContain("status = ?")
    })

    test("applies email search filter", async () => {
      const capturedQueries: string[] = []
      let capturedBindings: any[] = []
      let callCount = 0
      mockDb.prepare = (query: string) => {
        callCount++
        capturedQueries.push(query)
        return {
          bind: function (...values: any[]) {
            if (callCount === 1) capturedBindings = values
            return {
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }
          },
        } as any
      }

      await adapter.listUsers(tenantId, { email: "test" })

      expect(capturedQueries[0]).toContain("email LIKE ?")
      expect(capturedBindings.some((b) => b === "%test%")).toBe(true)
    })

    test("normalizes email search to lowercase", async () => {
      let capturedBindings: any[] = []
      let callCount = 0
      mockDb.prepare = () => {
        callCount++
        return {
          bind: function (...values: any[]) {
            if (callCount === 1) capturedBindings = values
            return {
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }
          },
        } as any
      }

      await adapter.listUsers(tenantId, { email: "TEST@EXAMPLE.COM" })

      expect(capturedBindings.some((b) => b === "%test@example.com%")).toBe(
        true,
      )
    })

    test("applies limit parameter", async () => {
      const capturedQueries: string[] = []
      let capturedBindings: any[] = []
      let callCount = 0
      mockDb.prepare = (query: string) => {
        callCount++
        capturedQueries.push(query)
        return {
          bind: function (...values: any[]) {
            if (callCount === 1) capturedBindings = values
            return {
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }
          },
        } as any
      }

      await adapter.listUsers(tenantId, { limit: 10 })

      expect(capturedQueries[0]).toContain("LIMIT ?")
      expect(capturedBindings[capturedBindings.length - 1]).toBe(11) // limit + 1 for has_more check
    })

    test("uses default limit of 50", async () => {
      let capturedBindings: any[] = []
      let callCount = 0
      mockDb.prepare = () => {
        callCount++
        return {
          bind: function (...values: any[]) {
            if (callCount === 1) capturedBindings = values
            return {
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }
          },
        } as any
      }

      await adapter.listUsers(tenantId, {})

      expect(capturedBindings[capturedBindings.length - 1]).toBe(51) // 50 + 1
    })

    test("sorts by created_at DESC by default", async () => {
      const capturedQueries: string[] = []
      mockDb.prepare = (query: string) => {
        capturedQueries.push(query)
        return {
          bind: () =>
            ({
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }) as any,
        } as any
      }

      await adapter.listUsers(tenantId, {})

      expect(capturedQueries[0]).toContain("ORDER BY created_at DESC, id DESC")
    })

    test("sorts by specified column", async () => {
      const capturedQueries: string[] = []
      mockDb.prepare = (query: string) => {
        capturedQueries.push(query)
        return {
          bind: () =>
            ({
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }) as any,
        } as any
      }

      await adapter.listUsers(tenantId, { sort_by: "email" })

      expect(capturedQueries[0]).toContain("ORDER BY email DESC, id DESC")
    })

    test("sorts in ascending order", async () => {
      const capturedQueries: string[] = []
      mockDb.prepare = (query: string) => {
        capturedQueries.push(query)
        return {
          bind: () =>
            ({
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }) as any,
        } as any
      }

      await adapter.listUsers(tenantId, { sort_order: "asc" })

      expect(capturedQueries[0]).toContain("ORDER BY created_at ASC, id ASC")
    })

    test("validates sort column to prevent SQL injection", async () => {
      const capturedQueries: string[] = []
      mockDb.prepare = (query: string) => {
        capturedQueries.push(query)
        return {
          bind: () =>
            ({
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }) as any,
        } as any
      }

      await adapter.listUsers(tenantId, {
        sort_by: "invalid_column; DROP TABLE users" as any,
      })

      // Should default to created_at
      expect(capturedQueries[0]).toContain("ORDER BY created_at DESC")
      expect(capturedQueries[0]).not.toContain("DROP TABLE")
    })

    test("implements cursor-based pagination", async () => {
      const cursorRow = { created_at: 1234567890 }
      let callCount = 0
      let mainQueryCaptured = ""

      mockDb.prepare = (query: string) => {
        callCount++
        if (callCount === 1) {
          // Cursor lookup query
          return {
            bind: () => ({ first: async () => cursorRow }) as any,
          } as any
        } else if (callCount === 2) {
          // Main query
          mainQueryCaptured = query
          return {
            bind: () =>
              ({ all: async () => ({ results: [], success: true }) }) as any,
          } as any
        } else {
          // Count query
          return {
            bind: () => ({ first: async () => ({ count: 10 }) }) as any,
          } as any
        }
      }

      await adapter.listUsers(tenantId, { cursor: "usr_123" })

      expect(mainQueryCaptured).toContain("created_at < ?")
    })

    test("handles ascending cursor pagination", async () => {
      const cursorRow = { email: "test@example.com" }
      let callCount = 0
      let mainQueryCaptured = ""

      mockDb.prepare = (query: string) => {
        callCount++
        if (callCount === 1) {
          return {
            bind: () => ({ first: async () => cursorRow }) as any,
          } as any
        } else if (callCount === 2) {
          mainQueryCaptured = query
          return {
            bind: () =>
              ({ all: async () => ({ results: [], success: true }) }) as any,
          } as any
        } else {
          return {
            bind: () => ({ first: async () => ({ count: 10 }) }) as any,
          } as any
        }
      }

      await adapter.listUsers(tenantId, {
        cursor: "usr_123",
        sort_by: "email",
        sort_order: "asc",
      })

      expect(mainQueryCaptured).toContain("email > ?")
    })

    test("detects has_more when results exceed limit", async () => {
      const userRows = Array.from({ length: 11 }, (_, i) => ({
        id: `usr_${i}`,
        tenant_id: tenantId,
        email: `user${i}@example.com`,
        name: null,
        metadata: null,
        status: "active",
        created_at: 1234567890 + i,
        updated_at: 1234567890 + i,
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
      }))

      let callCount = 0
      mockDb.prepare = () => {
        callCount++
        if (callCount === 1) {
          return {
            bind: () =>
              ({
                all: async () => ({ results: userRows, success: true }),
              }) as any,
          } as any
        } else {
          return {
            bind: () => ({ first: async () => ({ count: 20 }) }) as any,
          } as any
        }
      }

      const result = await adapter.listUsers(tenantId, { limit: 10 })

      expect(result.users).toHaveLength(10) // Extra item should be removed
      expect(result.has_more).toBe(true)
      expect(result.next_cursor).toBe("usr_9") // Last item in returned list
    })

    test("sets next_cursor to null when no more results", async () => {
      const userRows = Array.from({ length: 5 }, (_, i) => ({
        id: `usr_${i}`,
        tenant_id: tenantId,
        email: `user${i}@example.com`,
        name: null,
        metadata: null,
        status: "active",
        created_at: 1234567890 + i,
        updated_at: 1234567890 + i,
        last_login_at: null,
        deleted_at: null,
        password_reset_required: false,
      }))

      let callCount = 0
      mockDb.prepare = () => {
        callCount++
        if (callCount === 1) {
          return {
            bind: () =>
              ({
                all: async () => ({ results: userRows, success: true }),
              }) as any,
          } as any
        } else {
          return {
            bind: () => ({ first: async () => ({ count: 5 }) }) as any,
          } as any
        }
      }

      const result = await adapter.listUsers(tenantId, { limit: 10 })

      expect(result.users).toHaveLength(5)
      expect(result.has_more).toBe(false)
      expect(result.next_cursor).toBeNull()
    })

    test("excludes soft-deleted users", async () => {
      let capturedQuery = ""
      mockDb.prepare = (query: string) => {
        capturedQuery = query
        return {
          bind: () =>
            ({
              all: async () => ({ results: [], success: true }),
              first: async () => ({ count: 0 }),
            }) as any,
        } as any
      }

      await adapter.listUsers(tenantId, {})

      expect(capturedQuery).toContain("deleted_at IS NULL")
    })

    test("returns total count of users", async () => {
      let callCount = 0
      mockDb.prepare = () => {
        callCount++
        if (callCount === 1) {
          return {
            bind: () =>
              ({ all: async () => ({ results: [], success: true }) }) as any,
          } as any
        } else {
          return {
            bind: () => ({ first: async () => ({ count: 42 }) }) as any,
          } as any
        }
      }

      const result = await adapter.listUsers(tenantId, {})

      expect(result.total_count).toBe(42)
    })
  })

  describe("revokeAllUserSessions()", () => {
    test("deletes all user sessions", async () => {
      let capturedQuery = ""
      let capturedBindings: any[] = []
      mockDb.prepare = (query: string) => {
        capturedQuery = query
        return {
          bind: function (...values: any[]) {
            capturedBindings = values
            return {
              run: async () => ({ success: true, meta: { changes: 5 } }),
            }
          },
        } as any
      }

      const result = await adapter.revokeAllUserSessions(tenantId, "usr_123")

      expect(result.deletedCount).toBe(5)
      expect(capturedQuery).toContain("DELETE FROM account_sessions")
      expect(capturedQuery).toContain("WHERE user_id = ?")
      expect(capturedQuery).toContain(
        "SELECT id FROM browser_sessions WHERE tenant_id = ?",
      )
      expect(capturedBindings).toEqual(["usr_123", tenantId])
    })
  })

  describe("Identity management", () => {
    describe("createIdentity()", () => {
      test("inserts identity into database", async () => {
        const identity: UserIdentity = {
          id: "idt_123",
          user_id: "usr_123",
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: { name: "Test User" },
          created_at: Date.now(),
        }

        await adapter.createIdentity(identity)

        const statement = mockDb._statements[0]
        expect(statement.query).toContain("INSERT INTO user_identities")
        expect(statement.query).toContain(
          "id, user_id, tenant_id, provider, provider_user_id, provider_data, created_at",
        )
        expect(statement.bindings).toEqual([
          identity.id,
          identity.user_id,
          identity.tenant_id,
          identity.provider,
          identity.provider_user_id,
          JSON.stringify(identity.provider_data),
          identity.created_at,
        ])
      })

      test("serializes provider_data as JSON", async () => {
        const identity: UserIdentity = {
          id: "idt_123",
          user_id: "usr_123",
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: { name: "Test", email: "test@example.com" },
          created_at: Date.now(),
        }

        await adapter.createIdentity(identity)

        const statement = mockDb._statements[0]
        expect(statement.bindings[5]).toBe(
          JSON.stringify(identity.provider_data),
        )
      })

      test("stores null provider_data as null", async () => {
        const identity: UserIdentity = {
          id: "idt_123",
          user_id: "usr_123",
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: null,
          created_at: Date.now(),
        }

        await adapter.createIdentity(identity)

        const statement = mockDb._statements[0]
        expect(statement.bindings[5]).toBeNull()
      })

      test("uses custom identities table name", async () => {
        const customMockDb = createMockD1Database()
        const customAdapter = new D1UserAdapter({
          db: customMockDb as any,
          identitiesTable: "custom_identities",
        })

        const identity: UserIdentity = {
          id: "idt_123",
          user_id: "usr_123",
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: null,
          created_at: Date.now(),
        }

        await customAdapter.createIdentity(identity)

        const statement = customMockDb._statements[0]
        expect(statement.query).toContain("INSERT INTO custom_identities")
      })
    })

    describe("getIdentity()", () => {
      test("retrieves identity from database", async () => {
        const identityRow = {
          id: "idt_123",
          user_id: "usr_123",
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: JSON.stringify({ name: "Test User" }),
          created_at: 1234567890,
        }

        let capturedQuery = ""
        let capturedBindings: any[] = []
        mockDb.prepare = (query: string) => {
          capturedQuery = query
          return {
            bind: function (...values: any[]) {
              capturedBindings = values
              return { first: async () => identityRow }
            },
          } as any
        }

        const identity = await adapter.getIdentity(tenantId, "idt_123")

        expect(capturedQuery).toContain("SELECT * FROM user_identities")
        expect(capturedQuery).toContain("WHERE tenant_id = ? AND id = ?")
        expect(capturedBindings).toEqual([tenantId, "idt_123"])

        expect(identity).toEqual({
          id: "idt_123",
          user_id: "usr_123",
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: { name: "Test User" },
          created_at: 1234567890,
        })
      })

      test("parses provider_data JSON", async () => {
        const identityRow = {
          id: "idt_123",
          user_id: "usr_123",
          tenant_id: tenantId,
          provider: "github",
          provider_user_id: "github_456",
          provider_data: JSON.stringify({ login: "testuser", id: 123 }),
          created_at: 1234567890,
        }

        mockDb.prepare = () =>
          ({
            bind: () => ({ first: async () => identityRow }) as any,
          }) as any

        const identity = await adapter.getIdentity(tenantId, "idt_123")

        expect(identity?.provider_data).toEqual({ login: "testuser", id: 123 })
      })

      test("handles null provider_data", async () => {
        const identityRow = {
          id: "idt_123",
          user_id: "usr_123",
          tenant_id: tenantId,
          provider: "google",
          provider_user_id: "google_123",
          provider_data: null,
          created_at: 1234567890,
        }

        mockDb.prepare = () =>
          ({
            bind: () => ({ first: async () => identityRow }) as any,
          }) as any

        const identity = await adapter.getIdentity(tenantId, "idt_123")

        expect(identity?.provider_data).toBeNull()
      })

      test("returns null when identity not found", async () => {
        mockDb.prepare = () =>
          ({
            bind: () => ({ first: async () => null }) as any,
          }) as any

        const identity = await adapter.getIdentity(tenantId, "idt_nonexistent")

        expect(identity).toBeNull()
      })
    })

    describe("getUserIdentities()", () => {
      test("retrieves all identities for user", async () => {
        const identityRows = [
          {
            id: "idt_1",
            user_id: "usr_123",
            tenant_id: tenantId,
            provider: "google",
            provider_user_id: "google_123",
            provider_data: null,
            created_at: 1234567890,
          },
          {
            id: "idt_2",
            user_id: "usr_123",
            tenant_id: tenantId,
            provider: "github",
            provider_user_id: "github_456",
            provider_data: JSON.stringify({ login: "testuser" }),
            created_at: 1234567891,
          },
        ]

        let capturedQuery = ""
        mockDb.prepare = (query: string) => {
          capturedQuery = query
          return {
            bind: () =>
              ({
                all: async () => ({ results: identityRows, success: true }),
              }) as any,
          } as any
        }

        const identities = await adapter.getUserIdentities(tenantId, "usr_123")

        expect(capturedQuery).toContain("SELECT * FROM user_identities")
        expect(capturedQuery).toContain("WHERE tenant_id = ? AND user_id = ?")
        expect(capturedQuery).toContain("ORDER BY created_at DESC")

        expect(identities).toHaveLength(2)
        expect(identities[0].provider).toBe("google")
        expect(identities[1].provider).toBe("github")
        expect(identities[1].provider_data).toEqual({ login: "testuser" })
      })

      test("returns empty array when no identities found", async () => {
        mockDb.prepare = () =>
          ({
            bind: () =>
              ({ all: async () => ({ results: [], success: true }) }) as any,
          }) as any

        const identities = await adapter.getUserIdentities(tenantId, "usr_123")

        expect(identities).toEqual([])
      })
    })

    describe("deleteIdentity()", () => {
      test("deletes identity from database", async () => {
        let capturedQuery = ""
        let capturedBindings: any[] = []
        mockDb.prepare = (query: string) => {
          capturedQuery = query
          return {
            bind: function (...values: any[]) {
              capturedBindings = values
              return {
                run: async () => ({ success: true, meta: { changes: 1 } }),
              }
            },
          } as any
        }

        await adapter.deleteIdentity(tenantId, "idt_123")

        expect(capturedQuery).toContain("DELETE FROM user_identities")
        expect(capturedQuery).toContain("WHERE tenant_id = ? AND id = ?")
        expect(capturedBindings).toEqual([tenantId, "idt_123"])
      })
    })
  })
})

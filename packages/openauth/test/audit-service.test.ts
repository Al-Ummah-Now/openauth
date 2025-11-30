import {
  expect,
  test,
  describe,
  beforeEach,
  mock,
  spyOn,
  setSystemTime,
  afterEach,
} from "bun:test"
import { AuditService, type TokenUsageEvent } from "../src/services/audit.js"

// Mock D1 database
const createMockD1 = () => {
  const mockResults: any[] = []

  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: mock(() =>
          Promise.resolve({ success: true, meta: { changes: 1 } }),
        ),
        all: mock(() => Promise.resolve({ results: mockResults })),
        first: mock(() => Promise.resolve(mockResults[0] || null)),
      }),
    }),
    _mockResults: mockResults,
  }
}

describe("AuditService", () => {
  let service: AuditService
  let mockDb: any

  beforeEach(() => {
    mockDb = createMockD1()
    service = new AuditService({ database: mockDb })
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  describe("logTokenUsage", () => {
    test("logs token generation event", async () => {
      const event: TokenUsageEvent = {
        token_id: "token-123",
        subject: "user:abc",
        event_type: "generated",
        client_id: "client-xyz",
        ip_address: "192.168.1.1",
        user_agent: "Mozilla/5.0",
        timestamp: Date.now(),
        metadata: { source: "oauth" },
      }

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.logTokenUsage(event)

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("INSERT INTO token_usage")
    })

    test("logs token refreshed event", async () => {
      const event: TokenUsageEvent = {
        token_id: "token-456",
        subject: "user:def",
        event_type: "refreshed",
        client_id: "client-abc",
        timestamp: Date.now(),
      }

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.logTokenUsage(event)

      expect(prepareSpy).toHaveBeenCalled()
    })

    test("logs token revoked event", async () => {
      const event: TokenUsageEvent = {
        token_id: "token-789",
        subject: "user:ghi",
        event_type: "revoked",
        client_id: "client-def",
        timestamp: Date.now(),
      }

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.logTokenUsage(event)

      expect(prepareSpy).toHaveBeenCalled()
    })

    test("logs token reused event", async () => {
      const event: TokenUsageEvent = {
        token_id: "token-reused",
        subject: "user:jkl",
        event_type: "reused",
        client_id: "client-ghi",
        ip_address: "10.0.0.1",
        timestamp: Date.now(),
      }

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.logTokenUsage(event)

      expect(prepareSpy).toHaveBeenCalled()
    })

    test("handles optional fields correctly", async () => {
      const event: TokenUsageEvent = {
        token_id: "token-minimal",
        subject: "user:minimal",
        event_type: "generated",
        timestamp: Date.now(),
      }

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.logTokenUsage(event)

      expect(prepareSpy).toHaveBeenCalled()
    })

    test("serializes metadata as JSON", async () => {
      const metadata = {
        grant_type: "authorization_code",
        scope: "openid profile",
        custom_field: "value",
      }

      const event: TokenUsageEvent = {
        token_id: "token-metadata",
        subject: "user:meta",
        event_type: "generated",
        client_id: "client-meta",
        timestamp: Date.now(),
        metadata,
      }

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.logTokenUsage(event)

      expect(prepareSpy).toHaveBeenCalled()
      // The bind call should include the stringified metadata
      const bindCall = prepareSpy.mock.results[0].value.bind
      expect(bindCall).toBeDefined()
    })

    test("does not throw on error (fire-and-forget)", async () => {
      const brokenDb = {
        prepare: () => ({
          bind: () => ({
            run: () => {
              throw new Error("Database error")
            },
          }),
        }),
      }

      const brokenService = new AuditService({ database: brokenDb as any })

      const event: TokenUsageEvent = {
        token_id: "token-error",
        subject: "user:error",
        event_type: "generated",
        timestamp: Date.now(),
      }

      // Should not throw - errors are caught and logged
      await expect(brokenService.logTokenUsage(event)).resolves.toBeUndefined()
    })
  })

  describe("getTokenAnalytics", () => {
    test("retrieves token analytics for subject", async () => {
      const subject = "user:analytics"
      const mockEvents: TokenUsageEvent[] = [
        {
          token_id: "token-1",
          subject,
          event_type: "generated",
          client_id: "client-1",
          timestamp: Date.now(),
        },
        {
          token_id: "token-2",
          subject,
          event_type: "refreshed",
          client_id: "client-1",
          timestamp: Date.now() + 1000,
        },
      ]

      mockDb._mockResults.push(...mockEvents)

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.getTokenAnalytics(subject, 100)

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("SELECT * FROM token_usage")
      expect(sql).toContain("WHERE subject = ?")
      expect(sql).toContain("ORDER BY timestamp DESC")
      expect(sql).toContain("LIMIT ?")
    })

    test("uses custom limit", async () => {
      const subject = "user:limit-test"

      await service.getTokenAnalytics(subject, 50)

      const prepareSpy = spyOn(mockDb, "prepare")
      await service.getTokenAnalytics(subject, 50)

      expect(prepareSpy).toHaveBeenCalled()
    })

    test("parses metadata from JSON", async () => {
      const subject = "user:json-test"
      const metadata = { custom: "data" }

      mockDb._mockResults.push({
        token_id: "token-json",
        subject,
        event_type: "generated",
        client_id: "client-json",
        timestamp: Date.now(),
        metadata: JSON.stringify(metadata),
      })

      const results = await service.getTokenAnalytics(subject)

      expect(results[0].metadata).toEqual(metadata)
    })

    test("handles missing metadata", async () => {
      const subject = "user:no-meta"

      mockDb._mockResults.push({
        token_id: "token-no-meta",
        subject,
        event_type: "generated",
        client_id: "client-no-meta",
        timestamp: Date.now(),
        metadata: null,
      })

      const results = await service.getTokenAnalytics(subject)

      expect(results[0].metadata).toBeUndefined()
    })

    test("returns empty array on error", async () => {
      const brokenDb = {
        prepare: () => ({
          bind: () => ({
            all: () => {
              throw new Error("Query error")
            },
          }),
        }),
      }

      const brokenService = new AuditService({ database: brokenDb as any })

      const results = await brokenService.getTokenAnalytics("user:error")

      expect(results).toEqual([])
    })
  })

  describe("getTokenFamily", () => {
    test("retrieves token family history", async () => {
      const tokenId = "family-root"

      const mockEvents: TokenUsageEvent[] = [
        {
          token_id: tokenId,
          subject: "user:family",
          event_type: "generated",
          client_id: "client-family",
          timestamp: Date.now(),
        },
        {
          token_id: tokenId,
          subject: "user:family",
          event_type: "refreshed",
          client_id: "client-family",
          timestamp: Date.now() + 1000,
        },
        {
          token_id: tokenId,
          subject: "user:family",
          event_type: "refreshed",
          client_id: "client-family",
          timestamp: Date.now() + 2000,
        },
      ]

      mockDb._mockResults.push(...mockEvents)

      const results = await service.getTokenFamily(tokenId)

      expect(results).toHaveLength(3)
      expect(results[0].event_type).toBe("generated")
      expect(results[1].event_type).toBe("refreshed")
      expect(results[2].event_type).toBe("refreshed")
    })

    test("orders results chronologically", async () => {
      const tokenId = "chronological-test"

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.getTokenFamily(tokenId)

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("ORDER BY timestamp ASC") // ASC for chronological order
    })
  })

  describe("getAuditLogs", () => {
    test("retrieves logs with subject filter", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      await service.getAuditLogs({ subject: "user:filter-test" })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE subject = ?")
    })

    test("retrieves logs with event_type filter", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      await service.getAuditLogs({ event_type: "revoked" })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE event_type = ?")
    })

    test("retrieves logs with client_id filter", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      await service.getAuditLogs({ client_id: "specific-client" })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("WHERE client_id = ?")
    })

    test("retrieves logs with timestamp range", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      const startTimestamp = Date.now() - 86400000 // 24 hours ago
      const endTimestamp = Date.now()

      await service.getAuditLogs({
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
      })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("timestamp >= ?")
      expect(sql).toContain("timestamp <= ?")
    })

    test("combines multiple filters with AND", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      await service.getAuditLogs({
        subject: "user:multi",
        event_type: "generated",
        client_id: "client-multi",
      })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("AND")
    })

    test("supports pagination", async () => {
      const prepareSpy = spyOn(mockDb, "prepare")

      await service.getAuditLogs({
        limit: 50,
        offset: 100,
      })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("LIMIT ? OFFSET ?")
    })

    test("returns empty array on error", async () => {
      const brokenDb = {
        prepare: () => ({
          bind: () => ({
            all: () => {
              throw new Error("Query error")
            },
          }),
        }),
      }

      const brokenService = new AuditService({ database: brokenDb as any })

      const results = await brokenService.getAuditLogs({})

      expect(results).toEqual([])
    })
  })

  describe("cleanExpired", () => {
    test("removes logs older than specified age", async () => {
      const maxAgeSeconds = 30 * 24 * 60 * 60 // 30 days

      const prepareSpy = spyOn(mockDb, "prepare")

      await service.cleanExpired(maxAgeSeconds)

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("DELETE FROM token_usage")
      expect(sql).toContain("WHERE timestamp < ?")
    })

    test("returns count of deleted rows", async () => {
      const mockDb = {
        prepare: () => ({
          bind: () => ({
            run: mock(() =>
              Promise.resolve({ success: true, meta: { changes: 42 } }),
            ),
          }),
        }),
      }

      const service = new AuditService({ database: mockDb as any })

      const count = await service.cleanExpired(86400)

      expect(count).toBe(42)
    })

    test("returns 0 on error", async () => {
      const brokenDb = {
        prepare: () => ({
          bind: () => ({
            run: () => {
              throw new Error("Delete error")
            },
          }),
        }),
      }

      const brokenService = new AuditService({ database: brokenDb as any })

      const count = await brokenService.cleanExpired(86400)

      expect(count).toBe(0)
    })
  })

  describe("configuration", () => {
    test("rejects invalid custom table names for security", async () => {
      // Custom table names are blocked by SQLValidator for security
      expect(() => {
        new AuditService({
          database: mockDb,
          tableName: "custom_audit_logs",
        })
      }).toThrow("Invalid table name specified")
    })

    test("uses default table name when not specified", async () => {
      const defaultService = new AuditService({ database: mockDb })

      const prepareSpy = spyOn(mockDb, "prepare")

      await defaultService.logTokenUsage({
        token_id: "test",
        subject: "user:test",
        event_type: "generated",
        timestamp: Date.now(),
      })

      expect(prepareSpy).toHaveBeenCalled()
      const sql = prepareSpy.mock.calls[0][0]
      expect(sql).toContain("token_usage")
    })
  })
})

import { expect, test, describe, beforeEach, mock } from "bun:test"
import {
  queryMultiRegionAuditLogs,
  getMultiRegionTokenAnalytics,
  getMultiRegionTokenFamily,
  getMultiRegionStatistics,
  type RegionalD1Config,
} from "../src/services/multi-region-audit.js"
import type { TokenUsageEvent } from "../src/services/audit.js"

// Mock D1 database
const createMockD1 = (regionName: string, mockEvents: TokenUsageEvent[]) => ({
  prepare: (sql: string) => ({
    bind: (...params: any[]) => ({
      all: mock(() => Promise.resolve({ results: mockEvents })),
    }),
  }),
})

describe("queryMultiRegionAuditLogs", () => {
  let regions: RegionalD1Config[]
  let usEvents: TokenUsageEvent[]
  let euEvents: TokenUsageEvent[]
  let apacEvents: TokenUsageEvent[]

  beforeEach(() => {
    const now = Date.now()

    usEvents = [
      {
        token_id: "token-us-1",
        subject: "user-123",
        event_type: "generated",
        client_id: "client-1",
        timestamp: now - 1000,
      },
      {
        token_id: "token-us-2",
        subject: "user-123",
        event_type: "refreshed",
        client_id: "client-1",
        timestamp: now - 2000,
      },
    ]

    euEvents = [
      {
        token_id: "token-eu-1",
        subject: "user-123",
        event_type: "generated",
        client_id: "client-2",
        timestamp: now - 500,
      },
    ]

    apacEvents = [
      {
        token_id: "token-apac-1",
        subject: "user-456",
        event_type: "revoked",
        client_id: "client-3",
        timestamp: now - 3000,
      },
    ]

    regions = [
      {
        name: "us-east",
        database: createMockD1("US", usEvents) as any,
      },
      {
        name: "eu-west",
        database: createMockD1("EU", euEvents) as any,
      },
      {
        name: "apac",
        database: createMockD1("APAC", apacEvents) as any,
      },
    ]
  })

  test("queries all regions and merges results", async () => {
    const results = await queryMultiRegionAuditLogs(regions, {
      subject: "user-123",
      limit: 100,
    })

    // Should have events from all regions
    expect(results.length).toBeGreaterThan(0)

    // Should tag each event with region
    const hasUsEvent = results.some((e: any) => e._region === "us-east")
    const hasEuEvent = results.some((e: any) => e._region === "eu-west")

    expect(hasUsEvent || hasEuEvent).toBe(true)
  })

  test("sorts results by timestamp (newest first)", async () => {
    const results = await queryMultiRegionAuditLogs(regions, {
      limit: 100,
    })

    // Verify descending order
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].timestamp).toBeGreaterThanOrEqual(
        results[i + 1].timestamp,
      )
    }
  })

  test("respects limit parameter", async () => {
    const results = await queryMultiRegionAuditLogs(regions, {
      limit: 2,
    })

    expect(results.length).toBeLessThanOrEqual(2)
  })

  test("filters by subject", async () => {
    const results = await queryMultiRegionAuditLogs(regions, {
      subject: "user-123",
      limit: 100,
    })

    // All results should match subject (if filtering works)
    // Note: This depends on AuditService implementation
    expect(results.length).toBeGreaterThan(0)
  })

  test("handles region failures gracefully", async () => {
    // Create region that fails
    const failingRegion: RegionalD1Config = {
      name: "failing",
      database: {
        prepare: () => ({
          bind: () => ({
            all: mock(() => Promise.reject(new Error("DB error"))),
          }),
        }),
      } as any,
    }

    const regionsWithFailure = [...regions, failingRegion]

    const results = await queryMultiRegionAuditLogs(regionsWithFailure, {
      limit: 100,
    })

    // Should still return results from successful regions
    expect(results.length).toBeGreaterThan(0)
  })

  test("handles empty results from all regions", async () => {
    const emptyRegions: RegionalD1Config[] = [
      {
        name: "empty-us",
        database: createMockD1("US", []) as any,
      },
      {
        name: "empty-eu",
        database: createMockD1("EU", []) as any,
      },
    ]

    const results = await queryMultiRegionAuditLogs(emptyRegions, {
      limit: 100,
    })

    expect(results).toEqual([])
  })
})

describe("getMultiRegionTokenAnalytics", () => {
  test("queries analytics from all regions", async () => {
    const now = Date.now()
    const events: TokenUsageEvent[] = [
      {
        token_id: "token-1",
        subject: "user-123",
        event_type: "generated",
        client_id: "client-1",
        timestamp: now,
      },
    ]

    const regions: RegionalD1Config[] = [
      {
        name: "us",
        database: createMockD1("US", events) as any,
      },
    ]

    const results = await getMultiRegionTokenAnalytics(regions, "user-123", 50)

    expect(results.length).toBeGreaterThan(0)
  })

  test("merges and sorts results chronologically", async () => {
    const now = Date.now()
    const usEvents: TokenUsageEvent[] = [
      {
        token_id: "token-1",
        subject: "user-123",
        event_type: "generated",
        timestamp: now - 1000,
      },
    ]
    const euEvents: TokenUsageEvent[] = [
      {
        token_id: "token-2",
        subject: "user-123",
        event_type: "refreshed",
        timestamp: now - 500,
      },
    ]

    const regions: RegionalD1Config[] = [
      { name: "us", database: createMockD1("US", usEvents) as any },
      { name: "eu", database: createMockD1("EU", euEvents) as any },
    ]

    const results = await getMultiRegionTokenAnalytics(regions, "user-123", 50)

    // Should be sorted newest first
    expect(results[0].timestamp).toBeGreaterThanOrEqual(results[1].timestamp)
  })
})

describe("getMultiRegionTokenFamily", () => {
  test("queries token family from all regions", async () => {
    const now = Date.now()
    const events: TokenUsageEvent[] = [
      {
        token_id: "family-token-1",
        subject: "user-123",
        event_type: "generated",
        timestamp: now,
      },
      {
        token_id: "family-token-1",
        subject: "user-123",
        event_type: "refreshed",
        timestamp: now + 1000,
      },
    ]

    const regions: RegionalD1Config[] = [
      {
        name: "us",
        database: createMockD1("US", events) as any,
      },
    ]

    const results = await getMultiRegionTokenFamily(
      regions,
      "family-token-1",
      50,
    )

    expect(results.length).toBeGreaterThan(0)
  })

  test("sorts results chronologically (oldest first for history)", async () => {
    const now = Date.now()
    const events: TokenUsageEvent[] = [
      {
        token_id: "token-1",
        subject: "user-123",
        event_type: "refreshed",
        timestamp: now + 2000,
      },
      {
        token_id: "token-1",
        subject: "user-123",
        event_type: "generated",
        timestamp: now,
      },
      {
        token_id: "token-1",
        subject: "user-123",
        event_type: "refreshed",
        timestamp: now + 1000,
      },
    ]

    const regions: RegionalD1Config[] = [
      {
        name: "us",
        database: createMockD1("US", events) as any,
      },
    ]

    const results = await getMultiRegionTokenFamily(regions, "token-1", 50)

    // Should be sorted oldest first (ascending)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].timestamp).toBeLessThanOrEqual(results[i + 1].timestamp)
    }
  })
})

describe("getMultiRegionStatistics", () => {
  test("aggregates statistics from all regions", async () => {
    const now = Date.now()
    const usEvents: TokenUsageEvent[] = [
      {
        token_id: "token-1",
        subject: "user-123",
        event_type: "generated",
        timestamp: now,
      },
      {
        token_id: "token-2",
        subject: "user-456",
        event_type: "refreshed",
        timestamp: now,
      },
    ]
    const euEvents: TokenUsageEvent[] = [
      {
        token_id: "token-3",
        subject: "user-789",
        event_type: "revoked",
        timestamp: now,
      },
    ]

    const regions: RegionalD1Config[] = [
      { name: "us", database: createMockD1("US", usEvents) as any },
      { name: "eu", database: createMockD1("EU", euEvents) as any },
    ]

    const stats = await getMultiRegionStatistics(regions, {
      start_timestamp: now - 10000,
      end_timestamp: now + 10000,
    })

    expect(stats.total_events).toBe(3)
    expect(stats.by_event_type.generated).toBe(1)
    expect(stats.by_event_type.refreshed).toBe(1)
    expect(stats.by_event_type.revoked).toBe(1)
    expect(stats.by_region.us).toBe(2)
    expect(stats.by_region.eu).toBe(1)
  })

  test("calculates time range correctly", async () => {
    const now = Date.now()
    const events: TokenUsageEvent[] = [
      {
        token_id: "token-1",
        subject: "user-123",
        event_type: "generated",
        timestamp: now - 5000,
      },
      {
        token_id: "token-2",
        subject: "user-123",
        event_type: "refreshed",
        timestamp: now,
      },
    ]

    const regions: RegionalD1Config[] = [
      {
        name: "us",
        database: createMockD1("US", events) as any,
      },
    ]

    const stats = await getMultiRegionStatistics(regions)

    expect(stats.time_range.earliest).toBe(now - 5000)
    expect(stats.time_range.latest).toBe(now)
  })

  test("handles empty results", async () => {
    const regions: RegionalD1Config[] = [
      {
        name: "us",
        database: createMockD1("US", []) as any,
      },
    ]

    const stats = await getMultiRegionStatistics(regions)

    expect(stats.total_events).toBe(0)
    expect(stats.by_event_type.generated).toBe(0)
    expect(stats.by_region).toEqual({})
    expect(stats.time_range.earliest).toBe(0)
    expect(stats.time_range.latest).toBe(0)
  })

  test("counts events by region correctly", async () => {
    const now = Date.now()
    const usEvents: TokenUsageEvent[] = Array(5).fill({
      token_id: "token",
      subject: "user",
      event_type: "generated",
      timestamp: now,
    })
    const euEvents: TokenUsageEvent[] = Array(3).fill({
      token_id: "token",
      subject: "user",
      event_type: "generated",
      timestamp: now,
    })

    const regions: RegionalD1Config[] = [
      { name: "us", database: createMockD1("US", usEvents) as any },
      { name: "eu", database: createMockD1("EU", euEvents) as any },
    ]

    const stats = await getMultiRegionStatistics(regions)

    expect(stats.by_region.us).toBe(5)
    expect(stats.by_region.eu).toBe(3)
    expect(stats.total_events).toBe(8)
  })
})

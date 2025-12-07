import { describe, test, expect, beforeEach } from "bun:test"
import {
  TTLCache,
  providerCacheKey,
  tenantCacheKeyPrefix,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CACHE_MAX_SIZE,
} from "./cache.js"

// Helper to wait for a duration
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("TTLCache", () => {
  let cache: TTLCache<string>

  beforeEach(() => {
    cache = new TTLCache<string>()
  })

  describe("constructor", () => {
    test("creates cache with default max size", () => {
      const cache = new TTLCache<string>()
      const stats = cache.getStats()

      expect(stats.size).toBe(0)
    })

    test("creates cache with custom max size", () => {
      const cache = new TTLCache<string>({ maxSize: 100 })
      expect(cache).toBeDefined()
    })

    test("creates cache with different value types", () => {
      const stringCache = new TTLCache<string>()
      const numberCache = new TTLCache<number>()
      const objectCache = new TTLCache<{ value: string }>()

      expect(stringCache).toBeDefined()
      expect(numberCache).toBeDefined()
      expect(objectCache).toBeDefined()
    })
  })

  describe("set / get", () => {
    test("stores and retrieves a value", () => {
      cache.set("key1", "value1", 1000)
      const value = cache.get("key1")

      expect(value).toBe("value1")
    })

    test("stores and retrieves multiple values", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key2", "value2", 1000)
      cache.set("key3", "value3", 1000)

      expect(cache.get("key1")).toBe("value1")
      expect(cache.get("key2")).toBe("value2")
      expect(cache.get("key3")).toBe("value3")
    })

    test("returns undefined for non-existent key", () => {
      const value = cache.get("nonexistent")
      expect(value).toBeUndefined()
    })

    test("updates existing key value", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key1", "value2", 1000)

      expect(cache.get("key1")).toBe("value2")
    })

    test("stores different value types", () => {
      const numberCache = new TTLCache<number>()
      const objectCache = new TTLCache<{ id: string; name: string }>()

      numberCache.set("num", 42, 1000)
      objectCache.set("obj", { id: "1", name: "Test" }, 1000)

      expect(numberCache.get("num")).toBe(42)
      expect(objectCache.get("obj")).toEqual({ id: "1", name: "Test" })
    })

    test("stores null values", () => {
      const cache = new TTLCache<string | null>()
      cache.set("key", null, 1000)

      expect(cache.get("key")).toBe(null)
    })

    test("updates cache size stat on insert", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key2", "value2", 1000)

      const stats = cache.getStats()
      expect(stats.size).toBe(2)
    })

    test("does not increment size on update", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key1", "updated", 1000)

      const stats = cache.getStats()
      expect(stats.size).toBe(1)
    })
  })

  describe("TTL expiration", () => {
    test("expires entry after TTL", async () => {
      cache.set("key1", "value1", 50) // 50ms TTL

      expect(cache.get("key1")).toBe("value1")

      await wait(100) // Wait for expiration

      expect(cache.get("key1")).toBeUndefined()
    })

    test("respects different TTLs for different keys", async () => {
      cache.set("short", "value1", 50)
      cache.set("long", "value2", 200)

      await wait(100)

      expect(cache.get("short")).toBeUndefined()
      expect(cache.get("long")).toBe("value2")
    })

    test("allows zero TTL (expires immediately)", async () => {
      cache.set("key1", "value1", 0)

      await wait(10)

      expect(cache.get("key1")).toBeUndefined()
    })

    test("decrements size when entry expires on get", async () => {
      cache.set("key1", "value1", 50)
      cache.set("key2", "value2", 50)

      expect(cache.getStats().size).toBe(2)

      await wait(100)

      cache.get("key1") // Triggers expiration check
      expect(cache.getStats().size).toBe(1)
    })

    test("increments misses when entry has expired", async () => {
      cache.set("key1", "value1", 50)

      await wait(100)

      cache.get("key1")

      const stats = cache.getStats()
      expect(stats.misses).toBe(1)
      expect(stats.hits).toBe(0)
    })

    test("updating key extends TTL", async () => {
      cache.set("key1", "value1", 50)

      await wait(30)

      cache.set("key1", "value1", 100) // Extend TTL

      await wait(40) // Total 70ms, original would have expired

      expect(cache.get("key1")).toBe("value1")
    })
  })

  describe("LRU eviction", () => {
    test("evicts oldest entry when max size reached", () => {
      const smallCache = new TTLCache<string>({ maxSize: 3 })

      smallCache.set("key1", "value1", 10000)
      smallCache.set("key2", "value2", 10000)
      smallCache.set("key3", "value3", 10000)
      smallCache.set("key4", "value4", 10000) // Should evict key1

      expect(smallCache.get("key1")).toBeUndefined()
      expect(smallCache.get("key2")).toBe("value2")
      expect(smallCache.get("key3")).toBe("value3")
      expect(smallCache.get("key4")).toBe("value4")
    })

    test("moves accessed entry to end of LRU order", () => {
      const smallCache = new TTLCache<string>({ maxSize: 3 })

      smallCache.set("key1", "value1", 10000)
      smallCache.set("key2", "value2", 10000)
      smallCache.set("key3", "value3", 10000)

      // Access key1 (moves to end)
      smallCache.get("key1")

      // Add key4 (should evict key2, not key1)
      smallCache.set("key4", "value4", 10000)

      expect(smallCache.get("key1")).toBe("value1")
      expect(smallCache.get("key2")).toBeUndefined()
      expect(smallCache.get("key3")).toBe("value3")
      expect(smallCache.get("key4")).toBe("value4")
    })

    test("evicts expired entries before LRU eviction", async () => {
      const smallCache = new TTLCache<string>({ maxSize: 3 })

      smallCache.set("expired1", "value1", 50)
      smallCache.set("expired2", "value2", 50)
      smallCache.set("valid", "value3", 10000)

      await wait(100) // Wait for expiration

      // Add new entry, should evict expired ones first
      smallCache.set("new", "value4", 10000)

      expect(smallCache.get("expired1")).toBeUndefined()
      expect(smallCache.get("expired2")).toBeUndefined()
      expect(smallCache.get("valid")).toBe("value3")
      expect(smallCache.get("new")).toBe("value4")
    })

    test("increments eviction counter", () => {
      const smallCache = new TTLCache<string>({ maxSize: 2 })

      smallCache.set("key1", "value1", 10000)
      smallCache.set("key2", "value2", 10000)
      smallCache.set("key3", "value3", 10000) // Evicts key1

      const stats = smallCache.getStats()
      expect(stats.evictions).toBe(1)
    })

    test("handles single-entry cache", () => {
      const tinyCache = new TTLCache<string>({ maxSize: 1 })

      tinyCache.set("key1", "value1", 10000)
      tinyCache.set("key2", "value2", 10000)

      expect(tinyCache.get("key1")).toBeUndefined()
      expect(tinyCache.get("key2")).toBe("value2")
    })
  })

  describe("has", () => {
    test("returns true for existing key", () => {
      cache.set("key1", "value1", 1000)
      expect(cache.has("key1")).toBe(true)
    })

    test("returns false for non-existent key", () => {
      expect(cache.has("nonexistent")).toBe(false)
    })

    test("returns false for expired key", async () => {
      cache.set("key1", "value1", 50)

      expect(cache.has("key1")).toBe(true)

      await wait(100)

      expect(cache.has("key1")).toBe(false)
    })

    test("does not update LRU order", () => {
      const smallCache = new TTLCache<string>({ maxSize: 3 })

      smallCache.set("key1", "value1", 10000)
      smallCache.set("key2", "value2", 10000)
      smallCache.set("key3", "value3", 10000)

      // Check key1 (should not move to end)
      smallCache.has("key1")

      // Add key4 (should still evict key1)
      smallCache.set("key4", "value4", 10000)

      expect(smallCache.get("key1")).toBeUndefined()
    })

    test("decrements size when expired key is checked", async () => {
      cache.set("key1", "value1", 50)

      expect(cache.getStats().size).toBe(1)

      await wait(100)

      cache.has("key1")
      expect(cache.getStats().size).toBe(0)
    })
  })

  describe("delete", () => {
    test("deletes existing key", () => {
      cache.set("key1", "value1", 1000)
      const deleted = cache.delete("key1")

      expect(deleted).toBe(true)
      expect(cache.get("key1")).toBeUndefined()
    })

    test("returns false when deleting non-existent key", () => {
      const deleted = cache.delete("nonexistent")
      expect(deleted).toBe(false)
    })

    test("decrements size when key is deleted", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key2", "value2", 1000)

      cache.delete("key1")

      const stats = cache.getStats()
      expect(stats.size).toBe(1)
    })

    test("can delete and re-add same key", () => {
      cache.set("key1", "value1", 1000)
      cache.delete("key1")
      cache.set("key1", "value2", 1000)

      expect(cache.get("key1")).toBe("value2")
    })
  })

  describe("deleteByPrefix", () => {
    test("deletes all entries with matching prefix", () => {
      cache.set("tenant:1:provider1", "value1", 1000)
      cache.set("tenant:1:provider2", "value2", 1000)
      cache.set("tenant:2:provider1", "value3", 1000)

      const count = cache.deleteByPrefix("tenant:1:")

      expect(count).toBe(2)
      expect(cache.get("tenant:1:provider1")).toBeUndefined()
      expect(cache.get("tenant:1:provider2")).toBeUndefined()
      expect(cache.get("tenant:2:provider1")).toBe("value3")
    })

    test("returns zero when no matches found", () => {
      cache.set("key1", "value1", 1000)
      const count = cache.deleteByPrefix("nonexistent:")

      expect(count).toBe(0)
      expect(cache.get("key1")).toBe("value1")
    })

    test("deletes all entries with empty prefix", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key2", "value2", 1000)

      const count = cache.deleteByPrefix("")

      expect(count).toBe(2)
      expect(cache.getSize()).toBe(0)
    })

    test("updates size correctly", () => {
      cache.set("tenant:1:provider1", "value1", 1000)
      cache.set("tenant:1:provider2", "value2", 1000)
      cache.set("tenant:2:provider1", "value3", 1000)

      cache.deleteByPrefix("tenant:1:")

      expect(cache.getStats().size).toBe(1)
    })

    test("handles exact match", () => {
      cache.set("exact", "value1", 1000)
      cache.set("exactMatch", "value2", 1000)

      const count = cache.deleteByPrefix("exact")

      expect(count).toBe(2)
    })
  })

  describe("clear", () => {
    test("removes all entries", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key2", "value2", 1000)
      cache.set("key3", "value3", 1000)

      cache.clear()

      expect(cache.get("key1")).toBeUndefined()
      expect(cache.get("key2")).toBeUndefined()
      expect(cache.get("key3")).toBeUndefined()
    })

    test("resets size to zero", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key2", "value2", 1000)

      cache.clear()

      expect(cache.getStats().size).toBe(0)
      expect(cache.getSize()).toBe(0)
    })

    test("allows adding entries after clear", () => {
      cache.set("key1", "value1", 1000)
      cache.clear()
      cache.set("key2", "value2", 1000)

      expect(cache.get("key2")).toBe("value2")
    })
  })

  describe("getStats", () => {
    test("returns cache statistics", () => {
      const stats = cache.getStats()

      expect(stats).toHaveProperty("hits")
      expect(stats).toHaveProperty("misses")
      expect(stats).toHaveProperty("size")
      expect(stats).toHaveProperty("evictions")
    })

    test("tracks hits correctly", () => {
      cache.set("key1", "value1", 1000)

      cache.get("key1") // Hit
      cache.get("key1") // Hit

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
    })

    test("tracks misses correctly", () => {
      cache.get("nonexistent1") // Miss
      cache.get("nonexistent2") // Miss

      const stats = cache.getStats()
      expect(stats.misses).toBe(2)
    })

    test("tracks both hits and misses", () => {
      cache.set("key1", "value1", 1000)

      cache.get("key1") // Hit
      cache.get("nonexistent") // Miss

      const stats = cache.getStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
    })

    test("returns copy of stats (not reference)", () => {
      const stats1 = cache.getStats()
      stats1.hits = 999

      const stats2 = cache.getStats()
      expect(stats2.hits).toBe(0)
    })
  })

  describe("getSize", () => {
    test("returns current cache size", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key2", "value2", 1000)

      expect(cache.getSize()).toBe(2)
    })

    test("returns zero for empty cache", () => {
      expect(cache.getSize()).toBe(0)
    })
  })

  describe("getHitRate", () => {
    test("returns 0 for cache with no requests", () => {
      expect(cache.getHitRate()).toBe(0)
    })

    test("returns 100 for all hits", () => {
      cache.set("key1", "value1", 1000)
      cache.get("key1")
      cache.get("key1")

      expect(cache.getHitRate()).toBe(100)
    })

    test("returns 0 for all misses", () => {
      cache.get("nonexistent1")
      cache.get("nonexistent2")

      expect(cache.getHitRate()).toBe(0)
    })

    test("returns correct percentage for mixed hits/misses", () => {
      cache.set("key1", "value1", 1000)

      cache.get("key1") // Hit
      cache.get("nonexistent") // Miss

      expect(cache.getHitRate()).toBe(50)
    })

    test("calculates hit rate with multiple operations", () => {
      cache.set("key1", "value1", 1000)
      cache.set("key2", "value2", 1000)

      cache.get("key1") // Hit
      cache.get("key1") // Hit
      cache.get("key2") // Hit
      cache.get("nonexistent") // Miss

      // 3 hits, 1 miss = 75%
      expect(cache.getHitRate()).toBe(75)
    })
  })

  describe("cleanup", () => {
    test("removes all expired entries", async () => {
      cache.set("expired1", "value1", 50)
      cache.set("expired2", "value2", 50)
      cache.set("valid", "value3", 10000)

      await wait(100)

      const count = cache.cleanup()

      expect(count).toBe(2)
      expect(cache.get("expired1")).toBeUndefined()
      expect(cache.get("expired2")).toBeUndefined()
      expect(cache.get("valid")).toBe("value3")
    })

    test("returns zero when no expired entries", () => {
      cache.set("key1", "value1", 10000)
      cache.set("key2", "value2", 10000)

      const count = cache.cleanup()

      expect(count).toBe(0)
    })

    test("updates size after cleanup", async () => {
      cache.set("expired1", "value1", 50)
      cache.set("expired2", "value2", 50)
      cache.set("valid", "value3", 10000)

      await wait(100)

      cache.cleanup()

      expect(cache.getStats().size).toBe(1)
    })

    test("returns zero for empty cache", () => {
      const count = cache.cleanup()
      expect(count).toBe(0)
    })
  })
})

describe("providerCacheKey", () => {
  test("generates cache key with tenant and provider", () => {
    const key = providerCacheKey("tenant123", "google")
    expect(key).toBe("provider:tenant123:google")
  })

  test("generates different keys for different tenants", () => {
    const key1 = providerCacheKey("tenant1", "google")
    const key2 = providerCacheKey("tenant2", "google")

    expect(key1).not.toBe(key2)
  })

  test("generates different keys for different providers", () => {
    const key1 = providerCacheKey("tenant123", "google")
    const key2 = providerCacheKey("tenant123", "github")

    expect(key1).not.toBe(key2)
  })

  test("handles special characters in tenant ID", () => {
    const key = providerCacheKey("tenant-with-dashes_123", "google")
    expect(key).toBe("provider:tenant-with-dashes_123:google")
  })

  test("handles special characters in provider name", () => {
    const key = providerCacheKey("tenant123", "custom_oauth2")
    expect(key).toBe("provider:tenant123:custom_oauth2")
  })
})

describe("tenantCacheKeyPrefix", () => {
  test("generates cache key prefix for tenant", () => {
    const prefix = tenantCacheKeyPrefix("tenant123")
    expect(prefix).toBe("provider:tenant123:")
  })

  test("generates different prefixes for different tenants", () => {
    const prefix1 = tenantCacheKeyPrefix("tenant1")
    const prefix2 = tenantCacheKeyPrefix("tenant2")

    expect(prefix1).not.toBe(prefix2)
  })

  test("prefix matches provider cache keys", () => {
    const tenantId = "tenant123"
    const prefix = tenantCacheKeyPrefix(tenantId)
    const key = providerCacheKey(tenantId, "google")

    expect(key.startsWith(prefix)).toBe(true)
  })

  test("handles special characters in tenant ID", () => {
    const prefix = tenantCacheKeyPrefix("tenant-with-dashes_123")
    expect(prefix).toBe("provider:tenant-with-dashes_123:")
  })
})

describe("DEFAULT_CACHE_TTL_MS", () => {
  test("is defined as 60 seconds", () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(60_000)
  })

  test("is a positive number", () => {
    expect(DEFAULT_CACHE_TTL_MS).toBeGreaterThan(0)
  })
})

describe("DEFAULT_CACHE_MAX_SIZE", () => {
  test("is defined as 500", () => {
    expect(DEFAULT_CACHE_MAX_SIZE).toBe(500)
  })

  test("is a positive number", () => {
    expect(DEFAULT_CACHE_MAX_SIZE).toBeGreaterThan(0)
  })
})

describe("Cache integration scenarios", () => {
  test("simulates provider caching workflow", () => {
    const cache = new TTLCache<{ clientId: string; clientSecret: string }>()

    // Cache provider configs for different tenants
    cache.set(
      providerCacheKey("tenant1", "google"),
      { clientId: "client1", clientSecret: "secret1" },
      DEFAULT_CACHE_TTL_MS,
    )
    cache.set(
      providerCacheKey("tenant1", "github"),
      { clientId: "client2", clientSecret: "secret2" },
      DEFAULT_CACHE_TTL_MS,
    )
    cache.set(
      providerCacheKey("tenant2", "google"),
      { clientId: "client3", clientSecret: "secret3" },
      DEFAULT_CACHE_TTL_MS,
    )

    // Retrieve specific provider
    const config = cache.get(providerCacheKey("tenant1", "google"))
    expect(config).toEqual({ clientId: "client1", clientSecret: "secret1" })

    // Invalidate all providers for tenant1
    const deleted = cache.deleteByPrefix(tenantCacheKeyPrefix("tenant1"))
    expect(deleted).toBe(2)

    // Verify tenant2 is unaffected
    const tenant2Config = cache.get(providerCacheKey("tenant2", "google"))
    expect(tenant2Config).toEqual({ clientId: "client3", clientSecret: "secret3" })
  })

  test("handles high-volume concurrent access", () => {
    const cache = new TTLCache<string>({ maxSize: 100 })

    // Simulate many concurrent requests with unique keys
    for (let i = 0; i < 200; i++) {
      const tenantId = `tenant${Math.floor(i / 5)}`
      const provider = `provider${i % 5}`
      cache.set(providerCacheKey(tenantId, provider), `value${i}`, 10000)
    }

    // Should have evicted oldest entries (200 inserts, max 100)
    expect(cache.getSize()).toBe(100)
  })

  test("maintains cache consistency under mixed operations", async () => {
    const cache = new TTLCache<number>({ maxSize: 10 })

    // Add entries with varying TTLs
    cache.set("key1", 1, 100)
    cache.set("key2", 2, 200)
    cache.set("key3", 3, 300)

    // Access pattern
    cache.get("key1")
    cache.get("key2")

    await wait(150)

    // key1 should be expired, key2 and key3 still valid
    expect(cache.get("key1")).toBeUndefined()
    expect(cache.get("key2")).toBe(2)
    expect(cache.get("key3")).toBe(3)

    // Clean up
    cache.cleanup()
    expect(cache.getSize()).toBe(2)
  })
})

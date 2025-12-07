import { describe, test, expect, beforeEach } from "bun:test"
import { memoryStore } from "./rate-limit.js"

describe("memoryStore", () => {
  // Note: memoryStore uses a shared Map, so we need unique keys per test
  let testKeyCounter = 0

  function getUniqueKey() {
    return `test-key-${++testKeyCounter}-${Date.now()}`
  }

  describe("increment", () => {
    test("initializes count to 1 on first call", async () => {
      const key = getUniqueKey()
      const windowMs = 60000 // 1 minute

      const result = await memoryStore.increment(key, windowMs)

      expect(result.count).toBe(1)
      expect(result.resetAt).toBeGreaterThan(Date.now())
      expect(result.resetAt).toBeLessThanOrEqual(Date.now() + windowMs)
    })

    test("increments count on subsequent calls within window", async () => {
      const key = getUniqueKey()
      const windowMs = 60000

      const first = await memoryStore.increment(key, windowMs)
      expect(first.count).toBe(1)

      const second = await memoryStore.increment(key, windowMs)
      expect(second.count).toBe(2)
      expect(second.resetAt).toBe(first.resetAt)

      const third = await memoryStore.increment(key, windowMs)
      expect(third.count).toBe(3)
      expect(third.resetAt).toBe(first.resetAt)
    })

    test("resets count after window expires", async () => {
      const key = getUniqueKey()
      const windowMs = 10 // Very short window for testing

      const first = await memoryStore.increment(key, windowMs)
      expect(first.count).toBe(1)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 15))

      const second = await memoryStore.increment(key, windowMs)
      expect(second.count).toBe(1) // Reset to 1
      expect(second.resetAt).toBeGreaterThan(first.resetAt)
    })

    test("sets resetAt to current time plus window", async () => {
      const key = getUniqueKey()
      const windowMs = 60000
      const beforeCall = Date.now()

      const result = await memoryStore.increment(key, windowMs)

      expect(result.resetAt).toBeGreaterThanOrEqual(beforeCall + windowMs)
      expect(result.resetAt).toBeLessThanOrEqual(Date.now() + windowMs + 100) // Allow 100ms buffer
    })

    test("maintains separate counts for different keys", async () => {
      const key1 = getUniqueKey()
      const key2 = getUniqueKey()
      const windowMs = 60000

      const result1 = await memoryStore.increment(key1, windowMs)
      expect(result1.count).toBe(1)

      const result2 = await memoryStore.increment(key2, windowMs)
      expect(result2.count).toBe(1)

      const result1Again = await memoryStore.increment(key1, windowMs)
      expect(result1Again.count).toBe(2)

      const result2Again = await memoryStore.increment(key2, windowMs)
      expect(result2Again.count).toBe(2)
    })

    test("returns correct remaining count calculation", async () => {
      const key = getUniqueKey()
      const windowMs = 60000
      const maxRequests = 10

      const first = await memoryStore.increment(key, windowMs)
      expect(maxRequests - first.count).toBe(9)

      const second = await memoryStore.increment(key, windowMs)
      expect(maxRequests - second.count).toBe(8)

      const third = await memoryStore.increment(key, windowMs)
      expect(maxRequests - third.count).toBe(7)
    })

    test("handles rapid successive calls", async () => {
      const key = getUniqueKey()
      const windowMs = 60000

      // Make 5 sequential calls and capture the count at each step
      // Note: The implementation returns the same object reference that gets mutated
      const counts = []
      for (let i = 0; i < 5; i++) {
        const result = await memoryStore.increment(key, windowMs)
        counts.push(result.count)
      }

      // Counts should be 1, 2, 3, 4, 5
      expect(counts).toEqual([1, 2, 3, 4, 5])
    })

    test("handles different window sizes", async () => {
      const key1 = getUniqueKey()
      const key2 = getUniqueKey()

      const result1 = await memoryStore.increment(key1, 1000)
      expect(result1.resetAt - Date.now()).toBeLessThanOrEqual(1000)

      const result2 = await memoryStore.increment(key2, 60000)
      expect(result2.resetAt - Date.now()).toBeLessThanOrEqual(60000)

      const result3 = await memoryStore.increment(getUniqueKey(), 3600000)
      expect(result3.resetAt - Date.now()).toBeLessThanOrEqual(3600000)
    })

    test("window expiry check uses current time", async () => {
      const key = getUniqueKey()
      const windowMs = 20

      // First increment
      await memoryStore.increment(key, windowMs)

      // Wait half the window
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Second increment (still within window)
      const result = await memoryStore.increment(key, windowMs)
      expect(result.count).toBe(2)

      // Wait for window to fully expire
      await new Promise((resolve) => setTimeout(resolve, 15))

      // Third increment (window expired, should reset)
      const resetResult = await memoryStore.increment(key, windowMs)
      expect(resetResult.count).toBe(1)
    })

    test("count increments correctly beyond typical rate limits", async () => {
      const key = getUniqueKey()
      const windowMs = 60000

      // Simulate exceeding a rate limit
      for (let i = 1; i <= 15; i++) {
        const result = await memoryStore.increment(key, windowMs)
        expect(result.count).toBe(i)
      }
    })

    test("preserves resetAt when incrementing within window", async () => {
      const key = getUniqueKey()
      const windowMs = 60000

      const first = await memoryStore.increment(key, windowMs)
      const originalResetAt = first.resetAt

      // Multiple increments
      for (let i = 0; i < 5; i++) {
        const result = await memoryStore.increment(key, windowMs)
        expect(result.resetAt).toBe(originalResetAt)
      }
    })
  })
})

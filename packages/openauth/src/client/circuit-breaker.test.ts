import { describe, test, expect, beforeEach } from "bun:test"
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
} from "./circuit-breaker.js"

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker

  beforeEach(() => {
    breaker = new CircuitBreaker("test-breaker", {
      failureThreshold: 50,
      minimumRequests: 3,
      windowSize: 60000,
      cooldownPeriod: 1000,
      successThreshold: 2,
    })
  })

  describe("initial state", () => {
    test("starts in CLOSED state", () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    test("stats show zero requests", () => {
      const stats = breaker.getStats()
      expect(stats.totalRequests).toBe(0)
      expect(stats.failedRequests).toBe(0)
      expect(stats.failureRate).toBe(0)
    })
  })

  describe("successful operations", () => {
    test("passes through successful operations", async () => {
      const result = await breaker.execute(async () => "success")
      expect(result).toBe("success")
    })

    test("tracks successful requests", async () => {
      await breaker.execute(async () => "ok")
      await breaker.execute(async () => "ok")

      const stats = breaker.getStats()
      expect(stats.totalRequests).toBe(2)
      expect(stats.failedRequests).toBe(0)
    })
  })

  describe("failed operations", () => {
    test("propagates errors", async () => {
      await expect(
        breaker.execute(async () => {
          throw new Error("test error")
        }),
      ).rejects.toThrow("test error")
    })

    test("tracks failed requests", async () => {
      try {
        await breaker.execute(async () => {
          throw new Error("fail")
        })
      } catch {}

      const stats = breaker.getStats()
      expect(stats.failedRequests).toBe(1)
    })
  })

  describe("circuit opening", () => {
    test("opens circuit after threshold exceeded", async () => {
      // Cause failures to exceed threshold (>50% of min 3 requests)
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail")
          })
        } catch {}
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })

    test("throws CircuitBreakerError when open", async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail")
          })
        } catch {}
      }

      await expect(
        breaker.execute(async () => "should not run"),
      ).rejects.toThrow(CircuitBreakerError)
    })

    test("does not open until minimum requests reached", async () => {
      // Only 2 failures (below minimum of 3)
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail")
          })
        } catch {}
      }

      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })
  })

  describe("circuit recovery", () => {
    test("manual reset closes circuit", async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail")
          })
        } catch {}
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN)

      breaker.reset()

      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    test("reset clears statistics", () => {
      breaker.reset()
      const stats = breaker.getStats()

      expect(stats.totalRequests).toBe(0)
      expect(stats.failedRequests).toBe(0)
    })
  })

  describe("getStats", () => {
    test("calculates failure rate correctly", async () => {
      await breaker.execute(async () => "ok")
      try {
        await breaker.execute(async () => {
          throw new Error("fail")
        })
      } catch {}

      const stats = breaker.getStats()
      expect(stats.failureRate).toBe(50)
    })

    test("reports cooldown remaining when open", async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail")
          })
        } catch {}
      }

      const stats = breaker.getStats()
      expect(stats.cooldownRemaining).toBeGreaterThan(0)
    })
  })
})

describe("CircuitBreaker configuration", () => {
  test("uses default config when none provided", () => {
    const breaker = new CircuitBreaker("default-breaker")
    const stats = breaker.getStats()
    expect(stats.state).toBe(CircuitState.CLOSED)
  })

  test("accepts partial config", () => {
    const breaker = new CircuitBreaker("partial-breaker", {
      failureThreshold: 75,
    })
    expect(breaker.getState()).toBe(CircuitState.CLOSED)
  })
})

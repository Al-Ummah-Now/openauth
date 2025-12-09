import { describe, test, expect } from "bun:test"
import {
  D1Error,
  D1TransientError,
  D1PermanentError,
  D1NotFoundError,
  classifyD1Error,
  withRetry,
  checkD1Result,
} from "./d1-errors.js"
import { ClientNotFoundError, ClientNameConflictError } from "./errors.js"

describe("D1 Error Classes", () => {
  describe("D1Error", () => {
    test("sets name and operation", () => {
      const error = new D1Error("test message", "testOp")
      expect(error.name).toBe("D1Error")
      expect(error.operation).toBe("testOp")
      expect(error.isTransient).toBe(false)
    })
  })

  describe("D1TransientError", () => {
    test("is transient", () => {
      const error = new D1TransientError("network error", "fetch")
      expect(error.isTransient).toBe(true)
      expect(error.name).toBe("D1TransientError")
    })

    test("preserves cause", () => {
      const cause = new Error("original")
      const error = new D1TransientError("wrapped", "op", cause)
      expect(error.cause).toBe(cause)
    })
  })

  describe("D1PermanentError", () => {
    test("is not transient", () => {
      const error = new D1PermanentError("constraint violation", "insert")
      expect(error.isTransient).toBe(false)
      expect(error.name).toBe("D1PermanentError")
    })
  })

  describe("D1NotFoundError", () => {
    test("is not transient", () => {
      const error = new D1NotFoundError("not found", "get")
      expect(error.isTransient).toBe(false)
      expect(error.name).toBe("D1NotFoundError")
    })
  })
})

describe("classifyD1Error", () => {
  test("returns D1Error unchanged", () => {
    const original = new D1TransientError("test", "op")
    const result = classifyD1Error(original, "newOp")
    expect(result).toBe(original)
  })

  test("classifies timeout as transient", () => {
    const error = new Error("Connection timeout")
    const result = classifyD1Error(error, "query")
    expect(result).toBeInstanceOf(D1TransientError)
  })

  test("classifies network errors as transient", () => {
    const error = new Error("Network unavailable")
    const result = classifyD1Error(error, "query")
    expect(result).toBeInstanceOf(D1TransientError)
  })

  test("classifies connection errors as transient", () => {
    const error = new Error("ECONNREFUSED")
    const result = classifyD1Error(error, "query")
    expect(result).toBeInstanceOf(D1TransientError)
  })

  test("classifies too many requests as transient", () => {
    const error = new Error("Too many requests")
    const result = classifyD1Error(error, "query")
    expect(result).toBeInstanceOf(D1TransientError)
  })

  test("classifies not found as D1NotFoundError", () => {
    const error = new Error("Resource not found")
    const result = classifyD1Error(error, "get")
    expect(result).toBeInstanceOf(D1NotFoundError)
  })

  test("classifies constraint violation as permanent", () => {
    const error = new Error("UNIQUE constraint failed")
    const result = classifyD1Error(error, "insert")
    expect(result).toBeInstanceOf(D1PermanentError)
  })

  test("classifies syntax error as permanent", () => {
    const error = new Error("SQL syntax error near SELECT")
    const result = classifyD1Error(error, "query")
    expect(result).toBeInstanceOf(D1PermanentError)
  })

  test("classifies unknown errors as transient (safe default)", () => {
    const error = new Error("Something weird happened")
    const result = classifyD1Error(error, "unknown")
    expect(result).toBeInstanceOf(D1TransientError)
  })

  test("handles non-Error objects", () => {
    const result = classifyD1Error("string error", "op")
    expect(result).toBeInstanceOf(D1TransientError)
    expect(result.message).toContain("string error")
  })
})

describe("withRetry", () => {
  test("returns successful result immediately", async () => {
    let attempts = 0
    const result = await withRetry("test", async () => {
      attempts++
      return "success"
    })

    expect(result).toBe("success")
    expect(attempts).toBe(1)
  })

  test("retries transient errors", async () => {
    let attempts = 0
    const result = await withRetry(
      "test",
      async () => {
        attempts++
        if (attempts < 3) {
          throw new Error("Network timeout")
        }
        return "success"
      },
      { maxAttempts: 3, initialDelayMs: 1 },
    )

    expect(result).toBe("success")
    expect(attempts).toBe(3)
  })

  test("does not retry permanent errors", async () => {
    let attempts = 0
    await expect(
      withRetry(
        "test",
        async () => {
          attempts++
          throw new Error("UNIQUE constraint failed")
        },
        { maxAttempts: 3 },
      ),
    ).rejects.toThrow(D1PermanentError)

    expect(attempts).toBe(1)
  })

  test("does not retry not-found errors", async () => {
    let attempts = 0
    await expect(
      withRetry(
        "test",
        async () => {
          attempts++
          throw new Error("Resource not found")
        },
        { maxAttempts: 3 },
      ),
    ).rejects.toThrow(D1NotFoundError)

    expect(attempts).toBe(1)
  })

  test("throws after max attempts exhausted", async () => {
    let attempts = 0
    await expect(
      withRetry(
        "test",
        async () => {
          attempts++
          throw new Error("Network timeout")
        },
        { maxAttempts: 3, initialDelayMs: 1 },
      ),
    ).rejects.toThrow(D1TransientError)

    expect(attempts).toBe(3)
  })

  test("preserves domain errors without wrapping", async () => {
    await expect(
      withRetry("test", async () => {
        throw new ClientNotFoundError("client-123")
      }),
    ).rejects.toThrow(ClientNotFoundError)
  })

  test("preserves ClientNameConflictError", async () => {
    await expect(
      withRetry("test", async () => {
        throw new ClientNameConflictError("My App")
      }),
    ).rejects.toThrow(ClientNameConflictError)
  })
})

describe("checkD1Result", () => {
  test("passes for successful result", () => {
    expect(() => checkD1Result({ success: true }, "insert")).not.toThrow()
  })

  test("throws for failed result", () => {
    expect(() => checkD1Result({ success: false }, "insert")).toThrow(
      D1PermanentError,
    )
  })

  test("throws not found when expecting changes but none made", () => {
    expect(() =>
      checkD1Result({ success: true, meta: { changes: 0 } }, "update", true),
    ).toThrow(D1NotFoundError)
  })

  test("passes when expecting changes and changes made", () => {
    expect(() =>
      checkD1Result({ success: true, meta: { changes: 1 } }, "update", true),
    ).not.toThrow()
  })
})

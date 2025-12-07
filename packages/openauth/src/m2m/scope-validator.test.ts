import { describe, test, expect } from "bun:test"
import { parseScopes, validateScopes } from "./scope-validator.js"

describe("parseScopes", () => {
  test("returns empty array for undefined", () => {
    const result = parseScopes(undefined)
    expect(result).toEqual([])
  })

  test("returns empty array for empty string", () => {
    const result = parseScopes("")
    expect(result).toEqual([])
  })

  test("parses single scope", () => {
    const result = parseScopes("read")
    expect(result).toEqual(["read"])
  })

  test("parses multiple scopes", () => {
    const result = parseScopes("read write")
    expect(result).toEqual(["read", "write"])
  })

  test("parses scopes with extra spaces", () => {
    const result = parseScopes("  read   write   delete  ")
    expect(result).toEqual(["read", "write", "delete"])
  })

  test("handles scopes with multiple consecutive spaces", () => {
    const result = parseScopes("read    write     delete")
    expect(result).toEqual(["read", "write", "delete"])
  })

  test("preserves scope order", () => {
    const result = parseScopes("admin read write delete")
    expect(result).toEqual(["admin", "read", "write", "delete"])
  })

  test("handles complex scope names", () => {
    const result = parseScopes("user:read user:write admin:delete")
    expect(result).toEqual(["user:read", "user:write", "admin:delete"])
  })
})

describe("validateScopes", () => {
  describe("when no scopes requested", () => {
    test("grants all allowed scopes", () => {
      const result = validateScopes([], ["read", "write", "delete"])
      expect(result).toEqual({
        valid: true,
        granted: ["read", "write", "delete"],
        denied: [],
      })
    })

    test("grants empty array when no allowed scopes", () => {
      const result = validateScopes([], [])
      expect(result).toEqual({
        valid: true,
        granted: [],
        denied: [],
      })
    })
  })

  describe("when valid scopes requested", () => {
    test("grants all requested scopes when they are allowed", () => {
      const result = validateScopes(["read", "write"], ["read", "write", "delete"])
      expect(result).toEqual({
        valid: true,
        granted: ["read", "write"],
        denied: [],
      })
    })

    test("grants single requested scope", () => {
      const result = validateScopes(["read"], ["read", "write"])
      expect(result).toEqual({
        valid: true,
        granted: ["read"],
        denied: [],
      })
    })

    test("grants exact match when requested equals allowed", () => {
      const result = validateScopes(["read", "write"], ["read", "write"])
      expect(result).toEqual({
        valid: true,
        granted: ["read", "write"],
        denied: [],
      })
    })
  })

  describe("when invalid scopes requested", () => {
    test("denies all scopes when none are allowed", () => {
      const result = validateScopes(["read", "write"], [])
      expect(result).toEqual({
        valid: false,
        granted: [],
        denied: ["read", "write"],
      })
    })

    test("denies unauthorized scope", () => {
      const result = validateScopes(["admin"], ["read", "write"])
      expect(result).toEqual({
        valid: false,
        granted: [],
        denied: ["admin"],
      })
    })

    test("denies multiple unauthorized scopes", () => {
      const result = validateScopes(["admin", "delete"], ["read", "write"])
      expect(result).toEqual({
        valid: false,
        granted: [],
        denied: ["admin", "delete"],
      })
    })
  })

  describe("when mixed valid and invalid scopes requested", () => {
    test("grants valid and denies invalid scopes", () => {
      const result = validateScopes(
        ["read", "admin", "write"],
        ["read", "write", "delete"]
      )
      expect(result).toEqual({
        valid: false,
        granted: ["read", "write"],
        denied: ["admin"],
      })
    })

    test("preserves request order in granted scopes", () => {
      const result = validateScopes(
        ["write", "read", "delete"],
        ["read", "write", "delete"]
      )
      expect(result).toEqual({
        valid: true,
        granted: ["write", "read", "delete"],
        denied: [],
      })
    })

    test("preserves request order in denied scopes", () => {
      const result = validateScopes(
        ["admin", "read", "superuser"],
        ["read", "write"]
      )
      expect(result).toEqual({
        valid: false,
        granted: ["read"],
        denied: ["admin", "superuser"],
      })
    })
  })

  describe("edge cases", () => {
    test("handles duplicate requested scopes", () => {
      const result = validateScopes(["read", "read", "write"], ["read", "write"])
      expect(result).toEqual({
        valid: true,
        granted: ["read", "read", "write"],
        denied: [],
      })
    })

    test("handles duplicate denied scopes", () => {
      const result = validateScopes(["admin", "admin"], ["read"])
      expect(result).toEqual({
        valid: false,
        granted: [],
        denied: ["admin", "admin"],
      })
    })

    test("handles case-sensitive scope matching", () => {
      const result = validateScopes(["Read"], ["read", "write"])
      expect(result).toEqual({
        valid: false,
        granted: [],
        denied: ["Read"],
      })
    })

    test("handles complex scope names", () => {
      const result = validateScopes(
        ["user:read", "user:write"],
        ["user:read", "user:write", "admin:delete"]
      )
      expect(result).toEqual({
        valid: true,
        granted: ["user:read", "user:write"],
        denied: [],
      })
    })
  })
})

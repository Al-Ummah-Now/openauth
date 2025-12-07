import { describe, test, expect } from "bun:test"
import { hasScope, hasAllScopes, hasAnyScope } from "./require-scope.js"

describe("hasScope", () => {
  test("returns true for exact scope match", () => {
    expect(hasScope(["users:read"], "users:read")).toBe(true)
    expect(hasScope(["users:read", "users:write"], "users:write")).toBe(true)
  })

  test("returns false when scope not present", () => {
    expect(hasScope(["users:read"], "users:write")).toBe(false)
    expect(hasScope([], "users:read")).toBe(false)
  })

  test("supports wildcard matching with resource prefix", () => {
    expect(hasScope(["users:*"], "users:read")).toBe(true)
    expect(hasScope(["users:*"], "users:write")).toBe(true)
    expect(hasScope(["users:*"], "users:delete")).toBe(true)
  })

  test("wildcard does not match different resource", () => {
    expect(hasScope(["users:*"], "posts:read")).toBe(false)
    expect(hasScope(["posts:*"], "users:read")).toBe(false)
  })

  test("supports wildcard matching for scopes without colon", () => {
    // Edge case: scope without colon splits into [scope, undefined]
    // admin:* matches "admin" because it extracts "admin" as resource
    expect(hasScope(["admin:*"], "admin")).toBe(true)
    expect(hasScope(["admin"], "admin")).toBe(true)
    expect(hasScope(["user:*"], "admin")).toBe(false)
  })

  test("admin:* grants all scopes", () => {
    expect(hasScope(["admin:*"], "users:read")).toBe(true)
    expect(hasScope(["admin:*"], "users:write")).toBe(true)
    expect(hasScope(["admin:*"], "posts:delete")).toBe(true)
    expect(hasScope(["admin:*"], "anything:action")).toBe(true)
  })

  test("* grants all scopes", () => {
    expect(hasScope(["*"], "users:read")).toBe(true)
    expect(hasScope(["*"], "users:write")).toBe(true)
    expect(hasScope(["*"], "posts:delete")).toBe(true)
    expect(hasScope(["*"], "anything:action")).toBe(true)
  })

  test("admin:* combined with other scopes", () => {
    expect(hasScope(["users:read", "admin:*"], "posts:write")).toBe(true)
    expect(hasScope(["admin:*", "users:read"], "anything:action")).toBe(true)
  })

  test("* combined with other scopes", () => {
    expect(hasScope(["users:read", "*"], "posts:write")).toBe(true)
    expect(hasScope(["*", "users:read"], "anything:action")).toBe(true)
  })

  test("checks exact match before wildcard", () => {
    expect(hasScope(["users:read"], "users:read")).toBe(true)
    expect(hasScope(["users:*", "users:read"], "users:read")).toBe(true)
  })

  test("handles multiple colons in scope", () => {
    expect(hasScope(["api:v1:users:*"], "api:v1:users:read")).toBe(false) // Only matches first segment
    expect(hasScope(["api:v1:users:read"], "api:v1:users:read")).toBe(true)
  })

  test("handles empty granted scopes array", () => {
    expect(hasScope([], "users:read")).toBe(false)
  })

  test("handles required scope without colon", () => {
    expect(hasScope(["read"], "read")).toBe(true)
    expect(hasScope(["write"], "read")).toBe(false)
  })
})

describe("hasAllScopes", () => {
  test("returns true when all required scopes are present", () => {
    expect(hasAllScopes(["users:read", "users:write"], ["users:read"])).toBe(
      true,
    )
    expect(
      hasAllScopes(
        ["users:read", "users:write", "posts:read"],
        ["users:read", "posts:read"],
      ),
    ).toBe(true)
  })

  test("returns false when any required scope is missing", () => {
    expect(
      hasAllScopes(["users:read"], ["users:read", "users:write"]),
    ).toBe(false)
    expect(hasAllScopes(["users:read"], ["users:write"])).toBe(false)
  })

  test("returns true for empty required scopes", () => {
    expect(hasAllScopes(["users:read"], [])).toBe(true)
    expect(hasAllScopes([], [])).toBe(true)
  })

  test("works with wildcard scopes", () => {
    expect(hasAllScopes(["users:*"], ["users:read", "users:write"])).toBe(true)
    expect(
      hasAllScopes(["users:*", "posts:*"], ["users:read", "posts:delete"]),
    ).toBe(true)
  })

  test("admin:* grants all required scopes", () => {
    expect(
      hasAllScopes(["admin:*"], ["users:read", "users:write", "posts:delete"]),
    ).toBe(true)
  })

  test("* grants all required scopes", () => {
    expect(
      hasAllScopes(["*"], ["users:read", "users:write", "posts:delete"]),
    ).toBe(true)
  })

  test("partial wildcard match returns false", () => {
    expect(
      hasAllScopes(["users:*"], ["users:read", "posts:write"]),
    ).toBe(false)
  })

  test("combination of exact and wildcard scopes", () => {
    expect(
      hasAllScopes(
        ["users:read", "posts:*"],
        ["users:read", "posts:write", "posts:delete"],
      ),
    ).toBe(true)
  })
})

describe("hasAnyScope", () => {
  test("returns true when at least one required scope is present", () => {
    expect(
      hasAnyScope(["users:read"], ["users:read", "users:write"]),
    ).toBe(true)
    expect(
      hasAnyScope(["users:write"], ["users:read", "users:write"]),
    ).toBe(true)
  })

  test("returns false when no required scopes are present", () => {
    expect(hasAnyScope(["users:read"], ["users:write", "posts:read"])).toBe(
      false,
    )
    expect(hasAnyScope([], ["users:read"])).toBe(false)
  })

  test("returns false for empty required scopes", () => {
    expect(hasAnyScope(["users:read"], [])).toBe(false)
    expect(hasAnyScope([], [])).toBe(false)
  })

  test("works with wildcard scopes", () => {
    expect(hasAnyScope(["users:*"], ["users:read", "posts:write"])).toBe(true)
    expect(hasAnyScope(["posts:*"], ["users:read", "posts:write"])).toBe(true)
  })

  test("admin:* matches any required scope", () => {
    expect(hasAnyScope(["admin:*"], ["users:read", "posts:write"])).toBe(true)
  })

  test("* matches any required scope", () => {
    expect(hasAnyScope(["*"], ["users:read", "posts:write"])).toBe(true)
  })

  test("returns true when first scope matches", () => {
    expect(
      hasAnyScope(
        ["users:read", "posts:read"],
        ["users:read", "users:write"],
      ),
    ).toBe(true)
  })

  test("returns true when last scope matches", () => {
    expect(
      hasAnyScope(["users:read", "posts:read"], ["posts:write", "posts:read"]),
    ).toBe(true)
  })

  test("returns true when middle scope matches", () => {
    expect(
      hasAnyScope(
        ["users:read", "posts:read", "comments:read"],
        ["posts:read"],
      ),
    ).toBe(true)
  })
})

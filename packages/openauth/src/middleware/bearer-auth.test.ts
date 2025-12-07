import { describe, test, expect } from "bun:test"
import { extractBearerToken } from "./bearer-auth.js"

describe("extractBearerToken", () => {
  test("extracts token from valid Bearer header", () => {
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    const authHeader = `Bearer ${token}`

    expect(extractBearerToken(authHeader)).toBe(token)
  })

  test("extracts token with case-insensitive Bearer prefix", () => {
    const token = "test.token.here"

    expect(extractBearerToken(`Bearer ${token}`)).toBe(token)
    expect(extractBearerToken(`bearer ${token}`)).toBe(token)
    expect(extractBearerToken(`BEARER ${token}`)).toBe(token)
    expect(extractBearerToken(`BeArEr ${token}`)).toBe(token)
  })

  test("returns null for undefined header", () => {
    expect(extractBearerToken(undefined)).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(extractBearerToken("")).toBeNull()
  })

  test("returns null for header without Bearer prefix", () => {
    expect(extractBearerToken("some-token")).toBeNull()
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull()
  })

  test("returns null for Bearer without token", () => {
    expect(extractBearerToken("Bearer")).toBeNull()
    expect(extractBearerToken("Bearer ")).toBeNull()
  })

  test("extracts token with multiple spaces after Bearer", () => {
    const token = "test.token"
    expect(extractBearerToken(`Bearer  ${token}`)).toBe(token)
    expect(extractBearerToken(`Bearer   ${token}`)).toBe(token)
  })

  test("handles token with spaces in it", () => {
    // Note: The regex captures everything after "Bearer " as the token
    const authHeader = "Bearer token with spaces"
    expect(extractBearerToken(authHeader)).toBe("token with spaces")
  })

  test("handles token with special characters", () => {
    const token = "abc123-._~+/="
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token)
  })

  test("handles very long token", () => {
    const token = "a".repeat(1000)
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token)
  })

  test("returns null for malformed headers", () => {
    expect(extractBearerToken("BearerToken")).toBeNull()
    expect(extractBearerToken("Token Bearer")).toBeNull()
    expect(extractBearerToken("Basic Bearer token")).toBeNull()
  })

  test("extracts JWT-like tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    expect(extractBearerToken(`Bearer ${jwt}`)).toBe(jwt)
  })

  test("handles token starting immediately after space", () => {
    const token = "token123"
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token)
  })

  test("extracts single space as token when only spaces after Bearer", () => {
    // The regex \s+ is greedy but .+ also needs to match, so it leaves one space
    // This is edge case behavior - "Bearer    " extracts " " as the token
    expect(extractBearerToken("Bearer    ")).toBe(" ")
    expect(extractBearerToken("Bearer     ")).toBe(" ")
  })

  test("does not extract token with newlines", () => {
    // The .+ pattern doesn't match newlines, so this returns null
    const token = "token\nwith\nnewlines"
    expect(extractBearerToken(`Bearer ${token}`)).toBeNull()
  })

  test("handles Unicode characters in token", () => {
    const token = "token-with-emoji-🔒"
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token)
  })

  test("returns null for null input", () => {
    expect(extractBearerToken(null as any)).toBeNull()
  })

  test("extracts complete token without truncation", () => {
    const token = "short"
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token)
    expect(extractBearerToken(`Bearer ${token}`)).not.toBe("shor")
  })
})

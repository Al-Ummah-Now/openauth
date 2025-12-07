import { describe, test, expect } from "bun:test"
import {
  validateClientName,
  validateGrantTypes,
  validateScopes,
  validateRedirectUris,
  validateMetadata,
} from "./validation.js"
import {
  InvalidGrantTypeError,
  InvalidScopeFormatError,
  InvalidRedirectUriError,
} from "./errors.js"

describe("validateClientName", () => {
  test("accepts valid names", () => {
    expect(() => validateClientName("My App")).not.toThrow()
    expect(() => validateClientName("my-app")).not.toThrow()
    expect(() => validateClientName("my_app")).not.toThrow()
    expect(() => validateClientName("MyApp123")).not.toThrow()
  })

  test("rejects empty name", () => {
    expect(() => validateClientName("")).toThrow("Client name is required")
  })

  test("rejects name that is too long", () => {
    const longName = "a".repeat(101)
    expect(() => validateClientName(longName)).toThrow(
      "Client name must be 100 characters or less",
    )
  })

  test("rejects invalid characters", () => {
    expect(() => validateClientName("my@app")).toThrow()
    expect(() => validateClientName("my!app")).toThrow()
  })
})

describe("validateGrantTypes", () => {
  test("accepts valid grant types", () => {
    expect(() => validateGrantTypes(["client_credentials"])).not.toThrow()
    expect(() => validateGrantTypes(["authorization_code"])).not.toThrow()
    expect(() => validateGrantTypes(["refresh_token"])).not.toThrow()
    expect(() =>
      validateGrantTypes([
        "client_credentials",
        "authorization_code",
        "refresh_token",
      ]),
    ).not.toThrow()
  })

  test("rejects invalid grant types", () => {
    expect(() => validateGrantTypes(["password"])).toThrow(InvalidGrantTypeError)
    expect(() => validateGrantTypes(["implicit"])).toThrow(InvalidGrantTypeError)
    expect(() => validateGrantTypes(["invalid"])).toThrow(InvalidGrantTypeError)
  })

  test("rejects non-array", () => {
    expect(() => validateGrantTypes("client_credentials" as any)).toThrow(
      "grant_types must be an array",
    )
  })
})

describe("validateScopes", () => {
  test("accepts valid scopes", () => {
    expect(() => validateScopes(["read", "write"])).not.toThrow()
    expect(() => validateScopes(["users:read", "users:write"])).not.toThrow()
    expect(() => validateScopes(["api.users.read"])).not.toThrow()
    expect(() => validateScopes(["scope-with-dash"])).not.toThrow()
    expect(() => validateScopes(["scope_with_underscore"])).not.toThrow()
  })

  test("rejects invalid scope format", () => {
    expect(() => validateScopes(["scope with space"])).toThrow(
      InvalidScopeFormatError,
    )
    expect(() => validateScopes(["scope@invalid"])).toThrow(
      InvalidScopeFormatError,
    )
  })

  test("rejects too many scopes", () => {
    const manyScopes = Array.from({ length: 51 }, (_, i) => `scope${i}`)
    expect(() => validateScopes(manyScopes)).toThrow("Maximum 50 scopes allowed")
  })

  test("rejects non-array", () => {
    expect(() => validateScopes("read" as any)).toThrow(
      "scopes must be an array",
    )
  })
})

describe("validateRedirectUris", () => {
  test("accepts valid HTTPS URIs", () => {
    expect(() =>
      validateRedirectUris(["https://example.com/callback"]),
    ).not.toThrow()
    expect(() =>
      validateRedirectUris(["https://app.example.com/oauth/callback"]),
    ).not.toThrow()
  })

  test("accepts localhost HTTP for development", () => {
    expect(() =>
      validateRedirectUris(["http://localhost:3000/callback"]),
    ).not.toThrow()
    expect(() =>
      validateRedirectUris(["http://127.0.0.1:3000/callback"]),
    ).not.toThrow()
  })

  test("rejects non-localhost HTTP", () => {
    expect(() =>
      validateRedirectUris(["http://example.com/callback"]),
    ).toThrow(InvalidRedirectUriError)
  })

  test("rejects invalid URIs", () => {
    expect(() => validateRedirectUris(["not-a-url"])).toThrow(
      InvalidRedirectUriError,
    )
    expect(() => validateRedirectUris(["ftp://example.com"])).toThrow(
      InvalidRedirectUriError,
    )
  })

  test("rejects too many redirect URIs", () => {
    const manyUris = Array.from(
      { length: 11 },
      (_, i) => `https://example${i}.com/callback`,
    )
    expect(() => validateRedirectUris(manyUris)).toThrow(
      "Maximum 10 redirect URIs allowed",
    )
  })

  test("rejects non-array", () => {
    expect(() =>
      validateRedirectUris("https://example.com" as any),
    ).toThrow("redirect_uris must be an array")
  })
})

describe("validateMetadata", () => {
  test("accepts valid metadata", () => {
    expect(() => validateMetadata({})).not.toThrow()
    expect(() =>
      validateMetadata({ key: "value", nested: { a: 1 } }),
    ).not.toThrow()
  })

  test("rejects non-object", () => {
    expect(() => validateMetadata(null as any)).toThrow(
      "metadata must be an object",
    )
    expect(() => validateMetadata("string" as any)).toThrow(
      "metadata must be an object",
    )
    expect(() => validateMetadata(123 as any)).toThrow(
      "metadata must be an object",
    )
  })

  test("rejects metadata that is too large", () => {
    const largeMetadata = { data: "x".repeat(10001) }
    expect(() => validateMetadata(largeMetadata)).toThrow(
      "metadata must be less than 10KB",
    )
  })
})

import { describe, test, expect, beforeAll, afterEach } from "bun:test"
import { Hono } from "hono"
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  type JWK,
  type JSONWebKeySet,
} from "jose"
import {
  extractBearerToken,
  bearerAuth,
  clearJWKSCache,
} from "./bearer-auth.js"
import { AuthError, MissingTokenError, InvalidTokenError } from "./errors.js"

/**
 * Helper to add error handler to Hono apps for testing
 */
function addErrorHandler(app: Hono) {
  app.onError((error, c) => {
    if (error instanceof AuthError) {
      return c.json({ error: error.message, code: error.code }, error.status)
    }
    return c.json({ error: "Internal Server Error" }, 500)
  })
  return app
}

describe("extractBearerToken", () => {
  test("extracts token from valid Bearer header", () => {
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
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
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
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

describe("bearerAuth middleware", () => {
  let keyPair1: { privateKey: CryptoKey; publicKey: CryptoKey }
  let keyPair2: { privateKey: CryptoKey; publicKey: CryptoKey }
  let jwk1: JWK
  let jwk2: JWK
  const issuer = "https://auth.example.com"

  beforeAll(async () => {
    // Generate two key pairs for testing key rotation
    keyPair1 = await generateKeyPair("RS256")
    keyPair2 = await generateKeyPair("RS256")

    // Export as JWK
    jwk1 = await exportJWK(keyPair1.publicKey)
    jwk1.kid = "key-1"
    jwk1.alg = "RS256"
    jwk1.use = "sig"

    jwk2 = await exportJWK(keyPair2.publicKey)
    jwk2.kid = "key-2"
    jwk2.alg = "RS256"
    jwk2.use = "sig"
  })

  afterEach(() => {
    clearJWKSCache()
  })

  async function createToken(
    privateKey: CryptoKey,
    kid: string,
    claims: Record<string, unknown> = {},
  ): Promise<string> {
    return new SignJWT({
      sub: "test-user",
      mode: "m2m",
      client_id: "test-client",
      scope: "read write",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey)
  }

  describe("with getPublicKey (legacy mode)", () => {
    test("verifies token with single key", async () => {
      const app = new Hono()
      app.use(
        "*",
        bearerAuth({
          getPublicKey: async () => keyPair1.publicKey,
          issuer,
        }),
      )
      app.get("/test", (c) =>
        c.json({ success: true, tenantId: c.get("tenantId") }),
      )

      const token = await createToken(keyPair1.privateKey, "key-1")
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    test("rejects token with wrong key", async () => {
      const app = addErrorHandler(new Hono())
      app.use(
        "*",
        bearerAuth({
          getPublicKey: async () => keyPair2.publicKey, // Different key
          issuer,
        }),
      )
      app.get("/test", (c) => c.json({ success: true }))

      const token = await createToken(keyPair1.privateKey, "key-1")
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      })

      // Should fail - wrong key
      expect(res.status).toBe(401)
    })
  })

  describe("with jwks (local JWKS)", () => {
    test("verifies token using correct key from JWKS", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1, jwk2] }

      const app = new Hono()
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) =>
        c.json({
          success: true,
          clientId: c.get("clientId"),
          scopes: c.get("scopes"),
        }),
      )

      // Token signed with key-1
      const token1 = await createToken(keyPair1.privateKey, "key-1")
      const res1 = await app.request("/test", {
        headers: { Authorization: `Bearer ${token1}` },
      })

      expect(res1.status).toBe(200)
      const body1 = await res1.json()
      expect(body1.success).toBe(true)
      expect(body1.clientId).toBe("test-client")
      expect(body1.scopes).toEqual(["read", "write"])
    })

    test("verifies token with different key from same JWKS", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1, jwk2] }

      const app = new Hono()
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) => c.json({ success: true }))

      // Token signed with key-2
      const token2 = await createToken(keyPair2.privateKey, "key-2")
      const res2 = await app.request("/test", {
        headers: { Authorization: `Bearer ${token2}` },
      })

      expect(res2.status).toBe(200)
    })

    test("supports key rotation - both old and new keys work", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1, jwk2] }

      const app = new Hono()
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) => c.json({ success: true }))

      // Old token (key-1)
      const oldToken = await createToken(keyPair1.privateKey, "key-1")
      const res1 = await app.request("/test", {
        headers: { Authorization: `Bearer ${oldToken}` },
      })
      expect(res1.status).toBe(200)

      // New token (key-2)
      const newToken = await createToken(keyPair2.privateKey, "key-2")
      const res2 = await app.request("/test", {
        headers: { Authorization: `Bearer ${newToken}` },
      })
      expect(res2.status).toBe(200)
    })

    test("rejects token with unknown kid", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] } // Only key-1

      const app = addErrorHandler(new Hono())
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) => c.json({ success: true }))

      // Token signed with key-2 (not in JWKS)
      const token = await createToken(keyPair2.privateKey, "key-2")
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
    })

    test("rejects token with wrong issuer", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = addErrorHandler(new Hono())
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) => c.json({ success: true }))

      // Token with different issuer
      const token = await new SignJWT({
        sub: "test-user",
        mode: "m2m",
        client_id: "test-client",
        scope: "read",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
        .setIssuer("https://wrong.example.com")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(keyPair1.privateKey)

      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
    })

    test("validates audience when specified", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = addErrorHandler(new Hono())
      app.use("*", bearerAuth({ jwks, issuer, audience: "api.example.com" }))
      app.get("/test", (c) => c.json({ success: true }))

      // Token with correct audience
      const validToken = await new SignJWT({
        sub: "test-user",
        mode: "m2m",
        client_id: "test-client",
        scope: "read",
        aud: "api.example.com",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(keyPair1.privateKey)

      const res1 = await app.request("/test", {
        headers: { Authorization: `Bearer ${validToken}` },
      })
      expect(res1.status).toBe(200)

      // Token with wrong audience
      const invalidToken = await new SignJWT({
        sub: "test-user",
        mode: "m2m",
        client_id: "test-client",
        scope: "read",
        aud: "wrong.example.com",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(keyPair1.privateKey)

      const res2 = await app.request("/test", {
        headers: { Authorization: `Bearer ${invalidToken}` },
      })
      expect(res2.status).toBe(401)
    })
  })

  describe("requireM2M option", () => {
    test("accepts M2M token when requireM2M is true", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = new Hono()
      app.use("*", bearerAuth({ jwks, issuer, requireM2M: true }))
      app.get("/test", (c) => c.json({ success: true }))

      const token = await createToken(keyPair1.privateKey, "key-1")
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
    })

    test("rejects non-M2M token when requireM2M is true", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = addErrorHandler(new Hono())
      app.use("*", bearerAuth({ jwks, issuer, requireM2M: true }))
      app.get("/test", (c) => c.json({ success: true }))

      // User token (not M2M)
      const userToken = await new SignJWT({
        sub: "user-123",
        mode: "user",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(keyPair1.privateKey)

      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${userToken}` },
      })

      expect(res.status).toBe(401)
    })
  })

  describe("error handling", () => {
    test("returns 401 for missing Authorization header", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = addErrorHandler(new Hono())
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) => c.json({ success: true }))

      const res = await app.request("/test")
      expect(res.status).toBe(401)
    })

    test("returns 401 for invalid token format", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = addErrorHandler(new Hono())
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) => c.json({ success: true }))

      const res = await app.request("/test", {
        headers: { Authorization: "Bearer not-a-valid-jwt" },
      })

      expect(res.status).toBe(401)
    })

    test("returns 401 for expired token", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = addErrorHandler(new Hono())
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) => c.json({ success: true }))

      // Create expired token
      const expiredToken = await new SignJWT({
        sub: "test-user",
        mode: "m2m",
        client_id: "test-client",
        scope: "read",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
        .setIssuer(issuer)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .sign(keyPair1.privateKey)

      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${expiredToken}` },
      })

      expect(res.status).toBe(401)
    })
  })

  describe("context variables", () => {
    test("sets token, tenantId, clientId, and scopes for M2M token", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = new Hono()
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) =>
        c.json({
          tenantId: c.get("tenantId"),
          clientId: c.get("clientId"),
          scopes: c.get("scopes"),
          hasToken: !!c.get("token"),
        }),
      )

      const token = await new SignJWT({
        sub: "test-client",
        mode: "m2m",
        client_id: "my-client",
        scope: "api:read api:write",
        tenant_id: "tenant-123",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(keyPair1.privateKey)

      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.tenantId).toBe("tenant-123")
      expect(body.clientId).toBe("my-client")
      expect(body.scopes).toEqual(["api:read", "api:write"])
      expect(body.hasToken).toBe(true)
    })

    test("sets default tenantId when not in token", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = new Hono()
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) => c.json({ tenantId: c.get("tenantId") }))

      const token = await createToken(keyPair1.privateKey, "key-1")
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      })

      const body = await res.json()
      expect(body.tenantId).toBe("default")
    })

    test("sets context for user token", async () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      const app = new Hono()
      app.use("*", bearerAuth({ jwks, issuer }))
      app.get("/test", (c) =>
        c.json({
          tenantId: c.get("tenantId"),
          clientId: c.get("clientId"),
          scopes: c.get("scopes"),
        }),
      )

      const userToken = await new SignJWT({
        sub: "user-123",
        mode: "user",
        tenant_id: "tenant-abc",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(keyPair1.privateKey)

      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${userToken}` },
      })

      const body = await res.json()
      expect(body.tenantId).toBe("tenant-abc")
      expect(body.clientId).toBeUndefined()
      expect(body.scopes).toBeUndefined()
    })
  })

  describe("configuration validation", () => {
    test("throws error if no key source provided", () => {
      expect(() => {
        bearerAuth({ issuer })
      }).toThrow("bearerAuth requires one of: getPublicKey, jwksUrl, or jwks")
    })

    test("throws error if multiple key sources provided", () => {
      const jwks: JSONWebKeySet = { keys: [jwk1] }

      expect(() => {
        bearerAuth({
          getPublicKey: async () => keyPair1.publicKey,
          jwks,
          issuer,
        })
      }).toThrow(
        "bearerAuth accepts only one of: getPublicKey, jwksUrl, or jwks",
      )
    })
  })

  describe("clearJWKSCache", () => {
    test("clears the cache", () => {
      // This is mainly to ensure the function exists and doesn't throw
      expect(() => clearJWKSCache()).not.toThrow()
    })
  })
})

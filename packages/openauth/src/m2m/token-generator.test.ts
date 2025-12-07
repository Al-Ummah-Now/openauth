import { describe, test, expect, beforeAll } from "bun:test"
import { generateKeyPair } from "jose"
import { jwtDecrypt } from "jose"
import { generateM2MToken } from "./token-generator.js"
import type { M2MTokenClaims } from "./types.js"

// Test key pair setup
let testSigningKey: {
  private: any
  alg: string
  id: string
}

beforeAll(async () => {
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  testSigningKey = {
    private: keyPair.privateKey,
    alg: "ES256",
    id: "test-key-id",
  }
})

// Helper to decode JWT without verification (for testing purposes)
async function decodeJWT(token: string): Promise<M2MTokenClaims> {
  const [_header, payloadB64] = token.split(".")
  const payload = Buffer.from(payloadB64, "base64url").toString("utf-8")
  return JSON.parse(payload)
}

describe("generateM2MToken", () => {
  describe("basic token generation", () => {
    test("generates valid JWT with correct structure", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read", "write"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      expect(result).toHaveProperty("access_token")
      expect(result).toHaveProperty("expires_in")
      expect(typeof result.access_token).toBe("string")
      expect(typeof result.expires_in).toBe("number")

      // JWT should have 3 parts
      const parts = result.access_token.split(".")
      expect(parts).toHaveLength(3)
    })

    test("generates unique tokens on each call", async () => {
      const result1 = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const result2 = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      expect(result1.access_token).not.toBe(result2.access_token)
    })
  })

  describe("token claims", () => {
    test("sets mode to 'm2m'", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.mode).toBe("m2m")
    })

    test("includes client_id in claims", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.client_id).toBe("client_test123")
    })

    test("sets sub to client_id", async () => {
      const result = await generateM2MToken({
        clientId: "client_myapp",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.sub).toBe("client_myapp")
      expect(claims.sub).toBe(claims.client_id)
    })

    test("includes scopes as space-separated string", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read", "write", "delete"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.scope).toBe("read write delete")
    })

    test("handles empty scopes array", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: [],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.scope).toBe("")
    })

    test("handles single scope", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["admin"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.scope).toBe("admin")
    })

    test("includes issuer claim", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.iss).toBe("https://auth.example.com")
    })

    test("includes unique jti for each token", async () => {
      const result1 = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const result2 = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims1 = await decodeJWT(result1.access_token)
      const claims2 = await decodeJWT(result2.access_token)

      expect(claims1.jti).toBeDefined()
      expect(claims2.jti).toBeDefined()
      expect(claims1.jti).not.toBe(claims2.jti)

      // JTI should be a valid UUID format
      expect(claims1.jti).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })
  })

  describe("timestamp claims", () => {
    test("includes iat (issued at) timestamp", async () => {
      const beforeTime = Math.floor(Date.now() / 1000)

      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const afterTime = Math.floor(Date.now() / 1000)
      const claims = await decodeJWT(result.access_token)

      expect(claims.iat).toBeGreaterThanOrEqual(beforeTime)
      expect(claims.iat).toBeLessThanOrEqual(afterTime)
    })

    test("includes exp (expiration) timestamp", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.exp).toBeDefined()
      expect(claims.exp).toBeGreaterThan(claims.iat)
    })

    test("default TTL is 1 hour (3600 seconds)", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.exp - claims.iat).toBe(3600)
      expect(result.expires_in).toBe(3600)
    })
  })

  describe("tenant_id handling", () => {
    test("includes tenant_id when provided", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        tenantId: "tenant_abc",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.tenant_id).toBe("tenant_abc")
    })

    test("omits tenant_id when not provided", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.tenant_id).toBeUndefined()
    })

    test("includes tenant_id when config.includeTenantId is true", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        tenantId: "tenant_xyz",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
        config: { includeTenantId: true },
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.tenant_id).toBe("tenant_xyz")
    })

    test("omits tenant_id when config.includeTenantId is false", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        tenantId: "tenant_xyz",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
        config: { includeTenantId: false },
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.tenant_id).toBeUndefined()
    })

    test("omits tenant_id when config.includeTenantId is false even if tenantId provided", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        tenantId: "tenant_should_not_appear",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
        config: { includeTenantId: false },
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.tenant_id).toBeUndefined()
    })
  })

  describe("custom TTL configuration", () => {
    test("respects custom TTL from config", async () => {
      const customTTL = 7200 // 2 hours
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
        config: { ttl: customTTL },
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.exp - claims.iat).toBe(customTTL)
      expect(result.expires_in).toBe(customTTL)
    })

    test("handles short TTL (5 minutes)", async () => {
      const customTTL = 300 // 5 minutes
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
        config: { ttl: customTTL },
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.exp - claims.iat).toBe(customTTL)
      expect(result.expires_in).toBe(customTTL)
    })

    test("handles long TTL (24 hours)", async () => {
      const customTTL = 86400 // 24 hours
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
        config: { ttl: customTTL },
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.exp - claims.iat).toBe(customTTL)
      expect(result.expires_in).toBe(customTTL)
    })

    test("respects TTL of 0 (immediate expiration)", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
        config: { ttl: 0 },
      })

      const claims = await decodeJWT(result.access_token)
      // ttl: 0 is a valid value and should be respected (nullish coalescing)
      expect(claims.exp - claims.iat).toBe(0)
      expect(result.expires_in).toBe(0)
    })
  })

  describe("JWT header", () => {
    test("includes correct algorithm in header", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const [headerB64] = result.access_token.split(".")
      const header = JSON.parse(Buffer.from(headerB64, "base64url").toString())

      expect(header.alg).toBe("ES256")
    })

    test("includes key ID in header", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const [headerB64] = result.access_token.split(".")
      const header = JSON.parse(Buffer.from(headerB64, "base64url").toString())

      expect(header.kid).toBe("test-key-id")
    })

    test("includes typ as JWT in header", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: ["read"],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const [headerB64] = result.access_token.split(".")
      const header = JSON.parse(Buffer.from(headerB64, "base64url").toString())

      expect(header.typ).toBe("JWT")
    })
  })

  describe("complex scenarios", () => {
    test("generates token with all optional parameters", async () => {
      const result = await generateM2MToken({
        clientId: "client_full_test",
        tenantId: "tenant_full",
        scopes: ["read", "write", "delete", "admin"],
        issuer: "https://auth.production.com",
        signingKey: testSigningKey,
        config: {
          ttl: 1800,
          includeTenantId: true,
        },
      })

      const claims = await decodeJWT(result.access_token)

      expect(claims.mode).toBe("m2m")
      expect(claims.client_id).toBe("client_full_test")
      expect(claims.sub).toBe("client_full_test")
      expect(claims.tenant_id).toBe("tenant_full")
      expect(claims.scope).toBe("read write delete admin")
      expect(claims.iss).toBe("https://auth.production.com")
      expect(claims.exp - claims.iat).toBe(1800)
      expect(claims.jti).toBeDefined()
      expect(result.expires_in).toBe(1800)
    })

    test("handles different client ID formats", async () => {
      const clientIds = [
        "client_abc123",
        "svc_myservice",
        "app_dashboard",
        "api_backend_v2",
      ]

      for (const clientId of clientIds) {
        const result = await generateM2MToken({
          clientId,
          scopes: ["read"],
          issuer: "https://auth.example.com",
          signingKey: testSigningKey,
        })

        const claims = await decodeJWT(result.access_token)
        expect(claims.client_id).toBe(clientId)
        expect(claims.sub).toBe(clientId)
      }
    })

    test("handles different issuer URLs", async () => {
      const issuers = [
        "https://auth.example.com",
        "https://login.myapp.io",
        "https://auth.example.com/tenant/123",
        "https://auth.example.com:8443",
      ]

      for (const issuer of issuers) {
        const result = await generateM2MToken({
          clientId: "client_test",
          scopes: ["read"],
          issuer,
          signingKey: testSigningKey,
        })

        const claims = await decodeJWT(result.access_token)
        expect(claims.iss).toBe(issuer)
      }
    })

    test("handles complex scope names", async () => {
      const result = await generateM2MToken({
        clientId: "client_test123",
        scopes: [
          "api:read",
          "api:write",
          "users:admin",
          "billing:manage",
          "reports:view",
        ],
        issuer: "https://auth.example.com",
        signingKey: testSigningKey,
      })

      const claims = await decodeJWT(result.access_token)
      expect(claims.scope).toBe(
        "api:read api:write users:admin billing:manage reports:view"
      )
    })
  })
})

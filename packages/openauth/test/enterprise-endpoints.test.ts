import {
  expect,
  test,
  describe,
  beforeEach,
  mock,
  spyOn,
  setSystemTime,
  afterEach,
} from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createClient } from "../src/client.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { createSubjects } from "../src/subject.js"
import { D1ClientAdapter } from "../src/client/d1-adapter.js"
import { ClientAuthenticator } from "../src/client/authenticator.js"
import { AuditService } from "../src/services/audit.js"

const subjects = createSubjects({
  user: object({
    userID: string(),
  }),
})

// Mock D1 database
const createMockD1 = () => {
  const mockClients = new Map<string, any>()

  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: mock(async () => {
          // Handle INSERT for client creation
          if (sql.includes("INSERT INTO oauth_clients")) {
            const [
              clientId,
              secretHash,
              name,
              redirectUris,
              grantTypes,
              scopes,
            ] = params
            mockClients.set(clientId, {
              client_id: clientId,
              client_secret_hash: secretHash,
              client_name: name,
              redirect_uris: redirectUris,
              grant_types: grantTypes,
              scopes: scopes,
              created_at: Date.now(),
            })
            return { success: true, meta: { changes: 1 } }
          }
          return { success: true, meta: { changes: 1 } }
        }),
        first: mock(async () => {
          // Handle SELECT for client lookup
          if (sql.includes("SELECT * FROM oauth_clients")) {
            const clientId = params[0]
            return mockClients.get(clientId) || null
          }
          return null
        }),
        all: mock(() => Promise.resolve({ results: [] })),
      }),
    }),
    _mockClients: mockClients,
  }
}

describe("Enterprise Endpoints", () => {
  let storage: ReturnType<typeof MemoryStorage>
  let mockClientDb: any
  let mockAuditDb: any
  let auth: any
  let client: ReturnType<typeof createClient>
  let authenticator: ClientAuthenticator
  let tokens: { access: string; refresh: string }

  beforeEach(async () => {
    setSystemTime(new Date("2024-01-01T00:00:00Z"))

    storage = MemoryStorage()
    mockClientDb = createMockD1()
    mockAuditDb = createMockD1()

    const adapter = new D1ClientAdapter({ database: mockClientDb })
    authenticator = new ClientAuthenticator({
      adapter,
      // Note: Must use default iterations to match issuer's authenticator
    })

    // Create a test client
    await authenticator.createClient(
      "test-client",
      "test-secret",
      "Test Client",
      {
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        scopes: ["openid", "profile"],
      },
    )

    auth = issuer({
      storage,
      subjects,
      clientDb: mockClientDb,
      audit: {
        service: new AuditService({ database: mockAuditDb }),
        hooks: {
          onTokenGenerated: true,
          onTokenRefreshed: true,
          onTokenRevoked: true,
          onTokenReused: true,
        },
      },
      allow: async () => true,
      success: async (ctx) => {
        return ctx.subject("user", {
          userID: "123",
        })
      },
      ttl: {
        access: 900, // 15 minutes
        refresh: 86400, // 1 day
      },
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", async (c) => {
              return ctx.success(c, {
                email: "foo@bar.com",
              })
            })
          },
        },
      },
    })

    const BASE_URL = "https://auth.example.com"
    client = createClient({
      issuer: BASE_URL,
      clientID: "test-client",
      fetch: (a, b) => Promise.resolve(auth.request(a, b)),
    })

    // Helper to make requests with full URL so issuer() returns consistent value
    const authRequest = (path: string, init?: RequestInit) =>
      auth.request(`${BASE_URL}${path}`, init)

    // Obtain tokens through authorization flow
    const [verifier, authorization] = await client.pkce(
      "http://localhost:3000/callback",
    )
    let response = await auth.request(authorization)
    response = await auth.request(response.headers.get("location")!, {
      headers: {
        cookie: response.headers.get("set-cookie")!,
      },
    })
    const location = new URL(response.headers.get("location")!)
    const code = location.searchParams.get("code")
    const exchanged = await client.exchange(
      code!,
      "http://localhost:3000/callback",
      verifier,
    )
    if (exchanged.err) throw exchanged.err
    tokens = exchanged.tokens
  })

  afterEach(() => {
    setSystemTime()
  })

  // Use full URL for requests to ensure issuer claim matches
  const BASE_URL = "https://auth.example.com"

  describe("Token Introspection Endpoint", () => {
    test("requires client authentication", async () => {
      const response = await auth.request(`${BASE_URL}/token/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: tokens.access,
        }),
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe("invalid_request")
    })

    test("accepts Basic auth credentials", async () => {
      const credentials = btoa("test-client:test-secret")

      const response = await auth.request(`${BASE_URL}/token/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.access,
        }),
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.active).toBe(true)
    })

    test("accepts form-based credentials", async () => {
      const response = await auth.request(`${BASE_URL}/token/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: tokens.access,
          client_id: "test-client",
          client_secret: "test-secret",
        }),
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.active).toBe(true)
    })

    test("rejects invalid client credentials", async () => {
      const credentials = btoa("test-client:wrong-secret")

      const response = await auth.request(`${BASE_URL}/token/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.access,
        }),
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe("invalid_client")
    })

    test("returns active=true for valid access token", async () => {
      const credentials = btoa("test-client:test-secret")

      const response = await auth.request(`${BASE_URL}/token/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.access,
        }),
      })

      const body = await response.json()

      expect(body).toMatchObject({
        active: true,
        token_type: "Bearer",
        client_id: "test-client",
      })
      expect(body.exp).toBeDefined()
      expect(body.sub).toBeDefined()
    })

    test("returns active=false for expired access token", async () => {
      const credentials = btoa("test-client:test-secret")

      // Advance time past token expiration
      setSystemTime(Date.now() + 1000 * 1000) // 1000 seconds (> 900s TTL)

      const response = await auth.request(`${BASE_URL}/token/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.access,
        }),
      })

      const body = await response.json()
      expect(body.active).toBe(false)
    })

    test("returns active=false for invalid token", async () => {
      const credentials = btoa("test-client:test-secret")

      const response = await auth.request(`${BASE_URL}/token/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: "invalid-token",
        }),
      })

      const body = await response.json()
      expect(body.active).toBe(false)
    })

    test("requires token parameter", async () => {
      const credentials = btoa("test-client:test-secret")

      const response = await auth.request(`${BASE_URL}/token/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({}),
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe("invalid_request")
    })
  })

  describe("Token Revocation Endpoint", () => {
    test("requires client_id for revocation (returns 400 when missing)", async () => {
      // Per RFC 7009: client_id is required to identify the client
      // Without client_id, we can't determine if it's a public or confidential client
      const response = await auth.request(`${BASE_URL}/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: tokens.refresh,
        }),
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe("invalid_request")
    })

    test("accepts Basic auth credentials", async () => {
      const credentials = btoa("test-client:test-secret")

      const response = await auth.request(`${BASE_URL}/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.refresh,
          token_type_hint: "refresh_token",
        }),
      })

      expect(response.status).toBe(200)
    })

    test("revokes refresh token successfully", async () => {
      const credentials = btoa("test-client:test-secret")

      // Revoke the refresh token
      const revokeResponse = await auth.request(`${BASE_URL}/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.refresh,
          token_type_hint: "refresh_token",
        }),
      })

      expect(revokeResponse.status).toBe(200)

      // Try to use the revoked refresh token
      const refreshResponse = await auth.request("/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh,
        }),
      })

      expect(refreshResponse.status).toBe(400)
      const body = await refreshResponse.json()
      expect(body.error).toBe("invalid_grant")
    })

    test("returns success even for non-existent token (RFC 7009)", async () => {
      const credentials = btoa("test-client:test-secret")

      const response = await auth.request(`${BASE_URL}/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: "non-existent-token",
          token_type_hint: "refresh_token",
        }),
      })

      // Per RFC 7009, always return success
      expect(response.status).toBe(200)
    })

    test("requires token parameter", async () => {
      const credentials = btoa("test-client:test-secret")

      const response = await auth.request(`${BASE_URL}/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({}),
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe("invalid_request")
    })

    test("rejects invalid client credentials", async () => {
      const credentials = btoa("test-client:wrong-secret")

      const response = await auth.request(`${BASE_URL}/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.refresh,
        }),
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe("invalid_client")
    })

    test("auto-detects token type from format", async () => {
      const credentials = btoa("test-client:test-secret")

      // Refresh tokens contain colon separator
      const isRefreshToken = tokens.refresh.includes(":")
      expect(isRefreshToken).toBe(true)

      // Should revoke even without token_type_hint
      const response = await auth.request(`${BASE_URL}/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.refresh,
        }),
      })

      expect(response.status).toBe(200)
    })
  })

  describe("Audit Hooks Integration", () => {
    test("logs token generation events", async () => {
      const logSpy = spyOn(mockAuditDb, "prepare")

      // Generate new tokens through authorization flow
      const [verifier, authorization] = await client.pkce(
        "http://localhost:3000/callback",
      )
      let response = await auth.request(authorization)
      response = await auth.request(response.headers.get("location")!, {
        headers: {
          cookie: response.headers.get("set-cookie")!,
        },
      })
      const location = new URL(response.headers.get("location")!)
      const code = location.searchParams.get("code")
      await client.exchange(code!, "http://localhost:3000/callback", verifier)

      // Verify audit log was called
      expect(logSpy).toHaveBeenCalled()
    })

    test("logs token refresh events", async () => {
      const logSpy = spyOn(mockAuditDb, "prepare")

      // Refresh the tokens
      await auth.request("/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh,
        }),
      })

      // Verify audit log was called for refresh
      expect(logSpy).toHaveBeenCalled()
    })

    test("logs token revocation events", async () => {
      const logSpy = spyOn(mockAuditDb, "prepare")
      const credentials = btoa("test-client:test-secret")

      // Revoke a token
      await auth.request(`${BASE_URL}/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: tokens.refresh,
          token_type_hint: "refresh_token",
        }),
      })

      // Verify audit log was called for revocation
      expect(logSpy).toHaveBeenCalled()
    })

    test("logs token reuse detection events", async () => {
      const logSpy = spyOn(mockAuditDb, "prepare")

      // Use refresh token once
      const firstRefresh = await auth.request("/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh,
        }),
      })

      expect(firstRefresh.status).toBe(200)

      // Advance time past reuse window
      setSystemTime(Date.now() + 70 * 1000) // 70 seconds > 60s reuse window

      // Try to reuse the same refresh token (should trigger reuse detection)
      await auth.request("/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh,
        }),
      })

      // Verify audit log was called for reuse detection
      expect(logSpy).toHaveBeenCalled()
    })
  })

  describe("CORS Configuration", () => {
    test("applies global CORS when configured", async () => {
      const corsAuth = issuer({
        storage: MemoryStorage(),
        subjects,
        cors: {
          origins: ["https://app.example.com"],
          credentials: true,
          methods: ["GET", "POST"],
          headers: ["Content-Type", "Authorization"],
          maxAge: 3600,
        },
        allow: async () => true,
        success: async (ctx) => {
          return ctx.subject("user", { userID: "123" })
        },
        providers: {
          dummy: {
            type: "dummy",
            init(route, ctx) {
              route.get("/authorize", async (c) => {
                return ctx.success(c, { email: "test@example.com" })
              })
            },
          },
        },
      })

      const response = await corsAuth.request("/.well-known/jwks.json", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "GET",
        },
      })

      // CORS headers should be present
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeTruthy()
    })
  })

  describe("Unsupported Operations", () => {
    test("returns 501 for introspection when clientDb not configured", async () => {
      const noClientAuth = issuer({
        storage: MemoryStorage(),
        subjects,
        allow: async () => true,
        success: async (ctx) => {
          return ctx.subject("user", { userID: "123" })
        },
        providers: {
          dummy: {
            type: "dummy",
            init(route, ctx) {
              route.get("/authorize", async (c) => {
                return ctx.success(c, { email: "test@example.com" })
              })
            },
          },
        },
      })

      const response = await noClientAuth.request("/token/introspect", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: "some-token",
        }),
      })

      expect(response.status).toBe(501)
      const body = await response.json()
      expect(body.error).toBe("unsupported_operation")
    })

    test("returns 501 for revocation when clientDb not configured", async () => {
      const noClientAuth = issuer({
        storage: MemoryStorage(),
        subjects,
        allow: async () => true,
        success: async (ctx) => {
          return ctx.subject("user", { userID: "123" })
        },
        providers: {
          dummy: {
            type: "dummy",
            init(route, ctx) {
              route.get("/authorize", async (c) => {
                return ctx.success(c, { email: "test@example.com" })
              })
            },
          },
        },
      })

      const response = await noClientAuth.request("/token/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: "some-token",
        }),
      })

      expect(response.status).toBe(501)
      const body = await response.json()
      expect(body.error).toBe("unsupported_operation")
    })
  })
})

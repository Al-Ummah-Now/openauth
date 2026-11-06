/**
 * Security hardening regression tests:
 * 1. Client auth: NULL secret hash / disabled clients rejected
 * 2. PKCE: S256 only, constant-time compare, optional require-for-public
 * 3. No raw error messages in error responses
 * 4. Discovery advertises the real signing alg
 * 5. Silent auth TTL units (seconds)
 * 6. Configured fixed issuer (ignores X-Forwarded-Host)
 * 7. refresh_token grant client_id binding
 */
import {
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
  setSystemTime,
  mock,
} from "bun:test"
import { object, string } from "valibot"
import { decodeJwt } from "jose"
import { issuer } from "../src/issuer.js"
import { createClient } from "../src/client.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage } from "../src/storage/storage.js"
import { validatePKCE, generatePKCE } from "../src/pkce.js"
import { ClientAuthenticator } from "../src/client/authenticator.js"
import { ClientD1Adapter } from "../src/client/client-d1-adapter.js"
import { hashClientSecret } from "../src/client/secret-generator.js"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSessionCookieHeader } from "../src/session/middleware.js"

const subjects = createSubjects({
  user: object({
    userID: string(),
  }),
})

// ------------------------------------------------------------------
// Minimal D1 mock (lookup by id only)
// ------------------------------------------------------------------
function createMockD1() {
  const clients = new Map<string, any>()
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: mock(async () => ({ success: true, meta: { changes: 1 } })),
        first: mock(async () => {
          if (sql.includes("SELECT * FROM oauth_clients WHERE id = ?")) {
            return clients.get(params[0]) || null
          }
          return null
        }),
        all: mock(async () => ({ results: [] })),
      }),
    }),
    _clients: clients,
  }
}

function clientRow(
  id: string,
  opts: { hash: string | null; enabled?: number; grants?: string[] },
) {
  const now = Date.now()
  return {
    id,
    tenant_id: "default",
    name: id,
    client_secret_hash: opts.hash,
    grant_types: JSON.stringify(
      opts.grants ?? ["client_credentials", "authorization_code"],
    ),
    scopes: JSON.stringify(["read"]),
    redirect_uris: JSON.stringify([]),
    metadata: JSON.stringify({}),
    enabled: opts.enabled ?? 1,
    created_at: now,
    updated_at: now,
  }
}

const dummyProvider = {
  type: "dummy",
  init(route: any, ctx: any) {
    route.get("/authorize", async (c: any) =>
      ctx.success(c, { email: "foo@bar.com" }),
    )
  },
}

function baseConfig(overrides: Record<string, any> = {}) {
  return {
    storage: MemoryStorage(),
    subjects,
    allow: async () => true,
    providers: { dummy: dummyProvider as any },
    success: async (ctx: any) => ctx.subject("user", { userID: "123" }),
    ...overrides,
  }
}

function form(
  body: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  }
}

const basic = (id: string, secret: string) => `Basic ${btoa(`${id}:${secret}`)}`

async function codeFlow(
  auth: ReturnType<typeof issuer>,
  opts: { clientID?: string; pkce?: boolean; host?: string } = {},
) {
  const host = opts.host ?? "https://auth.example.com"
  const client = createClient({
    issuer: host,
    clientID: opts.clientID ?? "123",
    fetch: (a, b) => Promise.resolve(auth.request(a, b)),
  })
  const { challenge, url } = await client.authorize(
    "https://client.example.com/callback",
    "code",
    { pkce: opts.pkce ?? true },
  )
  let response = await auth.request(url)
  response = await auth.request(response.headers.get("location")!, {
    headers: { cookie: response.headers.get("set-cookie")! },
  })
  const code = new URL(response.headers.get("location")!).searchParams.get(
    "code",
  )!
  const exchanged = await client.exchange(
    code,
    "https://client.example.com/callback",
    challenge.verifier,
  )
  if (exchanged.err) throw exchanged.err
  return { client, tokens: exchanged.tokens }
}

beforeEach(() => setSystemTime(new Date("2024-01-01T00:00:00Z")))
afterEach(() => setSystemTime())

// ==================================================================
// 1. CLIENT AUTHENTICATION
// ==================================================================
describe("client authentication", () => {
  let db: ReturnType<typeof createMockD1>
  let authenticator: ClientAuthenticator

  beforeEach(async () => {
    db = createMockD1()
    db._clients.set("public", clientRow("public", { hash: null }))
    db._clients.set("empty", clientRow("empty", { hash: "" }))
    db._clients.set(
      "conf",
      clientRow("conf", { hash: await hashClientSecret("s3cret") }),
    )
    db._clients.set(
      "disabled",
      clientRow("disabled", {
        hash: await hashClientSecret("s3cret"),
        enabled: 0,
      }),
    )
    authenticator = new ClientAuthenticator({
      adapter: new ClientD1Adapter(db as any),
    })
  })

  test("client with NULL secret hash is rejected for any secret", async () => {
    expect(
      (await authenticator.validateClient("public", "anything")).valid,
    ).toBe(false)
    expect((await authenticator.validateClient("public")).valid).toBe(false)
    expect((await authenticator.validateClient("empty", "x")).valid).toBe(false)
    expect(
      (await authenticator.authenticateClient("public", "x")).client,
    ).toBeNull()
  })

  test("public client only accepted with explicit opt-in and no secret", async () => {
    expect(
      (
        await authenticator.validateClient("public", undefined, {
          allowPublicClient: true,
        })
      ).valid,
    ).toBe(true)
    expect(
      (
        await authenticator.validateClient("public", "x", {
          allowPublicClient: true,
        })
      ).valid,
    ).toBe(false)
  })

  test("confidential client requires the right secret", async () => {
    expect((await authenticator.validateClient("conf", "s3cret")).valid).toBe(
      true,
    )
    expect((await authenticator.validateClient("conf", "wrong")).valid).toBe(
      false,
    )
    expect((await authenticator.validateClient("conf")).valid).toBe(false)
  })

  test("disabled client is rejected", async () => {
    expect(
      (await authenticator.validateClient("disabled", "s3cret")).valid,
    ).toBe(false)
    const adapter = new ClientD1Adapter(db as any)
    expect(await adapter.verifyCredentials("disabled", "s3cret")).toBeNull()
    expect(await adapter.verifyCredentials("public", "anything")).toBeNull()
    expect(await adapter.verifyCredentials("conf", "s3cret")).not.toBeNull()
  })

  describe("issuer endpoints", () => {
    let auth: ReturnType<typeof issuer>
    beforeEach(() => {
      auth = issuer(baseConfig({ clientDb: db }) as any)
    })

    test("client_credentials: confidential client succeeds", async () => {
      const res = await auth.request(
        "https://auth.example.com/token",
        form({
          grant_type: "client_credentials",
          client_id: "conf",
          client_secret: "s3cret",
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).access_token).toBeString()
    })

    test("client_credentials: NULL-secret client rejected", async () => {
      const res = await auth.request(
        "https://auth.example.com/token",
        form({
          grant_type: "client_credentials",
          client_id: "public",
          client_secret: "whatever",
        }),
      )
      expect(res.status).toBe(401)
      expect((await res.json()).error).toBe("invalid_client")
    })

    test("client_credentials: disabled client rejected", async () => {
      const res2 = await auth.request(
        "https://auth.example.com/token",
        form(
          { grant_type: "client_credentials" },
          { Authorization: basic("disabled", "s3cret") },
        ),
      )
      expect(res2.status).toBe(401)
    })

    test("introspect: NULL-secret client rejected", async () => {
      const res = await auth.request(
        "https://auth.example.com/token/introspect",
        form({ token: "x", client_id: "public", client_secret: "whatever" }),
      )
      expect(res.status).toBe(401)
    })

    test("revoke: NULL-secret client rejected (with or without secret)", async () => {
      const res = await auth.request(
        "https://auth.example.com/token/revoke",
        form({ token: "a:b", client_id: "public" }),
      )
      expect(res.status).toBe(401)
      const res2 = await auth.request(
        "https://auth.example.com/token/revoke",
        form({ token: "a:b", client_id: "public", client_secret: "x" }),
      )
      expect(res2.status).toBe(401)
    })

    test("revoke: confidential client still works", async () => {
      const res = await auth.request(
        "https://auth.example.com/token/revoke",
        form({ token: "a:b" }, { Authorization: basic("conf", "s3cret") }),
      )
      expect(res.status).toBe(200)
    })
  })
})

// ==================================================================
// 2. PKCE
// ==================================================================
describe("PKCE", () => {
  test("validatePKCE accepts only S256", async () => {
    const { verifier, challenge } = await generatePKCE()
    expect(await validatePKCE(verifier, challenge, "S256")).toBe(true)
    expect(await validatePKCE(verifier, challenge)).toBe(true)
    // plain must be rejected even if verifier === challenge
    expect(await validatePKCE(verifier, verifier, "plain")).toBe(false)
    expect(await validatePKCE(verifier, challenge, "plain")).toBe(false)
    expect(await validatePKCE(verifier, challenge, "S512")).toBe(false)
  })

  test("validatePKCE rejects mismatched verifier/challenge", async () => {
    const a = await generatePKCE()
    const b = await generatePKCE()
    expect(await validatePKCE(a.verifier, b.challenge, "S256")).toBe(false)
    expect(
      await validatePKCE(a.verifier, b.challenge.slice(0, 10), "S256"),
    ).toBe(false)
    expect(await validatePKCE(a.verifier, "", "S256")).toBe(false)
  })

  test("/authorize rejects code_challenge_method=plain", async () => {
    const auth = issuer(baseConfig() as any)
    const res = await auth.request(
      "https://auth.example.com/authorize?" +
        new URLSearchParams({
          client_id: "123",
          redirect_uri: "https://client.example.com/callback",
          response_type: "code",
          code_challenge: "abc",
          code_challenge_method: "plain",
        }),
    )
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get("location")!)
    expect(loc.searchParams.get("error")).toBe("invalid_request")
    expect(loc.searchParams.get("code")).toBeNull()
  })

  test("plain PKCE code stored by older flows cannot be exchanged", async () => {
    const storage = MemoryStorage()
    const auth = issuer(baseConfig({ storage }) as any)
    await Storage.set(
      storage,
      ["oauth:code", "legacy"],
      {
        type: "user",
        properties: { userID: "1" },
        subject: "user:1",
        redirectURI: "https://client.example.com/callback",
        clientID: "123",
        pkce: { challenge: "v".repeat(50), method: "plain" },
        ttl: { access: 60, refresh: 600 },
      },
      60,
    )
    const res = await auth.request(
      "https://auth.example.com/token",
      form({
        grant_type: "authorization_code",
        code: "legacy",
        client_id: "123",
        redirect_uri: "https://client.example.com/callback",
        code_verifier: "v".repeat(50),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_grant")
  })

  test("S256 PKCE and no-PKCE code flows keep working", async () => {
    const auth = issuer(baseConfig() as any)
    const withPkce = await codeFlow(auth, { pkce: true })
    expect(withPkce.tokens.access).toBeString()
    const withoutPkce = await codeFlow(auth, { pkce: false })
    expect(withoutPkce.tokens.access).toBeString()
  })

  describe("requireForPublicClients option", () => {
    let db: ReturnType<typeof createMockD1>
    beforeEach(async () => {
      db = createMockD1()
      db._clients.set("spa", clientRow("spa", { hash: null }))
      db._clients.set(
        "web",
        clientRow("web", { hash: await hashClientSecret("x") }),
      )
    })

    const authorize = (auth: any, clientId: string) =>
      auth.request(
        "https://auth.example.com/authorize?" +
          new URLSearchParams({
            client_id: clientId,
            redirect_uri: "https://client.example.com/callback",
            response_type: "code",
          }),
      )

    test("off by default: public client without PKCE allowed", async () => {
      const auth = issuer(baseConfig({ clientDb: db }) as any)
      const res = await authorize(auth, "spa")
      expect(res.headers.get("location")).toContain("/dummy/authorize")
    })

    test("on: public client without PKCE rejected, confidential/unknown unaffected", async () => {
      const auth = issuer(
        baseConfig({
          clientDb: db,
          pkce: { requireForPublicClients: true },
        }) as any,
      )
      const spa = await authorize(auth, "spa")
      expect(
        new URL(spa.headers.get("location")!).searchParams.get("error"),
      ).toBe("invalid_request")
      const web = await authorize(auth, "web")
      expect(web.headers.get("location")).toContain("/dummy/authorize")
      const unknown = await authorize(auth, "not-registered")
      expect(unknown.headers.get("location")).toContain("/dummy/authorize")
    })
  })
})

// ==================================================================
// 3. NO RAW ERROR MESSAGES
// ==================================================================
describe("error responses do not leak internal messages", () => {
  test("base issuer onError uses a generic description", async () => {
    const consoleError = console.error
    console.error = () => {}
    try {
      const auth = issuer(
        baseConfig({
          success: async () => {
            throw new Error("db password=hunter2 at 10.0.0.1")
          },
        }) as any,
      )
      let res = await auth.request(
        "https://auth.example.com/authorize?" +
          new URLSearchParams({
            client_id: "123",
            redirect_uri: "https://client.example.com/callback",
            response_type: "code",
          }),
      )
      res = await auth.request(res.headers.get("location")!, {
        headers: { cookie: res.headers.get("set-cookie")! },
      })
      const loc = new URL(res.headers.get("location")!)
      expect(loc.searchParams.get("error")).toBe("server_error")
      expect(loc.searchParams.get("error_description")).toBe(
        "Internal server error",
      )
      expect(res.headers.get("location")).not.toContain("hunter2")
    } finally {
      console.error = consoleError
    }
  })
})

// ==================================================================
// 6. CONFIGURED ISSUER
// ==================================================================
describe("configured issuer", () => {
  test("legacy: issuer derived from X-Forwarded-Host when not configured", async () => {
    const auth = issuer(baseConfig() as any)
    const res = await auth.request(
      "https://auth.example.com/.well-known/oauth-authorization-server",
      { headers: { "x-forwarded-host": "evil.example.net" } },
    )
    expect((await res.json()).issuer).toBe("https://evil.example.net")
  })

  test("configured issuer ignores X-Forwarded-Host in discovery and tokens", async () => {
    const auth = issuer(
      baseConfig({ issuer: "https://auth.example.com/" }) as any,
    )
    const res = await auth.request(
      "https://worker.dev/.well-known/oauth-authorization-server",
      { headers: { "x-forwarded-host": "evil.example.net" } },
    )
    const doc = await res.json()
    expect(doc.issuer).toBe("https://auth.example.com")
    expect(doc.token_endpoint).toBe("https://auth.example.com/token")

    const { tokens } = await codeFlow(auth, {
      host: "https://some-other-host.dev",
    })
    expect(decodeJwt(tokens.access).iss).toBe("https://auth.example.com")
  })

  test("configured issuer: default allow check ignores X-Forwarded-Host", async () => {
    const auth = issuer(
      baseConfig({
        issuer: "https://auth.example.com",
        allow: undefined,
      }) as any,
    )
    const res = await auth.request(
      "https://auth.example.com/authorize?" +
        new URLSearchParams({
          client_id: "123",
          redirect_uri: "https://evil.example.net/callback",
          response_type: "code",
        }),
      { headers: { "x-forwarded-host": "evil.example.net" } },
    )
    // Not allowed: no redirect to the provider
    expect(res.headers.get("location") ?? "").not.toContain("/dummy/authorize")
  })

  test("invalid configured issuer throws", () => {
    expect(() => issuer(baseConfig({ issuer: "not a url" }) as any)).toThrow()
  })
})

// ==================================================================
// 7. REFRESH TOKEN CLIENT BINDING
// ==================================================================
describe("refresh_token client binding", () => {
  let auth: ReturnType<typeof issuer>
  let refresh: string

  beforeEach(async () => {
    auth = issuer(baseConfig() as any)
    refresh = (await codeFlow(auth, { clientID: "client-a" })).tokens.refresh
  })

  const doRefresh = (extra: Record<string, string> = {}, headers = {}) =>
    auth.request(
      "https://auth.example.com/token",
      form(
        { grant_type: "refresh_token", refresh_token: refresh, ...extra },
        headers,
      ),
    )

  test("no client_id supplied: still works (backwards compatible)", async () => {
    expect((await doRefresh()).status).toBe(200)
  })

  test("matching client_id works", async () => {
    expect((await doRefresh({ client_id: "client-a" })).status).toBe(200)
  })

  test("matching Basic auth client works", async () => {
    expect(
      (await doRefresh({}, { Authorization: basic("client-a", "s") })).status,
    ).toBe(200)
  })

  test("mismatched client_id rejected and token not consumed", async () => {
    const bad = await doRefresh({ client_id: "client-b" })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe("invalid_grant")
    const badBasic = await doRefresh(
      {},
      { Authorization: basic("client-b", "s") },
    )
    expect(badBasic.status).toBe(400)
    // Legitimate client can still use the token afterwards
    expect((await doRefresh({ client_id: "client-a" })).status).toBe(200)
  })
})

// ==================================================================
// ENTERPRISE ISSUER: 3, 4, 5, 6 + silent-auth redirect validation
// ==================================================================
// Tenant resolution uses the Host header, which app.request() does not set
function call(app: any, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has("host")) headers.set("host", new URL(url).host)
  return app.request(url, { ...init, headers })
}

describe("enterprise issuer", () => {
  const sessionSecret = new Uint8Array(32).fill(0x42)
  let storage: ReturnType<typeof MemoryStorage>
  let tenantService: TenantServiceImpl
  let sessionService: SessionServiceImpl

  beforeEach(async () => {
    storage = MemoryStorage()
    tenantService = new TenantServiceImpl(storage)
    sessionService = new SessionServiceImpl(storage)
    await tenantService.createTenant({ id: "default", name: "Default" })
  })

  function makeApp(extra: Record<string, any> = {}) {
    return createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      subjects,
      providers: { dummy: dummyProvider as any },
      tenantResolver: {
        customDomains: new Map([
          ["auth.example.com", "default"],
          ["worker.dev", "default"],
        ]),
      },
      onSuccess: async (ctx: any) => ctx.subject("user", { userID: "123" }),
      ...extra,
    } as any).app
  }

  async function sessionCookie() {
    const bs = await sessionService.createBrowserSession({
      tenantId: "default",
      userAgent: "test",
      ipAddress: "127.0.0.1",
    })
    await sessionService.addAccountToSession({
      browserSessionId: bs.id,
      userId: "user:123",
      subjectType: "user",
      subjectProperties: { userID: "123" },
      refreshToken: "rt",
      clientId: "app",
      ttl: 60 * 60 * 24,
    })
    const fresh = await sessionService.getBrowserSession(bs.id, "default")
    const header = await createSessionCookieHeader(fresh!, sessionSecret)
    return header.split(";")[0]
  }

  const silentAuthorize = (
    app: any,
    cookie: string,
    redirect: string,
    extra = {},
  ) =>
    call(
      app,
      "https://auth.example.com/authorize?" +
        new URLSearchParams({
          client_id: "app",
          redirect_uri: redirect,
          response_type: "code",
          state: "st",
          prompt: "none",
          ...extra,
        }),
      { headers: { cookie } },
    )

  test("discovery advertises the real signing alg (ES256)", async () => {
    const app = makeApp()
    const res = await call(
      app,
      "https://auth.example.com/.well-known/openid-configuration",
    )
    const doc = await res.json()
    expect(doc.id_token_signing_alg_values_supported).toEqual(["ES256"])
    expect(doc.id_token_signing_alg_values_supported).not.toContain("RS256")
    expect(doc.code_challenge_methods_supported).toEqual(["S256"])
  })

  test("configured issuer used in discovery and tokens", async () => {
    const app = makeApp({ issuer: "https://auth.example.com" })
    const res = await call(
      app,
      "https://worker.dev/.well-known/openid-configuration",
      { headers: { "x-forwarded-host": "evil.example.net" } },
    )
    expect((await res.json()).issuer).toBe("https://auth.example.com")
  })

  test("silent auth stores TTLs in seconds and a 10 minute code", async () => {
    const app = makeApp()
    const cookie = await sessionCookie()
    const res = await silentAuthorize(app, cookie, "https://app.example.com/cb")
    expect(res.status).toBe(302)
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!
    expect(code).toBeString()
    const stored = await Storage.get<any>(storage, ["oauth:code", code])
    expect(stored.ttl).toEqual({
      access: 60 * 60 * 24 * 30,
      refresh: 60 * 60 * 24 * 365,
    })

    const tokenRes = await call(
      app,
      "https://auth.example.com/token",
      form({
        grant_type: "authorization_code",
        code,
        client_id: "app",
        redirect_uri: "https://app.example.com/cb",
      }),
    )
    expect(tokenRes.status).toBe(200)
    const body = await tokenRes.json()
    expect(body.expires_in).toBe(60 * 60 * 24 * 30)
    const claims = decodeJwt(body.access_token)
    // Before the fix this was ~30 days * 1000 (tens of thousands of years)
    expect(claims.exp! - Math.floor(Date.now() / 1000)).toBe(60 * 60 * 24 * 30)
  })

  test("silent auth code expires after 10 minutes", async () => {
    const app = makeApp()
    const cookie = await sessionCookie()
    const res = await silentAuthorize(app, cookie, "https://app.example.com/cb")
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!
    setSystemTime(new Date(Date.now() + 11 * 60 * 1000))
    expect(await Storage.get(storage, ["oauth:code", code])).toBeUndefined()
  })

  test("silent auth honours configured ttl (seconds)", async () => {
    const app = makeApp({ ttl: { access: 120, refresh: 3600 } })
    const cookie = await sessionCookie()
    const res = await silentAuthorize(app, cookie, "https://app.example.com/cb")
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!
    const stored = await Storage.get<any>(storage, ["oauth:code", code])
    expect(stored.ttl).toEqual({ access: 120, refresh: 3600 })
  })

  test("silent auth does not issue a code to a disallowed redirect_uri", async () => {
    const app = makeApp()
    const cookie = await sessionCookie()
    const res = await silentAuthorize(
      app,
      cookie,
      "https://evil.example.net/cb",
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("unauthorized_client")
    expect(res.headers.get("location")).toBeNull()
  })

  test("silent auth rejects code_challenge_method=plain", async () => {
    const app = makeApp()
    const cookie = await sessionCookie()
    const res = await silentAuthorize(
      app,
      cookie,
      "https://app.example.com/cb",
      {
        code_challenge: "abc",
        code_challenge_method: "plain",
      },
    )
    const loc = new URL(res.headers.get("location")!)
    expect(loc.searchParams.get("error")).toBe("invalid_request")
    expect(loc.searchParams.get("code")).toBeNull()
  })

  test("500 responses do not leak err.message", async () => {
    const consoleError = console.error
    console.error = () => {}
    try {
      const app = makeApp()
      app.get("/boom", () => {
        throw new Error("secret internal detail")
      })
      const res = await call(app, "https://auth.example.com/boom")
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe("server_error")
      expect(body.error_description).toBe("Internal server error")
    } finally {
      console.error = consoleError
    }
  })
})

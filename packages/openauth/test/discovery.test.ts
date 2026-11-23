import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test"
import { object, string } from "valibot"
import { SignJWT } from "jose"
import { issuer } from "../src/issuer.js"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { signingKeys } from "../src/keys.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { createSubjects } from "../src/subject.js"
import { TenantServiceImpl } from "../src/tenant/service.js"

const HOST = "https://auth.example.com"
const subjects = createSubjects({ user: object({ userID: string() }) })

const consoleSpy = spyOn(console, "error").mockImplementation(mock())
afterAll(() => {
  consoleSpy.mockRestore()
})

const clientDb = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({ success: true, meta: { changes: 0 } }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  }),
} as any

const providers = {
  dummy: {
    type: "dummy",
    init(route: any, ctx: any) {
      route.get("/authorize", async (c: any) =>
        ctx.success(c, { email: "foo@bar.com" }),
      )
    },
  },
} as any

let storage: ReturnType<typeof MemoryStorage>
let serverErrors: unknown[]

function base(extra: Record<string, any> = {}) {
  return issuer({
    storage,
    subjects,
    providers,
    issuer: HOST,
    allow: async () => true,
    success: async (ctx: any) => ctx.subject("user", { userID: "123" }),
    ...extra,
  } as any)
}

function enterprise(extra: Record<string, any> = {}) {
  return createMultiTenantIssuer({
    tenantService,
    sessionService: new SessionServiceImpl(storage),
    storage,
    sessionSecret: new Uint8Array(32).fill(0x42),
    subjects,
    providers,
    issuer: HOST,
    tenantResolver: {
      customDomains: new Map([["auth.example.com", "default"]]),
    },
    onSuccess: async (ctx: any) => ctx.subject("user", { userID: "123" }),
    onServerError: (err: unknown) => {
      serverErrors.push(err)
      return undefined
    },
    ...extra,
  } as any).app
}

let tenantService: TenantServiceImpl

beforeEach(async () => {
  storage = MemoryStorage()
  serverErrors = []
  tenantService = new TenantServiceImpl(storage)
  await tenantService.createTenant({ id: "default", name: "Default" })
})

const call = (app: any, path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set("host", "auth.example.com")
  return app.request(`${HOST}${path}`, { ...init, headers })
}
const OAUTH = "/.well-known/oauth-authorization-server"
const OIDC = "/.well-known/openid-configuration"
const metadata = async (app: any, path: string) =>
  (await (await call(app, path)).json()) as Record<string, any>

const FULL = {
  clientDb,
  device: { ipHeader: "cf-connecting-ip" },
  documentation: "https://docs.example.com/auth",
}

describe("discovery lists only what the issuer serves", () => {
  for (const [name, make, path] of [
    ["base", base, OAUTH],
    ["enterprise", enterprise, OAUTH],
    ["enterprise", enterprise, OIDC],
  ] as const) {
    for (const [config, extra] of [
      ["everything on", FULL],
      ["nothing extra", {}],
    ] as const) {
      test(`${name} ${path}, ${config}: every endpoint answers`, async () => {
        const app = make(extra)
        const doc = await metadata(app, path)
        const endpoints = Object.entries(doc).filter(
          ([key]) =>
            key.endsWith("_endpoint") ||
            key === "jwks_uri" ||
            key === "verification_uri",
        )
        expect(endpoints.length).toBeGreaterThanOrEqual(4)
        for (const [key, url] of endpoints) {
          expect(url).toStartWith(`${HOST}/`)
          const at = (url as string).slice(HOST.length)
          const get = await call(app, at)
          const post = await call(app, at, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "token=x&grant_type=refresh_token",
          })
          // 404 for both methods (and 501 "not enabled") means nothing serves it
          const served = [get.status, post.status].some(
            (s) => s !== 404 && s !== 501,
          )
          expect({ key, served }).toEqual({ key, served: true })
        }
      })
    }
  }

  test("no dynamic registration, id_token or code+token responses", async () => {
    for (const [app, path] of [
      [base(FULL), OAUTH],
      [enterprise(FULL), OAUTH],
      [enterprise(FULL), OIDC],
    ] as const) {
      const doc = await metadata(app, path)
      expect(doc.registration_endpoint).toBeUndefined()
      expect(doc.response_types_supported).toEqual(["code", "token"])
      expect(doc.code_challenge_methods_supported).toEqual(["S256"])
    }
  })

  test("client endpoints and methods follow clientDb", async () => {
    const without = await metadata(base(), OAUTH)
    expect(without.introspection_endpoint).toBeUndefined()
    expect(without.revocation_endpoint).toBeUndefined()
    expect(without.token_endpoint_auth_methods_supported).not.toContain(
      "client_secret_basic",
    )
    const withClients = await metadata(base({ clientDb }), OAUTH)
    expect(withClients.introspection_endpoint).toBe(`${HOST}/token/introspect`)
    expect(withClients.revocation_endpoint).toBe(`${HOST}/token/revoke`)
    expect(withClients.token_endpoint_auth_methods_supported).toContain(
      "client_secret_basic",
    )
  })

  test("the device grant needs clientDb, so it is not listed without it", async () => {
    for (const path of [OAUTH, OIDC]) {
      const doc = await metadata(enterprise({ device: {} }), path)
      expect(doc.device_authorization_endpoint).toBeUndefined()
    }
  })

  test("documentation is the configured URL, or left out", async () => {
    for (const path of [OAUTH, OIDC]) {
      expect(
        (await metadata(enterprise(FULL), path)).service_documentation,
      ).toBe(FULL.documentation)
      expect(
        (await metadata(enterprise(), path)).service_documentation,
      ).toBeUndefined()
    }
  })

  test("both enterprise documents agree", async () => {
    const app = enterprise(FULL)
    const oidc = await metadata(app, OIDC)
    expect(oidc).toMatchObject(await metadata(app, OAUTH))
  })
})

describe("/userinfo refuses a bad token as the caller's error", () => {
  async function sign(claims: Record<string, unknown>, exp = "1h") {
    const [key] = await signingKeys(storage)
    return new SignJWT(claims)
      .setProtectedHeader({ alg: key!.alg, kid: key!.id })
      .setIssuer(HOST)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(key!.private)
  }
  const user = {
    mode: "access",
    type: "user",
    properties: { userID: "123" },
  }
  const ask = (app: any, token: string) =>
    call(app, "/userinfo", { headers: { Authorization: `Bearer ${token}` } })

  for (const [name, make] of [
    ["base", base],
    ["enterprise", enterprise],
  ] as const) {
    test(`${name}: a good token answers its subject`, async () => {
      const res = await ask(make(), await sign(user))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ userID: "123" })
    })

    for (const [what, token] of [
      ["not a token", async () => "nonsense"],
      ["expired", async () => sign(user, "-1h")],
      ["wrong mode", async () => sign({ ...user, mode: "refresh" })],
      ["unknown subject type", async () => sign({ ...user, type: "robot" })],
      [
        "prototype subject type",
        async () => sign({ ...user, type: "toString" }),
      ],
      ["no subject type", async () => sign({ mode: "access" })],
      [
        "properties that don't fit",
        async () => sign({ ...user, properties: { userID: 5 } }),
      ],
      [
        "unknown key",
        async () => {
          const [key] = await signingKeys(storage)
          return new SignJWT(user)
            .setProtectedHeader({ alg: key!.alg, kid: "someone-else" })
            .setIssuer(HOST)
            .setExpirationTime("1h")
            .sign(key!.private)
        },
      ],
      [
        "another issuer",
        async () => {
          const [key] = await signingKeys(storage)
          return new SignJWT(user)
            .setProtectedHeader({ alg: key!.alg, kid: key!.id })
            .setIssuer("https://evil.example.com")
            .setExpirationTime("1h")
            .sign(key!.private)
        },
      ],
    ] as [string, () => Promise<string>][]) {
      test(`${name}: ${what} → 401`, async () => {
        const res = await ask(make(), await token())
        expect(res.status).toBe(401)
        expect(res.headers.get("www-authenticate")).toBe(
          'Bearer error="invalid_token"',
        )
        expect((await res.json()).error).toBe("invalid_token")
        expect(serverErrors).toEqual([])
      })
    }
  }
})

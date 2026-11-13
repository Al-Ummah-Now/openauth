/**
 * Refreshed tokens carry the user's CURRENT roles (enterprise issuer).
 *
 * Before: the refresh grant signed the properties stored at sign-in, so a role
 * granted later never reached refreshed tokens and a revoked one (Admin,
 * Super Admin) stayed for the refresh token's whole life (1 year).
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { decodeJwt } from "jose"
import { object, string } from "valibot"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import { PasswordProvider, ScryptHasher } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"
import { loadRefreshToken, refreshKey } from "../src/refresh-token.js"

const HOST = "auth.example.com"
const OTHER_HOST = "auth.other.example.com"
const EMAIL = "refresh@example.com"
const PASSWORD = "pw-refresh-123"
const USER = "usr_1"
const CLIENT = { id: "web", redirect: "https://web.example.com/cb" }

let storage: StorageAdapter
let sessions: SessionServiceImpl
/** RBAC roles per `${tenantId}:${userId}` */
let rbacRoles: Map<string, string[]>
let rbacDown: boolean
let suspended: Set<string>
let rbacCalls: Array<{ userId: string; tenantId: string; clientId: string }>

const fakeRbac = {
  async getUserRoles(userId: string, tenantId: string) {
    if (rbacDown) throw new Error("D1 unavailable")
    return (rbacRoles.get(`${tenantId}:${userId}`) ?? []).map((name) => ({
      id: name,
      name,
    }))
  },
  async enrichTokenClaims(params: {
    userId: string
    clientId: string
    tenantId: string
  }) {
    rbacCalls.push(params)
    if (rbacDown) throw new Error("D1 unavailable")
    const roles = rbacRoles.get(`${params.tenantId}:${params.userId}`) ?? []
    return {
      roles: [...roles],
      permissions: roles.map((r) => `${r.toLowerCase()}:${params.clientId}`),
    }
  },
}

/** A property patch onRefresh returns (AUTH-PASSKEYS passkey_deadline). */
let refreshPatch: Record<string, unknown> | undefined

async function createApp(withStatusCheck = true) {
  const tenantService = new TenantServiceImpl(storage)
  await tenantService.createTenant({ id: "default", name: "Default" })
  await tenantService.createTenant({ id: "other", name: "Other" })
  const { app } = createMultiTenantIssuer({
    tenantService,
    sessionService: sessions,
    storage,
    sessionSecret: new Uint8Array(32).fill(7),
    subjects: createSubjects({ user: object({ email: string() }) }),
    tenantResolver: {
      customDomains: new Map([
        [HOST, "default"],
        [OTHER_HOST, "other"],
      ]),
    },
    rbacService: fakeRbac as any,
    ttl: { access: 900 },
    providers: {
      password: PasswordProvider(
        PasswordUI({ sendCode: async () => undefined }),
      ),
    },
    // Like Auth: the roles come from RBAC, and no userID is passed to the
    // enterprise enrichment at sign-in
    onSuccess: async (ctx, value, tenant) => {
      const roles = (await fakeRbac.getUserRoles(USER, tenant.id)).map(
        (r) => r.name,
      )
      return ctx.subject("user", {
        id: USER,
        email: (value as any).email,
        roles,
      } as any)
    },
    ...(withStatusCheck
      ? {
          onRefresh: async ({ userId }) =>
            userId && suspended.has(userId)
              ? { revoke: true as const, reason: "suspended" }
              : refreshPatch
                ? { properties: refreshPatch }
                : undefined,
        }
      : {}),
  })
  return app
}

type App = Awaited<ReturnType<typeof createApp>>

class Browser {
  jar = new Map<string, string>()
  constructor(
    private app: App,
    private host = HOST,
  ) {}
  async go(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set("host", this.host)
    headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "))
    const res = await this.app.request(`https://${this.host}${path}`, {
      ...init,
      headers,
    })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";")
      const i = pair.indexOf("=")
      const value = pair.slice(i + 1)
      if (!value || /max-age=0/i.test(c)) this.jar.delete(pair.slice(0, i))
      else this.jar.set(pair.slice(0, i), value)
    }
    return res
  }
  /** Signs in and redeems the code: the client's first token pair. */
  async signIn() {
    const start = await this.go(
      `/authorize?client_id=${CLIENT.id}&response_type=code&state=s&redirect_uri=${encodeURIComponent(CLIENT.redirect)}`,
    )
    const res = await this.go(start.headers.get("location")!, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: EMAIL,
        password: PASSWORD,
      }).toString(),
    })
    expect(res.status).toBe(302)
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!
    const token = await this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: CLIENT.redirect,
      client_id: CLIENT.id,
    })
    expect(token.status).toBe(200)
    return token.body as { access_token: string; refresh_token: string }
  }
  async token(form: Record<string, string>) {
    const res = await this.go("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    })
    return {
      status: res.status,
      headers: res.headers,
      body: (await res.json()) as any,
    }
  }
  refresh(refreshToken: string) {
    return this.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  }
}

function claims(accessToken: string) {
  return decodeJwt(accessToken) as any
}

async function storedRefresh(refreshToken: string) {
  const parts = refreshToken.split(":")
  const secret = parts.pop()!
  return loadRefreshToken(storage, refreshKey(parts.join(":"), secret))
}

beforeEach(async () => {
  refreshPatch = undefined
  storage = MemoryStorage()
  sessions = new SessionServiceImpl(storage)
  rbacRoles = new Map([["default:usr_1", ["Member"]]])
  rbacDown = false
  suspended = new Set()
  rbacCalls = []
  await Storage.set(
    storage,
    ["email", EMAIL, "password"],
    await ScryptHasher().hash(PASSWORD),
  )
})

describe("refresh recomputes roles", () => {
  test("a role granted after sign-in is in the next refreshed token", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn()
    expect(claims(first.access_token).properties.roles).toEqual(["Member"])

    rbacRoles.set("default:usr_1", ["Member", "Super Admin"])
    const res = await browser.refresh(first.refresh_token)
    expect(res.status).toBe(200)
    const props = claims(res.body.access_token).properties
    expect(props.roles).toEqual(["Member", "Super Admin"])
    expect(props.permissions).toEqual(["member:web", "super admin:web"])
    expect(props.tenantId).toBe("default")
    expect(props.id).toBe(USER)
    // Computed for this token's user, tenant and client
    expect(rbacCalls.at(-1)).toEqual({
      userId: USER,
      tenantId: "default",
      clientId: CLIENT.id,
    })
    // The rotated refresh token carries the current roles too
    const rotated = await storedRefresh(res.body.refresh_token)
    expect(rotated?.properties.roles).toEqual(["Member", "Super Admin"])
  })

  test("a revoked role is gone from the next refreshed token", async () => {
    rbacRoles.set("default:usr_1", ["Member", "Admin", "Super Admin"])
    const browser = new Browser(await createApp())
    const first = await browser.signIn()
    expect(claims(first.access_token).properties.roles).toEqual([
      "Member",
      "Admin",
      "Super Admin",
    ])

    rbacRoles.set("default:usr_1", ["Member"])
    const res = await browser.refresh(first.refresh_token)
    expect(res.status).toBe(200)
    expect(claims(res.body.access_token).properties.roles).toEqual(["Member"])
    expect(claims(res.body.access_token).properties.permissions).toEqual([
      "member:web",
    ])

    // And every later refresh stays current
    rbacRoles.set("default:usr_1", [])
    const again = await browser.refresh(res.body.refresh_token)
    expect(again.status).toBe(200)
    expect(claims(again.body.access_token).properties.roles).toEqual([])
  })

  test("a concurrent refresh in the reuse window also gets the current roles", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn()
    rbacRoles.set("default:usr_1", ["Member", "Admin"])
    const a = await browser.refresh(first.refresh_token)
    rbacRoles.set("default:usr_1", ["Member"])
    const b = await browser.refresh(first.refresh_token)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    // Same successor refresh token (rotation invariant), current roles each time
    expect(b.body.refresh_token).toBe(a.body.refresh_token)
    expect(claims(b.body.access_token).properties.roles).toEqual(["Member"])
  })

  test("the user's account sessions get the current roles", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn()
    rbacRoles.set("default:usr_1", ["Member", "Admin"])
    expect((await browser.refresh(first.refresh_token)).status).toBe(200)

    const sessionIds: string[] = []
    for await (const [, v] of Storage.scan<{ sessionId: string }>(storage, [
      "session",
      "user",
      "default",
      USER,
    ]))
      sessionIds.push(v.sessionId)
    expect(sessionIds.length).toBe(1)
    const account = await sessions.getAccountSession(sessionIds[0]!, USER)
    expect(account?.subject_properties.roles).toEqual(["Member", "Admin"])
    expect(account?.subject_properties.email).toBe(EMAIL)
  })
})

describe("onRefresh property patch", () => {
  test("a patched property is set, and undefined removes it", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn()
    refreshPatch = { passkey_deadline: 1234 }
    const res = await browser.refresh(first.refresh_token)
    expect(res.status).toBe(200)
    const props = claims(res.body.access_token).properties
    expect(props.passkey_deadline).toBe(1234)
    expect(props.roles).toEqual(["Member"])

    refreshPatch = { passkey_deadline: undefined }
    const again = await browser.refresh(res.body.refresh_token)
    expect(again.status).toBe(200)
    expect(
      claims(again.body.access_token).properties.passkey_deadline,
    ).toBeUndefined()
    // amr from the password sign-in is kept across refreshes
    expect(claims(again.body.access_token).amr).toEqual(["pwd"])
  })
})

describe("tenant scoping", () => {
  test("roles are read for the token's own tenant only", async () => {
    rbacRoles.set("other:usr_1", ["Admin", "Super Admin"])
    const browser = new Browser(await createApp())
    const first = await browser.signIn()

    const res = await browser.refresh(first.refresh_token)
    expect(res.status).toBe(200)
    expect(claims(res.body.access_token).properties.roles).toEqual(["Member"])
    expect(rbacCalls.every((c) => c.tenantId === "default")).toBe(true)
  })

  test("refreshing through another tenant's host does not pick up that tenant's roles", async () => {
    rbacRoles.set("other:usr_1", ["Super Admin"])
    const app = await createApp()
    const first = await new Browser(app).signIn()

    const res = await new Browser(app, OTHER_HOST).refresh(first.refresh_token)
    expect(res.status).toBe(200)
    const props = claims(res.body.access_token).properties
    expect(props.tenantId).toBe("default")
    expect(props.roles).toEqual(["Member"])
    expect(rbacCalls.every((c) => c.tenantId === "default")).toBe(true)
  })
})

describe("refused refreshes", () => {
  test("a suspended user is refused and the token family is revoked", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn()
    const rotated = await browser.refresh(first.refresh_token)
    expect(rotated.status).toBe(200)

    suspended.add(USER)
    const readsBefore = rbacCalls.length
    const res = await browser.refresh(rotated.body.refresh_token)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_grant")
    // No RBAC read for a refused user, and nothing issued
    expect(rbacCalls.length).toBe(readsBefore)
    expect(res.body.access_token).toBeUndefined()

    // Reinstated later: this sign-in's tokens stay dead (sign in again)
    suspended.delete(USER)
    expect((await browser.refresh(rotated.body.refresh_token)).status).toBe(400)
    expect((await browser.refresh(first.refresh_token)).status).toBe(400)
  })

  test("RBAC failure answers a retryable 503, never the stored roles", async () => {
    rbacRoles.set("default:usr_1", ["Member", "Super Admin"])
    const browser = new Browser(await createApp())
    const first = await browser.signIn()

    // Super Admin is revoked, then RBAC can't be read
    rbacRoles.set("default:usr_1", ["Member"])
    rbacDown = true
    const res = await browser.refresh(first.refresh_token)
    expect(res.status).toBe(503)
    expect(res.body.error).toBe("temporarily_unavailable")
    expect(res.body.access_token).toBeUndefined()
    expect(res.headers.get("retry-after")).toBe("5")

    // The refresh token was not spent: the retry works once RBAC is back
    rbacDown = false
    const retry = await browser.refresh(first.refresh_token)
    expect(retry.status).toBe(200)
    expect(claims(retry.body.access_token).properties.roles).toEqual(["Member"])
  })

  test("a stolen token replayed past the reuse window is still revoked while RBAC is down", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn()
    expect((await browser.refresh(first.refresh_token)).status).toBe(200)
    const stored = await storedRefresh(first.refresh_token)
    // Used long ago
    const parts = first.refresh_token.split(":")
    const secret = parts.pop()!
    await Storage.set(storage, refreshKey(parts.join(":"), secret), {
      ...stored,
      timeUsed: Date.now() - 3_600_000,
    })
    rbacDown = true
    const replay = await browser.refresh(first.refresh_token)
    expect(replay.status).toBe(400)
    expect(replay.body.error).toBe("invalid_grant")
  })
})

describe("legacy refresh tokens", () => {
  test("a token whose stored properties lack roles gets them on refresh", async () => {
    const browser = new Browser(await createApp(false))
    const first = await browser.signIn()
    const parts = first.refresh_token.split(":")
    const secret = parts.pop()!
    const key = refreshKey(parts.join(":"), secret)
    const stored = await loadRefreshToken(storage, key)
    const { roles, permissions, ...rest } = stored!.properties
    void roles
    void permissions
    await Storage.set(storage, key, { ...stored, properties: rest })
    rbacRoles.set("default:usr_1", ["Member", "Admin"])

    const res = await browser.refresh(first.refresh_token)
    expect(res.status).toBe(200)
    expect(claims(res.body.access_token).properties.roles).toEqual([
      "Member",
      "Admin",
    ])
  })
})

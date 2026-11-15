/**
 * Tokens name their sign-in (AlUmmahNow#442, AlUmmahNowAuth#363):
 * - a browser sign-in's code, refresh token and every access token carry
 *   `sid` = sessionTokenId(browser session, user), the same across refreshes;
 * - a native app's `install_id` on the code exchange is kept on the refresh
 *   token (and its rotations) and passed to onRefresh, with sid and authTime.
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
import { parseInstallId, sessionTokenId } from "../src/session/token-id.js"

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
let refreshInputs: Array<Record<string, unknown>>

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
          onRefresh: async (input) => {
            refreshInputs.push(input)
            const { userId } = input
            return userId && suspended.has(userId)
              ? { revoke: true as const, reason: "suspended" }
              : refreshPatch
                ? { properties: refreshPatch }
                : undefined
          },
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
  async signIn(extra: Record<string, string> = {}) {
    const start = await this.go(
      `/authorize?client_id=${CLIENT.id}&response_type=code&state=s&redirect_uri=${encodeURIComponent(CLIENT.redirect)}`,
    )
    // Already signed in on this browser: single sign-on answers with the code
    const startLocation = start.headers.get("location")!
    const res = startLocation.startsWith(CLIENT.redirect)
      ? start
      : await this.go(startLocation, {
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
      ...extra,
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
  refreshInputs = []
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

/** The browser session ids the user is signed in on. */
async function browserSessionsOf(userId: string): Promise<string[]> {
  const ids: string[] = []
  for await (const [key] of Storage.scan(storage, [
    "session",
    "user",
    "default",
    userId,
  ]))
    ids.push(key.at(-1)!)
  return ids
}

describe("sid: the sign-in's session id", () => {
  test("every token of a browser sign-in carries sessionTokenId(browser session, user)", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn()
    const [bsid] = await browserSessionsOf(USER)
    expect(bsid).toBeTruthy()
    const sid = await sessionTokenId(bsid, USER)
    expect(claims(first.access_token).sid).toBe(sid)
    expect((await storedRefresh(first.refresh_token))?.sid).toBe(sid)

    const refreshed = await browser.refresh(first.refresh_token)
    expect(refreshed.status).toBe(200)
    expect(claims(refreshed.body.access_token).sid).toBe(sid)
    expect((await storedRefresh(refreshed.body.refresh_token))?.sid).toBe(sid)
    expect(refreshInputs.at(-1)?.sid).toBe(sid)
    expect(typeof refreshInputs.at(-1)?.authTime).toBe("number")
  })

  test("two browsers get different sids; signing in again in one keeps its sid", async () => {
    const app = await createApp()
    const a = new Browser(app)
    const b = new Browser(app)
    const sidA = claims((await a.signIn()).access_token).sid
    const sidB = claims((await b.signIn()).access_token).sid
    expect(sidA).not.toBe(sidB)
    expect(claims((await a.signIn()).access_token).sid).toBe(sidA)
  })

  test("the sid is opaque: 22 url-safe characters, never the browser session id", async () => {
    const browser = new Browser(await createApp())
    const sid = claims((await browser.signIn()).access_token).sid as string
    expect(sid).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const [bsid] = await browserSessionsOf(USER)
    expect(sid).not.toContain(bsid)
  })
})

describe("install_id: a native app's install", () => {
  test("is kept on the refresh token and its rotations, and passed to onRefresh", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn({ install_id: "ins_ABC-123.x" })
    expect((await storedRefresh(first.refresh_token))?.installId).toBe(
      "ins_ABC-123.x",
    )
    // Never in the access token
    expect(claims(first.access_token).installId).toBeUndefined()
    const refreshed = await browser.refresh(first.refresh_token)
    expect(refreshed.status).toBe(200)
    expect(refreshInputs.at(-1)?.installId).toBe("ins_ABC-123.x")
    expect((await storedRefresh(refreshed.body.refresh_token))?.installId).toBe(
      "ins_ABC-123.x",
    )
  })

  test("an invalid install_id is ignored, not stored", async () => {
    const browser = new Browser(await createApp())
    const first = await browser.signIn({ install_id: "bad id/with spaces" })
    expect(
      (await storedRefresh(first.refresh_token))?.installId,
    ).toBeUndefined()
  })

  test("parseInstallId", () => {
    expect(parseInstallId("a")).toBe("a")
    expect(parseInstallId("x".repeat(128))).toBe("x".repeat(128))
    for (const bad of ["", "x".repeat(129), "a b", "a/b", null, 5])
      expect(parseInstallId(bad)).toBeUndefined()
  })
})

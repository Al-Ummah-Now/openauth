/**
 * Device authorization grant (RFC 8628): device code request, activation page
 * (code entry, confirmation, CSRF), approval through the normal sign-in, and
 * polling with authorization_pending / slow_down / access_denied / expired_token.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test"
import { object, string } from "valibot"
import { decodeJwt } from "jose"
import { issuer } from "../src/issuer.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import {
  networkOf,
  DEVICE_CODE_GRANT,
  USER_CODE_ALPHABET,
  generateUserCode,
  normalizeUserCode,
} from "../src/device.js"

const HOST = "https://auth.example.com"
const subjects = createSubjects({ user: object({ userID: string() }) })

function mockD1(rows: any[]) {
  const clients = new Map(rows.map((r) => [r.id, r]))
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: mock(async () => ({ success: true, meta: { changes: 1 } })),
        first: mock(async () =>
          sql.includes("FROM oauth_clients WHERE id = ?")
            ? clients.get(params[0]) || null
            : null,
        ),
        all: mock(async () => ({ results: [] })),
      }),
    }),
  }
}

const row = (id: string, grants: string[], name = id) => ({
  id,
  tenant_id: "default",
  name,
  client_secret_hash: null,
  grant_types: JSON.stringify(grants),
  scopes: "[]",
  redirect_uris: "[]",
  metadata: JSON.stringify({ type: "native" }),
  enabled: 1,
  created_at: 0,
  updated_at: 0,
})

const db = mockD1([
  row("tv", [DEVICE_CODE_GRANT, "refresh_token"], "Al Ummah Now TV"),
  row("other-tv", [DEVICE_CODE_GRANT]),
  row("web", ["authorization_code"]),
])

const dummyProvider = {
  type: "dummy",
  init(route: any, ctx: any) {
    route.get("/authorize", async (c: any) =>
      ctx.success(c, { email: "foo@bar.com" }),
    )
  },
}

let auth: ReturnType<typeof issuer>
let now: number
beforeEach(() => {
  now = Date.parse("2026-01-01T00:00:00Z")
  setSystemTime(new Date(now))
  auth = issuer({
    storage: MemoryStorage(),
    subjects,
    allow: async () => true,
    clientDb: db as any,
    device: {},
    providers: { dummy: dummyProvider as any },
    success: async (ctx: any) => ctx.subject("user", { userID: "u-123" }),
  } as any)
})
afterEach(() => setSystemTime())

const tick = (seconds: number) => {
  now += seconds * 1000
  setSystemTime(new Date(now))
}

const post = (
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  auth.request(`${HOST}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "1.2.3.4",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  })
const get = (url: string, headers: Record<string, string> = {}) =>
  auth.request(url.startsWith("http") ? url : `${HOST}${url}`, {
    headers: { "cf-connecting-ip": "1.2.3.4", ...headers },
  })

async function startDevice(clientId = "tv") {
  const res = await post("/device_authorization", {
    client_id: clientId,
    scope: "openid offline_access",
  })
  expect(res.status).toBe(200)
  return (await res.json()) as any
}
const poll = async (deviceCode: string, clientId = "tv") => {
  const res = await post("/token", {
    grant_type: DEVICE_CODE_GRANT,
    device_code: deviceCode,
    client_id: clientId,
  })
  return { status: res.status, body: (await res.json()) as any }
}

/** Enter the code, return the confirm page's CSRF token and cookie. */
async function confirmPage(userCode: string) {
  const res = await get(`/activate?user_code=${encodeURIComponent(userCode)}`)
  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain('data-page="device-confirm"')
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]
  const cookie = res.headers.get("set-cookie")!.split(";")[0]
  return { html, csrf, cookie }
}

/** Through the normal sign-in (dummy provider signs in at once); returns the callback URL. */
async function signInTo(authorizeUrl: string) {
  let r = await get(authorizeUrl)
  const cookies = r.headers.get("set-cookie") ?? ""
  while (
    r.status === 302 &&
    !r.headers.get("location")!.includes("/activate/callback")
  ) {
    r = await get(r.headers.get("location")!, { cookie: cookies })
  }
  const callback = r.headers.get("location")!
  expect(callback.startsWith(`${HOST}/activate/callback?`)).toBe(true)
  return callback
}

const cookieNamed = (res: Response, name: string) =>
  (res.headers.get("set-cookie") ?? "")
    .split(/,\s*(?=[^;=]+=)/)
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1)

async function approve(userCode: string) {
  const { csrf, cookie } = await confirmPage(userCode)
  const res = await post(
    "/activate",
    { user_code: userCode, csrf, action: "approve" },
    { cookie },
  )
  expect(res.status).toBe(302)
  const handleCookie = cookieNamed(res, "__device_handle")!
  expect(handleCookie).toBeString()
  const callback = await signInTo(res.headers.get("location")!)
  const done = await get(callback, { cookie: handleCookie })
  return { authorizeUrl: new URL(res.headers.get("location")!), done }
}

describe("device authorization request", () => {
  test("returns codes, verification URIs, 10-minute expiry and interval", async () => {
    const d = await startDevice()
    expect(d.device_code.length).toBeGreaterThanOrEqual(43)
    expect(d.user_code).toMatch(
      /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
    )
    expect(d.verification_uri).toBe(`${HOST}/activate`)
    expect(d.verification_uri_complete).toBe(
      `${HOST}/activate?user_code=${d.user_code}`,
    )
    expect(d.expires_in).toBe(600)
    expect(d.interval).toBe(5)
  })

  test("only clients registered with the device grant", async () => {
    for (const id of ["web", "unknown"]) {
      const res = await post("/device_authorization", { client_id: id })
      expect(res.status).toBe(400)
      expect(((await res.json()) as any).error).toBe("unauthorized_client")
    }
    expect((await post("/device_authorization", {})).status).toBe(400)
  })

  test("is rate limited per client and IP", async () => {
    for (let i = 0; i < 10; i++) await startDevice()
    const res = await post("/device_authorization", { client_id: "tv" })
    expect(res.status).toBe(429)
    expect(((await res.json()) as any).error).toBe("slow_down")
  })

  test("discovery advertises the endpoint and grant", async () => {
    const meta = (await (
      await get("/.well-known/oauth-authorization-server")
    ).json()) as any
    expect(meta.device_authorization_endpoint).toBe(
      `${HOST}/device_authorization`,
    )
    expect(meta.grant_types_supported).toContain(DEVICE_CODE_GRANT)
  })
})

describe("polling and approval", () => {
  test("pending, slow_down, then tokens once after approval", async () => {
    const d = await startDevice()
    expect((await poll(d.device_code)).body.error).toBe("authorization_pending")
    const fast = await poll(d.device_code)
    expect(fast.body.error).toBe("slow_down")
    expect(fast.body.interval).toBe(10)

    const { authorizeUrl, done } = await approve(d.user_code)
    expect(authorizeUrl.searchParams.get("client_id")).toBe("tv")
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256")
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      `${HOST}/activate/callback`,
    )
    expect(await done.text()).toContain('data-page="device-done"')

    tick(11)
    const ok = await poll(d.device_code)
    expect(ok.status).toBe(200)
    expect(ok.body.token_type).toBe("bearer")
    expect(ok.body.refresh_token).toBeString()
    const claims = decodeJwt(ok.body.access_token)
    expect(claims.properties).toEqual({ userID: "u-123" })
    expect(claims.aud).toBe("tv")
    // auth_time is when the approving user signed in, before the TV polled
    expect(typeof claims.auth_time).toBe("number")
    expect(claims.auth_time as number).toBeLessThan(claims.iat as number)

    // single use
    tick(11)
    expect((await poll(d.device_code)).body.error).toBe("expired_token")
  })

  test("the device's refresh token works with its client id", async () => {
    const d = await startDevice()
    await approve(d.user_code)
    const { body } = await poll(d.device_code)
    const res = await post("/token", {
      grant_type: "refresh_token",
      refresh_token: body.refresh_token,
      client_id: "tv",
    })
    expect(res.status).toBe(200)
  })

  test("deny gives access_denied", async () => {
    const d = await startDevice()
    const { csrf, cookie } = await confirmPage(d.user_code)
    const res = await post(
      "/activate",
      { user_code: d.user_code, csrf, action: "deny" },
      { cookie },
    )
    expect(await res.text()).toContain('data-page="device-denied"')
    expect((await poll(d.device_code)).body.error).toBe("access_denied")
    // the code can't be used again
    expect((await get(`/activate?user_code=${d.user_code}`)).status).toBe(400)
  })

  test("codes expire after 10 minutes", async () => {
    const d = await startDevice()
    tick(601)
    expect((await poll(d.device_code)).body.error).toBe("expired_token")
    expect((await get(`/activate?user_code=${d.user_code}`)).status).toBe(400)
  })

  test("a device code only works for the client it was issued to", async () => {
    const d = await startDevice()
    expect((await poll(d.device_code, "other-tv")).body.error).toBe(
      "invalid_grant",
    )
    expect((await poll("made-up")).body.error).toBe("expired_token")
  })
})

describe("activation page", () => {
  test("accepts the code without the dash and in lower case", async () => {
    const d = await startDevice()
    const page = await confirmPage(d.user_code.replace("-", "").toLowerCase())
    expect(page.html).toContain("Al Ummah Now TV")
    expect(page.html).toContain(d.user_code)
    expect(page.cookie).toStartWith("__device_csrf=")
  })

  test("refuses approval without the CSRF cookie or with a wrong token", async () => {
    const d = await startDevice()
    const { csrf, cookie } = await confirmPage(d.user_code)
    expect(
      (
        await post("/activate", {
          user_code: d.user_code,
          csrf,
          action: "approve",
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await post(
          "/activate",
          { user_code: d.user_code, csrf: "x", action: "approve" },
          { cookie },
        )
      ).status,
    ).toBe(400)
    expect((await poll(d.device_code)).body.error).toBe("authorization_pending")
  })

  test("wrong codes are rate limited per IP", async () => {
    for (let i = 0; i < 10; i++)
      expect((await get("/activate?user_code=BCDF-GHJK")).status).toBe(400)
    const res = await get("/activate?user_code=BCDF-GHJK")
    expect(res.status).toBe(429)
    expect(await res.text()).toContain('data-error="rate_limited"')
    tick(61)
    expect((await get("/activate?user_code=BCDF-GHJK")).status).toBe(400)
  })

  test("a captured authorize link can't be finished in another browser (phishing)", async () => {
    const d = await startDevice()
    const { csrf, cookie } = await confirmPage(d.user_code)
    // The attacker confirms in their browser and sends the authorize link to a victim
    const res = await post(
      "/activate",
      { user_code: d.user_code, csrf, action: "approve" },
      { cookie },
    )
    const callback = await signInTo(res.headers.get("location")!)
    // The victim's browser has no (or another) handle cookie
    expect((await get(callback)).status).toBe(400)
    expect(
      (await get(callback, { cookie: "__device_handle=other" })).status,
    ).toBe(400)
    tick(11)
    expect((await poll(d.device_code)).body.error).toBe("authorization_pending")
  })

  test("the CSRF token is bound to the confirmed code", async () => {
    const a = await startDevice()
    const b = await startDevice()
    const { csrf, cookie } = await confirmPage(a.user_code)
    const res = await post(
      "/activate",
      { user_code: b.user_code, csrf, action: "approve" },
      { cookie },
    )
    expect(res.status).toBe(400)
    expect((await poll(b.device_code)).body.error).toBe("authorization_pending")
  })

  test("approvals count against the per-IP lookup limit", async () => {
    const d = await startDevice()
    const { csrf, cookie } = await confirmPage(d.user_code)
    for (let i = 0; i < 9; i++) await get("/activate?user_code=BCDF-GHJK")
    const res = await post(
      "/activate",
      { user_code: d.user_code, csrf, action: "approve" },
      { cookie },
    )
    expect(res.status).toBe(429)
  })

  test("failed lookups are limited per network, across its addresses", async () => {
    for (let i = 0; i < 30; i++)
      await get("/activate?user_code=BCDF-GHJK", {
        "cf-connecting-ip": `10.0.0.${i}`,
      })
    const sameNet = await get("/activate?user_code=BCDF-GHJK", {
      "cf-connecting-ip": "10.0.0.200",
    })
    expect(sameNet.status).toBe(429)
    // Other networks are unaffected: there is no global lockout
    const other = await get("/activate?user_code=BCDF-GHJK", {
      "cf-connecting-ip": "9.9.9.9",
    })
    expect(other.status).toBe(400)
  })

  test("a callback without a valid state or code fails safely", async () => {
    expect((await get("/activate/callback?code=x&state=nope")).status).toBe(400)
  })

  test("is Arabic and right-to-left with ?lang=ar", async () => {
    const html = await (await get("/activate?lang=ar")).text()
    expect(html).toContain('dir="rtl"')
    expect(html).toContain("تسجيل الدخول على جهازك")
  })

  test("the entry page can't be framed", async () => {
    const res = await get("/activate")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
  })
})

describe("networkOf", () => {
  test("groups IPv4 by /24 and IPv6 by /48", () => {
    expect(networkOf("203.0.113.7")).toBe("203.0.113.0/24")
    expect(networkOf("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48")
    expect(networkOf("2001:db8::1")).toBe("2001:db8:0::/48")
    expect(networkOf("::1")).toBe("0:0:0::/48")
    expect(networkOf("unknown")).toBe("unknown")
  })

  test("different spellings of one network share a bucket", () => {
    expect(networkOf("2001:0DB8:ABCD:0012::1")).toBe("2001:db8:abcd::/48")
    expect(networkOf("2001:db8:abcd:0:0:0:0:1")).toBe("2001:db8:abcd::/48")
    expect(networkOf("2001:db8::")).toBe("2001:db8:0::/48")
    expect(networkOf("::ffff:203.0.113.7")).toBe("203.0.113.0/24")
    expect(networkOf("::ffff:cb00:7107")).toBe("203.0.113.0/24")
    expect(networkOf("203.000.113.7")).toBe("203.0.113.0/24")
    expect(networkOf("fe80::1%eth0")).toBe("fe80:0:0::/48")
  })
})

describe("user codes", () => {
  test("8 characters from the consonant alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateUserCode()
      expect(c).toHaveLength(8)
      for (const ch of c) expect(USER_CODE_ALPHABET).toContain(ch)
    }
  })
  test("normalization", () => {
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDFGHJK")
    expect(normalizeUserCode(" BCDF GHJK ")).toBe("BCDFGHJK")
    expect(normalizeUserCode("BCDF-GHJA")).toBeNull()
    expect(normalizeUserCode("BCD")).toBeNull()
    expect(normalizeUserCode(undefined)).toBeNull()
  })
})

describe("through the enterprise issuer (client registry on)", () => {
  const ENT = "auth.example.com"
  async function enterprise() {
    const { createMultiTenantIssuer } =
      await import("../src/enterprise/issuer.js")
    const { TenantServiceImpl } = await import("../src/tenant/service.js")
    const { SessionServiceImpl } = await import("../src/session/service.js")
    const { PasswordProvider } = await import("../src/provider/password.js")
    const { PasswordUI } = await import("../src/ui/password.js")
    const storage = MemoryStorage()
    const tenantService = new TenantServiceImpl(storage)
    await tenantService.createTenant({ id: "default", name: "Default" })
    return createMultiTenantIssuer({
      tenantService,
      sessionService: new SessionServiceImpl(storage),
      storage,
      sessionSecret: new Uint8Array(32).fill(5),
      subjects: createSubjects({ user: object({ email: string() }) }),
      tenantResolver: { customDomains: new Map([[ENT, "default"]]) },
      clientDb: db as any,
      clientRegistry: { mode: "enforce" },
      issuer: HOST,
      device: {},
      providers: {
        password: PasswordProvider(
          PasswordUI({ sendCode: async () => undefined }),
        ),
      },
      onSuccess: async (ctx, v) =>
        ctx.subject("user", { email: (v as any).email } as any),
    }).app
  }
  const authorize = (app: any, clientId: string) =>
    app.request(
      `${HOST}/authorize?` +
        new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          state: "h",
          redirect_uri: `${HOST}/activate/callback`,
          code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
          code_challenge_method: "S256",
        }),
      { headers: { host: ENT } },
    )

  test("a device-grant client may sign in to the activate callback", async () => {
    const res = await authorize(await enterprise(), "tv")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toContain("/password/authorize")
  })

  test("other clients may not use the activate callback", async () => {
    const res = await authorize(await enterprise(), "web")
    expect(res.status).toBe(400)
    expect(res.headers.get("location")).toBeNull()
  })

  test("device authorization and discovery are served", async () => {
    const app = await enterprise()
    const res = await app.request(`${HOST}/device_authorization`, {
      method: "POST",
      headers: {
        host: ENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "client_id=tv",
    })
    expect(res.status).toBe(200)
    const meta = (await (
      await app.request(`${HOST}/.well-known/oauth-authorization-server`, {
        headers: { host: ENT },
      })
    ).json()) as any
    expect(meta.device_authorization_endpoint).toBe(
      `${HOST}/device_authorization`,
    )
    const activate = await app.request(`${HOST}/activate`, {
      headers: { host: ENT },
    })
    expect(activate.status).toBe(200)
  })
})

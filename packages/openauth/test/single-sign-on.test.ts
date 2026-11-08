/**
 * Single sign-on across clients (enterprise issuer).
 *
 * Before: an active browser session was only used for prompt=none, so every
 * client (web, profile, admin) showed the sign-in form again, and
 * prompt=select_account with one account also fell through to the form.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { object, string } from "valibot"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import { PasswordProvider, ScryptHasher } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"

const HOST = "auth.example.com"
const EMAIL = "sso@example.com"
const PASSWORD = "pw-sso-123"
const A = { id: "client-a", redirect: "https://a.example.com/cb" }
const B = { id: "client-b", redirect: "https://b.example.com/cb" }

let storage: StorageAdapter

async function createApp(singleSignOn?: boolean) {
  const tenantService = new TenantServiceImpl(storage)
  await tenantService.createTenant({ id: "default", name: "Default" })
  const { app } = createMultiTenantIssuer({
    tenantService,
    sessionService: new SessionServiceImpl(storage),
    storage,
    sessionSecret: new Uint8Array(32).fill(3),
    subjects: createSubjects({ user: object({ email: string() }) }),
    tenantResolver: { customDomains: new Map([[HOST, "default"]]) },
    singleSignOn,
    providers: {
      password: PasswordProvider(
        PasswordUI({ sendCode: async () => undefined }),
      ),
    },
    onSuccess: async (ctx, value) =>
      ctx.subject("user", { email: (value as any).email, id: "user-1" } as any),
  })
  return app
}

class Browser {
  jar = new Map<string, string>()
  constructor(private app: Awaited<ReturnType<typeof createApp>>) {}
  async go(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set("host", HOST)
    headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "))
    const res = await this.app.request(`https://${HOST}${path}`, {
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
  authorize(client: { id: string; redirect: string }, extra = "") {
    return this.go(
      `/authorize?client_id=${client.id}&response_type=code&state=${client.id}-state&redirect_uri=${encodeURIComponent(client.redirect)}${extra}`,
    )
  }
  async signIn(client: { id: string; redirect: string }) {
    const start = await this.authorize(client)
    expect(start.headers.get("location")).toContain("/password/authorize")
    const res = await this.go(start.headers.get("location")!, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: EMAIL,
        password: PASSWORD,
      }).toString(),
    })
    expect(res.status).toBe(302)
    return new URL(res.headers.get("location")!)
  }
}

async function codePayload(location: URL) {
  return Storage.get<any>(storage, [
    "oauth:code",
    location.searchParams.get("code")!,
  ])
}

function expectSignInForm(res: Response) {
  expect(res.status).toBe(302)
  expect(res.headers.get("location")).toContain("/password/authorize")
}

beforeEach(async () => {
  storage = MemoryStorage()
  await Storage.set(
    storage,
    ["email", EMAIL, "password"],
    await ScryptHasher().hash(PASSWORD),
  )
})

describe("single sign-on", () => {
  test("a second client completes silently, with no sign-in form", async () => {
    const browser = new Browser(await createApp())
    const toA = await browser.signIn(A)

    const res = await browser.authorize(B)
    expect(res.status).toBe(302)
    const toB = new URL(res.headers.get("location")!)
    expect(toB.origin + toB.pathname).toBe(B.redirect)
    expect(toB.searchParams.get("state")).toBe("client-b-state")

    const a = await codePayload(toA)
    const b = await codePayload(toB)
    expect(b.clientID).toBe(B.id)
    expect(b.redirectURI).toBe(B.redirect)
    // Same user, same subject for every client
    expect(b.subject).toBe(a.subject)
    expect(b.properties.email).toBe(EMAIL)
  })

  test("prompt=login forces the sign-in form", async () => {
    const browser = new Browser(await createApp())
    await browser.signIn(A)
    expectSignInForm(await browser.authorize(B, "&prompt=login"))
  })

  test("max_age=0 forces the sign-in form", async () => {
    const browser = new Browser(await createApp())
    await browser.signIn(A)
    await Bun.sleep(5)
    expectSignInForm(await browser.authorize(B, "&max_age=0"))
  })

  test("prompt=select_account with one account shows the account picker, not the form", async () => {
    const browser = new Browser(await createApp())
    await browser.signIn(A)
    const res = await browser.authorize(B, "&prompt=select_account")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain(EMAIL)
    expect(html).not.toContain('type="password"')
  })

  test("no browser session: the sign-in form", async () => {
    const browser = new Browser(await createApp())
    expectSignInForm(await browser.authorize(B))
  })

  test("signed out (session cookie gone): the sign-in form again", async () => {
    const browser = new Browser(await createApp())
    await browser.signIn(A)
    browser.jar.delete("__session")
    expectSignInForm(await browser.authorize(B))
  })

  test("singleSignOn: false keeps per-client sign-in", async () => {
    const browser = new Browser(await createApp(false))
    await browser.signIn(A)
    expectSignInForm(await browser.authorize(B))
  })

  test("an unregistered redirect_uri is never silently issued a code", async () => {
    const tenantService = new TenantServiceImpl(storage)
    await tenantService.createTenant({ id: "default", name: "Default" })
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService: new SessionServiceImpl(storage),
      storage,
      sessionSecret: new Uint8Array(32).fill(3),
      subjects: createSubjects({ user: object({ email: string() }) }),
      tenantResolver: { customDomains: new Map([[HOST, "default"]]) },
      onAllow: async (input) => input.clientID !== "evil",
      providers: {
        password: PasswordProvider(
          PasswordUI({ sendCode: async () => undefined }),
        ),
      },
      onSuccess: async (ctx, value) =>
        ctx.subject("user", { email: (value as any).email, id: "u" } as any),
    })
    const browser = new Browser(app)
    await browser.signIn(A)
    const res = await browser.authorize({
      id: "evil",
      redirect: "https://evil.example.com/cb",
    })
    expect(res.headers.get("location") ?? "").not.toContain("code=")
  })
})

/**
 * Per-tab authorization flows (src/flow.ts).
 *
 * Before: the pending authorization lived in ONE `authorization` cookie shared
 * by every tab and client. These tests pin the scenarios that produced the raw
 * "The browser was in an unknown state" page, plus the wrong-client redirect
 * when two sign-ins ran at once in one browser.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import { PasswordProvider, ScryptHasher } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"
import { FLOW_BIND_COOKIE, FLOW_PARAM, flowKey } from "../src/flow.js"
import type { Provider } from "../src/provider/provider.js"
import { CodeProvider } from "../src/provider/code.js"
import { CodeUI } from "../src/ui/code.js"

const subjects = createSubjects({ user: object({ email: string() }) })
const ISSUER = "https://auth.example.com"
const HOST = "auth.example.com"
const FALLBACK = "https://videos.example.com"
const APP_A = "https://a.example.com/cb?locale=en"
const APP_B = "https://b.example.com/cb"
const EMAIL = "user@example.com"
const PASSWORD = "correct horse"
const UNKNOWN_STATE_TEXT = "The browser was in an unknown state"

let storage: StorageAdapter
let codes: Record<string, string>

function boomProvider(): Provider<{ email: string }> {
  return {
    type: "boom",
    init(routes) {
      routes.get("/authorize", () => {
        throw new Error("provider exploded")
      })
    },
  }
}

/** OAuth-like provider: the callback comes back WITHOUT ?auth_flow=. */
function redirectProvider(): Provider<{ email: string }> {
  return {
    type: "redirect",
    init(routes, ctx) {
      routes.get("/authorize", async (c) => {
        await ctx.set(c, "provider", 600, { state: "upstream-state" })
        return c.redirect("https://idp.example.com/authorize")
      })
      routes.get("/callback", async (c) => {
        const state = await ctx.get<{ state: string } | undefined>(
          c,
          "provider",
        )
        if (state?.state !== "upstream-state") return c.text("bad state", 400)
        return ctx.success(c, { email: EMAIL })
      })
    },
  }
}

function createAuth() {
  return issuer({
    storage,
    subjects,
    allow: async () => true,
    restart: { fallbackUrl: FALLBACK },
    providers: {
      password: PasswordProvider(
        PasswordUI({
          sendCode: async (email, code) => {
            codes[email] = code
          },
        }),
      ),
      boom: boomProvider(),
      redirect: redirectProvider(),
      code: CodeProvider(CodeUI({ sendCode: async () => undefined })),
    },
    success: async (ctx, value) => ctx.subject("user", { email: value.email }),
  })
}

type App = { request: (input: string, init?: RequestInit) => Promise<Response> }

/** A browser: one cookie jar shared by all of its tabs. */
class Browser {
  jar = new Map<string, string>()
  constructor(private app: App) {}
  private take(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";")
      const i = pair.indexOf("=")
      const name = pair.slice(0, i)
      const value = pair.slice(i + 1)
      if (!value || /max-age=0/i.test(c)) this.jar.delete(name)
      else this.jar.set(name, value)
    }
  }
  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ")
  }
  async get(path: string, headers: Record<string, string> = {}) {
    const res = await this.app.request(new URL(path, ISSUER).toString(), {
      headers: { host: HOST, cookie: this.cookie(), ...headers },
    })
    this.take(res)
    return res
  }
  async post(path: string, fields: Record<string, string>) {
    const res = await this.app.request(new URL(path, ISSUER).toString(), {
      method: "POST",
      headers: {
        host: HOST,
        cookie: this.cookie(),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
    })
    this.take(res)
    return res
  }
  /** Open a tab on /authorize for a client; returns the login page path. */
  async startSignIn(clientID: string, redirectURI: string, extra = "") {
    const res = await this.get(
      `/authorize?client_id=${clientID}&response_type=code&provider=password&state=${clientID}-state&redirect_uri=${encodeURIComponent(redirectURI)}${extra}`,
    )
    expect(res.status).toBe(302)
    const location = res.headers.get("location")!
    expect(location).toContain(`${FLOW_PARAM}=`)
    return location
  }
}

function flowIdOf(path: string) {
  return new URL(path, ISSUER).searchParams.get(FLOW_PARAM)!
}

const login = { email: EMAIL, password: PASSWORD }

async function expectRestartPage(res: Response, restartUrl: string) {
  expect(res.status).toBe(400)
  expect(res.headers.get("content-type")).toContain("text/html")
  const html = await res.text()
  expect(html).not.toContain(UNKNOWN_STATE_TEXT)
  expect(html).not.toContain("invalid_state")
  expect(html).toContain('data-page="restart"')
  expect(html).toContain(`href="${restartUrl}"`)
  return html
}

beforeEach(async () => {
  storage = MemoryStorage()
  codes = {}
  await Storage.set(
    storage,
    ["email", EMAIL, "password"],
    await ScryptHasher().hash(PASSWORD),
  )
})

describe("two tabs, two clients, one browser", () => {
  test("each tab completes to its own client", async () => {
    const browser = new Browser(createAuth())
    const tabA = await browser.startSignIn("client-a", APP_A)
    const tabB = await browser.startSignIn("client-b", APP_B)

    const a = await browser.post(tabA, login)
    expect(a.status).toBe(302)
    const toA = new URL(a.headers.get("location")!)
    expect(toA.origin + toA.pathname).toBe("https://a.example.com/cb")
    expect(toA.searchParams.get("state")).toBe("client-a-state")

    const b = await browser.post(tabB, login)
    expect(b.status).toBe(302)
    const toB = new URL(b.headers.get("location")!)
    expect(toB.origin + toB.pathname).toBe("https://b.example.com/cb")
    expect(toB.searchParams.get("state")).toBe("client-b-state")

    // Each code is bound to its own client
    const codeA = await Storage.get<any>(storage, [
      "oauth:code",
      toA.searchParams.get("code")!,
    ])
    const codeB = await Storage.get<any>(storage, [
      "oauth:code",
      toB.searchParams.get("code")!,
    ])
    expect(codeA.clientID).toBe("client-a")
    expect(codeB.clientID).toBe("client-b")
  })

  test("registration progress in one tab survives a sign-up started in another", async () => {
    const browser = new Browser(createAuth())
    const tabA = await browser.startSignIn("client-a", APP_A)
    const tabB = await browser.startSignIn("client-b", APP_B)
    const registerA = tabA.replace("/password/authorize", "/password/register")
    const registerB = tabB.replace("/password/authorize", "/password/register")

    await browser.get(registerA)
    const step = await browser.post(registerA, {
      action: "register",
      email: "new@example.com",
      password: "pw-123456",
      repeat: "pw-123456",
    })
    expect(await step.text()).toContain('name="code"')

    // Tab B opens the register form (rewrites the shared `provider` cookie)
    await browser.get(registerB)

    const done = await browser.post(registerA, {
      action: "verify",
      code: codes["new@example.com"],
    })
    expect(done.status).toBe(302)
    expect(done.headers.get("location")).toStartWith("https://a.example.com/cb")
  })
})

describe("back button / resubmitted form after a successful sign-in", () => {
  test("with a flow id: back to the client's app, not an error", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A)
    const first = await browser.post(tab, login)
    expect(first.headers.get("location")).toStartWith(
      "https://a.example.com/cb",
    )

    const again = await browser.post(tab, login)
    expect(again.status).toBe(302)
    expect(again.headers.get("location")).toBe("https://a.example.com/")
    // No second code was issued
    expect(again.headers.get("location")).not.toContain("code=")
  })

  test("without a flow id (legacy page): friendly restart page", async () => {
    const browser = new Browser(createAuth())
    await browser.startSignIn("client-a", APP_A)
    const first = await browser.post("/password/authorize", login)
    expect(first.headers.get("location")).toStartWith(
      "https://a.example.com/cb",
    )
    const again = await browser.post("/password/authorize", login)
    await expectRestartPage(again, FALLBACK)
  })
})

describe("stale login page", () => {
  test("flow and cookie expired: friendly page to the fallback app", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A)
    await Storage.remove(storage, flowKey(flowIdOf(tab)))
    browser.jar.delete("authorization")
    const res = await browser.post(tab, login)
    await expectRestartPage(res, FALLBACK)
  })

  test("Arabic page when the login page was Arabic", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A, "&lang=ar")
    expect(tab).toContain("lang=ar")
    await Storage.remove(storage, flowKey(flowIdOf(tab)))
    browser.jar.delete("authorization")
    const html = await expectRestartPage(
      await browser.post(tab, login),
      FALLBACK,
    )
    expect(html).toContain('dir="rtl"')
    expect(html).toContain("ابدأ تسجيل الدخول من جديد")
  })

  test("English, not the browser's Accept-Language, when no lang is given", async () => {
    const html = await expectRestartPage(
      await createAuth().request(`${ISSUER}/password/authorize`, {
        method: "POST",
        headers: {
          "accept-language": "ar-SA,ar;q=0.9",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(login).toString(),
      }),
      FALLBACK,
    )
    expect(html).toContain('lang="en"')
    expect(html).toContain('dir="ltr"')
  })

  test("an unsupported or invalid lang falls back to English", async () => {
    for (const lang of ["fr", "constructor", "__proto__", "ar-XX-<x>"]) {
      const res = await createAuth().request(
        `${ISSUER}/password/authorize?lang=${encodeURIComponent(lang)}`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(login).toString(),
        },
      )
      const html = await expectRestartPage(res, FALLBACK)
      expect(html).toContain('lang="en"')
      expect(html).toContain('dir="ltr"')
    }
  })

  test("storage lag: the cookie of the same flow still completes it", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A)
    await Storage.remove(storage, flowKey(flowIdOf(tab)))
    const res = await browser.post(tab, login)
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toStartWith("https://a.example.com/cb")
  })

  test("storage lag never borrows another tab's cookie", async () => {
    const browser = new Browser(createAuth())
    const tabA = await browser.startSignIn("client-a", APP_A)
    await browser.startSignIn("client-b", APP_B) // cookie now belongs to B
    await Storage.remove(storage, flowKey(flowIdOf(tabA)))
    const res = await browser.post(tabA, login)
    const html = await expectRestartPage(res, FALLBACK)
    expect(html).not.toContain("b.example.com")
  })

  test("stale register and change-password forms restart instead of failing", async () => {
    const browser = new Browser(createAuth())
    const register = await browser.post("/password/register", {
      action: "verify",
      code: "123456",
    })
    expect(register.status).toBe(200)
    expect(await register.text()).toContain('value="register"')

    const change = await browser.post("/password/change", {
      action: "verify",
      code: "123456",
    })
    expect(change.status).toBe(200)
    expect(await change.text()).toContain('name="email"')
  })
})

describe("direct /password/authorize (bookmark, history)", () => {
  test("the login page renders", async () => {
    const browser = new Browser(createAuth())
    const res = await browser.get("/password/authorize")
    expect(res.status).toBe(200)
  })

  test("signing in shows the friendly page, never the raw error", async () => {
    const browser = new Browser(createAuth())
    const res = await browser.post("/password/authorize", login)
    await expectRestartPage(res, FALLBACK)
  })

  test("any provider error without a flow shows the friendly page", async () => {
    const browser = new Browser(createAuth())
    const res = await browser.get("/boom/authorize")
    await expectRestartPage(res, FALLBACK)
  })
})

describe("browser binding (CSRF / replay)", () => {
  test("a flow id replayed from another browser is rejected", async () => {
    const auth = createAuth()
    const victim = new Browser(auth)
    const attacker = new Browser(auth)
    const tab = await victim.startSignIn("client-a", APP_A)
    const res = await attacker.post(tab, login)
    // Restart to the flow's own app; no code issued
    await expectRestartPage(res, "https://a.example.com/")
  })

  test("a flow id with a forged bind cookie is rejected", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A)
    browser.jar.set(FLOW_BIND_COOKIE, "x".repeat(43))
    browser.jar.delete("authorization")
    await expectRestartPage(
      await browser.post(tab, login),
      "https://a.example.com/",
    )
  })

  test("the bind cookie is shared by tabs and httpOnly", async () => {
    const auth = createAuth()
    const res = await auth.request(
      `${ISSUER}/authorize?client_id=c&response_type=code&provider=password&redirect_uri=${encodeURIComponent(APP_A)}`,
    )
    const bind = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${FLOW_BIND_COOKIE}=`))!
    expect(bind).toContain("HttpOnly")
    expect(bind).toContain("Secure")
    const browser = new Browser(auth)
    await browser.startSignIn("client-a", APP_A)
    const first = browser.jar.get(FLOW_BIND_COOKIE)
    await browser.startSignIn("client-b", APP_B)
    expect(browser.jar.get(FLOW_BIND_COOKIE)).toBe(first)
  })
})

describe("flow record", () => {
  test("is versioned, browser-bound and expires", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A)
    const record = await Storage.get<any>(storage, flowKey(flowIdOf(tab)))
    expect(record.v).toBe(1)
    expect(record.authorization.client_id).toBe("client-a")
    expect(record.binding).toMatch(/^[0-9a-f]{64}$/)
    expect(record.binding).not.toBe(browser.jar.get(FLOW_BIND_COOKIE))
    expect(record.expiresAt - record.createdAt).toBe(24 * 60 * 60 * 1000)
  })

  test("login page links keep the flow id and locale", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A, "&lang=ar")
    const html = await (await browser.get(tab)).text()
    const id = flowIdOf(tab)
    expect(html).toContain(`href="register?${FLOW_PARAM}=${id}&amp;lang=ar"`)
    expect(html).toContain(`href="change?${FLOW_PARAM}=${id}&amp;lang=ar"`)
  })
})

describe("enterprise issuer", () => {
  async function createEnterprise() {
    const tenantService = new TenantServiceImpl(storage)
    await tenantService.createTenant({ id: "default", name: "Default" })
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService: new SessionServiceImpl(storage),
      storage,
      sessionSecret: new Uint8Array(32).fill(7),
      subjects,
      tenantResolver: {
        customDomains: new Map([["auth.example.com", "default"]]),
      },
      restart: { fallbackUrl: FALLBACK },
      providers: {
        password: PasswordProvider(
          PasswordUI({ sendCode: async () => undefined }),
        ),
      },
      onSuccess: async (ctx, value) =>
        ctx.subject("user", { email: (value as any).email }),
    })
    return app
  }

  test("unknown state renders the friendly page, not JSON invalid_state", async () => {
    const browser = new Browser(await createEnterprise())
    const res = await browser.post("/password/authorize", login)
    await expectRestartPage(res, FALLBACK)
  })

  test("two tabs complete to their own clients", async () => {
    const browser = new Browser(await createEnterprise())
    const tabA = await browser.startSignIn("client-a", APP_A)
    const tabB = await browser.startSignIn("client-b", APP_B)
    const a = await browser.post(tabA, login)
    expect(a.headers.get("location")).toStartWith("https://a.example.com/cb")
    const b = await browser.post(tabB, login)
    expect(b.headers.get("location")).toStartWith("https://b.example.com/cb")
  })
})

describe("review follow-ups", () => {
  test("an OAuth callback without the flow id completes its own flow's client", async () => {
    const browser = new Browser(createAuth())
    const startA = await browser.get(
      `/authorize?client_id=client-a&response_type=code&provider=redirect&state=client-a-state&redirect_uri=${encodeURIComponent(APP_A)}`,
    )
    const tabA = startA.headers.get("location")!
    await browser.get(tabA) // sets the provider state for flow A
    // Tab B starts a sign-in for another client (rewrites `authorization`)
    await browser.get(
      `/authorize?client_id=client-b&response_type=code&state=client-b-state&redirect_uri=${encodeURIComponent(APP_B)}`,
    )
    const callback = await browser.get("/redirect/callback?code=upstream")
    expect(callback.status).toBe(302)
    const to = new URL(callback.headers.get("location")!)
    expect(to.origin + to.pathname).toBe("https://a.example.com/cb")
    expect(to.searchParams.get("state")).toBe("client-a-state")
    // The flow is now completed: going back is recognised
    const record = await Storage.get<any>(storage, flowKey(flowIdOf(tabA)))
    expect(record.completedAt).toBeNumber()
  })

  test("provider state in the flow record is encrypted", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A)
    const register = tab.replace("/password/authorize", "/password/register")
    await browser.get(register)
    await browser.post(register, {
      action: "register",
      email: "sealed@example.com",
      password: "pw-123456",
      repeat: "pw-123456",
    })
    const record = await Storage.get<any>(storage, flowKey(flowIdOf(tab)))
    const sealed = record.provider.provider
    expect(typeof sealed).toBe("string")
    expect(sealed).not.toContain(codes["sealed@example.com"])
    expect(JSON.stringify(record)).not.toContain("sealed@example.com")
  })

  test("a lagging flow record falls back to this flow's provider cookie", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A)
    const register = tab.replace("/password/authorize", "/password/register")
    await browser.get(register)
    await browser.post(register, {
      action: "register",
      email: "lag@example.com",
      password: "pw-123456",
      repeat: "pw-123456",
    })
    // Simulate a stale read: the record without the latest provider state
    const key = flowKey(flowIdOf(tab))
    const record = await Storage.get<any>(storage, key)
    await Storage.set(storage, key, { ...record, provider: undefined }, 600)
    const done = await browser.post(register, {
      action: "verify",
      code: codes["lag@example.com"],
    })
    expect(done.status).toBe(302)
    expect(done.headers.get("location")).toStartWith("https://a.example.com/cb")
  })

  test("OA-5: a stale stored copy never beats this flow's newer cookie", async () => {
    const browser = new Browser(createAuth())
    const tab = await browser.startSignIn("client-a", APP_A)
    const register = tab.replace("/password/authorize", "/password/register")
    await browser.get(register)
    const form = {
      action: "register",
      email: "resent@example.com",
      password: "pw-123456",
      repeat: "pw-123456",
    }
    await browser.post(register, form)
    const key = flowKey(flowIdOf(tab))
    // What a lagging PoP still serves: the state with the first code
    const stale = structuredClone(await Storage.get<any>(storage, key))
    const firstCode = codes["resent@example.com"]
    await browser.post(register, form) // "resend": a new code
    expect(codes["resent@example.com"]).not.toBe(firstCode)
    await Storage.set(storage, key, stale, 600)
    const done = await browser.post(register, {
      action: "verify",
      code: codes["resent@example.com"],
    })
    expect(done.status).toBe(302)
    expect(done.headers.get("location")).toStartWith("https://a.example.com/cb")
  })

  test("a stale code-provider form restarts instead of a 500", async () => {
    const browser = new Browser(createAuth())
    const res = await browser.post("/code/authorize", {
      action: "verify",
      code: "1",
    })
    expect(res.status).toBeLessThan(500)
    expect(await res.text()).not.toContain(UNKNOWN_STATE_TEXT)
  })
})

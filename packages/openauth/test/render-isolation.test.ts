/**
 * Every page render uses its own request's theme and language.
 *
 * Before: the theme lived in a global (`globalThis.OPENAUTH_THEME`), set when an
 * issuer was created and again by the enterprise middleware on each request. A
 * Worker isolate serves many requests at once, so one tenant's page could be
 * drawn with another tenant's theme, and the last issuer created won for all.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import type { StorageAdapter } from "../src/storage/storage.js"
import { PasswordProvider } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"
import { THEME_SST, THEME_TERMINAL, type Theme } from "../src/ui/theme.js"

const subjects = createSubjects({ user: object({ email: string() }) })

let storage: StorageAdapter
beforeEach(() => {
  storage = MemoryStorage()
})

function password() {
  return PasswordProvider(PasswordUI({ sendCode: async () => undefined }))
}

function plainIssuer(theme: Theme) {
  return issuer({
    storage,
    subjects,
    theme,
    allow: async () => true,
    providers: { password: password() },
    success: async (ctx, v) => ctx.subject("user", { email: (v as any).email }),
  })
}

/** Follow /authorize to the password login page, keeping cookies. */
async function loginPage(
  app: {
    request: (url: string, init?: RequestInit) => Response | Promise<Response>
  },
  origin: string,
  lang?: string,
) {
  const host = new URL(origin).host
  const q = new URLSearchParams({
    client_id: "app",
    response_type: "code",
    provider: "password",
    state: "s",
    redirect_uri: "http://localhost/cb",
  })
  if (lang) q.set("lang", lang)
  let res = await app.request(`${origin}/authorize?${q}`, { headers: { host } })
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
  for (let i = 0; i < 5 && res.status === 302; i++) {
    const next = new URL(res.headers.get("location")!, origin)
    if (lang && !next.searchParams.has("lang"))
      next.searchParams.set("lang", lang)
    res = await app.request(next.toString(), { headers: { host, cookie } })
  }
  expect(res.status).toBe(200)
  return res.text()
}

describe("per-request rendering", () => {
  test("two issuers in one isolate each render their own theme", async () => {
    const sst = plainIssuer(THEME_SST)
    const terminal = plainIssuer(THEME_TERMINAL) // created last: used to win
    const [a, b] = await Promise.all([
      loginPage(sst, "https://a.example.com"),
      loginPage(terminal, "https://b.example.com"),
    ])
    expect(a).toContain("<title>SST</title>")
    expect(b).toContain("<title>terminal</title>")
  })

  test("concurrent requests keep their own language and direction", async () => {
    const app = plainIssuer(THEME_SST)
    const pages = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        loginPage(app, "https://a.example.com", i % 2 ? "ar" : "en"),
      ),
    )
    pages.forEach((html, i) => {
      if (i % 2) {
        expect(html).toContain('lang="ar"')
        expect(html).toContain('dir="rtl"')
      } else {
        expect(html).toContain('lang="en"')
        expect(html).toContain('dir="ltr"')
      }
    })
  })

  test("enterprise tenants on one issuer each get their own branding", async () => {
    const tenantService = new TenantServiceImpl(storage)
    await tenantService.createTenant({
      id: "red",
      name: "Red",
      branding: { theme: { primary: "#ff0000", title: "Red Co" } },
    })
    await tenantService.createTenant({
      id: "blue",
      name: "Blue",
      branding: { theme: { primary: "#0000ff", title: "Blue Co" } },
    })
    const { app } = createMultiTenantIssuer({
      tenantService,
      sessionService: new SessionServiceImpl(storage),
      storage,
      sessionSecret: new Uint8Array(32).fill(7),
      subjects,
      tenantResolver: {
        customDomains: new Map([
          ["red.example.com", "red"],
          ["blue.example.com", "blue"],
        ]),
      },
      onAllow: async () => true,
      providers: { password: password() },
      onSuccess: async (ctx, v) =>
        ctx.subject("user", { email: (v as any).email } as any),
    })
    const pages = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        loginPage(app, `https://${i % 2 ? "blue" : "red"}.example.com`),
      ),
    )
    pages.forEach((html, i) => {
      const [mine, other] =
        i % 2 ? ["#0000ff", "#ff0000"] : ["#ff0000", "#0000ff"]
      expect(html).toContain(mine)
      expect(html).not.toContain(other)
    })
  })
})

/**
 * /authorize checks the client registry (clientDb): before, any client_id
 * whose redirect_uri was on the issuer's domain got a sign-in form (prod web
 * even sent client_id=undefined), so a broken client never surfaced.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { object, string } from "valibot"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import type { StorageAdapter } from "../src/storage/storage.js"
import { PasswordProvider } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"

const HOST = "auth.example.com"
const WEB = "https://videos.example.com/api/callback"

function mockD1(rows: any[]) {
  const clients = new Map(rows.map((r) => [r.id, r]))
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        first: mock(async () =>
          sql.includes("FROM oauth_clients WHERE id = ?")
            ? clients.get(params[0]) || null
            : null,
        ),
        run: mock(async () => ({ success: true, meta: { changes: 0 } })),
        all: mock(async () => ({ results: [] })),
      }),
    }),
  }
}

function row(
  id: string,
  o: Partial<{
    tenant: string
    enabled: number
    grants: string[]
    uris: string[]
  }> = {},
) {
  return {
    id,
    tenant_id: o.tenant ?? "default",
    name: id,
    client_secret_hash: "x",
    grant_types: JSON.stringify(
      o.grants ?? ["authorization_code", "refresh_token"],
    ),
    scopes: "[]",
    redirect_uris: JSON.stringify(
      o.uris ?? [WEB, `${WEB}?locale=en`, `${WEB}?locale=ar`],
    ),
    metadata: "{}",
    enabled: o.enabled ?? 1,
    created_at: 0,
    updated_at: 0,
  }
}

let storage: StorageAdapter
const db = mockD1([
  row("web"),
  row("off", { enabled: 0 }),
  row("m2m", { grants: ["client_credentials"], uris: [] }),
  row("other-tenant", { tenant: "other" }),
])

async function app(mode?: "enforce" | "report") {
  const tenantService = new TenantServiceImpl(storage)
  await tenantService.createTenant({ id: "default", name: "Default" })
  return createMultiTenantIssuer({
    tenantService,
    sessionService: new SessionServiceImpl(storage),
    storage,
    sessionSecret: new Uint8Array(32).fill(5),
    subjects: createSubjects({ user: object({ email: string() }) }),
    tenantResolver: { customDomains: new Map([[HOST, "default"]]) },
    clientDb: db as any,
    clientRegistry: mode ? { mode } : undefined,
    restart: { fallbackUrl: "https://videos.example.com/" },
    providers: {
      password: PasswordProvider(
        PasswordUI({ sendCode: async () => undefined }),
      ),
    },
    onSuccess: async (ctx, v) =>
      ctx.subject("user", { email: (v as any).email } as any),
  }).app
}

const authorize = (
  a: Awaited<ReturnType<typeof app>>,
  clientId: string,
  redirect = WEB,
  lang = "",
) =>
  a.request(
    `https://${HOST}/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&state=s&redirect_uri=${encodeURIComponent(redirect)}${lang}`,
    { headers: { host: HOST } },
  )

async function expectRejected(res: Response, reason: string) {
  expect(res.status).toBe(400)
  expect(res.headers.get("location")).toBeNull()
  expect(res.headers.get("content-type")).toContain("text/html")
  const html = await res.text()
  expect(html).toContain('data-page="client-error"')
  expect(html).toContain(`data-error="${reason}"`)
  expect(html).toContain('href="https://videos.example.com/"')
  return html
}

beforeEach(() => {
  storage = MemoryStorage()
})

describe("client registry (enforce)", () => {
  test("a registered client and redirect_uri get the sign-in form", async () => {
    const res = await authorize(await app("enforce"), "web")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toContain("/password/authorize")
  })

  test("each registered query variant matches exactly", async () => {
    const a = await app("enforce")
    for (const v of ["?locale=en", "?locale=ar"]) {
      expect((await authorize(a, "web", WEB + v)).status).toBe(302)
    }
    await expectRejected(
      await authorize(a, "web", `${WEB}?locale=fr`),
      "redirect_uri_not_registered",
    )
  })

  test("unknown client_id (including the literal 'undefined') is rejected", async () => {
    const a = await app("enforce")
    await expectRejected(await authorize(a, "nope"), "unknown_client")
    await expectRejected(await authorize(a, "undefined"), "unknown_client")
  })

  test("a disabled client is rejected", async () => {
    await expectRejected(
      await authorize(await app("enforce"), "off"),
      "client_disabled",
    )
  })

  test("a client without authorization_code (M2M) is rejected", async () => {
    await expectRejected(
      await authorize(await app("enforce"), "m2m"),
      "client_not_allowed",
    )
  })

  test("a client from another tenant is unknown here", async () => {
    await expectRejected(
      await authorize(await app("enforce"), "other-tenant"),
      "unknown_client",
    )
  })

  test("an unregistered redirect_uri on our own domain is rejected", async () => {
    await expectRejected(
      await authorize(
        await app("enforce"),
        "web",
        "https://videos.example.com/elsewhere",
      ),
      "redirect_uri_not_registered",
    )
  })

  test("prompt=none never redirects an unregistered client", async () => {
    const res = await authorize(
      await app("enforce"),
      "nope",
      WEB,
      "&prompt=none",
    )
    await expectRejected(res, "unknown_client")
  })

  test("the error page is Arabic for ?lang=ar", async () => {
    const html = await expectRejected(
      await authorize(await app("enforce"), "nope", WEB, "&lang=ar"),
      "unknown_client",
    )
    expect(html).toContain('dir="rtl"')
    expect(html).toContain("لا يمكن لهذا التطبيق تسجيل دخولك هنا")
  })
})

describe("client registry (report / off)", () => {
  test("report mode logs and continues", async () => {
    const warn = console.warn
    const logs: string[] = []
    console.warn = (m: any) => logs.push(String(m))
    try {
      const res = await authorize(await app("report"), "undefined")
      expect(res.status).toBe(302)
      expect(res.headers.get("location")).toContain("/password/authorize")
    } finally {
      console.warn = warn
    }
    const entry = logs
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .find((e) => e?.event === "authorize_client_rejected")
    expect(entry).toMatchObject({
      mode: "report",
      reason: "unknown_client",
      client_id: "undefined",
    })
  })

  test("unset: no registry check (backward compatible)", async () => {
    expect((await authorize(await app(), "nope")).status).toBe(302)
  })
})

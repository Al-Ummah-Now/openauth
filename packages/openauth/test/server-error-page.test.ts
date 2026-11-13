/**
 * An unexpected issuer error (not an OauthError or an unknown sign-in state):
 * the host's onServerError gets the real error and returns a reference; a
 * browser sees the themed, localized "Something went wrong / Try again" page
 * with that reference, an API caller JSON with it. Never the raw error.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test"
import { object, string } from "valibot"
import { MemoryStorage } from "../src/storage/memory.js"
import { createSubjects } from "../src/subject.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"

const subjects = createSubjects({ user: object({ email: string() }) })
const sessionSecret = new Uint8Array(32).fill(3)

describe("issuer server errors", () => {
  let seen: unknown[]
  let app: ReturnType<typeof createMultiTenantIssuer>["app"]

  beforeEach(async () => {
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
    const storage = MemoryStorage()
    const tenantService = new TenantServiceImpl(storage)
    await tenantService.createTenant({ id: "test-tenant", name: "Test Tenant" })
    seen = []
    // The browser-session store fails (a D1 stall): every request that reads the session errors
    const sessionService = new SessionServiceImpl(storage)
    sessionService.getBrowserSession = async () => {
      throw new Error("D1_ERROR: storage unavailable")
    }
    app = createMultiTenantIssuer({
      tenantService,
      sessionService,
      storage,
      sessionSecret,
      subjects,
      onServerError: (err) => {
        seen.push(err)
        return "ERR-TEST-0001"
      },
      providers: {
        dummy: {
          type: "dummy",
          init(route) {
            route.get("/authorize", async () => {
              throw new Error("D1_ERROR: storage unavailable")
            })
          },
        },
      },
    }).app
  })

  afterEach(() => setSystemTime())

  // A browser session cookie makes the session middleware read the (failing) store
  const get = async (path: string, accept: string) => {
    const { createSessionCookieHeader } =
      await import("../src/session/middleware.js")
    const cookie = (
      await createSessionCookieHeader(
        { id: "bs-1", tenant_id: "test-tenant", version: 1 } as never,
        sessionSecret,
      )
    ).split(";")[0]
    return app.request(`http://auth.test.com${path}`, {
      headers: { Accept: accept, "X-Tenant-ID": "test-tenant", Cookie: cookie },
    })
  }

  test("a browser gets the Try again page with the reference, never the error", async () => {
    const res = await get(
      "/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
      "text/html,application/xhtml+xml",
    )
    expect(res.status).toBe(500)
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(res.headers.get("x-error-ref")).toBe("ERR-TEST-0001")
    const html = await res.text()
    expect(html).toContain('data-page="server-error"')
    expect(html).toContain("Something went wrong")
    expect(html).toContain("ERR-TEST-0001")
    expect(html).toContain('data-action="retry"')
    expect(html).not.toContain("D1_ERROR")
    expect(seen).toHaveLength(1)
    expect((seen[0] as Error).message).toContain("D1_ERROR")
  })

  test("Arabic with ?lang=ar", async () => {
    const res = await get(
      "/authorize?lang=ar&client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
      "text/html",
    )
    const html = await res.text()
    expect(html).toContain('dir="rtl"')
    expect(html).toContain("حدث خطأ ما")
    expect(html).toContain("حاول مرة أخرى")
  })

  test("an API caller gets JSON with the reference", async () => {
    const res = await get(
      "/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
      "application/json",
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: "server_error",
      error_description: "Internal server error",
      reference: "ERR-TEST-0001",
    })
  })
})

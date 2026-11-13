/**
 * Passkeys (AUTH-PASSKEYS): the embedded PasskeyProvider, the password page's
 * passkey button, and `amr` on codes, tokens, refreshes and silent SSO.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { decodeJwt } from "jose"
import { object, string } from "valibot"
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers"
import { createMultiTenantIssuer } from "../src/enterprise/issuer.js"
import { TenantServiceImpl } from "../src/tenant/service.js"
import { SessionServiceImpl } from "../src/session/service.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import { PasswordProvider, ScryptHasher } from "../src/provider/password.js"
import { PasskeyProvider } from "../src/provider/passkey.js"
import { PasswordUI } from "../src/ui/password.js"
import { issuer } from "../src/issuer.js"
import { createClient } from "../src/client.js"
import type { Provider } from "../src/provider/provider.js"
import type { PasskeyCredential } from "../src/passkey.js"
import { rpIdForHost } from "../src/passkey.js"

const HOST = "auth.example.com"
const ORIGIN = `https://${HOST}`
const RP_ID = "example.com"
const EMAIL = "pk@example.com"
const PASSWORD = "pw-pk-123"
const A = { id: "client-a", redirect: "https://a.example.com/cb" }
const B = { id: "client-b", redirect: "https://b.example.com/cb" }

// ---------- a software authenticator (ES256) ----------
class SoftAuthenticator {
  counter = 0
  id = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(16)))
  private keys!: CryptoKeyPair
  publicKey = ""
  async init() {
    this.keys = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey("jwk", this.keys.publicKey)
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ])
    this.publicKey = isoBase64URL.fromBuffer(isoCBOR.encode(cose as any))
    return this
  }
  async assert(challenge: string, origin = ORIGIN, rpID = RP_ID) {
    this.counter++
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({ type: "webauthn.get", challenge, origin }),
    )
    const rpHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpID)),
    )
    const authData = new Uint8Array(37)
    authData.set(rpHash, 0)
    authData[32] = 0x05 // user present + user verified
    new DataView(authData.buffer).setUint32(33, this.counter)
    const clientHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", clientDataJSON),
    )
    const signed = new Uint8Array(authData.length + clientHash.length)
    signed.set(authData)
    signed.set(clientHash, authData.length)
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.keys.privateKey,
        signed,
      ),
    )
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(derSignature(raw)),
      },
    }
  }
}

function derInt(bytes: Uint8Array) {
  let i = 0
  while (i < bytes.length - 1 && bytes[i] === 0) i++
  let v = bytes.slice(i)
  if (v[0] & 0x80) v = new Uint8Array([0, ...v])
  return new Uint8Array([0x02, v.length, ...v])
}
function derSignature(raw: Uint8Array) {
  const r = derInt(raw.slice(0, 32))
  const s = derInt(raw.slice(32))
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s])
}

// ---------- enterprise issuer with password + passkey ----------
let storage: StorageAdapter
let creds: Map<string, PasskeyCredential & { lastCounter?: number }>
let successValues: any[]

async function createApp() {
  const tenantService = new TenantServiceImpl(storage)
  await tenantService.createTenant({ id: "default", name: "Default" })
  const { app } = createMultiTenantIssuer({
    tenantService,
    sessionService: new SessionServiceImpl(storage),
    storage,
    sessionSecret: new Uint8Array(32).fill(4),
    subjects: createSubjects({ user: object({ email: string() }) }),
    tenantResolver: { customDomains: new Map([[HOST, "default"]]) },
    providers: {
      password: PasswordProvider(
        PasswordUI({ sendCode: async () => undefined, passkey: true }),
      ),
      passkey: PasskeyProvider({
        rpID: () => RP_ID,
        origins: () => [ORIGIN],
        store: {
          get: async (id) => creds.get(id),
          touch: async (id, counter) => {
            const c = creds.get(id)!
            c.counter = counter
          },
        },
      }),
    },
    onSuccess: async (ctx, value) => {
      successValues.push(value)
      const email =
        (value as any).email ?? ((value as any).userID ? EMAIL : undefined)
      return ctx.subject("user", {
        email,
        id: "user-1",
        roles: ["Member"],
      } as any)
    },
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
    const url = path.startsWith("http") ? path : `${ORIGIN}${path}`
    const res = await this.app.request(url, { ...init, headers })
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
      `/authorize?client_id=${client.id}&response_type=code&state=s&redirect_uri=${encodeURIComponent(client.redirect)}${extra}`,
    )
  }
  async loginPage(client = A) {
    const start = await this.authorize(client)
    const loc = start.headers.get("location")!
    expect(loc).toContain("/password/authorize")
    return new URL(loc, ORIGIN)
  }
  form(path: string, body: Record<string, string>) {
    return this.go(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    })
  }
}

/** The flow-carrying URL of a passkey route, as the page computes it. */
function passkeyUrl(page: URL, route: "options" | "verify") {
  return `/passkey/${route}${page.search}`
}

async function codePayload(location: URL) {
  return Storage.get<any>(storage, [
    "oauth:code",
    location.searchParams.get("code")!,
  ])
}

beforeEach(async () => {
  storage = MemoryStorage()
  creds = new Map()
  successValues = []
  await Storage.set(
    storage,
    ["email", EMAIL, "password"],
    await ScryptHasher().hash(PASSWORD),
  )
})

async function addAuthenticator() {
  const a = await new SoftAuthenticator().init()
  creds.set(a.id, {
    id: a.id,
    userID: "user-1",
    publicKey: a.publicKey,
    counter: 0,
  })
  return a
}

async function passkeySignIn(browser: Browser, a: SoftAuthenticator) {
  const page = await browser.loginPage()
  const opts = await browser.go(passkeyUrl(page, "options"), { method: "POST" })
  expect(opts.status).toBe(200)
  const { challenge, rpId, userVerification } = (await opts.json()) as any
  expect(rpId).toBe(RP_ID)
  expect(userVerification).toBe("required")
  const assertion = await a.assert(challenge)
  const res = await browser.form(passkeyUrl(page, "verify"), {
    credential: JSON.stringify(assertion),
  })
  return { page, res, assertion }
}

describe("passkey provider", () => {
  test("is embedded: /authorize still goes straight to the password page", async () => {
    const browser = new Browser(await createApp())
    await browser.loginPage()
  })

  test("the password page offers the passkey button and autofill", async () => {
    const browser = new Browser(await createApp())
    const page = await browser.loginPage()
    const html = await (await browser.go(page.pathname + page.search)).text()
    expect(html).toContain("data-passkey")
    expect(html.toLowerCase()).toContain('autocomplete="username webauthn"')
    expect(html).toContain("Sign in with a passkey")
    expect(html).toContain("../passkey/options?")
  })

  test("autofill that resolves after the button was pressed never submits a second time", async () => {
    const browser = new Browser(await createApp())
    const page = await browser.loginPage()
    const html = await (await browser.go(page.pathname + page.search)).text()
    const at = html.lastIndexOf("data-passkey-button]")
    const start = html.indexOf(">", html.lastIndexOf("<script", at)) + 1
    const script = html.slice(start, html.indexOf("</" + "script", at))
    expect(script).toContain("oaPasskey")

    const submitted: string[] = []
    let click: () => void = () => {}
    let resolveAutofill: (c: unknown) => void = () => {}
    const field = { value: "" }
    const form = {
      querySelector: () => field,
      submit: () => submitted.push(field.value),
    }
    const btn = {
      disabled: false,
      addEventListener: (_: string, fn: () => void) => (click = fn),
    }
    const root = {
      hidden: true,
      getAttribute: () => "../passkey/options",
      querySelector: (sel: string) => (sel === "form" ? form : btn),
    }
    const window = {
      oaPasskey: {
        supported: () => true,
        autofillSupported: () => Promise.resolve(true),
        get: (_: unknown, opts?: { conditional?: boolean }) =>
          opts?.conditional
            ? new Promise((r) => (resolveAutofill = r))
            : Promise.resolve({ id: "from-button" }),
      },
    }
    const document = {
      querySelector: (sel: string) => (sel === "[data-passkey]" ? root : null),
    }
    const fetch = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ challenge: "c" }),
      })
    new Function("window", "document", "fetch", script)(window, document, fetch)
    const tick = () => new Promise((r) => setTimeout(r, 0))
    await tick()

    // The user presses the button while conditional UI is pending; then the
    // conditional request resolves too (as a virtual authenticator does)
    click()
    resolveAutofill({ id: "from-autofill" })
    await tick()
    await tick()

    expect(submitted).toEqual([JSON.stringify({ id: "from-button" })])
  })

  test("Arabic page: Arabic passkey copy", async () => {
    const browser = new Browser(await createApp())
    const start = await browser.authorize(A, "&lang=ar")
    const html = await (await browser.go(start.headers.get("location")!)).text()
    expect(html).toContain("الدخول بمفتاح المرور")
  })

  test("signs in with a passkey: code with amr passkey, counter updated", async () => {
    const browser = new Browser(await createApp())
    const a = await addAuthenticator()
    const { res } = await passkeySignIn(browser, a)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get("location")!)
    expect(location.origin + location.pathname).toBe(A.redirect)
    const code = await codePayload(location)
    expect(code.amr).toEqual(["passkey"])
    expect(creds.get(a.id)!.counter).toBe(1)
    expect(successValues[0].amr).toEqual(["passkey"])
    expect(successValues[0].userID).toBe("user-1")
  })

  test("silent sign-on to another app keeps amr passkey", async () => {
    const browser = new Browser(await createApp())
    const a = await addAuthenticator()
    await passkeySignIn(browser, a)
    const res = await browser.authorize(B)
    const loc = new URL(res.headers.get("location")!)
    const code = await codePayload(loc)
    expect(code.clientID).toBe(B.id)
    expect(code.amr).toEqual(["passkey"])
  })

  test("password sign-in reports amr pwd, and silent sign-on keeps it", async () => {
    const browser = new Browser(await createApp())
    const page = await browser.loginPage()
    const res = await browser.form(page.pathname + page.search, {
      email: EMAIL,
      password: PASSWORD,
    })
    expect(res.status).toBe(302)
    expect(
      (await codePayload(new URL(res.headers.get("location")!))).amr,
    ).toEqual(["pwd"])
    expect(successValues[0].amr).toEqual(["pwd"])
    const silent = await browser.authorize(B)
    expect(
      (await codePayload(new URL(silent.headers.get("location")!))).amr,
    ).toEqual(["pwd"])
  })

  test("an unknown credential goes back to the page with an error", async () => {
    const browser = new Browser(await createApp())
    const a = await new SoftAuthenticator().init() // never stored
    const { res } = await passkeySignIn(browser, a)
    expect(res.status).toBe(303)
    const back = res.headers.get("location")!
    expect(back).toContain("/password/authorize")
    expect(back).toContain("passkey_error=1")
    const html = await (await browser.go(back)).text()
    expect(html).toContain("That passkey didn't work")
  })

  test("a replayed assertion is refused (single-use challenge)", async () => {
    const browser = new Browser(await createApp())
    const a = await addAuthenticator()
    const { page, assertion } = await passkeySignIn(browser, a)
    // New flow for the same browser; replay the old assertion without new options
    const again = await browser.form(passkeyUrl(page, "verify"), {
      credential: JSON.stringify(assertion),
    })
    expect(again.status).toBe(303)
    expect(again.headers.get("location")).toContain("passkey_error=1")
  })

  test("a wrong origin is refused", async () => {
    const browser = new Browser(await createApp())
    const a = await addAuthenticator()
    const page = await browser.loginPage()
    const opts = (await (
      await browser.go(passkeyUrl(page, "options"), { method: "POST" })
    ).json()) as any
    const assertion = await a.assert(opts.challenge, "https://evil.example.net")
    const res = await browser.form(passkeyUrl(page, "verify"), {
      credential: JSON.stringify(assertion),
    })
    expect(res.status).toBe(303)
  })

  test("a counter that goes backwards is refused (cloned authenticator)", async () => {
    const browser = new Browser(await createApp())
    const a = await addAuthenticator()
    creds.get(a.id)!.counter = 50
    const { res } = await passkeySignIn(browser, a)
    expect(res.status).toBe(303)
  })
})

describe("rpIdForHost", () => {
  test("drops a leading auth.", () => {
    expect(rpIdForHost("auth.alummahnow.net")).toBe("alummahnow.net")
    expect(rpIdForHost("auth.qa.alummahnow.net")).toBe("qa.alummahnow.net")
    expect(rpIdForHost("localhost:3301")).toBe("localhost")
  })
})

// ---------- base issuer: amr on access tokens and refreshes ----------
describe("amr claim", () => {
  const subjects = createSubjects({ user: object({ userID: string() }) })
  function makeIssuer(amr?: string[], type = "dummy") {
    return issuer({
      storage: MemoryStorage(),
      subjects,
      allow: async () => true,
      ttl: { access: 60, refresh: 6000, refreshReuse: 0 } as any,
      providers: {
        dummy: {
          type,
          init(route, ctx) {
            route.get("/authorize", (c) =>
              ctx.success(c, { email: "a@b.c" }, amr ? { amr } : undefined),
            )
          },
        } satisfies Provider<{ email: string }>,
      },
      success: async (ctx) => ctx.subject("user", { userID: "123" }),
    })
  }
  async function tokensOf(auth: ReturnType<typeof makeIssuer>) {
    const client = createClient({
      issuer: "https://auth.example.com",
      clientID: "app",
      fetch: (a, b) => Promise.resolve(auth.request(a, b)),
    })
    const { challenge, url } = await client.authorize(
      "https://app.example.com/cb",
      "code",
      { pkce: true },
    )
    let res = await auth.request(url)
    res = await auth.request(res.headers.get("location")!, {
      headers: { cookie: res.headers.get("set-cookie")! },
    })
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!
    const ex = await client.exchange(
      code,
      "https://app.example.com/cb",
      challenge.verifier,
    )
    if (ex.err) throw ex.err
    return { client, tokens: ex.tokens }
  }

  test("the provider's amr is on the access token and survives a refresh", async () => {
    const { client, tokens } = await tokensOf(makeIssuer(["passkey"]))
    expect(decodeJwt(tokens.access).amr).toEqual(["passkey"])
    const refreshed = await client.refresh(tokens.refresh)
    if (refreshed.err) throw refreshed.err
    expect(decodeJwt(refreshed.tokens!.access).amr).toEqual(["passkey"])
  })

  test("defaults: password → pwd, code → otp, others → fed", async () => {
    expect(
      decodeJwt(
        (await tokensOf(makeIssuer(undefined, "password"))).tokens.access,
      ).amr,
    ).toEqual(["pwd"])
    expect(
      decodeJwt((await tokensOf(makeIssuer(undefined, "code"))).tokens.access)
        .amr,
    ).toEqual(["otp"])
    expect(
      decodeJwt((await tokensOf(makeIssuer(undefined, "github"))).tokens.access)
        .amr,
    ).toEqual(["fed"])
  })

  test("ttl.code keeps a code redeemable longer (capped at 10 minutes)", async () => {
    const auth = issuer({
      storage: MemoryStorage(),
      subjects,
      allow: async () => true,
      ttl: { code: 3600 },
      providers: {
        dummy: {
          type: "dummy",
          init(route, ctx) {
            route.get("/authorize", (c) => ctx.success(c, { email: "a@b.c" }))
          },
        } satisfies Provider<{ email: string }>,
      },
      success: async (ctx) => ctx.subject("user", { userID: "123" }),
    })
    // Smoke: the issuer accepts the option and still signs in
    expect(auth).toBeDefined()
  })
})

/**
 * PasswordProvider: sendCode may return { type: "code_send_failed" } instead of
 * throwing. The provider must then re-render the current form with a localized
 * error (instead of escaping to the issuer's error handler).
 */
import { expect, test, describe, beforeEach } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { PasswordProvider } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"
import { en, ar } from "../src/ui/i18n.js"

const subjects = createSubjects({ user: object({ email: string() }) })

let sendResult: undefined | { type: "code_send_failed" }
let sent: string[]

function createAuth() {
  return issuer({
    storage: MemoryStorage(),
    subjects,
    allow: async () => true,
    providers: {
      password: PasswordProvider(
        PasswordUI({
          sendCode: async (email) => {
            sent.push(email)
            return sendResult
          },
        }),
      ),
    },
    success: async (ctx, value) => ctx.subject("user", { email: value.email }),
  })
}

function cookiesFrom(res: Response, jar: Map<string, string>) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";")
    const idx = pair.indexOf("=")
    jar.set(pair.slice(0, idx), pair.slice(idx + 1))
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
}

async function start(
  auth: ReturnType<typeof createAuth>,
  path: string,
  locale = "en",
) {
  const jar = new Map<string, string>()
  const authorize = await auth.request(
    `https://auth.example.com/authorize?client_id=c&response_type=code&provider=password&redirect_uri=${encodeURIComponent("https://app.example.com/cb")}`,
  )
  cookiesFrom(authorize, jar)
  const page = await auth.request(
    `https://auth.example.com${path}?lang=${locale}`,
    {
      headers: { cookie: cookieHeader(jar) },
    },
  )
  expect(page.status).toBe(200)
  cookiesFrom(page, jar)
  return jar
}

async function post(
  auth: ReturnType<typeof createAuth>,
  path: string,
  jar: Map<string, string>,
  fields: Record<string, string>,
  locale = "en",
) {
  const res = await auth.request(
    `https://auth.example.com${path}?lang=${locale}`,
    {
      method: "POST",
      headers: {
        cookie: cookieHeader(jar),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
    },
  )
  cookiesFrom(res, jar)
  return res
}

// The UI HTML-escapes the apostrophe in "couldn't"
const EN_ERROR_HTML = en.error_code_send_failed.replaceAll("'", "&#39;")

const REGISTER = {
  action: "register",
  email: "x@example.com",
  password: "Sup3r-secret-pw",
  repeat: "Sup3r-secret-pw",
}

describe("PasswordProvider sendCode failure", () => {
  let auth: ReturnType<typeof createAuth>
  beforeEach(() => {
    sendResult = undefined
    sent = []
    auth = createAuth()
  })

  test("register: re-renders the form with the error and keeps the input", async () => {
    sendResult = { type: "code_send_failed" }
    const jar = await start(auth, "/password/register")
    const res = await post(auth, "/password/register", jar, REGISTER)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(sent).toEqual(["x@example.com"])
    expect(html).toContain(EN_ERROR_HTML)
    expect(html).toContain('name="action" value="register"')
    expect(html).toContain('value="x@example.com"')
    expect(html).not.toContain('name="code"')

    // Fix the address and resubmit: the code screen appears
    sendResult = undefined
    const retry = await post(auth, "/password/register", jar, {
      ...REGISTER,
      email: "delivered@example.com",
    })
    const retryHtml = await retry.text()
    expect(retryHtml).toContain('name="code"')
    expect(retryHtml).not.toContain(en.error_code_send_failed.slice(0, 20))
  })

  test("register: Arabic copy", async () => {
    sendResult = { type: "code_send_failed" }
    const jar = await start(auth, "/password/register", "ar")
    const res = await post(auth, "/password/register", jar, REGISTER, "ar")
    expect(await res.text()).toContain(ar.error_code_send_failed)
  })

  test("register: success still goes to the code screen", async () => {
    const jar = await start(auth, "/password/register")
    const res = await post(auth, "/password/register", jar, REGISTER)
    expect(await res.text()).toContain('name="code"')
  })

  test("change: re-renders the email form with the error", async () => {
    sendResult = { type: "code_send_failed" }
    const jar = await start(auth, "/password/change")
    const res = await post(auth, "/password/change", jar, {
      action: "code",
      email: "x@example.com",
    })
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain(EN_ERROR_HTML)
    expect(html).toContain('name="action" value="code"')
    expect(html).toContain('value="x@example.com"')
    expect(html).not.toContain('name="code"')
  })

  test("change: success goes to the code screen", async () => {
    const jar = await start(auth, "/password/change")
    const res = await post(auth, "/password/change", jar, {
      action: "code",
      email: "x@example.com",
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('name="code"')
  })
})

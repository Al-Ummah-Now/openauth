/**
 * PasswordProvider `checkCode`: every submitted confirmation code goes through
 * the hook (so an app can count attempts in a strongly consistent store), and a
 * `false` rejects the attempt even when the code is right. Replaying the same
 * flow cookie in parallel cannot skip the hook.
 */
import { expect, test, describe, beforeEach } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { PasswordProvider } from "../src/provider/password.js"
import { PasswordUI } from "../src/ui/password.js"
import { Storage } from "../src/storage/storage.js"

const subjects = createSubjects({ user: object({ email: string() }) })
const LIMIT = 5

let codes: Map<string, string>
let calls: Array<{ email: string; code: string }>
let attempts: Map<string, number>
let storage: ReturnType<typeof MemoryStorage>

function createAuth(withHook = true) {
  storage = MemoryStorage()
  return issuer({
    storage,
    subjects,
    allow: async () => true,
    providers: {
      password: PasswordProvider({
        ...PasswordUI({
          sendCode: async (email, code) => {
            codes.set(email, code)
            attempts.set(email, 0)
          },
        }),
        ...(withHook
          ? {
              // In-memory stand-in for an atomic counter: increments before checking
              checkCode: async (email: string, code: string) => {
                calls.push({ email, code })
                const n = (attempts.get(email) ?? 0) + 1
                attempts.set(email, n)
                return n <= LIMIT && codes.get(email) === code
              },
            }
          : {}),
      }),
    },
    success: async (ctx, value) => ctx.subject("user", { email: value.email }),
  })
}

type Auth = ReturnType<typeof createAuth>

function cookiesFrom(res: Response, jar: Map<string, string>) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";")
    const idx = pair.indexOf("=")
    jar.set(pair.slice(0, idx), pair.slice(idx + 1))
  }
}
const cookieHeader = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ")

async function start(auth: Auth, path: string) {
  const jar = new Map<string, string>()
  const authorize = await auth.request(
    `https://auth.example.com/authorize?client_id=c&response_type=code&provider=password&redirect_uri=${encodeURIComponent("https://app.example.com/cb")}`,
  )
  cookiesFrom(authorize, jar)
  const page = await auth.request(`https://auth.example.com${path}`, {
    headers: { cookie: cookieHeader(jar) },
  })
  cookiesFrom(page, jar)
  return jar
}

async function post(
  auth: Auth,
  path: string,
  jar: Map<string, string>,
  fields: Record<string, string>,
  keepCookies = true,
) {
  const res = await auth.request(`https://auth.example.com${path}`, {
    method: "POST",
    headers: {
      cookie: cookieHeader(jar),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields).toString(),
  })
  if (keepCookies) cookiesFrom(res, jar)
  return res
}

const EMAIL = "victim@example.com"
const wrong = (code: string) => (code === "000000" ? "000001" : "000000")

async function changeAtCodeStep(auth: Auth) {
  const jar = await start(auth, "/password/change")
  await post(auth, "/password/change", jar, { action: "code", email: EMAIL })
  return jar
}

describe("PasswordProvider checkCode", () => {
  beforeEach(() => {
    codes = new Map()
    calls = []
    attempts = new Map()
  })

  test("change: the right code passes the hook and reaches the update step", async () => {
    const auth = createAuth()
    const jar = await changeAtCodeStep(auth)
    const res = await post(auth, "/password/change", jar, {
      action: "verify",
      code: codes.get(EMAIL)!,
    })
    expect(calls).toEqual([{ email: EMAIL, code: codes.get(EMAIL)! }])
    expect(await res.text()).toContain('name="repeat"')
  })

  test("change: the hook saying no rejects even the right code", async () => {
    const auth = createAuth()
    const jar = await changeAtCodeStep(auth)
    for (let i = 0; i < LIMIT; i++)
      await post(auth, "/password/change", jar, {
        action: "verify",
        code: wrong(codes.get(EMAIL)!),
      })
    const res = await post(auth, "/password/change", jar, {
      action: "verify",
      code: codes.get(EMAIL)!,
    })
    const html = await res.text()
    expect(html).not.toContain('name="repeat"')
    expect(html).toContain('name="code"')
    expect(calls.length).toBe(LIMIT + 1)
  })

  test("change: 300 parallel replays of one flow are all counted; none past the limit is accepted", async () => {
    const auth = createAuth()
    const jar = await changeAtCodeStep(auth)
    const right = codes.get(EMAIL)!
    // The attacker replays the same cookies with 300 parallel wrong guesses.
    // (Parallel requests complete in any order, so a right guess among them
    // could legitimately land within the limit: it is sent afterwards.)
    const results = await Promise.all(
      Array.from({ length: 300 }, () =>
        post(
          auth,
          "/password/change",
          new Map(jar),
          { action: "verify", code: wrong(right) },
          false,
        ).then((r) => r.text()),
      ),
    )
    expect(calls.length).toBe(300)
    expect(
      results.filter((html) => html.includes('name="repeat"')).length,
    ).toBe(0)
    // Every replay was counted: the right code is now refused too
    const after = await post(
      auth,
      "/password/change",
      new Map(jar),
      { action: "verify", code: right },
      false,
    ).then((r) => r.text())
    expect(calls.length).toBe(301)
    expect(after).not.toContain('name="repeat"')
  })

  test("register: the hook gates email verification and no password is stored", async () => {
    const auth = createAuth()
    const jar = await start(auth, "/password/register")
    await post(auth, "/password/register", jar, {
      action: "register",
      email: EMAIL,
      password: "Sup3r-secret-pw",
      repeat: "Sup3r-secret-pw",
    })
    attempts.set(EMAIL, LIMIT) // limit already used up
    const res = await post(auth, "/password/register", jar, {
      action: "verify",
      code: codes.get(EMAIL)!,
    })
    expect(res.status).toBe(200)
    expect(calls).toEqual([{ email: EMAIL, code: codes.get(EMAIL)! }])
    expect(
      await Storage.get(storage, ["email", EMAIL, "password"]),
    ).toBeUndefined()
  })

  test("without the hook the flow's own code still decides", async () => {
    const auth = createAuth(false)
    const jar = await changeAtCodeStep(auth)
    const bad = await post(auth, "/password/change", jar, {
      action: "verify",
      code: wrong(codes.get(EMAIL)!),
    })
    expect(await bad.text()).not.toContain('name="repeat"')
    const good = await post(auth, "/password/change", jar, {
      action: "verify",
      code: codes.get(EMAIL)!,
    })
    expect(await good.text()).toContain('name="repeat"')
    expect(calls.length).toBe(0)
  })
})

/**
 * The client's `clientCredentials`, `device`, `revoke` and `userinfo`, each
 * against a real in-memory issuer, and how each fails: nothing is thrown.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test"
import { decodeJwt } from "jose"
import { object, string } from "valibot"
import {
  clearClientCache,
  createClient,
  type DeviceAuthorization,
} from "../src/client.js"
import { hashClientSecret } from "../src/client/secret-generator.js"
import { DEVICE_CODE_GRANT } from "../src/device.js"
import { AuthRequestError } from "../src/error.js"
import { issuer } from "../src/issuer.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { createSubjects } from "../src/subject.js"

const HOST = "https://auth.example.com"
const REDIRECT = "https://client.example.com/callback"
const subjects = createSubjects({ user: object({ userID: string() }) })

function row(id: string, hash: string | null, grants: string[], extra = {}) {
  return {
    id,
    tenant_id: "default",
    name: id,
    client_secret_hash: hash,
    grant_types: JSON.stringify(grants),
    scopes: JSON.stringify(["users:read", "users:write"]),
    redirect_uris: JSON.stringify([REDIRECT]),
    metadata: JSON.stringify({}),
    enabled: 1,
    created_at: 0,
    updated_at: 0,
    ...extra,
  }
}

let auth: ReturnType<typeof issuer>
let consoleError: ReturnType<typeof spyOn>
beforeEach(async () => {
  clearClientCache()
  consoleError = spyOn(console, "error").mockImplementation(mock())
  const secret = await hashClientSecret("s3cret")
  const rows: Record<string, any> = {
    server: row("server", secret, ["client_credentials"]),
    web: row("web", secret, ["authorization_code", "refresh_token"]),
    tv: row("tv", null, [DEVICE_CODE_GRANT, "refresh_token"], {
      metadata: JSON.stringify({ type: "native" }),
    }),
  }
  auth = issuer({
    storage: MemoryStorage(),
    subjects,
    issuer: HOST,
    allow: async () => true,
    device: {},
    clientDb: {
      prepare: (sql: string) => ({
        bind: (...params: any[]) => ({
          run: async () => ({ success: true, meta: { changes: 1 } }),
          first: async () =>
            sql.includes("FROM oauth_clients WHERE id = ?")
              ? (rows[params[0]] ?? null)
              : null,
          all: async () => ({ results: [] }),
        }),
      }),
    },
    providers: {
      dummy: {
        type: "dummy",
        init(route: any, ctx: any) {
          route.get("/authorize", async (c: any) =>
            ctx.success(c, { email: "a@example.com" }),
          )
        },
      },
    },
    success: async (ctx: any) => ctx.subject("user", { userID: "u1" }),
  } as any)
})
afterEach(() => {
  consoleError.mockRestore()
  // Shared by the whole process and keyed by issuer: the next file's issuer has
  // the same URL and other keys
  clearClientCache()
})

const onIssuer = (a: any, b?: any) =>
  Promise.resolve(
    auth.request(a, {
      ...b,
      headers: { "cf-connecting-ip": "1.2.3.4", ...b?.headers },
    }),
  )
const client = (
  clientID: string,
  clientSecret?: string,
  f: (a: any, b?: any) => Promise<Response> = onIssuer,
) => createClient({ issuer: HOST, clientID, clientSecret, fetch: f })

const answer = (status: number, body: unknown) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  })
const offline = async (): Promise<Response> => {
  throw new TypeError("fetch failed")
}

function failure(result: { err: unknown }): AuthRequestError {
  expect(result.err).toBeInstanceOf(AuthRequestError)
  return result.err as AuthRequestError
}

/** Sign in through the issuer and exchange the code, as a browser would. */
async function signIn() {
  const web = client("web", "s3cret")
  const { challenge, url } = await web.authorize(REDIRECT, "code", {
    pkce: true,
  })
  let res = await auth.request(url)
  res = await auth.request(res.headers.get("location")!, {
    headers: { cookie: res.headers.get("set-cookie")! },
  })
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!
  const exchanged = await web.exchange(code, REDIRECT, challenge.verifier)
  if (exchanged.err) throw exchanged.err
  return { web, tokens: exchanged.tokens }
}

describe("clientCredentials", () => {
  test("answers a token with the granted scopes", async () => {
    const res = await client("server", "s3cret").clientCredentials({
      scopes: ["users:read"],
    })
    if (res.err) throw res.err
    expect(res.token.expiresIn).toBe(3600)
    expect(res.token.scopes).toEqual(["users:read"])
    expect(decodeJwt(res.token.access)).toMatchObject({
      mode: "m2m",
      sub: "server",
      iss: HOST,
      scope: "users:read",
    })
  })

  test("the server's refusals keep their code and status", async () => {
    const wrong = failure(await client("server", "nope").clientCredentials())
    expect([wrong.error, wrong.status]).toEqual(["invalid_client", 401])
    const scope = failure(
      await client("server", "s3cret").clientCredentials({
        scopes: ["everything"],
      }),
    )
    expect([scope.error, scope.status]).toEqual(["invalid_scope", 400])
    expect(scope.description).toContain("everything")
    const grant = failure(await client("web", "s3cret").clientCredentials())
    expect([grant.error, grant.status]).toEqual(["unauthorized_client", 403])
  })

  test("no network, an error page, an incomplete answer: never thrown", async () => {
    const net = failure(
      await client("server", "s3cret", offline).clientCredentials(),
    )
    expect(net.error).toBe("network_error")
    expect(net.status).toBeUndefined()
    expect((net.cause as Error).message).toBe("fetch failed")

    const page = failure(
      await client(
        "server",
        "s3cret",
        answer(502, "<html>Bad gateway"),
      ).clientCredentials(),
    )
    expect([page.error, page.status]).toEqual(["invalid_response", 502])

    for (const body of [{}, "", [], "null", { access_token: "x" }]) {
      const bad = failure(
        await client("server", "s3cret", answer(200, body)).clientCredentials(),
      )
      expect(bad.error).toBe("invalid_response")
    }
  })

  test("the secret is never in the body or an error", async () => {
    const bodies: string[] = []
    const res = await client("server", "s3cret", async (a, b) => {
      bodies.push(String(a) + String(b.body))
      throw new Error("down")
    }).clientCredentials()
    expect(bodies.join()).not.toContain("s3cret")
    expect(failure(res).message).not.toContain("s3cret")
  })
})

describe("device", () => {
  const start = async (tv = client("tv")) => {
    const started = await tv.device.start()
    if (started.err) throw started.err
    return started.device
  }
  /** Poll at once: what is under test is what poll does with each answer. */
  const eager = (d: DeviceAuthorization) => ({ ...d, interval: 0 })
  const until = (ms: number) => new Promise((r) => setTimeout(r, ms))

  /** Run `poll` with timers that fire at once, recording each wait. */
  async function withFastTimers<T>(run: () => Promise<T>) {
    const waits: number[] = []
    const real = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, ms = 0) => {
      waits.push(ms)
      return real(fn, 0)
    }) as any
    try {
      return { result: await run(), waits }
    } finally {
      globalThis.setTimeout = real
    }
  }

  test("start answers the codes", async () => {
    const before = Date.now()
    const device = await start()
    expect(device.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/)
    expect(device.verificationURI).toBe(`${HOST}/activate`)
    expect(device.verificationURIComplete).toContain(device.userCode)
    expect(device.interval).toBe(5)
    expect(device.expiresAt).toBeGreaterThanOrEqual(before + 600_000)
    expect(device.expiresAt).toBeLessThanOrEqual(Date.now() + 600_000)
  })

  test("a client without the grant is refused", async () => {
    expect(failure(await client("web").device.start()).error).toBe(
      "unauthorized_client",
    )
  })

  test("start fails without throwing", async () => {
    const down = client("tv", undefined, offline)
    expect(failure(await down.device.start()).error).toBe("network_error")
    const odd = client("tv", undefined, answer(200, { device_code: "x" }))
    expect(failure(await odd.device.start()).error).toBe("invalid_response")
  })

  test("the real issuer: pending until the user denies", async () => {
    const device = await start()
    let polls = 0
    const tv = client("tv", undefined, async (a, b) => {
      polls++
      const res = await onIssuer(a, b)
      if (polls === 1) {
        // The user opens the page and denies, between two polls
        const page = await onIssuer(device.verificationURIComplete)
        const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())![1]
        await onIssuer(`${HOST}/activate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            cookie: page.headers.get("set-cookie")!.split(";")[0],
          },
          body: new URLSearchParams({
            user_code: device.userCode,
            csrf: csrf!,
            action: "deny",
          }).toString(),
        })
      }
      return res
    })
    const { result } = await withFastTimers(() => tv.device.poll(eager(device)))
    expect(failure(result).error).toBe("access_denied")
    expect(polls).toBe(2)
  })

  test("the real issuer: pending until the user approves, then tokens", async () => {
    const device = await start()
    const cookieNamed = (res: Response, name: string) =>
      (res.headers.get("set-cookie") ?? "")
        .split(/,\s*(?=[^;=]+=)/)
        .map((c) => c.split(";")[0]!)
        .find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1)
    async function approve() {
      const page = await onIssuer(device.verificationURIComplete)
      const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())![1]
      const confirmed = await onIssuer(`${HOST}/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          cookie: page.headers.get("set-cookie")!.split(";")[0],
        },
        body: new URLSearchParams({
          user_code: device.userCode,
          csrf: csrf!,
          action: "approve",
        }).toString(),
      })
      const handle = cookieNamed(confirmed, "__device_handle")!
      let res = await onIssuer(confirmed.headers.get("location")!)
      const cookie = res.headers.get("set-cookie") ?? ""
      while (!res.headers.get("location")!.includes("/activate/callback"))
        res = await onIssuer(res.headers.get("location")!, {
          headers: { cookie },
        })
      const done = await onIssuer(res.headers.get("location")!, {
        headers: { cookie: handle },
      })
      expect(done.status).toBe(200)
    }
    let polls = 0
    const tv = client("tv", undefined, async (a, b) => {
      const res = await onIssuer(a, b)
      if (++polls === 1) await approve()
      return res
    })
    const { result } = await withFastTimers(() => tv.device.poll(eager(device)))
    if (result.err) throw result.err
    expect(polls).toBe(2)
    const verified = await client("tv").verify(subjects, result.tokens.access)
    if (verified.err) throw verified.err
    expect(verified.subject.properties.userID).toBe("u1")
  })

  /** A server that answers each poll with the next of `answers`. */
  function scripted(...answers: [number, unknown][]) {
    let i = 0
    return client("tv", undefined, async () => {
      const next = answers[i++]
      if (!next) throw new Error("polled after the last answer")
      if (next[0] === 0) throw new TypeError("fetch failed")
      return new Response(JSON.stringify(next[1]), { status: next[0] })
    })
  }
  const device = (over: Partial<DeviceAuthorization> = {}) => ({
    deviceCode: "dc",
    userCode: "BCDF-GHJK",
    verificationURI: `${HOST}/activate`,
    expiresAt: Date.now() + 600_000,
    interval: 5,
    ...over,
  })
  const granted: [number, unknown] = [
    200,
    { access_token: "a", refresh_token: "r", expires_in: 900 },
  ]

  test("waits the interval, slows down when told to, then answers tokens", async () => {
    const tv = scripted(
      [400, { error: "authorization_pending" }],
      [400, { error: "slow_down" }],
      [400, { error: "authorization_pending" }],
      granted,
    )
    const { result, waits } = await withFastTimers(() =>
      tv.device.poll(device()),
    )
    expect(result).toEqual({
      err: false,
      tokens: { access: "a", refresh: "r", expiresIn: 900 },
    })
    expect(waits).toEqual([5000, 5000, 10_000, 10_000])
  })

  test("keeps going through a lost connection and a server error, backing off", async () => {
    const tv = scripted([0, null], [503, "oops"], [429, {}], granted)
    const { result, waits } = await withFastTimers(() =>
      tv.device.poll(device()),
    )
    expect(result.err).toBe(false)
    expect(waits).toEqual([5000, 10_000, 20_000, 40_000])
  })

  test("a final refusal stops at once", async () => {
    for (const error of ["access_denied", "expired_token", "invalid_grant"]) {
      const { result } = await withFastTimers(() =>
        scripted([400, { error }]).device.poll(device()),
      )
      expect(failure(result).error).toBe(error)
    }
  })

  test("an answer without tokens is refused", async () => {
    const { result } = await withFastTimers(() =>
      scripted([200, { access_token: "a" }]).device.poll(device()),
    )
    expect(failure(result).error).toBe("invalid_response")
  })

  test("a code that has run out is not polled", async () => {
    const tv = scripted()
    const res = await tv.device.poll(device({ expiresAt: Date.now() - 1 }))
    expect(failure(res).error).toBe("expired_token")
  })

  test("an interval that is no number waits the default, never in a loop", async () => {
    for (const interval of [NaN, Infinity, -1, undefined as any]) {
      const { result, waits } = await withFastTimers(() =>
        scripted(granted).device.poll(device({ interval })),
      )
      expect(result.err).toBe(false)
      expect(waits).toEqual([5000])
    }
  })

  test("the last wait ends with the code, not an interval later", async () => {
    const { result, waits } = await withFastTimers(() =>
      scripted(granted).device.poll(
        device({ expiresAt: Date.now() + 2000, interval: 60 }),
      ),
    )
    expect(result.err).toBe(false)
    expect(waits[0]).toBeLessThanOrEqual(2000)
  })

  test("abort stops the wait at once, before and during it", async () => {
    const early = new AbortController()
    early.abort()
    const tv = scripted()
    expect(
      failure(await tv.device.poll(device(), { signal: early.signal })).error,
    ).toBe("aborted")

    const later = new AbortController()
    const began = Date.now()
    const polling = tv.device.poll(device(), { signal: later.signal })
    await until(20)
    later.abort()
    expect(failure(await polling).error).toBe("aborted")
    expect(Date.now() - began).toBeLessThan(2000)
  })

  test("abort during a request is an abort, not a network error", async () => {
    const controller = new AbortController()
    const tv = client("tv", undefined, async () => {
      controller.abort()
      throw new DOMException("aborted", "AbortError")
    })
    const { result } = await withFastTimers(() =>
      tv.device.poll(device(), { signal: controller.signal }),
    )
    expect(failure(result).error).toBe("aborted")
  })
})

describe("revoke", () => {
  test("a revoked refresh token is refused", async () => {
    const { web, tokens } = await signIn()
    expect(await web.revoke(tokens.refresh)).toEqual({ err: false })
    expect((await web.refresh(tokens.refresh)).err).toBeTruthy()
  })

  test("revoking twice, or a token nobody has, is fine", async () => {
    const { web, tokens } = await signIn()
    await web.revoke(tokens.refresh, { hint: "refresh_token" })
    expect(await web.revoke(tokens.refresh)).toEqual({ err: false })
    expect(await web.revoke("user:unknown")).toEqual({ err: false })
  })

  test("fails without throwing", async () => {
    const wrong = failure(await client("web", "nope").revoke("user:x"))
    expect([wrong.error, wrong.status]).toEqual(["invalid_client", 401])
    const down = client("web", "s3cret", offline)
    expect(failure(await down.revoke("user:x")).error).toBe("network_error")
  })

  test("an empty answer is a success (RFC 7009)", async () => {
    expect(
      await client("web", "s3cret", answer(200, "")).revoke("user:x"),
    ).toEqual({ err: false })
  })
})

describe("userinfo", () => {
  test("answers the subject's properties", async () => {
    const { web, tokens } = await signIn()
    const info = await web.userinfo(subjects.user, tokens.access)
    if (info.err) throw info.err
    const userID: string = info.properties.userID
    expect(userID).toBe("u1")
  })

  test("a bad token, whichever way the issuer says it", async () => {
    const old = client(
      "web",
      undefined,
      answer(200, { error: "invalid_token" }),
    )
    expect(failure(await old.userinfo(subjects.user, "x")).error).toBe(
      "invalid_token",
    )
    const now = client(
      "web",
      undefined,
      answer(401, { error: "invalid_token" }),
    )
    const err = failure(await now.userinfo(subjects.user, "x"))
    expect([err.error, err.status]).toEqual(["invalid_token", 401])
  })

  test("info that doesn't fit, or no answer, is an error", async () => {
    const odd = client("web", undefined, answer(200, { userID: 5 }))
    expect(failure(await odd.userinfo(subjects.user, "x")).error).toBe(
      "invalid_response",
    )
    const down = client("web", undefined, offline)
    expect(failure(await down.userinfo(subjects.user, "x")).error).toBe(
      "network_error",
    )
  })
})

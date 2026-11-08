import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { clearClientCache, createClient } from "../src/client.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { createSubjects } from "../src/subject.js"

const subjects = createSubjects({ user: object({ userID: string() }) })
const ISSUER = "https://auth-cache.example.com"

function makeIssuer() {
  return issuer({
    storage: MemoryStorage(),
    subjects,
    allow: async () => true,
    success: async (ctx) => ctx.subject("user", { userID: "123" }),
    ttl: { access: 3600 },
    providers: {
      dummy: {
        type: "dummy",
        init(route, ctx) {
          route.get("/authorize", async (c) =>
            ctx.success(c, { email: "a@b.c" }),
          )
        },
      },
    },
  })
}

let auth = makeIssuer()
/** Every request the clients make to the auth server, by path. */
let calls: string[] = []
const countingFetch = (a: any, b?: any) => {
  calls.push(new URL(typeof a === "string" ? a : a.url).pathname)
  return Promise.resolve(auth.request(a, b))
}
const wellKnownCalls = () =>
  calls.filter((p) => p.startsWith("/.well-known/")).length

async function issueToken(): Promise<string> {
  const client = createClient({
    issuer: ISSUER,
    clientID: "123",
    fetch: countingFetch,
  })
  const [verifier, authorization] = await client.pkce(
    "https://client.example.com/callback",
  )
  let response = await auth.request(authorization)
  response = await auth.request(response.headers.get("location")!, {
    headers: { cookie: response.headers.get("set-cookie")! },
  })
  const code = new URL(response.headers.get("location")!).searchParams.get(
    "code",
  )
  const exchanged = await client.exchange(
    code!,
    "https://client.example.com/callback",
    verifier,
  )
  if (exchanged.err) throw exchanged.err
  return exchanged.tokens.access
}

const consoleSpy = spyOn(console, "error").mockImplementation(mock())
afterAll(() => consoleSpy.mockRestore())

beforeEach(() => {
  auth = makeIssuer()
  clearClientCache()
  calls = []
})

describe("discovery and JWKS cache", () => {
  test("a new client per request fetches discovery and JWKS once for N verifies", async () => {
    const token = await issueToken()
    calls = []
    for (let i = 0; i < 50; i++) {
      // the pattern servers use: a fresh client on every request
      const client = createClient({
        issuer: ISSUER,
        clientID: "123",
        fetch: countingFetch,
      })
      const verified = await client.verify(subjects, token)
      expect(verified.err).toBeUndefined()
    }
    expect(
      calls.filter((p) => p === "/.well-known/oauth-authorization-server"),
    ).toHaveLength(1)
    expect(calls.filter((p) => p === "/.well-known/jwks.json")).toHaveLength(1)
  })

  test("concurrent verifies share one in-flight fetch", async () => {
    const token = await issueToken()
    calls = []
    const client = createClient({
      issuer: ISSUER,
      clientID: "123",
      fetch: countingFetch,
    })
    const results = await Promise.all(
      Array.from({ length: 20 }, () => client.verify(subjects, token)),
    )
    expect(results.every((r) => !r.err)).toBe(true)
    expect(wellKnownCalls()).toBe(2)
  })

  test("re-fetches after the TTL", async () => {
    const token = await issueToken()
    const client = createClient({
      issuer: ISSUER,
      clientID: "123",
      fetch: countingFetch,
      cacheTTL: 1000,
    })
    await client.verify(subjects, token)
    calls = []
    const now = Date.now()
    const spy = spyOn(Date, "now").mockReturnValue(now + 1500)
    try {
      expect((await client.verify(subjects, token)).err).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
    expect(wellKnownCalls()).toBe(2)
  })

  test("a token the cached keys reject triggers one re-fetch (rotation)", async () => {
    const client = createClient({
      issuer: ISSUER,
      clientID: "123",
      fetch: countingFetch,
    })
    const oldToken = await issueToken()
    await client.verify(subjects, oldToken)

    // The auth server rotates: new storage, new signing key.
    auth = makeIssuer()
    const newToken = await issueToken()
    calls = []
    const spy = spyOn(Date, "now").mockReturnValue(Date.now() + 31_000)
    try {
      expect((await client.verify(subjects, newToken)).err).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
    expect(calls.filter((p) => p === "/.well-known/jwks.json")).toHaveLength(1)
  })

  test("rotation re-fetches are rate limited", async () => {
    const client = createClient({
      issuer: ISSUER,
      clientID: "123",
      fetch: countingFetch,
    })
    await client.verify(subjects, await issueToken())
    auth = makeIssuer()
    const foreign = await issueToken()
    // The JWKS was fetched moments ago, so tokens the cached key rejects
    // must not trigger a fetch each.
    calls = []
    for (let i = 0; i < 5; i++) await client.verify(subjects, foreign)
    expect(
      calls.filter((p) => p === "/.well-known/jwks.json").length,
    ).toBeLessThanOrEqual(1)
  })

  test("a failed refresh keeps serving the cached keys", async () => {
    const token = await issueToken()
    let fail = false
    const flaky = (a: any, b?: any) =>
      fail
        ? Promise.resolve(new Response("down", { status: 503 }))
        : countingFetch(a, b)
    const client = createClient({
      issuer: ISSUER,
      clientID: "123",
      fetch: flaky,
      cacheTTL: 1000,
    })
    expect((await client.verify(subjects, token)).err).toBeUndefined()
    fail = true
    const spy = spyOn(Date, "now").mockReturnValue(Date.now() + 1500)
    try {
      expect((await client.verify(subjects, token)).err).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })

  test("a failed first fetch is not cached", async () => {
    const token = await issueToken()
    clearClientCache()
    let fail = true
    const flaky = (a: any, b?: any) =>
      fail
        ? Promise.resolve(new Response("down", { status: 503 }))
        : countingFetch(a, b)
    const client = createClient({
      issuer: ISSUER,
      clientID: "123",
      fetch: flaky,
    })
    await expect(client.verify(subjects, token)).rejects.toThrow()
    fail = false
    expect((await client.verify(subjects, token)).err).toBeUndefined()
  })
})

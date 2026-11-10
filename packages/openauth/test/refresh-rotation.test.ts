/**
 * OA-2: refresh-token rotation in the strongly consistent store.
 */
import { describe, expect, test } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createClient } from "../src/client.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import { removeAllRefreshTokens } from "../src/refresh-token.js"
import { EventualKV, SharedAtomicStore } from "./support/consistency-fakes.js"

const HOST = "https://auth.example.com"
const REDIRECT = "https://client.example.com/callback"
const subjects = createSubjects({ user: object({ userID: string() }) })

function makeIssuer(storage: StorageAdapter, ttl?: Record<string, number>) {
  return issuer({
    storage,
    subjects,
    allow: async () => true,
    ...(ttl ? { ttl } : {}),
    providers: {
      dummy: {
        type: "dummy",
        init(route: any, ctx: any) {
          route.get("/authorize", async (c: any) =>
            ctx.success(c, { email: "a@b.c" }),
          )
        },
      } as any,
    },
    success: async (ctx: any) => ctx.subject("user", { userID: "u1" }),
  } as any)
}
type Auth = ReturnType<typeof makeIssuer>

async function signIn(auth: Auth) {
  const client = createClient({
    issuer: HOST,
    clientID: "app",
    fetch: (a, b) => Promise.resolve(auth.request(a, b)),
  })
  const { challenge, url } = await client.authorize(REDIRECT, "code", {
    pkce: true,
  })
  let res = await auth.request(url)
  res = await auth.request(res.headers.get("location")!, {
    headers: { cookie: res.headers.get("set-cookie")! },
  })
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!
  const exchanged = await client.exchange(code, REDIRECT, challenge.verifier)
  if (exchanged.err) throw exchanged.err
  return exchanged.tokens.refresh
}

async function refresh(auth: Auth, token: string) {
  const res = await auth.request(`${HOST}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token,
    }).toString(),
  })
  return { status: res.status, body: (await res.json()) as any }
}

/** PoPs over KV that takes `propagationMs` to replicate, sharing one D1. */
function pops(n: number, propagationMs: number, atomic = true) {
  const kv = new EventualKV(propagationMs)
  const d1 = new SharedAtomicStore()
  const first = makeIssuer(kv.pop(atomic ? d1.adapter() : undefined))
  return {
    kv,
    d1,
    first,
    // Created later: keys are written by then
    more: () =>
      Array.from({ length: n }, () =>
        makeIssuer(kv.pop(atomic ? d1.adapter() : undefined)),
      ),
  }
}

describe("a token issued in one PoP works in another at once", () => {
  test("rotated in A, used in B within KV's replication delay", async () => {
    const env = pops(1, 0)
    const r1 = await signIn(env.first)
    const [b] = env.more()
    // Slow replication from here on
    env.kv.propagationMs = 10_000
    const r2 = (await refresh(env.first, r1)).body.refresh_token
    const res = await refresh(b, r2)
    expect(res.status).toBe(200)
  })

  test("without the atomic store the same request fails (the old defect)", async () => {
    const env = pops(1, 0, false)
    const r1 = await signIn(env.first)
    const [b] = env.more()
    env.kv.propagationMs = 10_000
    const r2 = (await refresh(env.first, r1)).body.refresh_token
    expect((await refresh(b, r2)).status).toBe(400)
  })
})

describe("concurrent rotation", () => {
  test("100 parallel refreshes of one token on 5 PoPs: all succeed with one next token", async () => {
    const env = pops(5, 0)
    const r1 = await signIn(env.first)
    const ps = env.more()
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => refresh(ps[i % 5], r1)),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
    const next = new Set(results.map((r) => r.body.refresh_token))
    expect(next.size).toBe(1)
    // and that next token is stored and works
    expect((await refresh(ps[2], [...next][0])).status).toBe(200)
  })

  test("200 parallel refreshes in one process: one rotation", async () => {
    const auth = makeIssuer(MemoryStorage())
    const r1 = await signIn(auth)
    const results = await Promise.all(
      Array.from({ length: 200 }, () => refresh(auth, r1)),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(new Set(results.map((r) => r.body.refresh_token)).size).toBe(1)
  })
})

describe("reuse after the window revokes only the token family", () => {
  test("the stolen chain dies, the user's other session stays", async () => {
    const storage = MemoryStorage()
    const auth = makeIssuer(storage, { reuse: 1, retention: 3600 })
    const phone = await signIn(auth)
    const laptop = await signIn(auth)
    const rotated = (await refresh(auth, phone)).body.refresh_token
    await new Promise((r) => setTimeout(r, 1100))
    // The old phone token is replayed after the window
    expect((await refresh(auth, phone)).status).toBe(400)
    // Its whole family is revoked, including the rotated token…
    expect((await refresh(auth, rotated)).status).toBe(400)
    // …but the laptop session (another family) is untouched
    expect((await refresh(auth, laptop)).status).toBe(200)
  })

  test("the default window is wider than KV's ~60 s staleness", async () => {
    const auth = makeIssuer(MemoryStorage())
    const r1 = await signIn(auth)
    const a = (await refresh(auth, r1)).body.refresh_token
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 90_000
      const b = await refresh(auth, r1)
      expect(b.status).toBe(200)
      expect(b.body.refresh_token).toBe(a)
    } finally {
      Date.now = realNow
    }
  })
})

describe("compatibility and invalidation", () => {
  test("a token in the plain store (older version) is moved over and rotates once under concurrency", async () => {
    const env = pops(4, 0)
    const r1 = await signIn(env.first)
    const [subject, id] = [
      r1.slice(0, r1.lastIndexOf(":")),
      r1.split(":").pop()!,
    ]
    const key = ["oauth:refresh", subject, id]
    const record = await env.d1.adapter().take(key)
    const plain = env.kv.pop()
    await Storage.set(plain, key, record, 3600)
    const ps = env.more()
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => refresh(ps[i % 4], r1)),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(new Set(results.map((r) => r.body.refresh_token)).size).toBe(1)
    expect(await Storage.get(env.kv.pop(), key)).toBeFalsy()
  })

  test("invalidating a subject removes its tokens from both stores", async () => {
    const env = pops(1, 0)
    const r1 = await signIn(env.first)
    const subject = r1.slice(0, r1.lastIndexOf(":"))
    const storage = env.kv.pop(env.d1.adapter())
    await Storage.set(
      storage,
      ["oauth:refresh", subject, "legacy"],
      { x: 1 },
      60,
    )
    expect(
      await removeAllRefreshTokens(storage, subject),
    ).toBeGreaterThanOrEqual(2)
    expect((await refresh(env.first, r1)).status).toBe(400)
  })
})

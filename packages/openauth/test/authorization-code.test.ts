/**
 * OA-1: the authorization code is single-use across processes, a replay
 * revokes what the code was exchanged for, and presented client credentials
 * must be valid.
 */
import { describe, expect, test } from "bun:test"
import { object, string } from "valibot"
import { decodeJwt } from "jose"
import { issuer } from "../src/issuer.js"
import { createClient } from "../src/client.js"
import { createSubjects } from "../src/subject.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage, type StorageAdapter } from "../src/storage/storage.js"
import { EventualKV, SharedAtomicStore } from "./support/consistency-fakes.js"

const HOST = "https://auth.example.com"
const REDIRECT = "https://client.example.com/callback"
const subjects = createSubjects({ user: object({ userID: string() }) })

function makeIssuer(storage: StorageAdapter, extra: Record<string, any> = {}) {
  return issuer({
    storage,
    subjects,
    allow: async () => true,
    providers: {
      dummy: {
        type: "dummy",
        init(route: any, ctx: any) {
          route.get("/authorize", async (c: any) =>
            ctx.success(c, { email: "foo@bar.com" }),
          )
        },
      } as any,
    },
    success: async (ctx: any) => ctx.subject("user", { userID: "123" }),
    ...extra,
  } as any)
}
type Auth = ReturnType<typeof makeIssuer>

/** Sign in through `auth`; returns the code and the PKCE verifier (if any). */
async function getCode(auth: Auth, pkce = true) {
  const client = createClient({
    issuer: HOST,
    clientID: "app",
    fetch: (a, b) => Promise.resolve(auth.request(a, b)),
  })
  const { challenge, url } = await client.authorize(REDIRECT, "code", { pkce })
  let res = await auth.request(url)
  res = await auth.request(res.headers.get("location")!, {
    headers: { cookie: res.headers.get("set-cookie")! },
  })
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!
  expect(code).toBeTruthy()
  return { code, verifier: challenge.verifier }
}

function exchange(
  auth: Auth,
  code: string,
  verifier?: string,
  extra: Record<string, string> = {},
) {
  return auth.request(`${HOST}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: "app",
      ...(verifier ? { code_verifier: verifier } : {}),
      ...extra,
    }).toString(),
  })
}

function refresh(auth: Auth, token: string) {
  return auth.request(`${HOST}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token,
    }).toString(),
  })
}

describe("single use under concurrency", () => {
  test("500 parallel exchanges of one code in one process: exactly one wins", async () => {
    const auth = makeIssuer(MemoryStorage())
    const { code, verifier } = await getCode(auth)
    const results = await Promise.all(
      Array.from({ length: 500 }, () => exchange(auth, code, verifier)),
    )
    const ok = results.filter((r) => r.status === 200)
    expect(ok.length).toBe(1)
    for (const r of results.filter((r) => r.status !== 200)) {
      expect(r.status).toBe(400)
      expect(((await r.json()) as any).error).toBe("invalid_grant")
    }
  })

  test("200 parallel exchanges across 8 PoPs with stale KV caches: exactly one wins", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const first = makeIssuer(kv.pop(d1.adapter()))
    const { code, verifier } = await getCode(first)
    // PoPs created now: keys exist; each PoP caches what it reads first
    const pops = Array.from({ length: 8 }, () =>
      makeIssuer(kv.pop(d1.adapter())),
    )
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        exchange(pops[i % pops.length], code, verifier),
      ),
    )
    expect(results.filter((r) => r.status === 200).length).toBe(1)
  })

  test("the same PoPs without an atomic store redeem the code many times (the old defect)", async () => {
    const kv = new EventualKV()
    const first = makeIssuer(kv.pop())
    const { code, verifier } = await getCode(first)
    const pops = Array.from({ length: 8 }, () => makeIssuer(kv.pop()))
    // Every PoP reads the code before any of them deletes it
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => exchange(pops[i], code, verifier)),
    )
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(1)
  })
})

describe("replay revokes what the code minted", () => {
  test("refresh tokens of the family (including rotated ones) and the access token", async () => {
    const storage = MemoryStorage()
    const auth = makeIssuer(storage)
    const { code, verifier } = await getCode(auth)
    const first = (await (await exchange(auth, code, verifier)).json()) as any
    expect(first.refresh_token).toBeTruthy()
    // The client rotates its refresh token before the replay
    const rotated = (await (
      await refresh(auth, first.refresh_token)
    ).json()) as any
    expect(rotated.refresh_token).toBeTruthy()

    const replay = await exchange(auth, code, verifier)
    expect(replay.status).toBe(400)
    expect(((await replay.json()) as any).error).toBe("invalid_grant")

    expect((await refresh(auth, rotated.refresh_token)).status).toBe(400)
    const jti = decodeJwt(first.access_token).jti!
    expect(
      await Storage.get(storage, ["oauth:revoked:access", jti]),
    ).toBeTruthy()
  })

  test("a parallel loser revokes the winner's grant", async () => {
    const storage = MemoryStorage()
    const auth = makeIssuer(storage)
    const { code, verifier } = await getCode(auth)
    const results = await Promise.all(
      Array.from({ length: 20 }, () => exchange(auth, code, verifier)),
    )
    const winner = (await results.find((r) => r.status === 200)!.json()) as any
    expect((await refresh(auth, winner.refresh_token)).status).toBe(400)
  })

  test("tokens from other codes of the same user are untouched", async () => {
    const auth = makeIssuer(MemoryStorage())
    const a = await getCode(auth)
    const b = await getCode(auth)
    await exchange(auth, a.code, a.verifier)
    const other = (await (
      await exchange(auth, b.code, b.verifier)
    ).json()) as any
    await exchange(auth, a.code, a.verifier) // replay of a
    expect((await refresh(auth, other.refresh_token)).status).toBe(200)
  })

  test("a failed check does not use the code up", async () => {
    const auth = makeIssuer(MemoryStorage())
    const { code, verifier } = await getCode(auth)
    const wrong = await exchange(auth, code, "x".repeat(64))
    expect(wrong.status).toBe(400)
    expect((await exchange(auth, code, verifier)).status).toBe(200)
  })
})

describe("client authentication", () => {
  test("a presented client_secret must be valid", async () => {
    const auth = makeIssuer(MemoryStorage())
    const { code, verifier } = await getCode(auth)
    const res = await exchange(auth, code, verifier, {
      client_secret: "guess",
    })
    expect(res.status).toBe(401)
    expect(((await res.json()) as any).error).toBe("invalid_client")
  })

  test("requireForCodeExchange: a code without PKCE needs client authentication", async () => {
    const auth = makeIssuer(MemoryStorage(), {
      pkce: { requireForCodeExchange: true },
    })
    const plain = await getCode(auth, false)
    const res = await exchange(auth, plain.code)
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error_description).toContain("PKCE")
    const withPkce = await getCode(auth, true)
    expect(
      (await exchange(auth, withPkce.code, withPkce.verifier)).status,
    ).toBe(200)
  })

  test("without the flag a code without PKCE still works (existing clients)", async () => {
    const auth = makeIssuer(MemoryStorage())
    const { code } = await getCode(auth, false)
    expect((await exchange(auth, code)).status).toBe(200)
  })
})

describe("compatibility", () => {
  test("a code written to the plain store by an older version is honoured once", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const storage = kv.pop(d1.adapter())
    const auth = makeIssuer(storage)
    const { code, verifier } = await getCode(auth)
    // Move the code to where the previous version kept it
    const payload = await d1.adapter().take(["oauth:code", code])
    await Storage.set(storage, ["oauth:code", code], payload, 60)
    expect((await exchange(auth, code, verifier)).status).toBe(200)
    expect((await exchange(auth, code, verifier)).status).toBe(400)
  })

  test("an adapter without an atomic store keeps working sequentially", async () => {
    const kv = new EventualKV()
    const auth = makeIssuer(kv.pop())
    const { code, verifier } = await getCode(auth)
    expect((await exchange(auth, code, verifier)).status).toBe(200)
    expect((await exchange(auth, code, verifier)).status).toBe(400)
  })
})

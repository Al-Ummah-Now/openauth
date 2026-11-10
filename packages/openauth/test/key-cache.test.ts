/**
 * OA-6: keys are not re-listed and re-imported on every request.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { object, string } from "valibot"
import { issuer } from "../src/issuer.js"
import { createSubjects } from "../src/subject.js"
import {
  clearKeyCache,
  encryptionKeys,
  legacySigningKeys,
  signingKeys,
} from "../src/keys.js"
import type { StorageAdapter } from "../src/storage/storage.js"
import { EventualKV, SharedAtomicStore } from "./support/consistency-fakes.js"

afterEach(() => clearKeyCache())

/** A fresh adapter object per "request" over the same stores, counting reads. */
function perRequest(kv: EventualKV, d1: SharedAtomicStore, scope?: string) {
  const counts = { scans: 0, atomicGets: 0 }
  const make = (): StorageAdapter => {
    const base = kv.pop(d1.adapter())
    const atomic = base.atomic!
    return {
      ...base,
      ...(scope ? { scope } : {}),
      scan(prefix) {
        counts.scans++
        return base.scan(prefix)
      },
      atomic: {
        ...atomic,
        get(key) {
          counts.atomicGets++
          return atomic.get(key)
        },
      },
    }
  }
  return { counts, make }
}

describe("module-scope key cache", () => {
  test("100 requests with a scope: keys load once", async () => {
    const env = perRequest(new EventualKV(), new SharedAtomicStore(), "kv-1")
    await Promise.all(
      Array.from({ length: 100 }, async () => {
        const s = env.make()
        await signingKeys(s)
        await encryptionKeys(s)
        await legacySigningKeys(s)
      }),
    )
    const first = { ...env.counts }
    for (let i = 0; i < 100; i++) {
      const s = env.make()
      await signingKeys(s)
      await encryptionKeys(s)
      await legacySigningKeys(s)
    }
    expect(env.counts).toEqual(first)
    expect(first.scans).toBeLessThanOrEqual(3)
  })

  test("the legacy RS512 list is kept in the atomic store: no KV list after the first", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const env = perRequest(kv, d1) // no scope: no module cache
    await legacySigningKeys(env.make())
    const scans = env.counts.scans
    for (let i = 0; i < 20; i++) await legacySigningKeys(env.make())
    expect(env.counts.scans).toBe(scans)
  })

  test("different scopes do not share keys", async () => {
    const a = perRequest(new EventualKV(), new SharedAtomicStore(), "a")
    const b = perRequest(new EventualKV(), new SharedAtomicStore(), "b")
    const ka = await signingKeys(a.make())
    const kb = await signingKeys(b.make())
    expect(ka[0].id).not.toBe(kb[0].id)
  })

  test("an issuer built per request serves JWKS without listing storage each time", async () => {
    const env = perRequest(new EventualKV(), new SharedAtomicStore(), "kv-2")
    const subjects = createSubjects({ user: object({ id: string() }) })
    const build = () =>
      issuer({
        storage: env.make(),
        subjects,
        providers: {},
        success: async () => new Response(),
      } as any)
    const first = await (
      await build().request("https://a.example/.well-known/jwks.json")
    ).json()
    const scans = env.counts.scans
    for (let i = 0; i < 30; i++) {
      const jwks = await (
        await build().request("https://a.example/.well-known/jwks.json")
      ).json()
      expect(jwks).toEqual(first)
    }
    expect(env.counts.scans).toBe(scans)
  })
})

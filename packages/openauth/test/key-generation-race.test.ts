/**
 * OA-3: key creation is atomic, every key has its own kid, and every key is
 * published, so processes racing on a fresh environment agree on one key.
 */
import { describe, expect, test } from "bun:test"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { encryptionKeys, signingKeys } from "../src/keys.js"
import { Storage } from "../src/storage/storage.js"
import { EventualKV, SharedAtomicStore } from "./support/consistency-fakes.js"

async function serialized(id: string, created: number, expired?: number) {
  const pair = await generateKeyPair("ES256", { extractable: true })
  return {
    id,
    publicKey: await exportSPKI(pair.publicKey),
    privateKey: await exportPKCS8(pair.privateKey),
    created,
    alg: "ES256",
    ...(expired ? { expired } : {}),
  }
}

describe("fresh environment, many PoPs at once", () => {
  test("40 concurrent first loads on 8 stale PoPs agree on one signing key", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const pops = Array.from({ length: 8 }, () => kv.pop(d1.adapter()))
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => signingKeys(pops[i % 8])),
    )
    const active = new Set(results.map((keys) => keys[0].id))
    expect(active.size).toBe(1)
    // Every PoP publishes that key
    for (const keys of results)
      expect(keys.map((k) => k.id)).toContain([...active][0])
    // and the public key every PoP returns is the same one
    const jwks = new Set(results.map((keys) => JSON.stringify(keys[0].jwk)))
    expect(jwks.size).toBe(1)
  })

  test("the same for the encryption key", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const pops = Array.from({ length: 6 }, () => kv.pop(d1.adapter()))
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => encryptionKeys(pops[i % 6])),
    )
    expect(new Set(results.map((keys) => keys[0].id)).size).toBe(1)
  })

  test("without an atomic store the PoPs create different keys (the old defect)", async () => {
    const kv = new EventualKV()
    const pops = Array.from({ length: 8 }, () => kv.pop())
    const results = await Promise.all(pops.map((p) => signingKeys(p)))
    expect(new Set(results.map((keys) => keys[0].id)).size).toBeGreaterThan(1)
  })
})

describe("existing keys", () => {
  test("the production key under signing:key/primary is adopted, not replaced", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const primary = await serialized("primary", 1_700_000_000_000)
    await Storage.set(kv.pop(), ["signing:key", "primary"], primary)
    const pops = Array.from({ length: 5 }, () => kv.pop(d1.adapter()))
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => signingKeys(pops[i % 5])),
    )
    for (const keys of results) {
      expect(keys).toHaveLength(1)
      expect(keys[0].id).toBe("primary")
    }
  })

  test("every key is published; the newest non-expired one signs", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const storage = kv.pop(d1.adapter())
    const now = Date.now()
    const old = await serialized("old", now - 3000, now - 1000)
    const a = await serialized("a", now - 2000)
    const b = await serialized("b", now - 1000)
    await d1.adapter().set(["keys:signing"], { keys: [old, a, b] })
    const keys = await signingKeys(storage)
    expect(keys.map((k) => k.id)).toEqual(["b", "a", "old"])
    expect(keys[2].expired).toBeDefined()
  })

  test("when every key has expired, exactly one new key is added", async () => {
    const kv = new EventualKV()
    const d1 = new SharedAtomicStore()
    const old = await serialized("old", 1, 2)
    await d1.adapter().set(["keys:signing"], { keys: [old] })
    const pops = Array.from({ length: 4 }, () => kv.pop(d1.adapter()))
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) => signingKeys(pops[i % 4])),
    )
    const active = new Set(results.map((keys) => keys[0].id))
    expect(active.size).toBe(1)
    expect([...active][0]).not.toBe("old")
    const index = await d1.adapter().get(["keys:signing"])
    expect(index.keys.map((k: any) => k.id)).toEqual([...active, "old"])
  })
})

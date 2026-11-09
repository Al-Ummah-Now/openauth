/**
 * OA-8: rate limits are exact across isolates (atomic counters), and no
 * limiter silently counts per isolate.
 */
import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage } from "../src/storage/storage.js"
import { hitRateLimit } from "../src/device.js"
import { atomicStore, rateLimit } from "../src/middleware/rate-limit.js"
import { EventualKV, SharedAtomicStore } from "./support/consistency-fakes.js"

describe("atomic increment", () => {
  test("500 parallel increments on the memory store: exact", async () => {
    const a = Storage.atomic(MemoryStorage())
    await Promise.all(Array.from({ length: 500 }, () => a.increment!(["n"], 1)))
    expect(await a.get(["n"])).toBe(500)
  })

  test("300 parallel increments through the compare-and-set fallback: exact", async () => {
    const d1 = new SharedAtomicStore() // no native increment
    const kv = new EventualKV()
    const pops = Array.from({ length: 6 }, () => kv.pop(d1.adapter()))
    await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        Storage.atomic(pops[i % 6]).increment!(["n"], 1),
      ),
    )
    expect(await d1.adapter().get(["n"])).toBe(300)
  })
})

describe("device-flow limits", () => {
  test("200 parallel lookups on 8 PoPs with a limit of 10: exactly 10 allowed", async () => {
    const d1 = new SharedAtomicStore()
    const kv = new EventualKV()
    const pops = Array.from({ length: 8 }, () => kv.pop(d1.adapter()))
    const now = Date.now()
    const limited = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        hitRateLimit(pops[i % 8], "lookup", "1.2.3.4", 10, now),
      ),
    )
    expect(limited.filter((l) => !l).length).toBe(10)
  })
})

describe("middleware", () => {
  test("atomicStore: 150 parallel requests over 5 isolates, max 50: exactly 50 pass", async () => {
    const d1 = new SharedAtomicStore()
    const kv = new EventualKV()
    const apps = Array.from({ length: 5 }, () => {
      const app = new Hono()
      app.use(
        rateLimit(
          { max: 50, window: 60 },
          {
            store: atomicStore(kv.pop(d1.adapter())),
            keyGenerator: () => "client-1",
          },
        ),
      )
      app.get("/", (c) => c.text("ok"))
      app.onError((_e, c) => c.text("limited", 429))
      return app
    })
    const results = await Promise.all(
      Array.from({ length: 150 }, (_, i) => apps[i % 5].request("/")),
    )
    expect(results.filter((r) => r.status === 200).length).toBe(50)
  })

  test("no store means no limiter, not a per-isolate one", () => {
    expect(() => rateLimit({ max: 1, window: 60 })).toThrow(/pass a store/)
  })
})

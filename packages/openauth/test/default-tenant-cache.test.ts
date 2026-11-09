/**
 * OA-9: a default-tenant change made in one isolate reaches the others.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_TENANT_VERSION_CHECK_MS,
  DEFAULT_TENANT_VERSION_KEY,
  getDefaultTenantTheme,
  invalidateDefaultTenantCache,
} from "../src/enterprise/default-tenant-cache.js"
import { Storage } from "../src/storage/storage.js"
import { EventualKV, SharedAtomicStore } from "./support/consistency-fakes.js"

const realNow = Date.now
afterEach(async () => {
  Date.now = realNow
  await invalidateDefaultTenantCache()
})

function tenants(color: { value: string }) {
  let reads = 0
  return {
    get reads() {
      return reads
    },
    service: {
      async getTenant() {
        reads++
        return {
          id: "default",
          status: "active",
          branding: { theme: { primary: color.value } },
        }
      },
    } as any,
  }
}

describe("default tenant cache", () => {
  test("the TTL is short (60 s), not an hour", () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(60_000)
  })

  test("a change published by another isolate is picked up within the version check", async () => {
    const d1 = new SharedAtomicStore()
    const kv = new EventualKV()
    const color = { value: "red" }
    const t = tenants(color)
    const here = kv.pop(d1.adapter())
    let now = realNow()
    Date.now = () => now
    expect(await getDefaultTenantTheme(t.service, here)).toEqual({
      primary: "red",
    })
    // Another isolate updates the tenant and publishes a new version
    color.value = "green"
    await Storage.atomic(kv.pop(d1.adapter())).set(
      DEFAULT_TENANT_VERSION_KEY,
      "v2",
    )
    expect(await getDefaultTenantTheme(t.service, here)).toEqual({
      primary: "red",
    }) // still within the check interval
    now += DEFAULT_TENANT_VERSION_CHECK_MS + 1
    expect(await getDefaultTenantTheme(t.service, here)).toEqual({
      primary: "green",
    })
  })

  test("unchanged version: no reload until the TTL", async () => {
    const d1 = new SharedAtomicStore()
    const here = new EventualKV().pop(d1.adapter())
    const t = tenants({ value: "red" })
    let now = realNow()
    Date.now = () => now
    await getDefaultTenantTheme(t.service, here)
    for (let i = 0; i < 10; i++) {
      now += DEFAULT_TENANT_VERSION_CHECK_MS + 1
      await getDefaultTenantTheme(t.service, here)
    }
    expect(t.reads).toBe(1)
    now += DEFAULT_CACHE_TTL_MS
    await getDefaultTenantTheme(t.service, here)
    expect(t.reads).toBe(2)
  })

  test("invalidate with a storage adapter publishes a new version", async () => {
    const d1 = new SharedAtomicStore()
    const s = new EventualKV().pop(d1.adapter())
    await invalidateDefaultTenantCache(s)
    const v1 = await d1.adapter().get(DEFAULT_TENANT_VERSION_KEY)
    await invalidateDefaultTenantCache(s)
    expect(await d1.adapter().get(DEFAULT_TENANT_VERSION_KEY)).not.toBe(v1)
  })
})

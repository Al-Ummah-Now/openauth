/**
 * Fakes for multi-process tests.
 *
 * - `SharedAtomicStore`: an honest atomic store (what a D1 table or a Durable
 *   Object gives). Every operation waits a random few ms first, like a network
 *   round trip, then runs its check-and-act synchronously, so concurrent
 *   callers interleave but each operation is linearizable.
 * - `EventualKV`: a KV-like store. Each "PoP" keeps its own read cache: the
 *   first read of a key (including a miss) is cached and never refreshed,
 *   which is the worst case of Cloudflare KV's ~60 s edge cache. A write is
 *   visible to the writing PoP at once and to other PoPs only on keys they
 *   have not read yet.
 */
import {
  joinKey,
  splitKey,
  type AtomicStorageAdapter,
  type StorageAdapter,
} from "../../src/storage/storage.js"

const roundTrip = () =>
  new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)))

type Entry = { json: string; expiry?: number }

export class SharedAtomicStore {
  readonly rows = new Map<string, Entry>()
  /** Operations that changed state (for assertions). */
  writes = 0

  private live(k: string) {
    const e = this.rows.get(k)
    if (!e) return undefined
    if (e.expiry !== undefined && Date.now() >= e.expiry) {
      this.rows.delete(k)
      return undefined
    }
    return e
  }

  adapter(): AtomicStorageAdapter {
    const put = (k: string, value: any, expiry?: Date) => {
      this.rows.set(k, {
        json: JSON.stringify(value),
        expiry: expiry?.getTime(),
      })
      this.writes++
    }
    return {
      get: async (key) => {
        await roundTrip()
        const e = this.live(joinKey(key))
        return e ? JSON.parse(e.json) : undefined
      },
      set: async (key, value, expiry) => {
        await roundTrip()
        put(joinKey(key), value, expiry)
      },
      add: async (key, value, expiry) => {
        await roundTrip()
        const k = joinKey(key)
        if (this.live(k)) return false
        put(k, value, expiry)
        return true
      },
      replace: async (key, expected, value, expiry) => {
        await roundTrip()
        const k = joinKey(key)
        const e = this.live(k)
        if (!e || e.json !== JSON.stringify(expected)) return false
        put(k, value, expiry)
        return true
      },
      take: async (key) => {
        await roundTrip()
        const k = joinKey(key)
        const e = this.live(k)
        if (!e) return undefined
        this.rows.delete(k)
        this.writes++
        return JSON.parse(e.json)
      },
      remove: async (key) => {
        await roundTrip()
        this.rows.delete(joinKey(key))
      },
      removePrefix: async (prefix) => {
        await roundTrip()
        const p = joinKey([...prefix, ""])
        let n = 0
        for (const k of [...this.rows.keys()])
          if (k.startsWith(p)) {
            this.rows.delete(k)
            n++
          }
        return n
      },
    }
  }
}

export class EventualKV {
  readonly global = new Map<string, Entry>()
  /**
   * @param propagationMs  how long a write takes to reach the other PoPs
   *   (Cloudflare: up to ~60 s). 0 = at once.
   */
  constructor(public propagationMs = 0) {}

  private publish(apply: () => void) {
    if (this.propagationMs) setTimeout(apply, this.propagationMs)
    else apply()
  }

  /** One PoP's view. `atomic` is attached as the adapter's atomic store. */
  pop(atomic?: AtomicStorageAdapter): StorageAdapter {
    const cache = new Map<string, Entry | null>()
    const read = (k: string) => {
      if (!cache.has(k)) cache.set(k, this.global.get(k) ?? null)
      const e = cache.get(k)
      if (!e) return undefined
      if (e.expiry !== undefined && Date.now() >= e.expiry) return undefined
      return JSON.parse(e.json)
    }
    const adapter: StorageAdapter = {
      get: async (key) => {
        await roundTrip()
        return read(joinKey(key))
      },
      set: async (key, value, expiry) => {
        await roundTrip()
        const e = { json: JSON.stringify(value), expiry: expiry?.getTime() }
        this.publish(() => this.global.set(joinKey(key), e))
        cache.set(joinKey(key), e)
      },
      remove: async (key) => {
        await roundTrip()
        this.publish(() => this.global.delete(joinKey(key)))
        cache.set(joinKey(key), null)
      },
      scan: async function* (this: EventualKV, prefix: string[]) {
        const p = joinKey([...prefix, ""])
        for (const k of [...this.global.keys()]) {
          if (!k.startsWith(p)) continue
          const v = read(k)
          if (v !== undefined) yield [splitKey(k), v] as [string[], any]
        }
      }.bind(this),
    }
    if (atomic) adapter.atomic = atomic
    return adapter
  }
}

/**
 * Configure OpenAuth to use a simple in-memory store.
 *
 * :::caution
 * This is not meant to be used in production.
 * :::
 *
 * This is useful for testing and development. It's not meant to be used in production.
 *
 * ```ts
 * import { MemoryStorage } from "@openauthjs/openauth/storage/memory"
 *
 * const storage = MemoryStorage()
 *
 * export default issuer({
 *   storage,
 *   // ...
 * })
 * ```
 *
 * Optionally, you can persist the store to a file.
 *
 * ```ts
 * MemoryStorage({
 *   persist: "./persist.json"
 * })
 * ```
 *
 * @packageDocumentation
 */
import {
  joinKey,
  joinKeyLegacy,
  splitKey,
  type AtomicStorageAdapter,
  type StorageAdapter,
} from "./storage.js"
import { existsSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"

/**
 * Configure the memory store.
 */
export interface MemoryStorageOptions {
  /**
   * Optionally, backup the store to a file. So it'll be persisted when the issuer restarts.
   *
   * @example
   * ```ts
   * {
   *   persist: "./persist.json"
   * }
   * ```
   */
  persist?: string
}
export function MemoryStorage(input?: MemoryStorageOptions): StorageAdapter {
  const store = [] as [
    string,
    { value: Record<string, any>; expiry?: number },
  ][]

  if (input?.persist) {
    if (existsSync(input.persist)) {
      const file = readFileSync(input?.persist)
      store.push(...JSON.parse(file.toString()))
    }
  }

  async function save() {
    if (!input?.persist) return
    const file = JSON.stringify(store)
    await writeFile(input.persist, file)
  }

  function search(key: string) {
    let left = 0
    let right = store.length - 1
    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const comparison = key.localeCompare(store[mid][0])

      if (comparison === 0) {
        return { found: true, index: mid }
      } else if (comparison < 0) {
        right = mid - 1
      } else {
        left = mid + 1
      }
    }
    return { found: false, index: left }
  }
  /** The live entry for a key (new format), dropping it if expired. Synchronous. */
  function live(joined: string) {
    const match = search(joined)
    if (!match.found) return { match, entry: undefined }
    const entry = store[match.index][1]
    if (entry.expiry && Date.now() >= entry.expiry) {
      store.splice(match.index, 1)
      return { match: search(joined), entry: undefined }
    }
    return { match, entry }
  }
  function put(joined: string, value: any, expiry?: Date) {
    const { match } = live(joined)
    const entry = [
      joined,
      { value, expiry: expiry ? expiry.getTime() : undefined },
    ] as (typeof store)[number]
    if (match.found) store[match.index] = entry
    else store.splice(match.index, 0, entry)
  }
  // Every check-and-act below runs synchronously (no await between the check
  // and the write), so it is atomic within the single JavaScript thread.
  const atomic: AtomicStorageAdapter = {
    async get(key) {
      return live(joinKey(key)).entry?.value
    },
    async set(key, value, expiry) {
      put(joinKey(key), value, expiry)
      await save()
    },
    async add(key, value, expiry) {
      const joined = joinKey(key)
      if (live(joined).entry) return false
      put(joined, value, expiry)
      await save()
      return true
    },
    async replace(key, expected, value, expiry) {
      const joined = joinKey(key)
      const { entry } = live(joined)
      if (!entry || JSON.stringify(entry.value) !== JSON.stringify(expected))
        return false
      put(joined, value, expiry)
      await save()
      return true
    },
    async take(key) {
      const joined = joinKey(key)
      const { match, entry } = live(joined)
      if (!entry) return undefined
      store.splice(match.index, 1)
      await save()
      return entry.value
    },
    async remove(key) {
      const { match, entry } = live(joinKey(key))
      if (!entry) return
      store.splice(match.index, 1)
      await save()
    },
    async removePrefix(prefix) {
      const p = joinKey([...prefix, ""])
      let n = 0
      for (let i = store.length - 1; i >= 0; i--) {
        if (store[i][0].startsWith(p)) {
          store.splice(i, 1)
          n++
        }
      }
      if (n) await save()
      return n
    },
  }
  return {
    atomic,
    async get(key: string[]) {
      // Try new format first
      let match = search(joinKey(key))
      if (!match.found) {
        // Fall back to legacy format for migration
        match = search(joinKeyLegacy(key))
      }
      if (!match.found) return undefined
      const entry = store[match.index][1]
      if (entry.expiry && Date.now() >= entry.expiry) {
        store.splice(match.index, 1)
        await save()
        return undefined
      }
      return entry.value
    },
    async set(key: string[], value: any, expiry?: Date) {
      const joined = joinKey(key)
      const match = search(joined)
      // Handle both Date objects and TTL numbers while maintaining Date type in signature
      const entry = [
        joined,
        {
          value,
          expiry: expiry ? expiry.getTime() : expiry,
        },
      ] as (typeof store)[number]
      if (!match.found) {
        store.splice(match.index, 0, entry)
      } else {
        store[match.index] = entry
      }
      await save()
    },
    async remove(key: string[]) {
      // Remove both new and legacy format keys
      const newMatch = search(joinKey(key))
      if (newMatch.found) {
        store.splice(newMatch.index, 1)
      }
      const legacyMatch = search(joinKeyLegacy(key))
      if (legacyMatch.found) {
        store.splice(legacyMatch.index, 1)
      }
      if (newMatch.found || legacyMatch.found) {
        await save()
      }
    },
    async *scan(prefix: string[]) {
      const now = Date.now()
      const prefixStr = joinKey(prefix)
      const legacyPrefixStr = joinKeyLegacy(prefix)
      const seenKeys = new Set<string>()
      for (const [key, entry] of store) {
        // Match both new and legacy format prefixes
        if (!key.startsWith(prefixStr) && !key.startsWith(legacyPrefixStr))
          continue
        if (entry.expiry && now >= entry.expiry) continue
        // Deduplicate by parsed key
        const parsedKey = splitKey(key)
        const keyStr = JSON.stringify(parsedKey)
        if (seenKeys.has(keyStr)) continue
        seenKeys.add(keyStr)
        yield [parsedKey, entry.value]
      }
    },
  }
}

/**
 * Configure OpenAuth to use [Cloudflare KV](https://developers.cloudflare.com/kv/) as a
 * storage adapter.
 *
 * ```ts
 * import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
 *
 * const storage = CloudflareStorage({
 *   namespace: "my-namespace"
 * })
 *
 *
 * export default issuer({
 *   storage,
 *   // ...
 * })
 * ```
 *
 * @packageDocumentation
 */
import type { KVNamespace } from "@cloudflare/workers-types"
import { joinKey, joinKeyLegacy, splitKey, StorageAdapter } from "./storage.js"

/**
 * Configure the Cloudflare KV store that's created.
 */
export interface CloudflareStorageOptions {
  namespace: KVNamespace
}
/**
 * Creates a Cloudflare KV store.
 * @param options - The config for the adapter.
 */
export function CloudflareStorage(
  options: CloudflareStorageOptions,
): StorageAdapter {
  return {
    async get(key: string[]) {
      // Try new format first
      let value = await options.namespace.get(joinKey(key), "json")
      if (value) return value as Record<string, any>

      // Fall back to legacy format for migration
      value = await options.namespace.get(joinKeyLegacy(key), "json")
      if (value) return value as Record<string, any>

      return undefined
    },

    async set(key: string[], value: any, expiry?: Date) {
      await options.namespace.put(joinKey(key), JSON.stringify(value), {
        expirationTtl: expiry
          ? Math.max(Math.floor((expiry.getTime() - Date.now()) / 1000), 60)
          : undefined,
      })
    },

    async remove(key: string[]) {
      // Remove both new and legacy format keys
      await Promise.all([
        options.namespace.delete(joinKey(key)),
        options.namespace.delete(joinKeyLegacy(key)),
      ])
    },

    async *scan(
      prefix: string[],
    ): AsyncGenerator<[string[], any], void, unknown> {
      const seenKeys = new Set<string>()

      // Helper to scan with a specific key joiner
      async function* scanWithPrefix(
        keyPrefix: string,
      ): AsyncGenerator<[string[], any], void, unknown> {
        let cursor: string | undefined
        while (true) {
          const result = await options.namespace.list({
            prefix: keyPrefix,
            cursor,
          })

          for (const key of result.keys) {
            if (!seenKeys.has(key.name)) {
              seenKeys.add(key.name)
              const value = await options.namespace.get(key.name, "json")
              if (value !== null) {
                yield [splitKey(key.name), value] as [string[], any]
              }
            }
          }
          if (result.list_complete) {
            break
          }
          cursor = result.cursor
        }
      }

      // Scan with new separator format
      yield* scanWithPrefix(joinKey([...prefix, ""]))

      // Also scan with legacy separator format for migration
      yield* scanWithPrefix(joinKeyLegacy([...prefix, ""]))
    },
  }
}

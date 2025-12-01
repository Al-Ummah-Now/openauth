/**
 * Tenant-scoped Storage Implementation
 *
 * Provides tenant-isolated storage by prefixing all keys with the tenant ID.
 * This ensures data isolation between tenants in a multi-tenant environment.
 *
 * Storage key format: ["t", tenantId, ...originalKey]
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from "../storage/storage.js"
import type { TenantStorage } from "../contracts/types.js"
import { TENANT_STORAGE_PREFIX } from "./types.js"

/**
 * TenantStorageImpl wraps a base StorageAdapter and prefixes all operations
 * with the tenant ID to provide data isolation.
 *
 * @example
 * ```typescript
 * const baseStorage = new CloudflareStorage(env.KV)
 * const tenantStorage = new TenantStorageImpl(baseStorage, "tenant123")
 *
 * // This stores at ["t", "tenant123", "oauth", "refresh", "abc"]
 * await tenantStorage.set(["oauth", "refresh", "abc"], { token: "..." })
 *
 * // This retrieves from ["t", "tenant123", "oauth", "refresh", "abc"]
 * const data = await tenantStorage.get(["oauth", "refresh", "abc"])
 * ```
 *
 * Testing checklist:
 * - TenantStorage prefixes keys correctly
 * - get() returns data with correct prefix
 * - set() stores data with correct prefix
 * - remove() removes data with correct prefix
 * - scan() scans with correct prefix and strips prefix from results
 */
export class TenantStorageImpl implements TenantStorage {
  /**
   * The tenant ID this storage is scoped to
   */
  public readonly tenantId: string

  /**
   * The base storage adapter
   */
  private readonly storage: StorageAdapter

  /**
   * Create a new tenant-scoped storage instance
   *
   * @param storage - The base storage adapter to wrap
   * @param tenantId - The tenant ID to scope storage to
   */
  constructor(storage: StorageAdapter, tenantId: string) {
    if (!tenantId || tenantId.trim() === "") {
      throw new Error("TenantStorageImpl: tenantId is required")
    }
    this.storage = storage
    this.tenantId = tenantId
  }

  /**
   * Create a prefixed key for tenant-isolated storage
   *
   * @param key - The original key array
   * @returns Prefixed key array: ["t", tenantId, ...key]
   */
  private prefixKey(key: string[]): string[] {
    return [TENANT_STORAGE_PREFIX, this.tenantId, ...key]
  }

  /**
   * Strip the tenant prefix from a key
   *
   * @param prefixedKey - The prefixed key array
   * @returns Original key array without the tenant prefix
   */
  private stripPrefix(prefixedKey: string[]): string[] {
    // Key format: ["t", tenantId, ...originalKey]
    // We need to remove the first two elements
    if (
      prefixedKey.length >= 2 &&
      prefixedKey[0] === TENANT_STORAGE_PREFIX &&
      prefixedKey[1] === this.tenantId
    ) {
      return prefixedKey.slice(2)
    }
    return prefixedKey
  }

  /**
   * Get a value from tenant-scoped storage
   *
   * @param key - The key to retrieve
   * @returns The stored value or undefined if not found
   *
   * @example
   * ```typescript
   * // Internally retrieves from ["t", "tenant123", "user", "profile", "123"]
   * const profile = await tenantStorage.get(["user", "profile", "123"])
   * ```
   */
  async get(key: string[]): Promise<Record<string, any> | undefined> {
    const prefixedKey = this.prefixKey(key)
    return this.storage.get(prefixedKey)
  }

  /**
   * Set a value in tenant-scoped storage
   *
   * @param key - The key to store under
   * @param value - The value to store
   * @param ttl - Optional time-to-live in seconds
   *
   * @example
   * ```typescript
   * // Internally stores at ["t", "tenant123", "user", "profile", "123"]
   * await tenantStorage.set(["user", "profile", "123"], { name: "John" }, 3600)
   * ```
   */
  async set(key: string[], value: any, ttl?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    const expiry = ttl ? new Date(Date.now() + ttl * 1000) : undefined
    await this.storage.set(prefixedKey, value, expiry)
  }

  /**
   * Remove a value from tenant-scoped storage
   *
   * @param key - The key to remove
   *
   * @example
   * ```typescript
   * // Internally removes ["t", "tenant123", "user", "profile", "123"]
   * await tenantStorage.remove(["user", "profile", "123"])
   * ```
   */
  async remove(key: string[]): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    await this.storage.remove(prefixedKey)
  }

  /**
   * Scan for keys matching a prefix in tenant-scoped storage
   *
   * @param prefix - The key prefix to scan for
   * @returns AsyncIterable of [key, value] tuples with the tenant prefix stripped
   *
   * @example
   * ```typescript
   * // Internally scans ["t", "tenant123", "user", "profile"]
   * for await (const [key, value] of tenantStorage.scan(["user", "profile"])) {
   *   // key is returned without the tenant prefix, e.g., ["user", "profile", "123"]
   *   console.log(key, value)
   * }
   * ```
   */
  async *scan(prefix: string[]): AsyncIterable<[string[], any]> {
    const prefixedPrefix = this.prefixKey(prefix)

    for await (const [key, value] of this.storage.scan(prefixedPrefix)) {
      // Strip the tenant prefix before yielding
      const strippedKey = this.stripPrefix(key)
      yield [strippedKey, value]
    }
  }
}

/**
 * Factory function to create a tenant-scoped storage instance
 *
 * @param storage - The base storage adapter
 * @param tenantId - The tenant ID to scope storage to
 * @returns A new TenantStorageImpl instance
 */
export function createTenantStorage(
  storage: StorageAdapter,
  tenantId: string,
): TenantStorage {
  return new TenantStorageImpl(storage, tenantId)
}

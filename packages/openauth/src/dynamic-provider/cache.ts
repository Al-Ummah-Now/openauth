/**
 * TTL Cache with LRU Eviction
 *
 * Provides in-memory caching for dynamic provider configurations
 * with time-based expiration and size-based eviction.
 *
 * Features:
 * - Configurable TTL per entry
 * - LRU eviction when max size is reached
 * - Automatic expired entry cleanup
 * - Cache statistics for monitoring
 * - Prefix-based deletion for tenant invalidation
 *
 * @packageDocumentation
 */

import type { CacheEntry } from "./types.js"

/**
 * Cache performance statistics
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Current number of entries in cache */
  size: number
  /** Number of entries evicted due to size limit */
  evictions: number
}

/**
 * Cache configuration options
 */
export interface CacheOptions {
  /** Maximum number of entries (default: 1000) */
  maxSize?: number
}

/**
 * TTL cache with LRU eviction for provider configurations
 *
 * @typeParam T - Type of cached values
 */
export class TTLCache<T> {
  private readonly cache = new Map<string, CacheEntry<T>>()
  private readonly maxSize: number
  private stats: CacheStats = { hits: 0, misses: 0, size: 0, evictions: 0 }

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 1000
  }

  /**
   * Get a value from the cache
   *
   * @param key - Cache key
   * @returns Cached value or undefined if not found/expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      return undefined
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.stats.size--
      this.stats.misses++
      return undefined
    }

    // Move to end for LRU ordering (Map maintains insertion order)
    this.cache.delete(key)
    this.cache.set(key, entry)

    this.stats.hits++
    return entry.value
  }

  /**
   * Set a value in the cache with TTL
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlMs - Time-to-live in milliseconds
   */
  set(key: string, value: T, ttlMs: number): void {
    // Evict expired entries if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictExpired()
    }

    // LRU eviction if still at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
        this.stats.evictions++
        this.stats.size--
      }
    }

    // Update or insert entry
    const isNew = !this.cache.has(key)
    if (!isNew) {
      // Delete first to maintain LRU order
      this.cache.delete(key)
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    })

    if (isNew) {
      this.stats.size++
    }
  }

  /**
   * Check if a key exists in the cache (without updating LRU order)
   *
   * @param key - Cache key
   * @returns True if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.stats.size--
      return false
    }
    return true
  }

  /**
   * Delete a specific key from the cache
   *
   * @param key - Cache key to delete
   * @returns True if key was deleted, false if not found
   */
  delete(key: string): boolean {
    const existed = this.cache.delete(key)
    if (existed) {
      this.stats.size--
    }
    return existed
  }

  /**
   * Delete all entries matching a key prefix
   *
   * Useful for invalidating all cached providers for a tenant.
   *
   * @param prefix - Key prefix to match
   * @returns Number of entries deleted
   */
  deleteByPrefix(prefix: string): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
        count++
        this.stats.size--
      }
    }
    return count
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear()
    this.stats.size = 0
  }

  /**
   * Get current cache statistics
   *
   * @returns Copy of cache stats
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Get current cache size
   *
   * @returns Number of entries in cache
   */
  getSize(): number {
    return this.cache.size
  }

  /**
   * Get cache hit rate as a percentage
   *
   * @returns Hit rate (0-100) or 0 if no requests
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses
    if (total === 0) return 0
    return (this.stats.hits / total) * 100
  }

  /**
   * Remove all expired entries from the cache
   *
   * @returns Number of expired entries removed
   */
  private evictExpired(): number {
    const now = Date.now()
    let count = 0

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        count++
        this.stats.size--
      }
    }

    return count
  }

  /**
   * Force cleanup of expired entries (for maintenance)
   *
   * @returns Number of expired entries removed
   */
  cleanup(): number {
    return this.evictExpired()
  }
}

/**
 * Generate a cache key for a specific provider
 *
 * @param tenantId - Tenant identifier
 * @param providerName - Provider name within the tenant
 * @returns Cache key string
 */
export function providerCacheKey(tenantId: string, providerName: string): string {
  return `provider:${tenantId}:${providerName}`
}

/**
 * Generate a cache key prefix for all providers in a tenant
 *
 * @param tenantId - Tenant identifier
 * @returns Cache key prefix for use with deleteByPrefix
 */
export function tenantCacheKeyPrefix(tenantId: string): string {
  return `provider:${tenantId}:`
}

/**
 * Default cache TTL in milliseconds (60 seconds)
 */
export const DEFAULT_CACHE_TTL_MS = 60_000

/**
 * Default maximum cache size
 */
export const DEFAULT_CACHE_MAX_SIZE = 500

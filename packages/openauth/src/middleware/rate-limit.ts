/**
 * Rate Limiting Middleware
 */

import { createMiddleware } from "hono/factory"
import type { RateLimitConfig, RateLimitInfo } from "./types.js"
import { RateLimitExceededError } from "./errors.js"

/**
 * In-memory rate limit store (for single instance)
 * For production, use KV or Durable Objects
 */
const inMemoryStore = new Map<string, { count: number; resetAt: number }>()

/**
 * Rate limit storage interface
 */
export interface RateLimitStore {
  increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetAt: number }>
}

/**
 * Default in-memory store implementation
 */
export const memoryStore: RateLimitStore = {
  async increment(key: string, windowMs: number) {
    const now = Date.now()
    const existing = inMemoryStore.get(key)

    if (existing && existing.resetAt > now) {
      existing.count++
      return existing
    }

    const entry = { count: 1, resetAt: now + windowMs }
    inMemoryStore.set(key, entry)
    return entry
  },
}

/**
 * KV-based rate limit store for Cloudflare Workers
 */
export function kvStore(kv: any): RateLimitStore {
  return {
    async increment(key: string, windowMs: number) {
      const now = Date.now()
      const existing = await kv.get(key, { type: "json" })

      if (existing && existing.resetAt > now) {
        existing.count++
        await kv.put(key, JSON.stringify(existing), {
          expirationTtl: Math.ceil(windowMs / 1000),
        })
        return existing
      }

      const entry = { count: 1, resetAt: now + windowMs }
      await kv.put(key, JSON.stringify(entry), {
        expirationTtl: Math.ceil(windowMs / 1000),
      })
      return entry
    },
  }
}

/**
 * Generate rate limit key from request
 */
export type KeyGenerator = (c: any) => string

/**
 * Default key generator - uses client ID or IP
 */
export const defaultKeyGenerator: KeyGenerator = (c) => {
  const clientId = c.get("clientId")
  if (clientId) return `rl:client:${clientId}`

  const tenantId = c.get("tenantId") || "default"
  const ip =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0] ||
    "unknown"
  return `rl:${tenantId}:${ip}`
}

/**
 * Rate limiting middleware
 */
export function rateLimit(
  config: RateLimitConfig,
  options?: {
    store?: RateLimitStore
    keyGenerator?: KeyGenerator
    skip?: (c: any) => boolean
  },
) {
  const store = options?.store || memoryStore
  const keyGenerator = options?.keyGenerator || defaultKeyGenerator
  const windowMs = config.window * 1000

  return createMiddleware(async (c, next) => {
    // Skip rate limiting if configured
    if (options?.skip?.(c)) {
      await next()
      return
    }

    const key = (config.keyPrefix || "") + keyGenerator(c)
    const { count, resetAt } = await store.increment(key, windowMs)

    const info: RateLimitInfo = {
      limit: config.max,
      remaining: Math.max(0, config.max - count),
      reset: Math.ceil(resetAt / 1000),
    }

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(info.limit))
    c.header("X-RateLimit-Remaining", String(info.remaining))
    c.header("X-RateLimit-Reset", String(info.reset))

    if (count > config.max) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
      c.header("Retry-After", String(retryAfter))
      throw new RateLimitExceededError(retryAfter)
    }

    await next()
  })
}

/**
 * Per-endpoint rate limiting
 */
export function endpointRateLimit(
  limits: Record<string, RateLimitConfig>,
  options?: { store?: RateLimitStore },
) {
  return createMiddleware(async (c, next) => {
    const path = c.req.path
    const method = c.req.method
    const key = `${method}:${path}`

    // Find matching limit config
    const config = limits[key] || limits[path] || limits["*"]

    if (!config) {
      await next()
      return
    }

    const store = options?.store || memoryStore
    const windowMs = config.window * 1000
    const clientKey = `${config.keyPrefix || "ep:"}${key}:${defaultKeyGenerator(c)}`

    const { count, resetAt } = await store.increment(clientKey, windowMs)

    if (count > config.max) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
      c.header("Retry-After", String(retryAfter))
      throw new RateLimitExceededError(retryAfter)
    }

    await next()
  })
}

/**
 * Middleware Composition Utilities
 */

import type { MiddlewareHandler } from "hono"
import { bearerAuth } from "./bearer-auth.js"
import { requireScope } from "./require-scope.js"
import { requireTenantMatch } from "./tenant-isolation.js"
import { rateLimit } from "./rate-limit.js"
import type { RateLimitConfig } from "./types.js"

/**
 * Options for creating an enterprise auth middleware stack
 */
export interface EnterpriseAuthOptions {
  /** Function to get public key for JWT verification */
  getPublicKey: () => Promise<CryptoKey>
  /** Expected issuer */
  issuer: string
  /** Required scopes for this route */
  scopes?: string[]
  /** Whether to require M2M tokens */
  requireM2M?: boolean
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig
  /** Whether to enforce tenant isolation */
  tenantIsolation?: boolean
  /** Allow super admin to bypass tenant check */
  allowSuperAdmin?: boolean
}

/**
 * Create a composed middleware stack for enterprise APIs
 */
export function enterpriseAuth(
  options: EnterpriseAuthOptions,
): MiddlewareHandler[] {
  const middlewares: MiddlewareHandler[] = []

  // 1. Rate limiting (first, to reject early)
  if (options.rateLimit) {
    middlewares.push(rateLimit(options.rateLimit))
  }

  // 2. Bearer token authentication
  middlewares.push(
    bearerAuth({
      getPublicKey: options.getPublicKey,
      issuer: options.issuer,
      requireM2M: options.requireM2M,
    }),
  )

  // 3. Tenant isolation
  if (options.tenantIsolation !== false) {
    middlewares.push(
      requireTenantMatch({
        allowSuperAdmin: options.allowSuperAdmin,
      }),
    )
  }

  // 4. Scope requirements
  if (options.scopes?.length) {
    middlewares.push(requireScope(...options.scopes))
  }

  return middlewares
}

/**
 * Helper to apply multiple middleware to a route
 */
export function applyMiddleware(
  ...middlewares: MiddlewareHandler[]
): MiddlewareHandler {
  return async (c, next) => {
    const compose = async (index: number): Promise<void> => {
      if (index >= middlewares.length) {
        await next()
        return
      }
      await middlewares[index](c, () => compose(index + 1))
    }
    await compose(0)
  }
}

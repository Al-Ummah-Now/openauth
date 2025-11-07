/**
 * API Gateway Authentication Middleware with Enterprise Features
 *
 * This middleware automatically detects and uses optional enterprise features:
 * - Token introspection (when available)
 * - Token revocation (when available)
 * - Falls back to JWT verification when features are not enabled
 *
 * Features:
 * - Automatic feature detection on startup
 * - Graceful degradation
 * - Result caching for performance
 * - Express middleware compatible
 * - TypeScript support
 */

import { createClient } from "@openauthjs/openauth/client"
import { subjects } from "../../subjects"
import type { Request, Response, NextFunction } from "express"

/**
 * Simple in-memory cache for introspection results
 */
class SimpleCache {
  private cache = new Map<string, { value: any; expires: number }>()

  get(key: string) {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expires) {
      this.cache.delete(key)
      return null
    }
    return entry.value
  }

  set(key: string, value: any, ttlSeconds: number) {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttlSeconds * 1000,
    })
  }

  clear() {
    this.cache.clear()
  }
}

interface AuthMiddlewareOptions {
  issuer: string
  clientID: string
  clientSecret?: string
  cacheTTL?: number // Introspection cache TTL in seconds (default: 300 = 5 minutes)
}

interface ValidationResult {
  valid: boolean
  subject?: any
  method: "introspection" | "jwt"
}

/**
 * Create authentication middleware with automatic feature detection
 */
export async function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const {
    issuer,
    clientID,
    clientSecret,
    cacheTTL = 300, // 5 minutes default
  } = options

  const client = createClient({ clientID, issuer })
  const cache = new SimpleCache()

  // Feature detection
  const features = {
    introspection: false,
    revocation: false,
    validation: "jwt" as "jwt" | "introspection" | "hybrid",
  }

  /**
   * Check if token introspection is available on the server
   */
  async function checkIntrospectionAvailability(): Promise<boolean> {
    if (!clientSecret) return false

    try {
      const response = await fetch(`${issuer}/token/introspect`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientID}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: "test-token" }),
      })

      // 501 = Not Implemented (feature not enabled)
      return response.status !== 501
    } catch {
      return false
    }
  }

  /**
   * Check if token revocation is available on the server
   */
  async function checkRevocationAvailability(): Promise<boolean> {
    if (!clientSecret) return false

    try {
      const response = await fetch(`${issuer}/token/revoke`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientID}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: "test-token" }),
      })

      return response.status !== 501
    } catch {
      return false
    }
  }

  /**
   * Validate token using server-side introspection
   */
  async function introspectToken(token: string) {
    if (!clientSecret) return null

    // Check cache first
    const cacheKey = `introspection:${token.slice(0, 20)}`
    const cached = cache.get(cacheKey)
    if (cached !== null) {
      return cached
    }

    try {
      const response = await fetch(`${issuer}/token/introspect`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientID}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token }),
      })

      if (!response.ok) {
        return null
      }

      const result = await response.json()
      const valid = result.active ? result : null

      // Cache result
      if (valid) {
        cache.set(cacheKey, valid, cacheTTL)
      }

      return valid
    } catch (error) {
      console.error("Introspection failed:", error)
      return null
    }
  }

  /**
   * Validate token using local JWT verification
   */
  async function verifyTokenLocally(token: string) {
    try {
      const verified = await client.verify(subjects, token)

      if (verified.err) {
        return null
      }

      return verified.subject
    } catch (error) {
      console.error("JWT verification failed:", error)
      return null
    }
  }

  /**
   * Validate token using best available method
   */
  async function validateToken(
    token: string,
    options: { forceIntrospection?: boolean } = {},
  ): Promise<ValidationResult> {
    const { forceIntrospection = false } = options

    // Try introspection if available and requested
    if ((forceIntrospection || features.introspection) && clientSecret) {
      const result = await introspectToken(token)

      if (result) {
        return {
          valid: true,
          subject: result,
          method: "introspection",
        }
      }

      // If introspection failed and was forced, don't fall back
      if (forceIntrospection) {
        return {
          valid: false,
          method: "introspection",
        }
      }
    }

    // Fall back to JWT verification
    const subject = await verifyTokenLocally(token)

    return {
      valid: !!subject,
      subject,
      method: "jwt",
    }
  }

  // Detect features on startup
  if (clientSecret) {
    features.introspection = await checkIntrospectionAvailability()
    features.revocation = await checkRevocationAvailability()

    if (features.introspection) {
      features.validation = "hybrid"
    }

    console.log("🔐 Auth middleware initialized:")
    console.log(`   Introspection: ${features.introspection ? "✓ Available" : "✗ Not available (using JWT)"}`)
    console.log(`   Revocation: ${features.revocation ? "✓ Available" : "✗ Not available"}`)
    console.log(`   Validation: ${features.validation}`)
  } else {
    console.log("🔐 Auth middleware initialized:")
    console.log("   Mode: JWT verification only (no client secret)")
  }

  /**
   * Express middleware factory
   */
  function middleware(middlewareOptions?: { forceIntrospection?: boolean }) {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization
      if (!authHeader) {
        return res.status(401).json({
          error: "unauthorized",
          error_description: "Missing Authorization header",
        })
      }

      const [scheme, token] = authHeader.split(" ")
      if (scheme !== "Bearer" || !token) {
        return res.status(401).json({
          error: "unauthorized",
          error_description: "Invalid Authorization header format",
        })
      }

      // Validate token
      const result = await validateToken(token, middlewareOptions)

      if (!result.valid) {
        return res.status(401).json({
          error: "invalid_token",
          error_description: "Token validation failed",
          validation_method: result.method,
        })
      }

      // Attach user to request
      ;(req as any).user = result.subject
      ;(req as any).validationMethod = result.method

      next()
    }
  }

  // Attach feature detection results to middleware
  middleware.features = features
  middleware.checkIntrospectionAvailability = checkIntrospectionAvailability
  middleware.checkRevocationAvailability = checkRevocationAvailability
  middleware.clearCache = () => cache.clear()

  return middleware
}

// TypeScript: Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: any
      validationMethod?: "introspection" | "jwt"
    }
  }
}

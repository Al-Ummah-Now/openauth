# Phase 6: Scope Authorization Middleware Implementation

## Overview

Implement Hono middleware for scope-based authorization, tenant isolation, and rate limiting for Enterprise Admin APIs.

## Files to Create

### 1. `/packages/openauth/src/middleware/types.ts`

```typescript
/**
 * Middleware Types
 */

/**
 * M2M token claims extracted from JWT
 */
export interface M2MTokenPayload {
  mode: "m2m"
  sub: string
  client_id: string
  tenant_id?: string
  scope: string
  exp: number
  iat: number
  iss: string
  jti: string
}

/**
 * User token claims
 */
export interface UserTokenPayload {
  mode: "user"
  sub: string
  tenant_id?: string
  exp: number
  iat: number
  iss: string
}

/**
 * Combined token payload
 */
export type TokenPayload = M2MTokenPayload | UserTokenPayload

/**
 * Context variables set by middleware
 */
export interface AuthContextVariables {
  /** Authenticated token payload */
  token: TokenPayload
  /** Tenant ID from token or header */
  tenantId: string
  /** Client ID (M2M only) */
  clientId?: string
  /** Granted scopes (M2M only) */
  scopes?: string[]
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  max: number
  /** Time window in seconds */
  window: number
  /** Key prefix for storage */
  keyPrefix?: string
}

/**
 * Rate limit info returned in headers
 */
export interface RateLimitInfo {
  limit: number
  remaining: number
  reset: number
}
```

### 2. `/packages/openauth/src/middleware/errors.ts`

```typescript
/**
 * Middleware Errors
 */

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 401
  ) {
    super(message)
    this.name = "AuthError"
  }
}

export class MissingTokenError extends AuthError {
  constructor() {
    super(
      "missing_token",
      "Authorization header is required",
      401
    )
  }
}

export class InvalidTokenError extends AuthError {
  constructor(reason?: string) {
    super(
      "invalid_token",
      reason ? `Invalid token: ${reason}` : "Invalid or expired token",
      401
    )
  }
}

export class InsufficientScopeError extends AuthError {
  constructor(required: string[], granted: string[]) {
    super(
      "insufficient_scope",
      `Required scope(s): ${required.join(", ")}. Granted: ${granted.join(", ") || "none"}`,
      403
    )
  }
}

export class TenantMismatchError extends AuthError {
  constructor() {
    super(
      "tenant_mismatch",
      "Access denied: tenant mismatch",
      403
    )
  }
}

export class RateLimitExceededError extends AuthError {
  constructor(retryAfter: number) {
    super(
      "rate_limit_exceeded",
      `Rate limit exceeded. Retry after ${retryAfter} seconds`,
      429
    )
  }
}
```

### 3. `/packages/openauth/src/middleware/bearer-auth.ts`

```typescript
/**
 * Bearer Token Authentication Middleware
 */

import { createMiddleware } from "hono/factory"
import { jwtVerify, type JWTPayload } from "jose"
import type { TokenPayload, M2MTokenPayload } from "./types.js"
import { MissingTokenError, InvalidTokenError } from "./errors.js"

interface BearerAuthOptions {
  /** Function to get the public key for verification */
  getPublicKey: () => Promise<CryptoKey>
  /** Expected issuer (iss claim) */
  issuer: string
  /** Optional audience (aud claim) */
  audience?: string
  /** Whether to require M2M tokens only */
  requireM2M?: boolean
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

/**
 * Bearer token authentication middleware
 */
export function bearerAuth(options: BearerAuthOptions) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization")
    const token = extractBearerToken(authHeader)

    if (!token) {
      throw new MissingTokenError()
    }

    try {
      const publicKey = await options.getPublicKey()

      const { payload } = await jwtVerify(token, publicKey, {
        issuer: options.issuer,
        audience: options.audience,
      })

      // Validate token structure
      const tokenPayload = validateTokenPayload(payload, options.requireM2M)

      // Set context variables
      c.set("token", tokenPayload)
      c.set("tenantId", tokenPayload.tenant_id || "default")

      if (tokenPayload.mode === "m2m") {
        c.set("clientId", tokenPayload.client_id)
        c.set("scopes", tokenPayload.scope.split(" ").filter(Boolean))
      }

      await next()
    } catch (error) {
      if (error instanceof MissingTokenError || error instanceof InvalidTokenError) {
        throw error
      }
      throw new InvalidTokenError((error as Error).message)
    }
  })
}

/**
 * Validate and type the JWT payload
 */
function validateTokenPayload(
  payload: JWTPayload,
  requireM2M?: boolean
): TokenPayload {
  if (!payload.sub) {
    throw new InvalidTokenError("missing sub claim")
  }

  if (!payload.exp) {
    throw new InvalidTokenError("missing exp claim")
  }

  if (payload.exp * 1000 < Date.now()) {
    throw new InvalidTokenError("token expired")
  }

  const mode = (payload as any).mode

  if (requireM2M && mode !== "m2m") {
    throw new InvalidTokenError("M2M token required")
  }

  if (mode === "m2m") {
    if (!(payload as any).client_id) {
      throw new InvalidTokenError("missing client_id claim")
    }
    if (typeof (payload as any).scope !== "string") {
      throw new InvalidTokenError("missing scope claim")
    }
    return payload as unknown as M2MTokenPayload
  }

  return {
    mode: "user",
    sub: payload.sub,
    tenant_id: (payload as any).tenant_id,
    exp: payload.exp,
    iat: payload.iat!,
    iss: payload.iss!,
  }
}
```

### 4. `/packages/openauth/src/middleware/require-scope.ts`

```typescript
/**
 * Scope Requirement Middleware
 */

import { createMiddleware } from "hono/factory"
import { InsufficientScopeError } from "./errors.js"

/**
 * Check if granted scopes include required scope
 * Supports wildcard matching (e.g., "users:*" matches "users:read")
 */
export function hasScope(granted: string[], required: string): boolean {
  if (granted.includes(required)) {
    return true
  }

  // Check for wildcard scopes
  const [resource] = required.split(":")
  if (granted.includes(`${resource}:*`)) {
    return true
  }

  // Check for admin scope (grants all)
  if (granted.includes("admin:*") || granted.includes("*")) {
    return true
  }

  return false
}

/**
 * Check if granted scopes include all required scopes
 */
export function hasAllScopes(granted: string[], required: string[]): boolean {
  return required.every((scope) => hasScope(granted, scope))
}

/**
 * Check if granted scopes include any of the required scopes
 */
export function hasAnyScope(granted: string[], required: string[]): boolean {
  return required.some((scope) => hasScope(granted, scope))
}

/**
 * Middleware that requires specific scope(s)
 */
export function requireScope(...requiredScopes: string[]) {
  return createMiddleware(async (c, next) => {
    const scopes = c.get("scopes") || []

    if (!hasAllScopes(scopes, requiredScopes)) {
      throw new InsufficientScopeError(requiredScopes, scopes)
    }

    await next()
  })
}

/**
 * Middleware that requires any of the specified scopes
 */
export function requireAnyScope(...requiredScopes: string[]) {
  return createMiddleware(async (c, next) => {
    const scopes = c.get("scopes") || []

    if (!hasAnyScope(scopes, requiredScopes)) {
      throw new InsufficientScopeError(requiredScopes, scopes)
    }

    await next()
  })
}

/**
 * Middleware that conditionally requires scope based on request
 */
export function requireScopeIf(
  condition: (c: any) => boolean,
  ...requiredScopes: string[]
) {
  return createMiddleware(async (c, next) => {
    if (condition(c)) {
      const scopes = c.get("scopes") || []
      if (!hasAllScopes(scopes, requiredScopes)) {
        throw new InsufficientScopeError(requiredScopes, scopes)
      }
    }

    await next()
  })
}
```

### 5. `/packages/openauth/src/middleware/tenant-isolation.ts`

```typescript
/**
 * Tenant Isolation Middleware
 */

import { createMiddleware } from "hono/factory"
import { TenantMismatchError } from "./errors.js"

/**
 * Middleware that ensures tenant ID matches between token and request
 *
 * @param headerName - Header containing tenant ID (default: X-Tenant-ID)
 * @param paramName - Route parameter containing tenant ID (optional)
 */
export function requireTenantMatch(options?: {
  headerName?: string
  paramName?: string
  allowSuperAdmin?: boolean
}) {
  const headerName = options?.headerName || "X-Tenant-ID"
  const paramName = options?.paramName

  return createMiddleware(async (c, next) => {
    const tokenTenantId = c.get("tenantId")
    const scopes = c.get("scopes") || []

    // Super admin can access any tenant
    if (options?.allowSuperAdmin && scopes.includes("admin:super")) {
      await next()
      return
    }

    // Check header tenant
    const headerTenantId = c.req.header(headerName)
    if (headerTenantId && headerTenantId !== tokenTenantId) {
      throw new TenantMismatchError()
    }

    // Check route param tenant
    if (paramName) {
      const paramTenantId = c.req.param(paramName)
      if (paramTenantId && paramTenantId !== tokenTenantId) {
        throw new TenantMismatchError()
      }
    }

    // Set tenant ID from token for downstream use
    c.set("tenantId", tokenTenantId)

    await next()
  })
}

/**
 * Middleware that extracts tenant from subdomain
 */
export function tenantFromSubdomain(baseDomain: string) {
  return createMiddleware(async (c, next) => {
    const host = c.req.header("Host") || ""

    if (host.endsWith(baseDomain)) {
      const subdomain = host.slice(0, -baseDomain.length - 1) // Remove ".baseDomain"
      if (subdomain && subdomain !== "www") {
        c.set("tenantId", subdomain)
      }
    }

    await next()
  })
}

/**
 * Middleware that ensures request body tenant matches token tenant
 */
export function requireBodyTenantMatch(fieldName = "tenant_id") {
  return createMiddleware(async (c, next) => {
    const tokenTenantId = c.get("tenantId")
    const scopes = c.get("scopes") || []

    // Super admin can set any tenant
    if (scopes.includes("admin:super")) {
      await next()
      return
    }

    // Only check for POST/PUT/PATCH with JSON body
    const method = c.req.method
    if (!["POST", "PUT", "PATCH"].includes(method)) {
      await next()
      return
    }

    const contentType = c.req.header("Content-Type") || ""
    if (!contentType.includes("application/json")) {
      await next()
      return
    }

    try {
      const body = await c.req.json()
      if (body[fieldName] && body[fieldName] !== tokenTenantId) {
        throw new TenantMismatchError()
      }
    } catch (e) {
      if (e instanceof TenantMismatchError) throw e
      // Ignore JSON parse errors - let downstream handle
    }

    await next()
  })
}
```

### 6. `/packages/openauth/src/middleware/rate-limit.ts`

```typescript
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
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
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
  const ip = c.req.header("CF-Connecting-IP") ||
             c.req.header("X-Forwarded-For")?.split(",")[0] ||
             "unknown"
  return `rl:${tenantId}:${ip}`
}

/**
 * Rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig, options?: {
  store?: RateLimitStore
  keyGenerator?: KeyGenerator
  skip?: (c: any) => boolean
}) {
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
  options?: { store?: RateLimitStore }
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
```

### 7. `/packages/openauth/src/middleware/error-handler.ts`

```typescript
/**
 * Error Handler Middleware
 */

import type { Context } from "hono"
import {
  AuthError,
  MissingTokenError,
  InvalidTokenError,
  InsufficientScopeError,
  TenantMismatchError,
  RateLimitExceededError,
} from "./errors.js"

/**
 * OAuth 2.0 error response format (RFC 6749)
 */
interface OAuthErrorResponse {
  error: string
  error_description?: string
}

/**
 * Convert AuthError to OAuth 2.0 error response
 */
function toOAuthError(error: AuthError): OAuthErrorResponse {
  return {
    error: error.code,
    error_description: error.message,
  }
}

/**
 * Error handler middleware for auth errors
 */
export function authErrorHandler() {
  return async (error: Error, c: Context) => {
    if (error instanceof RateLimitExceededError) {
      return c.json(toOAuthError(error), 429)
    }

    if (error instanceof MissingTokenError || error instanceof InvalidTokenError) {
      // RFC 6750 - WWW-Authenticate header
      c.header(
        "WWW-Authenticate",
        `Bearer realm="api", error="${error.code}", error_description="${error.message}"`
      )
      return c.json(toOAuthError(error), 401)
    }

    if (error instanceof InsufficientScopeError) {
      // RFC 6750 - insufficient_scope
      c.header(
        "WWW-Authenticate",
        `Bearer realm="api", error="insufficient_scope", error_description="${error.message}"`
      )
      return c.json(toOAuthError(error), 403)
    }

    if (error instanceof TenantMismatchError) {
      return c.json(toOAuthError(error), 403)
    }

    if (error instanceof AuthError) {
      return c.json(toOAuthError(error), error.status)
    }

    // Re-throw non-auth errors
    throw error
  }
}

/**
 * Hono error handler for app.onError
 */
export function onAuthError(error: Error, c: Context) {
  if (error instanceof AuthError) {
    if (error instanceof RateLimitExceededError) {
      return c.json(toOAuthError(error), 429)
    }

    if (error.status === 401) {
      c.header(
        "WWW-Authenticate",
        `Bearer realm="api", error="${error.code}"`
      )
    }

    return c.json(toOAuthError(error), error.status)
  }

  // Return generic error for non-auth errors
  console.error("Unhandled error:", error)
  return c.json({ error: "server_error", error_description: "Internal server error" }, 500)
}
```

### 8. `/packages/openauth/src/middleware/compose.ts`

```typescript
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
export function enterpriseAuth(options: EnterpriseAuthOptions): MiddlewareHandler[] {
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
    })
  )

  // 3. Tenant isolation
  if (options.tenantIsolation !== false) {
    middlewares.push(
      requireTenantMatch({
        allowSuperAdmin: options.allowSuperAdmin,
      })
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
export function applyMiddleware(...middlewares: MiddlewareHandler[]): MiddlewareHandler {
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
```

### 9. `/packages/openauth/src/middleware/index.ts`

```typescript
/**
 * Middleware Module Exports
 */

// Types
export type {
  M2MTokenPayload,
  UserTokenPayload,
  TokenPayload,
  AuthContextVariables,
  RateLimitConfig,
  RateLimitInfo,
} from "./types.js"

// Errors
export {
  AuthError,
  MissingTokenError,
  InvalidTokenError,
  InsufficientScopeError,
  TenantMismatchError,
  RateLimitExceededError,
} from "./errors.js"

// Bearer Auth
export { bearerAuth, extractBearerToken } from "./bearer-auth.js"

// Scope Authorization
export {
  requireScope,
  requireAnyScope,
  requireScopeIf,
  hasScope,
  hasAllScopes,
  hasAnyScope,
} from "./require-scope.js"

// Tenant Isolation
export {
  requireTenantMatch,
  tenantFromSubdomain,
  requireBodyTenantMatch,
} from "./tenant-isolation.js"

// Rate Limiting
export {
  rateLimit,
  endpointRateLimit,
  memoryStore,
  kvStore,
  defaultKeyGenerator,
  type RateLimitStore,
  type KeyGenerator,
} from "./rate-limit.js"

// Error Handling
export { authErrorHandler, onAuthError } from "./error-handler.js"

// Composition
export {
  enterpriseAuth,
  applyMiddleware,
  type EnterpriseAuthOptions,
} from "./compose.js"
```

## Usage Examples

### Basic Usage

```typescript
import { Hono } from "hono"
import {
  bearerAuth,
  requireScope,
  requireTenantMatch,
  rateLimit,
  onAuthError,
} from "@openauthjs/openauth/middleware"

const app = new Hono()

// Global error handler
app.onError(onAuthError)

// Rate limiting
app.use("/api/*", rateLimit({ max: 100, window: 60 }))

// Authentication
app.use("/api/*", bearerAuth({
  getPublicKey: () => getPublicKeyFromJWKS(),
  issuer: "https://auth.example.com",
  requireM2M: true,
}))

// Tenant isolation
app.use("/api/*", requireTenantMatch())

// Scoped routes
app.get("/api/users", requireScope("users:read"), async (c) => {
  const tenantId = c.get("tenantId")
  // ... list users
})

app.post("/api/users", requireScope("users:write"), async (c) => {
  // ... create user
})

app.delete("/api/users/:id", requireScope("users:delete"), async (c) => {
  // ... delete user
})
```

### Using Composed Middleware

```typescript
import { Hono } from "hono"
import { enterpriseAuth, onAuthError } from "@openauthjs/openauth/middleware"

const app = new Hono()
app.onError(onAuthError)

// Apply composed middleware
const authMiddleware = enterpriseAuth({
  getPublicKey: () => getPublicKeyFromJWKS(),
  issuer: "https://auth.example.com",
  scopes: ["users:read"],
  requireM2M: true,
  rateLimit: { max: 100, window: 60 },
  tenantIsolation: true,
})

app.get("/api/users", ...authMiddleware, async (c) => {
  const { tenantId, clientId, scopes } = c.var
  // ... handle request
})
```

### Per-Endpoint Rate Limiting

```typescript
import { endpointRateLimit } from "@openauthjs/openauth/middleware"

app.use("/api/*", endpointRateLimit({
  "POST:/api/users": { max: 10, window: 60 },  // 10 creates per minute
  "DELETE:/api/users/:id": { max: 5, window: 60 },  // 5 deletes per minute
  "*": { max: 100, window: 60 },  // Default
}))
```

### Wildcard Scopes

```typescript
// Client with "users:*" scope can access any users:* endpoint
const scopes = ["users:*"]

hasScope(scopes, "users:read")   // true
hasScope(scopes, "users:write")  // true
hasScope(scopes, "roles:read")   // false

// Admin with "*" scope can access everything
hasScope(["*"], "anything:here") // true
```

## Response Headers

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1701234600
```

### Authentication Error Headers (RFC 6750)

```http
WWW-Authenticate: Bearer realm="api", error="invalid_token", error_description="Token expired"
```

## Error Responses

### 401 Unauthorized

```json
{
  "error": "invalid_token",
  "error_description": "Invalid or expired token"
}
```

### 403 Forbidden - Insufficient Scope

```json
{
  "error": "insufficient_scope",
  "error_description": "Required scope(s): users:write. Granted: users:read"
}
```

### 403 Forbidden - Tenant Mismatch

```json
{
  "error": "tenant_mismatch",
  "error_description": "Access denied: tenant mismatch"
}
```

### 429 Too Many Requests

```json
{
  "error": "rate_limit_exceeded",
  "error_description": "Rate limit exceeded. Retry after 45 seconds"
}
```

## Tests

### Unit Tests: `/packages/openauth/src/middleware/require-scope.test.ts`

```typescript
import { describe, test, expect } from "bun:test"
import { hasScope, hasAllScopes, hasAnyScope } from "./require-scope.js"

describe("hasScope", () => {
  test("exact match", () => {
    expect(hasScope(["users:read"], "users:read")).toBe(true)
  })

  test("wildcard resource", () => {
    expect(hasScope(["users:*"], "users:read")).toBe(true)
    expect(hasScope(["users:*"], "users:write")).toBe(true)
    expect(hasScope(["users:*"], "roles:read")).toBe(false)
  })

  test("admin wildcard", () => {
    expect(hasScope(["admin:*"], "users:read")).toBe(true)
    expect(hasScope(["*"], "anything")).toBe(true)
  })
})

describe("hasAllScopes", () => {
  test("requires all scopes", () => {
    expect(hasAllScopes(["a", "b", "c"], ["a", "b"])).toBe(true)
    expect(hasAllScopes(["a", "b"], ["a", "b", "c"])).toBe(false)
  })
})

describe("hasAnyScope", () => {
  test("requires any scope", () => {
    expect(hasAnyScope(["a"], ["a", "b", "c"])).toBe(true)
    expect(hasAnyScope(["x"], ["a", "b", "c"])).toBe(false)
  })
})
```

### Integration Tests: `/packages/openauth/src/middleware/bearer-auth.test.ts`

```typescript
import { describe, test, expect } from "bun:test"
import { Hono } from "hono"
import { bearerAuth } from "./bearer-auth.js"
import { onAuthError } from "./error-handler.js"

describe("bearerAuth middleware", () => {
  test("rejects missing Authorization header", async () => {
    const app = new Hono()
    app.onError(onAuthError)
    app.use("/*", bearerAuth({
      getPublicKey: async () => mockPublicKey,
      issuer: "test",
    }))
    app.get("/", (c) => c.text("ok"))

    const res = await app.request("/")
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("missing_token")
  })

  test("accepts valid token", async () => {
    const app = new Hono()
    app.onError(onAuthError)
    app.use("/*", bearerAuth({
      getPublicKey: async () => mockPublicKey,
      issuer: "test",
    }))
    app.get("/", (c) => c.json({ sub: c.get("token").sub }))

    const token = await createMockToken({ sub: "user123" })
    const res = await app.request("/", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sub).toBe("user123")
  })
})
```

## Checklist

- [ ] Create `/packages/openauth/src/middleware/types.ts`
- [ ] Create `/packages/openauth/src/middleware/errors.ts`
- [ ] Create `/packages/openauth/src/middleware/bearer-auth.ts`
- [ ] Create `/packages/openauth/src/middleware/require-scope.ts`
- [ ] Create `/packages/openauth/src/middleware/tenant-isolation.ts`
- [ ] Create `/packages/openauth/src/middleware/rate-limit.ts`
- [ ] Create `/packages/openauth/src/middleware/error-handler.ts`
- [ ] Create `/packages/openauth/src/middleware/compose.ts`
- [ ] Create `/packages/openauth/src/middleware/index.ts`
- [ ] Write unit tests for scope validation
- [ ] Write unit tests for tenant isolation
- [ ] Write integration tests for bearer auth
- [ ] Write integration tests for rate limiting
- [ ] Update main index.ts exports

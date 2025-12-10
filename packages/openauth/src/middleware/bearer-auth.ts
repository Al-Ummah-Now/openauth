/**
 * Bearer Token Authentication Middleware
 *
 * Supports three key resolution methods:
 * 1. Single key: `getPublicKey: () => Promise<CryptoKey>`
 * 2. JWKS URL: `jwksUrl: "https://auth.example.com/.well-known/jwks.json"`
 * 3. Local JWKS: `jwks: { keys: [...] }`
 *
 * JWKS support enables key rotation - multiple keys can be active simultaneously,
 * and the correct key is selected based on the `kid` (Key ID) in the token header.
 *
 * @packageDocumentation
 */

import { createMiddleware } from "hono/factory"
import {
  jwtVerify,
  createRemoteJWKSet,
  createLocalJWKSet,
  type JWTPayload,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose"
import type { TokenPayload, M2MTokenPayload } from "./types.js"
import { MissingTokenError, InvalidTokenError } from "./errors.js"

/**
 * Options for bearer token authentication
 *
 * You must provide exactly one of:
 * - `getPublicKey` - Single key (legacy/simple mode)
 * - `jwksUrl` - JWKS endpoint URL (recommended for production)
 * - `jwks` - Local JWKS object (for testing or embedded keys)
 */
export interface BearerAuthOptions {
  /**
   * Function to get a single public key for verification.
   * Use this for simple setups without key rotation.
   *
   * @example
   * ```typescript
   * bearerAuth({
   *   getPublicKey: async () => importSPKI(publicKeyPem, 'RS256'),
   *   issuer: 'https://auth.example.com'
   * })
   * ```
   */
  getPublicKey?: () => Promise<CryptoKey>

  /**
   * JWKS endpoint URL for fetching public keys.
   * The keys are cached and automatically refreshed.
   * Supports key rotation - the correct key is selected based on `kid` in token header.
   *
   * @example
   * ```typescript
   * bearerAuth({
   *   jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
   *   issuer: 'https://auth.example.com'
   * })
   * ```
   */
  jwksUrl?: string

  /**
   * Local JWKS object for verification.
   * Use this for testing or when keys are embedded/pre-fetched.
   *
   * @example
   * ```typescript
   * bearerAuth({
   *   jwks: { keys: [{ kty: 'RSA', kid: 'key-1', n: '...', e: '...' }] },
   *   issuer: 'https://auth.example.com'
   * })
   * ```
   */
  jwks?: JSONWebKeySet

  /** Expected issuer (iss claim) */
  issuer: string
  /** Optional audience (aud claim) */
  audience?: string
  /** Whether to require M2M tokens only */
  requireM2M?: boolean

  /**
   * JWKS cache time-to-live in milliseconds.
   * Only applies to `jwksUrl`. Default: 10 minutes (600000ms).
   * Set to 0 to disable caching.
   */
  jwksCacheTtl?: number
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(
  authHeader: string | undefined,
): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

// Cache for remote JWKS instances (by URL)
const jwksCache = new Map<
  string,
  { resolver: JWTVerifyGetKey; createdAt: number }
>()

/**
 * Create or get cached JWKS resolver for a URL
 */
function getRemoteJWKSResolver(
  url: string,
  cacheTtl: number,
): JWTVerifyGetKey {
  const cached = jwksCache.get(url)
  const now = Date.now()

  // Return cached resolver if still valid
  if (cached && (cacheTtl === 0 || now - cached.createdAt < cacheTtl)) {
    return cached.resolver
  }

  // Create new resolver
  const resolver = createRemoteJWKSet(new URL(url), {
    // jose handles its own caching, but we cache the resolver instance
    cacheMaxAge: cacheTtl,
  })

  jwksCache.set(url, { resolver, createdAt: now })
  return resolver
}

/**
 * Create key resolver from options
 */
function createKeyResolver(
  options: BearerAuthOptions,
): CryptoKey | JWTVerifyGetKey | (() => Promise<CryptoKey>) {
  const keySourceCount = [
    options.getPublicKey,
    options.jwksUrl,
    options.jwks,
  ].filter(Boolean).length

  if (keySourceCount === 0) {
    throw new Error(
      "bearerAuth requires one of: getPublicKey, jwksUrl, or jwks",
    )
  }

  if (keySourceCount > 1) {
    throw new Error(
      "bearerAuth accepts only one of: getPublicKey, jwksUrl, or jwks",
    )
  }

  // JWKS URL - uses remote fetching with caching
  if (options.jwksUrl) {
    const cacheTtl = options.jwksCacheTtl ?? 600000 // 10 minutes default
    return getRemoteJWKSResolver(options.jwksUrl, cacheTtl)
  }

  // Local JWKS - create resolver from object
  if (options.jwks) {
    return createLocalJWKSet(options.jwks)
  }

  // Single key function (legacy mode)
  return options.getPublicKey!
}

/**
 * Bearer token authentication middleware
 *
 * Verifies JWT tokens using public keys. Supports three key resolution methods:
 *
 * **Single Key (Legacy)**
 * ```typescript
 * bearerAuth({
 *   getPublicKey: async () => importSPKI(pem, 'RS256'),
 *   issuer: 'https://auth.example.com'
 * })
 * ```
 *
 * **JWKS URL (Recommended)**
 * ```typescript
 * bearerAuth({
 *   jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
 *   issuer: 'https://auth.example.com'
 * })
 * ```
 *
 * **Local JWKS**
 * ```typescript
 * bearerAuth({
 *   jwks: { keys: [{ kty: 'RSA', kid: 'key-1', ... }] },
 *   issuer: 'https://auth.example.com'
 * })
 * ```
 *
 * Sets context variables:
 * - `token` - Validated token payload
 * - `tenantId` - Tenant ID from token or 'default'
 * - `clientId` - Client ID (M2M tokens only)
 * - `scopes` - Array of scopes (M2M tokens only)
 */
export function bearerAuth(options: BearerAuthOptions) {
  // Create key resolver at middleware creation time (not per-request)
  const keyResolver = createKeyResolver(options)

  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization")
    const token = extractBearerToken(authHeader)

    if (!token) {
      throw new MissingTokenError()
    }

    try {
      // Resolve key - handles single key, JWKS URL, or local JWKS
      let key: CryptoKey | JWTVerifyGetKey

      if (typeof keyResolver === "function" && keyResolver.length === 0) {
        // It's a getPublicKey function (no arguments)
        key = await (keyResolver as () => Promise<CryptoKey>)()
      } else {
        // It's a JWKS resolver (will be called by jwtVerify with header info)
        key = keyResolver as JWTVerifyGetKey
      }

      const { payload } = await jwtVerify(token, key, {
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
      if (
        error instanceof MissingTokenError ||
        error instanceof InvalidTokenError
      ) {
        throw error
      }
      throw new InvalidTokenError((error as Error).message)
    }
  })
}

/**
 * Clear the JWKS cache. Useful for testing or forcing key refresh.
 */
export function clearJWKSCache(): void {
  jwksCache.clear()
}

/**
 * Validate and type the JWT payload
 */
function validateTokenPayload(
  payload: JWTPayload,
  requireM2M?: boolean,
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

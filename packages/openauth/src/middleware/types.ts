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

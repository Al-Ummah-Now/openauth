/**
 * M2M Authentication Types
 */

/**
 * Configuration for M2M authentication
 */
export interface M2MConfig {
  /**
   * TTL for M2M access tokens in seconds
   * @default 3600 (1 hour)
   */
  ttl?: number

  /**
   * Default scopes if none requested
   */
  defaultScopes?: string[]

  /**
   * Whether to include tenant_id in token claims
   * @default true
   */
  includeTenantId?: boolean
}

/**
 * M2M token claims (JWT payload)
 */
export interface M2MTokenClaims {
  /** Token mode - distinguishes M2M from user tokens */
  mode: "m2m"

  /** Subject - the client_id */
  sub: string

  /** Client ID */
  client_id: string

  /** Tenant ID (if multi-tenant) */
  tenant_id?: string

  /** Granted scopes (space-separated) */
  scope: string

  /** Expiration timestamp (Unix epoch seconds) */
  exp: number

  /** Issued at timestamp */
  iat: number

  /** Issuer URL */
  iss: string

  /** JWT ID for revocation tracking */
  jti: string
}

/**
 * M2M token request parameters
 */
export interface M2MTokenRequest {
  grant_type: "client_credentials"
  client_id: string
  client_secret: string
  scope?: string
}

/**
 * M2M token response
 */
export interface M2MTokenResponse {
  access_token: string
  token_type: "Bearer"
  expires_in: number
  scope?: string
}

/**
 * Result of scope validation
 */
export interface ScopeValidationResult {
  valid: boolean
  granted: string[]
  denied: string[]
}

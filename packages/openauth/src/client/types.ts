/**
 * OAuth Client Management Types
 */

/**
 * Stored OAuth client (database representation)
 */
export interface OAuthClient {
  id: string
  tenant_id: string
  name: string
  client_secret_hash: string
  grant_types: string[]
  scopes: string[]
  redirect_uris: string[]
  metadata: Record<string, unknown>
  enabled: boolean
  created_at: number
  updated_at: number
  rotated_at?: number
  previous_secret_hash?: string
  previous_secret_expires_at?: number
}

/**
 * Client for API responses (no secret)
 */
export interface OAuthClientResponse {
  id: string
  tenant_id: string
  name: string
  grant_types: string[]
  scopes: string[]
  redirect_uris: string[]
  metadata: Record<string, unknown>
  enabled: boolean
  created_at: number
  updated_at: number
  rotated_at?: number
}

/**
 * Client creation response (includes plain secret once)
 */
export interface OAuthClientCreatedResponse extends OAuthClientResponse {
  client_secret: string
}

/**
 * Client rotation response
 */
export interface OAuthClientRotatedResponse extends OAuthClientResponse {
  client_secret: string
  previous_secret_expires_at: number
}

/**
 * Request to create a client
 */
export interface CreateClientRequest {
  name: string
  grant_types?: string[]
  scopes?: string[]
  redirect_uris?: string[]
  metadata?: Record<string, unknown>
  enabled?: boolean
}

/**
 * Request to update a client
 */
export interface UpdateClientRequest {
  name?: string
  grant_types?: string[]
  scopes?: string[]
  redirect_uris?: string[]
  metadata?: Record<string, unknown>
  enabled?: boolean
}

/**
 * Request to rotate client secret
 */
export interface RotateSecretRequest {
  /**
   * Grace period in seconds for old secret to remain valid
   * @default 3600 (1 hour)
   */
  grace_period_seconds?: number
}

/**
 * Pagination parameters
 */
export interface ListClientsParams {
  cursor?: string
  limit?: number
  enabled?: boolean
}

/**
 * Paginated response
 */
export interface PaginatedClientsResponse {
  clients: OAuthClientResponse[]
  next_cursor?: string
  has_more: boolean
}

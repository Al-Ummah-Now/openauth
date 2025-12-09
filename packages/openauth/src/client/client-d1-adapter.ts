/**
 * D1 adapter for OAuth client management with tenant isolation and secret rotation
 *
 * Features:
 * - Tenant isolation for multi-tenant deployments
 * - Secret rotation with grace period support
 * - Circuit breaker for resilience
 * - Retry logic with exponential backoff
 */

import type { D1Database } from "@cloudflare/workers-types"
import type {
  OAuthClient,
  OAuthClientResponse,
  CreateClientRequest,
  UpdateClientRequest,
  ListClientsParams,
  PaginatedClientsResponse,
} from "./types.js"
import { ClientNotFoundError, ClientNameConflictError } from "./errors.js"
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret,
} from "./secret-generator.js"
import {
  validateClientName,
  validateGrantTypes,
  validateScopes,
  validateRedirectUris,
  validateMetadata,
} from "./validation.js"
import {
  CircuitBreaker,
  CircuitBreakerError,
  type CircuitBreakerConfig,
} from "./circuit-breaker.js"
import { withRetry, D1NotFoundError, type RetryConfig } from "./d1-errors.js"

const DEFAULT_GRACE_PERIOD = 60 * 60 // 1 hour

export interface ClientD1AdapterOptions {
  retryConfig?: Partial<RetryConfig>
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>
}

export class ClientD1Adapter {
  private circuitBreaker: CircuitBreaker
  private retryConfig: Partial<RetryConfig>

  constructor(
    private db: D1Database,
    options: ClientD1AdapterOptions = {},
  ) {
    this.retryConfig = options.retryConfig || {}
    this.circuitBreaker = new CircuitBreaker(
      "ClientD1Adapter",
      options.circuitBreakerConfig,
    )
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats()
  }

  /**
   * Reset circuit breaker to closed state
   */
  resetCircuitBreaker() {
    this.circuitBreaker.reset()
  }

  /**
   * Create a new OAuth client
   */
  async createClient(
    tenantId: string,
    request: CreateClientRequest,
  ): Promise<{ client: OAuthClientResponse; secret: string }> {
    validateClientName(request.name)

    const grantTypes = request.grant_types || ["client_credentials"]
    validateGrantTypes(grantTypes)

    const scopes = request.scopes || []
    validateScopes(scopes)

    const redirectUris = request.redirect_uris || []
    validateRedirectUris(redirectUris)

    if (request.metadata) {
      validateMetadata(request.metadata)
    }

    return this.circuitBreaker.execute(() =>
      withRetry(
        `createClient(${request.name})`,
        async () => {
          // Check for name conflict
          const existing = await this.db
            .prepare(
              "SELECT id FROM oauth_clients WHERE tenant_id = ? AND name = ?",
            )
            .bind(tenantId, request.name)
            .first()

          if (existing) {
            throw new ClientNameConflictError(request.name)
          }

          const id = generateClientId()
          const secret = generateClientSecret()
          const secretHash = await hashClientSecret(secret)
          const now = Date.now()

          await this.db
            .prepare(
              `INSERT INTO oauth_clients (
                id, tenant_id, name, client_secret_hash, grant_types, scopes,
                redirect_uris, metadata, enabled, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              id,
              tenantId,
              request.name,
              secretHash,
              JSON.stringify(grantTypes),
              JSON.stringify(scopes),
              JSON.stringify(redirectUris),
              JSON.stringify(request.metadata || {}),
              request.enabled !== false ? 1 : 0,
              now,
              now,
            )
            .run()

          const client = await this.getClientInternal(id, tenantId)
          if (!client) {
            throw new Error("Failed to create client")
          }

          return { client: this.toResponse(client), secret }
        },
        this.retryConfig,
      ),
    )
  }

  /**
   * Get a client by ID (with circuit breaker and retry)
   */
  async getClient(
    clientId: string,
    tenantId: string,
  ): Promise<OAuthClient | null> {
    return this.circuitBreaker
      .execute(() =>
        withRetry(
          `getClient(${clientId})`,
          () => this.getClientInternal(clientId, tenantId),
          this.retryConfig,
        ),
      )
      .catch((error) => {
        if (error instanceof CircuitBreakerError) {
          console.error(
            `ClientD1Adapter: Circuit breaker open for getClient(${clientId})`,
          )
          return null
        }
        throw error
      })
  }

  /**
   * Internal get client (without circuit breaker - for use within other methods)
   */
  private async getClientInternal(
    clientId: string,
    tenantId: string,
  ): Promise<OAuthClient | null> {
    const row = await this.db
      .prepare("SELECT * FROM oauth_clients WHERE id = ? AND tenant_id = ?")
      .bind(clientId, tenantId)
      .first<any>()

    if (!row) return null

    return this.rowToClient(row)
  }

  /**
   * Get a client by ID (any tenant - for authentication)
   */
  async getClientById(clientId: string): Promise<OAuthClient | null> {
    return this.circuitBreaker
      .execute(() =>
        withRetry(
          `getClientById(${clientId})`,
          async () => {
            const row = await this.db
              .prepare("SELECT * FROM oauth_clients WHERE id = ?")
              .bind(clientId)
              .first<any>()

            if (!row) return null

            return this.rowToClient(row)
          },
          this.retryConfig,
        ),
      )
      .catch((error) => {
        if (error instanceof CircuitBreakerError) {
          console.error(
            `ClientD1Adapter: Circuit breaker open for getClientById(${clientId})`,
          )
          return null
        }
        throw error
      })
  }

  /**
   * List clients for a tenant
   */
  async listClients(
    tenantId: string,
    params: ListClientsParams = {},
  ): Promise<PaginatedClientsResponse> {
    const limit = Math.min(params.limit || 20, 100)
    const cursor = params.cursor ? parseInt(params.cursor, 10) : 0

    return this.circuitBreaker
      .execute(() =>
        withRetry(
          `listClients(${tenantId})`,
          async () => {
            let query = "SELECT * FROM oauth_clients WHERE tenant_id = ?"
            const bindings: (string | number)[] = [tenantId]

            if (params.enabled !== undefined) {
              query += " AND enabled = ?"
              bindings.push(params.enabled ? 1 : 0)
            }

            query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
            bindings.push(limit + 1, cursor)

            const result = await this.db
              .prepare(query)
              .bind(...bindings)
              .all<any>()

            const rows = result.results || []
            const hasMore = rows.length > limit
            const clients = rows
              .slice(0, limit)
              .map((r) => this.toResponse(this.rowToClient(r)))

            return {
              clients,
              next_cursor: hasMore ? String(cursor + limit) : undefined,
              has_more: hasMore,
            }
          },
          this.retryConfig,
        ),
      )
      .catch((error) => {
        if (error instanceof CircuitBreakerError) {
          console.error(`ClientD1Adapter: Circuit breaker open for listClients`)
          return { clients: [], has_more: false }
        }
        throw error
      })
  }

  /**
   * Update a client
   */
  async updateClient(
    clientId: string,
    tenantId: string,
    updates: UpdateClientRequest,
  ): Promise<OAuthClientResponse> {
    // Validate inputs first (outside circuit breaker)
    if (updates.name !== undefined) {
      validateClientName(updates.name)
    }
    if (updates.grant_types !== undefined) {
      validateGrantTypes(updates.grant_types)
    }
    if (updates.scopes !== undefined) {
      validateScopes(updates.scopes)
    }
    if (updates.redirect_uris !== undefined) {
      validateRedirectUris(updates.redirect_uris)
    }
    if (updates.metadata !== undefined) {
      validateMetadata(updates.metadata)
    }

    return this.circuitBreaker.execute(() =>
      withRetry(
        `updateClient(${clientId})`,
        async () => {
          const existing = await this.getClientInternal(clientId, tenantId)
          if (!existing) {
            throw new ClientNotFoundError(clientId)
          }

          const setClauses: string[] = ["updated_at = ?"]
          const values: (string | number)[] = [Date.now()]

          if (updates.name !== undefined) {
            // Check for name conflict
            const conflict = await this.db
              .prepare(
                "SELECT id FROM oauth_clients WHERE tenant_id = ? AND name = ? AND id != ?",
              )
              .bind(tenantId, updates.name, clientId)
              .first()
            if (conflict) {
              throw new ClientNameConflictError(updates.name)
            }
            setClauses.push("name = ?")
            values.push(updates.name)
          }

          if (updates.grant_types !== undefined) {
            setClauses.push("grant_types = ?")
            values.push(JSON.stringify(updates.grant_types))
          }

          if (updates.scopes !== undefined) {
            setClauses.push("scopes = ?")
            values.push(JSON.stringify(updates.scopes))
          }

          if (updates.redirect_uris !== undefined) {
            setClauses.push("redirect_uris = ?")
            values.push(JSON.stringify(updates.redirect_uris))
          }

          if (updates.metadata !== undefined) {
            setClauses.push("metadata = ?")
            values.push(JSON.stringify(updates.metadata))
          }

          if (updates.enabled !== undefined) {
            setClauses.push("enabled = ?")
            values.push(updates.enabled ? 1 : 0)
          }

          values.push(clientId, tenantId)

          await this.db
            .prepare(
              `UPDATE oauth_clients SET ${setClauses.join(", ")} WHERE id = ? AND tenant_id = ?`,
            )
            .bind(...values)
            .run()

          const updated = await this.getClientInternal(clientId, tenantId)
          if (!updated) {
            throw new ClientNotFoundError(clientId)
          }

          return this.toResponse(updated)
        },
        this.retryConfig,
      ),
    )
  }

  /**
   * Delete a client
   */
  async deleteClient(clientId: string, tenantId: string): Promise<void> {
    return this.circuitBreaker.execute(() =>
      withRetry(
        `deleteClient(${clientId})`,
        async () => {
          const existing = await this.getClientInternal(clientId, tenantId)
          if (!existing) {
            throw new ClientNotFoundError(clientId)
          }

          await this.db
            .prepare("DELETE FROM oauth_clients WHERE id = ? AND tenant_id = ?")
            .bind(clientId, tenantId)
            .run()
        },
        this.retryConfig,
      ),
    )
  }

  /**
   * Rotate client secret
   */
  async rotateSecret(
    clientId: string,
    tenantId: string,
    gracePeriodSeconds = DEFAULT_GRACE_PERIOD,
  ): Promise<{ client: OAuthClientResponse; secret: string }> {
    return this.circuitBreaker.execute(() =>
      withRetry(
        `rotateSecret(${clientId})`,
        async () => {
          const existing = await this.getClientInternal(clientId, tenantId)
          if (!existing) {
            throw new ClientNotFoundError(clientId)
          }

          const newSecret = generateClientSecret()
          const newSecretHash = await hashClientSecret(newSecret)
          const now = Date.now()
          const previousExpires = now + gracePeriodSeconds * 1000

          await this.db
            .prepare(
              `UPDATE oauth_clients SET
                client_secret_hash = ?,
                previous_secret_hash = ?,
                previous_secret_expires_at = ?,
                rotated_at = ?,
                updated_at = ?
              WHERE id = ? AND tenant_id = ?`,
            )
            .bind(
              newSecretHash,
              existing.client_secret_hash,
              previousExpires,
              now,
              now,
              clientId,
              tenantId,
            )
            .run()

          const updated = await this.getClientInternal(clientId, tenantId)
          if (!updated) {
            throw new ClientNotFoundError(clientId)
          }

          return { client: this.toResponse(updated), secret: newSecret }
        },
        this.retryConfig,
      ),
    )
  }

  /**
   * Verify client credentials (checks current and previous secret)
   */
  async verifyCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<OAuthClient | null> {
    const client = await this.getClientById(clientId)
    if (!client) return null

    // Check current secret
    const currentValid = await verifyClientSecret(
      clientSecret,
      client.client_secret_hash,
    )
    if (currentValid) return client

    // Check previous secret if within grace period
    if (
      client.previous_secret_hash &&
      client.previous_secret_expires_at &&
      Date.now() < client.previous_secret_expires_at
    ) {
      const previousValid = await verifyClientSecret(
        clientSecret,
        client.previous_secret_hash,
      )
      if (previousValid) return client
    }

    return null
  }

  /**
   * Convert database row to OAuthClient
   */
  private rowToClient(row: any): OAuthClient {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name || row.client_name,
      client_secret_hash: row.client_secret_hash,
      grant_types: JSON.parse(row.grant_types || "[]"),
      scopes: JSON.parse(row.scopes || "[]"),
      redirect_uris: JSON.parse(row.redirect_uris || "[]"),
      metadata: JSON.parse(row.metadata || "{}"),
      enabled: row.enabled === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      rotated_at: row.rotated_at || undefined,
      previous_secret_hash: row.previous_secret_hash || undefined,
      previous_secret_expires_at: row.previous_secret_expires_at || undefined,
    }
  }

  /**
   * Convert OAuthClient to response (strip secrets)
   */
  private toResponse(client: OAuthClient): OAuthClientResponse {
    return {
      id: client.id,
      tenant_id: client.tenant_id,
      name: client.name,
      grant_types: client.grant_types,
      scopes: client.scopes,
      redirect_uris: client.redirect_uris,
      metadata: client.metadata,
      enabled: client.enabled,
      created_at: client.created_at,
      updated_at: client.updated_at,
      rotated_at: client.rotated_at,
    }
  }
}

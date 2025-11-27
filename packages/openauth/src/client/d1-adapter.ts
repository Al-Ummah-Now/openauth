/**
 * D1 Client Adapter for OpenAuth
 *
 * Provides storage adapter for OAuth client credentials using Cloudflare D1.
 * Designed for low-frequency writes - NOT suitable for token storage.
 *
 * @packageDocumentation
 */

import type { D1Database } from "@cloudflare/workers-types"
import {
  withRetry,
  checkD1Result,
  D1NotFoundError,
  type RetryConfig,
} from "./d1-errors.js"
import {
  CircuitBreaker,
  CircuitBreakerError,
  type CircuitBreakerConfig,
} from "./circuit-breaker.js"
import { SQLValidator } from "../security/sql-validator.js"

export interface OAuthClient {
  client_id: string
  /**
   * Hash of the client secret for confidential clients.
   * NULL for public clients (SPAs, mobile apps) that cannot securely store secrets.
   */
  client_secret_hash: string | null
  client_name: string
  redirect_uris?: string[]
  grant_types?: string[]
  scopes?: string[]
  created_at: number
  updated_at: number
}

export interface D1ClientAdapterOptions {
  database: D1Database
  tableName?: string
  retryConfig?: Partial<RetryConfig>
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>
}

export class D1ClientAdapter {
  private db: D1Database
  private tableName: string
  private retryConfig: Partial<RetryConfig>
  private circuitBreaker: CircuitBreaker

  constructor(options: D1ClientAdapterOptions) {
    this.db = options.database
    // SECURITY: Validate table name to prevent SQL injection
    this.tableName = SQLValidator.validateTableName(
      options.tableName || "oauth_clients",
    )
    this.retryConfig = options.retryConfig || {}
    this.circuitBreaker = new CircuitBreaker(
      "D1ClientAdapter",
      options.circuitBreakerConfig,
    )
  }

  /**
   * Get a client by ID
   */
  async getClient(clientId: string): Promise<OAuthClient | null> {
    return this.circuitBreaker
      .execute(() =>
        withRetry(
          `getClient(${clientId})`,
          async () => {
            const result = await this.db
              .prepare(`SELECT * FROM ${this.tableName} WHERE client_id = ?`)
              .bind(clientId)
              .first<OAuthClient>()

            if (!result) return null

            // Parse JSON fields with error handling
            try {
              return {
                ...result,
                redirect_uris: result.redirect_uris
                  ? JSON.parse(result.redirect_uris as any)
                  : undefined,
                grant_types: result.grant_types
                  ? JSON.parse(result.grant_types as any)
                  : undefined,
                scopes: result.scopes
                  ? JSON.parse(result.scopes as any)
                  : undefined,
              }
            } catch (parseError) {
              throw new Error(
                `Invalid JSON in client fields for client ${clientId}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
              )
            }
          },
          this.retryConfig,
        ),
      )
      .catch((error) => {
        // Return null for not found or circuit breaker errors
        if (
          error instanceof D1NotFoundError ||
          error instanceof CircuitBreakerError
        ) {
          return null
        }
        console.error(
          `D1ClientAdapter: Failed to get client ${clientId}:`,
          error,
        )
        return null
      })
  }

  /**
   * Create a new client
   */
  async createClient(
    client: Omit<OAuthClient, "created_at" | "updated_at">,
  ): Promise<OAuthClient> {
    const now = Date.now()

    return this.circuitBreaker.execute(() =>
      withRetry(
        `createClient(${client.client_id})`,
        async () => {
          const result = await this.db
            .prepare(
              `
          INSERT INTO ${this.tableName} (
            client_id, client_secret_hash, client_name,
            redirect_uris, grant_types, scopes,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
            )
            .bind(
              client.client_id,
              client.client_secret_hash,
              client.client_name,
              client.redirect_uris
                ? JSON.stringify(client.redirect_uris)
                : null,
              client.grant_types ? JSON.stringify(client.grant_types) : null,
              client.scopes ? JSON.stringify(client.scopes) : null,
              now,
              now,
            )
            .run()

          checkD1Result(result, `createClient(${client.client_id})`)

          return {
            ...client,
            created_at: now,
            updated_at: now,
          }
        },
        this.retryConfig,
      ),
    )
  }

  /**
   * Update an existing client
   */
  async updateClient(
    clientId: string,
    updates: Partial<
      Omit<OAuthClient, "client_id" | "created_at" | "updated_at">
    >,
  ): Promise<OAuthClient | null> {
    const now = Date.now()

    // Build update query dynamically
    const updateFields: string[] = []
    const values: any[] = []

    if (updates.client_secret_hash !== undefined) {
      updateFields.push("client_secret_hash = ?")
      values.push(updates.client_secret_hash)
    }
    if (updates.client_name !== undefined) {
      updateFields.push("client_name = ?")
      values.push(updates.client_name)
    }
    if (updates.redirect_uris !== undefined) {
      updateFields.push("redirect_uris = ?")
      values.push(JSON.stringify(updates.redirect_uris))
    }
    if (updates.grant_types !== undefined) {
      updateFields.push("grant_types = ?")
      values.push(JSON.stringify(updates.grant_types))
    }
    if (updates.scopes !== undefined) {
      updateFields.push("scopes = ?")
      values.push(JSON.stringify(updates.scopes))
    }

    if (updateFields.length === 0) {
      return this.getClient(clientId)
    }

    updateFields.push("updated_at = ?")
    values.push(now)
    values.push(clientId) // for WHERE clause

    return this.circuitBreaker.execute(() =>
      withRetry(
        `updateClient(${clientId})`,
        async () => {
          const result = await this.db
            .prepare(
              `
          UPDATE ${this.tableName}
          SET ${updateFields.join(", ")}
          WHERE client_id = ?
        `,
            )
            .bind(...values)
            .run()

          try {
            checkD1Result(result, `updateClient(${clientId})`, true)
          } catch (error) {
            if (error instanceof D1NotFoundError) {
              return null
            }
            throw error
          }

          return this.getClient(clientId)
        },
        this.retryConfig,
      ),
    )
  }

  /**
   * Delete a client
   */
  async deleteClient(clientId: string): Promise<boolean> {
    return this.circuitBreaker
      .execute(() =>
        withRetry(
          `deleteClient(${clientId})`,
          async () => {
            const result = await this.db
              .prepare(`DELETE FROM ${this.tableName} WHERE client_id = ?`)
              .bind(clientId)
              .run()

            try {
              checkD1Result(result, `deleteClient(${clientId})`, true)
              return true
            } catch (error) {
              if (error instanceof D1NotFoundError) {
                return false
              }
              throw error
            }
          },
          this.retryConfig,
        ),
      )
      .catch((error) => {
        if (error instanceof CircuitBreakerError) {
          return false
        }
        console.error(
          `D1ClientAdapter: Failed to delete client ${clientId}:`,
          error,
        )
        return false
      })
  }

  /**
   * List all clients (with pagination)
   */
  async listClients(options?: {
    limit?: number
    offset?: number
  }): Promise<OAuthClient[]> {
    const limit = options?.limit || 100
    const offset = options?.offset || 0

    return this.circuitBreaker
      .execute(() =>
        withRetry(
          `listClients(limit=${limit}, offset=${offset})`,
          async () => {
            const result = await this.db
              .prepare(
                `
          SELECT * FROM ${this.tableName}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `,
              )
              .bind(limit, offset)
              .all<OAuthClient>()

            if (!result.results) return []

            return result.results.map((client) => {
              try {
                return {
                  ...client,
                  redirect_uris: client.redirect_uris
                    ? JSON.parse(client.redirect_uris as any)
                    : undefined,
                  grant_types: client.grant_types
                    ? JSON.parse(client.grant_types as any)
                    : undefined,
                  scopes: client.scopes
                    ? JSON.parse(client.scopes as any)
                    : undefined,
                }
              } catch (parseError) {
                throw new Error(
                  `Invalid JSON in client fields for client ${client.client_id}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                )
              }
            })
          },
          this.retryConfig,
        ),
      )
      .catch((error) => {
        if (error instanceof CircuitBreakerError) {
          return []
        }
        console.error("D1ClientAdapter: Failed to list clients:", error)
        return []
      })
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
}

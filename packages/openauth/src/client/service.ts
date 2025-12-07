/**
 * OAuth Client Management Service
 */

import type { D1Database } from "@cloudflare/workers-types"
import { ClientD1Adapter } from "./client-d1-adapter.js"
import type {
  OAuthClientResponse,
  CreateClientRequest,
  UpdateClientRequest,
  ListClientsParams,
  PaginatedClientsResponse,
} from "./types.js"

export class ClientService {
  private adapter: ClientD1Adapter

  constructor(db: D1Database) {
    this.adapter = new ClientD1Adapter(db)
  }

  /**
   * Create a new OAuth client
   */
  async createClient(
    tenantId: string,
    request: CreateClientRequest,
  ): Promise<{ client: OAuthClientResponse; secret: string }> {
    return this.adapter.createClient(tenantId, request)
  }

  /**
   * Get a client by ID (tenant-scoped)
   */
  async getClient(
    clientId: string,
    tenantId: string,
  ): Promise<OAuthClientResponse | null> {
    const client = await this.adapter.getClient(clientId, tenantId)
    if (!client) return null
    return this.toResponse(client)
  }

  /**
   * List clients for a tenant
   */
  async listClients(
    tenantId: string,
    params?: ListClientsParams,
  ): Promise<PaginatedClientsResponse> {
    return this.adapter.listClients(tenantId, params)
  }

  /**
   * Update a client
   */
  async updateClient(
    clientId: string,
    tenantId: string,
    updates: UpdateClientRequest,
  ): Promise<OAuthClientResponse> {
    return this.adapter.updateClient(clientId, tenantId, updates)
  }

  /**
   * Delete a client
   */
  async deleteClient(clientId: string, tenantId: string): Promise<void> {
    return this.adapter.deleteClient(clientId, tenantId)
  }

  /**
   * Rotate client secret
   */
  async rotateSecret(
    clientId: string,
    tenantId: string,
    gracePeriodSeconds?: number,
  ): Promise<{ client: OAuthClientResponse; secret: string }> {
    return this.adapter.rotateSecret(clientId, tenantId, gracePeriodSeconds)
  }

  /**
   * Verify client credentials for authentication
   */
  async verifyCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<OAuthClientResponse | null> {
    const client = await this.adapter.verifyCredentials(clientId, clientSecret)
    if (!client) return null
    if (!client.enabled) return null
    return this.toResponse(client)
  }

  private toResponse(client: any): OAuthClientResponse {
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

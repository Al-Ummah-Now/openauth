/**
 * Client Authenticator for OpenAuth
 *
 * Handles client credential validation for OAuth 2.0 client authentication.
 * Supports both confidential and public clients per RFC 6749.
 *
 * @packageDocumentation
 */

import { ClientD1Adapter } from "./client-d1-adapter.js"
import type { OAuthClient } from "./types.js"

export interface ClientAuthenticatorOptions {
  adapter: ClientD1Adapter
}

export interface ValidateClientOptions {
  /**
   * Accept public clients (no stored secret) authenticating by client_id only.
   * Defaults to `false`: a client without a secret hash is rejected.
   */
  allowPublicClient?: boolean
}

export class ClientAuthenticator {
  private adapter: ClientD1Adapter

  constructor(options: ClientAuthenticatorOptions) {
    this.adapter = options.adapter
  }

  /**
   * Validate client credentials
   *
   * Supports two client types per OAuth 2.0 spec:
   * - Confidential clients: Have client_secret_hash, require secret validation
   * - Public clients: No client_secret_hash, authenticate by client_id only.
   *   SECURITY: public clients are only accepted when the caller explicitly
   *   opts in with `allowPublicClient: true` AND no secret was supplied.
   *   A client without a stored secret can never be "authenticated" by
   *   presenting an arbitrary secret.
   *
   * Disabled clients (`enabled === false`) are always rejected.
   */
  async validateClient(
    clientId: string,
    clientSecret?: string,
    options: ValidateClientOptions = {},
  ): Promise<{ valid: boolean; isPublicClient: boolean }> {
    try {
      // Get client from database (no tenant required for auth)
      const client = await this.adapter.getClientById(clientId)
      if (!client) {
        return { valid: false, isPublicClient: false }
      }

      // Disabled clients must never authenticate
      if (client.enabled === false) {
        return { valid: false, isPublicClient: false }
      }

      // ============================================
      // PATH 1: PUBLIC CLIENT (no secret hash stored)
      // ============================================
      if (!client.client_secret_hash) {
        // Only allowed when the endpoint explicitly permits public clients
        // and the caller did not try to present a secret.
        if (options.allowPublicClient && !clientSecret) {
          return { valid: true, isPublicClient: true }
        }
        return { valid: false, isPublicClient: true }
      }

      // ============================================
      // PATH 2: CONFIDENTIAL CLIENT (has secret hash)
      // ============================================
      // Confidential clients MUST provide a valid secret.
      if (!clientSecret) {
        return { valid: false, isPublicClient: false }
      }

      // Use adapter's verifyCredentials which handles secret rotation grace period
      const verified = await this.adapter.verifyCredentials(
        clientId,
        clientSecret,
      )
      return { valid: verified !== null, isPublicClient: false }
    } catch (error) {
      console.error("ClientAuthenticator: Error validating client:", error)
      return { valid: false, isPublicClient: false }
    }
  }

  /**
   * Get client if credentials are valid
   *
   * Returns the client for:
   * - Public clients: only when `allowPublicClient` is set and no secret given
   * - Confidential clients: When client_id + client_secret are valid
   */
  async authenticateClient(
    clientId: string,
    clientSecret?: string,
    options: ValidateClientOptions = {},
  ): Promise<{ client: OAuthClient | null; isPublicClient: boolean }> {
    const result = await this.validateClient(clientId, clientSecret, options)
    if (!result.valid) {
      return { client: null, isPublicClient: result.isPublicClient }
    }

    const client = await this.adapter.getClientById(clientId)
    if (!client || client.enabled === false) {
      return { client: null, isPublicClient: result.isPublicClient }
    }
    return { client, isPublicClient: result.isPublicClient }
  }
}

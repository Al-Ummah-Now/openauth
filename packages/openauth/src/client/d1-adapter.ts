/**
 * D1 Client Adapter for OpenAuth
 *
 * Provides storage adapter for OAuth client credentials using Cloudflare D1.
 * Designed for low-frequency writes - NOT suitable for token storage.
 *
 * @packageDocumentation
 */

import type { D1Database } from "@cloudflare/workers-types"

export interface OAuthClient {
	client_id: string
	client_secret_hash: string
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
}

export class D1ClientAdapter {
	private db: D1Database
	private tableName: string

	constructor(options: D1ClientAdapterOptions) {
		this.db = options.database
		this.tableName = options.tableName || "oauth_clients"
	}

	/**
	 * Get a client by ID
	 */
	async getClient(clientId: string): Promise<OAuthClient | null> {
		try {
			const result = await this.db
				.prepare(`SELECT * FROM ${this.tableName} WHERE client_id = ?`)
				.bind(clientId)
				.first<OAuthClient>()

			if (!result) return null

			// Parse JSON fields
			return {
				...result,
				redirect_uris: result.redirect_uris
					? JSON.parse(result.redirect_uris as any)
					: undefined,
				grant_types: result.grant_types
					? JSON.parse(result.grant_types as any)
					: undefined,
				scopes: result.scopes ? JSON.parse(result.scopes as any) : undefined,
			}
		} catch (error) {
			console.error(
				`D1ClientAdapter: Error getting client ${clientId}:`,
				error,
			)
			return null
		}
	}

	/**
	 * Create a new client
	 */
	async createClient(
		client: Omit<OAuthClient, "created_at" | "updated_at">,
	): Promise<OAuthClient> {
		const now = Date.now()

		try {
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
					client.redirect_uris ? JSON.stringify(client.redirect_uris) : null,
					client.grant_types ? JSON.stringify(client.grant_types) : null,
					client.scopes ? JSON.stringify(client.scopes) : null,
					now,
					now,
				)
				.run()

			if (!result.success) {
				throw new Error("Failed to create client")
			}

			return {
				...client,
				created_at: now,
				updated_at: now,
			}
		} catch (error) {
			console.error("D1ClientAdapter: Error creating client:", error)
			throw new Error(
				`Failed to create client: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
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

		try {
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

			if (!result.success || result.meta.changes === 0) {
				return null
			}

			return this.getClient(clientId)
		} catch (error) {
			console.error(
				`D1ClientAdapter: Error updating client ${clientId}:`,
				error,
			)
			throw new Error(
				`Failed to update client: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	/**
	 * Delete a client
	 */
	async deleteClient(clientId: string): Promise<boolean> {
		try {
			const result = await this.db
				.prepare(`DELETE FROM ${this.tableName} WHERE client_id = ?`)
				.bind(clientId)
				.run()

			return result.success && result.meta.changes > 0
		} catch (error) {
			console.error(
				`D1ClientAdapter: Error deleting client ${clientId}:`,
				error,
			)
			return false
		}
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

		try {
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

			return result.results.map((client) => ({
				...client,
				redirect_uris: client.redirect_uris
					? JSON.parse(client.redirect_uris as any)
					: undefined,
				grant_types: client.grant_types
					? JSON.parse(client.grant_types as any)
					: undefined,
				scopes: client.scopes ? JSON.parse(client.scopes as any) : undefined,
			}))
		} catch (error) {
			console.error("D1ClientAdapter: Error listing clients:", error)
			return []
		}
	}
}

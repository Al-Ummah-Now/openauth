/**
 * Client Authenticator for OpenAuth
 *
 * Handles client credential validation using PBKDF2 with SHA-256.
 * Implements constant-time comparison to prevent timing attacks.
 *
 * @packageDocumentation
 */

import { D1ClientAdapter, type OAuthClient } from "./d1-adapter.js"

export interface ClientAuthenticatorOptions {
	adapter: D1ClientAdapter
	iterations?: number // PBKDF2 iterations (default: 100000)
	keyLength?: number // Key length in bytes (default: 64)
}

export class ClientAuthenticator {
	private adapter: D1ClientAdapter
	private iterations: number
	private keyLength: number

	constructor(options: ClientAuthenticatorOptions) {
		this.adapter = options.adapter
		this.iterations = options.iterations || 100000
		this.keyLength = options.keyLength || 64
	}

	/**
	 * Hash a client secret using PBKDF2
	 */
	async hashSecret(
		clientSecret: string,
		salt?: Uint8Array,
	): Promise<{
		hash: string
		salt: string
	}> {
		// Generate salt if not provided
		const saltBytes = salt || crypto.getRandomValues(new Uint8Array(16))

		// Import the secret as a key
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(clientSecret),
			"PBKDF2",
			false,
			["deriveBits"],
		)

		// Derive bits using PBKDF2
		const derivedBits = await crypto.subtle.deriveBits(
			{
				name: "PBKDF2",
				salt: saltBytes,
				iterations: this.iterations,
				hash: "SHA-256",
			},
			keyMaterial,
			this.keyLength * 8, // Convert bytes to bits
		)

		// Convert to hex strings
		const hashHex = this.bufferToHex(new Uint8Array(derivedBits))
		const saltHex = this.bufferToHex(saltBytes)

		// Combine salt and hash for storage
		return {
			hash: `${saltHex}:${hashHex}`,
			salt: saltHex,
		}
	}

	/**
	 * Validate client credentials
	 */
	async validateClient(
		clientId: string,
		clientSecret: string,
	): Promise<boolean> {
		try {
			// Get client from database
			const client = await this.adapter.getClient(clientId)
			if (!client) {
				// Perform dummy hash to prevent timing attacks
				await this.hashSecret(clientSecret)
				return false
			}

			// Extract salt and hash from stored value
			const [storedSalt, storedHash] = client.client_secret_hash.split(":")
			if (!storedSalt || !storedHash) {
				console.error("Invalid stored hash format for client:", clientId)
				return false
			}

			// Hash the provided secret with the stored salt
			const saltBytes = this.hexToBuffer(storedSalt)
			const { hash: computedHash } = await this.hashSecret(
				clientSecret,
				saltBytes,
			)
			const [, computedHashOnly] = computedHash.split(":")

			// Constant-time comparison
			return this.constantTimeCompare(storedHash, computedHashOnly)
		} catch (error) {
			console.error("ClientAuthenticator: Error validating client:", error)
			return false
		}
	}

	/**
	 * Get client if credentials are valid
	 */
	async authenticateClient(
		clientId: string,
		clientSecret: string,
	): Promise<OAuthClient | null> {
		const isValid = await this.validateClient(clientId, clientSecret)
		if (!isValid) return null

		return this.adapter.getClient(clientId)
	}

	/**
	 * Create a new client with hashed secret
	 */
	async createClient(
		clientId: string,
		clientSecret: string,
		clientName: string,
		options?: {
			redirect_uris?: string[]
			grant_types?: string[]
			scopes?: string[]
		},
	): Promise<OAuthClient> {
		// Hash the client secret
		const { hash } = await this.hashSecret(clientSecret)

		// Create the client
		return this.adapter.createClient({
			client_id: clientId,
			client_secret_hash: hash,
			client_name: clientName,
			redirect_uris: options?.redirect_uris,
			grant_types: options?.grant_types,
			scopes: options?.scopes,
		})
	}

	/**
	 * Update client secret
	 *
	 * Note: The updated_at timestamp is automatically updated by the adapter.
	 */
	async updateClientSecret(
		clientId: string,
		newSecret: string,
	): Promise<boolean> {
		const { hash } = await this.hashSecret(newSecret)
		const result = await this.adapter.updateClient(clientId, {
			client_secret_hash: hash,
		})
		return result !== null
	}

	/**
	 * Constant-time string comparison to prevent timing attacks
	 */
	private constantTimeCompare(a: string, b: string): boolean {
		if (a.length !== b.length) return false

		let result = 0
		for (let i = 0; i < a.length; i++) {
			result |= a.charCodeAt(i) ^ b.charCodeAt(i)
		}
		return result === 0
	}

	/**
	 * Convert buffer to hex string
	 */
	private bufferToHex(buffer: Uint8Array): string {
		return Array.from(buffer)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")
	}

	/**
	 * Convert hex string to buffer
	 */
	private hexToBuffer(hex: string): Uint8Array {
		const bytes = new Uint8Array(hex.length / 2)
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
		}
		return bytes
	}
}

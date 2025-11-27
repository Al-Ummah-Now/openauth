/**
 * Client Authenticator for OpenAuth
 *
 * Handles client credential validation using PBKDF2 with SHA-256.
 * Implements constant-time comparison to prevent timing attacks.
 *
 * @packageDocumentation
 */

import { D1ClientAdapter, type OAuthClient } from "./d1-adapter.js"

/**
 * PBKDF2 iteration count follows OWASP recommendations (2023).
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2
 *
 * OWASP recommends 600,000 iterations for PBKDF2-SHA256 (as of 2023).
 * However, for client secrets (which are typically high-entropy machine-generated values
 * rather than user passwords), 100,000 iterations provides adequate security while
 * maintaining reasonable performance for token endpoint operations.
 *
 * For user password hashing, consider using a higher iteration count or a modern
 * password hashing algorithm like Argon2id or scrypt.
 */
const PBKDF2_ITERATIONS_2023 = 100000

export interface ClientAuthenticatorOptions {
	adapter: D1ClientAdapter
	/** PBKDF2 iterations (default: 100000, OWASP 2023 baseline for high-entropy secrets) */
	iterations?: number
	/** Key length in bytes (default: 64) */
	keyLength?: number
}

export class ClientAuthenticator {
	private adapter: D1ClientAdapter
	private iterations: number
	private keyLength: number

	constructor(options: ClientAuthenticatorOptions) {
		this.adapter = options.adapter
		this.iterations = options.iterations || PBKDF2_ITERATIONS_2023
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
	 *
	 * Supports two client types per OAuth 2.0 spec:
	 * - Confidential clients: Have client_secret_hash, require secret validation
	 * - Public clients: No client_secret_hash, authenticate by client_id only
	 */
	async validateClient(
		clientId: string,
		clientSecret?: string,
	): Promise<{ valid: boolean; isPublicClient: boolean }> {
		try {
			// Get client from database
			const client = await this.adapter.getClient(clientId)
			if (!client) {
				// Perform dummy hash to prevent timing attacks
				if (clientSecret) await this.hashSecret(clientSecret)
				return { valid: false, isPublicClient: false }
			}

			// ============================================
			// PATH 1: PUBLIC CLIENT (no secret hash stored)
			// ============================================
			// Public clients (SPAs, mobile apps) cannot securely store secrets.
			// They authenticate by client_id only per RFC 7009.
			if (!client.client_secret_hash) {
				return { valid: true, isPublicClient: true }
			}

			// ============================================
			// PATH 2: CONFIDENTIAL CLIENT (has secret hash)
			// ============================================
			// Confidential clients MUST provide a valid secret.
			if (!clientSecret) {
				// Confidential client but no secret provided
				return { valid: false, isPublicClient: false }
			}

			// Extract salt and hash from stored value
			const [storedSalt, storedHash] = client.client_secret_hash.split(":")
			if (!storedSalt || !storedHash) {
				console.error("Invalid stored hash format for client:", clientId)
				return { valid: false, isPublicClient: false }
			}

			// Hash the provided secret with the stored salt
			const saltBytes = this.hexToBuffer(storedSalt)
			const { hash: computedHash } = await this.hashSecret(
				clientSecret,
				saltBytes,
			)
			const [, computedHashOnly] = computedHash.split(":")

			// Constant-time comparison
			const valid = this.constantTimeCompare(storedHash, computedHashOnly)
			return { valid, isPublicClient: false }
		} catch (error) {
			console.error("ClientAuthenticator: Error validating client:", error)
			return { valid: false, isPublicClient: false }
		}
	}

	/**
	 * Get client if credentials are valid
	 *
	 * Returns the client for:
	 * - Public clients: When client_id exists (no secret needed)
	 * - Confidential clients: When client_id + client_secret are valid
	 */
	async authenticateClient(
		clientId: string,
		clientSecret?: string,
	): Promise<{ client: OAuthClient | null; isPublicClient: boolean }> {
		const result = await this.validateClient(clientId, clientSecret)
		if (!result.valid) {
			return { client: null, isPublicClient: false }
		}

		const client = await this.adapter.getClient(clientId)
		return { client, isPublicClient: result.isPublicClient }
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

/**
 * AES-256-GCM Encryption Service for Provider Secrets
 *
 * Provides secure encryption for OAuth client secrets stored in the database.
 * Uses AES-256-GCM with random IVs for each encryption operation.
 *
 * Security features:
 * - AES-256-GCM authenticated encryption
 * - Unique 12-byte IV per encryption
 * - 128-bit authentication tag
 * - Constant-time operations via Web Crypto API
 *
 * @packageDocumentation
 */

import type { EncryptedValue } from "./types.js"
import { EncryptionError } from "./types.js"

/**
 * Configuration for the encryption service
 */
export interface EncryptionConfig {
  /** 32-byte (256-bit) encryption key */
  key: Uint8Array
}

/**
 * AES-256-GCM encryption service for secure secret storage
 */
export class EncryptionService {
  private readonly keyBytes: Uint8Array

  constructor(config: EncryptionConfig) {
    if (config.key.length !== 32) {
      throw new EncryptionError(
        "Encryption key must be exactly 32 bytes (256 bits)",
      )
    }
    this.keyBytes = config.key
  }

  /**
   * Import the raw key bytes as a CryptoKey for AES-GCM operations
   */
  private async getKey(): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      this.keyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )
  }

  /**
   * Encrypt a plaintext string using AES-256-GCM
   *
   * @param plaintext - The string to encrypt
   * @returns Encrypted value with ciphertext, IV, and auth tag
   */
  async encrypt(plaintext: string): Promise<EncryptedValue> {
    const key = await this.getKey()

    // Generate random 12-byte IV (96 bits, recommended for GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12))

    // Encode plaintext to bytes
    const encoder = new TextEncoder()
    const plaintextBytes = encoder.encode(plaintext)

    // Encrypt with AES-GCM (includes 128-bit auth tag)
    const ciphertextWithTag = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      plaintextBytes,
    )

    // Split ciphertext and authentication tag
    const ciphertextBytes = new Uint8Array(ciphertextWithTag)
    const ciphertext = ciphertextBytes.slice(0, -16)
    const tag = ciphertextBytes.slice(-16)

    return {
      ciphertext: this.toBase64(ciphertext),
      iv: this.toBase64(iv),
      tag: this.toBase64(tag),
    }
  }

  /**
   * Decrypt an encrypted value using AES-256-GCM
   *
   * @param encrypted - The encrypted value to decrypt
   * @returns Decrypted plaintext string
   * @throws EncryptionError if decryption fails (invalid key or corrupted data)
   */
  async decrypt(encrypted: EncryptedValue): Promise<string> {
    const key = await this.getKey()
    const iv = this.fromBase64(encrypted.iv)
    const ciphertext = this.fromBase64(encrypted.ciphertext)
    const tag = this.fromBase64(encrypted.tag)

    // Combine ciphertext and tag for decryption
    const combined = new Uint8Array(ciphertext.length + tag.length)
    combined.set(ciphertext)
    combined.set(tag, ciphertext.length)

    try {
      const plaintextBytes = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, tagLength: 128 },
        key,
        combined,
      )
      return new TextDecoder().decode(plaintextBytes)
    } catch {
      throw new EncryptionError(
        "Decryption failed: Invalid key or corrupted data",
      )
    }
  }

  /**
   * Encrypt a value for database storage
   *
   * Combines ciphertext and tag into a single string for storage.
   *
   * @param plaintext - The string to encrypt
   * @returns Object with ciphertext (includes tag) and IV for DB columns
   */
  async encryptForDB(
    plaintext: string,
  ): Promise<{ ciphertext: string; iv: string }> {
    const encrypted = await this.encrypt(plaintext)
    return {
      // Store ciphertext.tag in single column for simplicity
      ciphertext: encrypted.ciphertext + "." + encrypted.tag,
      iv: encrypted.iv,
    }
  }

  /**
   * Decrypt a value from database storage
   *
   * @param ciphertext - The stored ciphertext (ciphertext.tag format)
   * @param iv - The stored initialization vector
   * @returns Decrypted plaintext string
   * @throws EncryptionError if format is invalid or decryption fails
   */
  async decryptFromDB(ciphertext: string, iv: string): Promise<string> {
    const parts = ciphertext.split(".")
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new EncryptionError(
        "Invalid encrypted format: expected 'ciphertext.tag'",
      )
    }
    return this.decrypt({
      ciphertext: parts[0],
      iv,
      tag: parts[1],
    })
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private toBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private fromBase64(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}

/**
 * Generate a cryptographically secure random 256-bit encryption key
 *
 * @returns 32-byte Uint8Array suitable for AES-256
 */
export function generateEncryptionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

/**
 * Convert a hex string to bytes for use as an encryption key
 *
 * @param hex - 64-character hex string (32 bytes)
 * @returns 32-byte Uint8Array
 * @throws EncryptionError if hex string is not 64 characters
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new EncryptionError(
      "Encryption key must be 64 hex characters (32 bytes)",
    )
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

/**
 * Convert bytes to a hex string (for key generation/storage)
 *
 * @param bytes - Byte array to convert
 * @returns Hex string representation
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Mask a secret for safe display (shows only last 4 characters)
 *
 * @param secret - The secret to mask
 * @returns Masked string like "****abcd" or null if no secret
 */
export function maskSecret(secret: string | null): string | null {
  if (!secret) return null
  if (secret.length <= 4) {
    return "*".repeat(secret.length)
  }
  const visible = secret.slice(-4)
  const masked = "*".repeat(Math.min(secret.length - 4, 12))
  return masked + visible
}

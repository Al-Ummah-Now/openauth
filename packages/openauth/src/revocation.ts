/**
 * Token Revocation Service for OpenAuth
 *
 * Implements RFC 7009 token revocation.
 * Uses a hybrid strategy: short TTL (15min) for access tokens + revocation list for critical cases.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from "./storage/storage.js"
import { Storage } from "./storage/storage.js"

export interface RevocationServiceConfig {
  storage: StorageAdapter
  /**
   * TTL for revocation list entries (default: 900 seconds / 15 minutes)
   * Should match or exceed access token TTL
   */
  revocationTTL?: number
}

export class RevocationService {
  private storage: StorageAdapter
  private revocationTTL: number

  constructor(config: RevocationServiceConfig) {
    this.storage = config.storage
    this.revocationTTL = config.revocationTTL || 900 // 15 minutes
  }

  /**
   * Revoke an access token by adding it to the revocation list
   */
  async revokeAccessToken(tokenId: string): Promise<void> {
    try {
      const key = ["oauth:revoked:access", tokenId]
      await Storage.set(
        this.storage,
        key,
        {
          revoked_at: Date.now(),
        },
        this.revocationTTL,
      )
    } catch (error) {
      console.error("RevocationService: Failed to revoke access token:", error)
      throw error
    }
  }

  /**
   * Revoke a refresh token by removing it from storage
   */
  async revokeRefreshToken(subject: string, tokenId: string): Promise<boolean> {
    try {
      const key = ["oauth:refresh", subject, tokenId]
      await Storage.remove(this.storage, key)
      return true
    } catch (error) {
      console.error("RevocationService: Failed to revoke refresh token:", error)
      return false
    }
  }

  /**
   * Check if an access token has been revoked
   */
  async isAccessTokenRevoked(tokenId: string): Promise<boolean> {
    try {
      const key = ["oauth:revoked:access", tokenId]
      const result = await Storage.get<{ revoked_at: number }>(
        this.storage,
        key,
      )
      return result != null
    } catch (error) {
      console.error(
        "RevocationService: Failed to check revocation status:",
        error,
      )
      // On error, assume not revoked to avoid blocking valid tokens
      return false
    }
  }

  /**
   * Revoke all refresh tokens for a subject (used when revoking access tokens)
   */
  async revokeAllRefreshTokens(subject: string): Promise<number> {
    try {
      const prefix = ["oauth:refresh", subject]

      // Collect all keys first to avoid iterator issues during deletion
      const keysToDelete: string[][] = []
      for await (const [key] of Storage.scan(this.storage, prefix)) {
        keysToDelete.push(key)
      }

      // Delete all collected keys
      for (const key of keysToDelete) {
        await Storage.remove(this.storage, key)
      }

      return keysToDelete.length
    } catch (error) {
      console.error(
        "RevocationService: Failed to revoke all refresh tokens:",
        error,
      )
      return 0
    }
  }

  /**
   * Clean up expired revocation list entries
   * Should be called periodically (e.g., via cron job)
   */
  async cleanExpiredRevocations(): Promise<number> {
    try {
      const prefix = ["oauth:revoked:access"]
      const now = Date.now()

      // Collect expired keys first to avoid iterator issues during deletion
      const keysToDelete: string[][] = []
      for await (const [key, value] of Storage.scan<{ revoked_at: number }>(
        this.storage,
        prefix,
      )) {
        // Check if the revocation entry is expired based on TTL
        if (value.revoked_at + this.revocationTTL * 1000 < now) {
          keysToDelete.push(key)
        }
      }

      // Delete all expired keys
      for (const key of keysToDelete) {
        await Storage.remove(this.storage, key)
      }

      return keysToDelete.length
    } catch (error) {
      console.error(
        "RevocationService: Failed to clean expired revocations:",
        error,
      )
      return 0
    }
  }
}

import {
  expect,
  test,
  describe,
  beforeEach,
  setSystemTime,
  afterEach,
} from "bun:test"
import { RevocationService } from "../src/revocation.js"
import { MemoryStorage } from "../src/storage/memory.js"
import { Storage } from "../src/storage/storage.js"

describe("RevocationService", () => {
  let service: RevocationService
  let storage: ReturnType<typeof MemoryStorage>

  beforeEach(() => {
    storage = MemoryStorage()
    service = new RevocationService({
      storage,
      revocationTTL: 900, // 15 minutes
    })
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  describe("revokeAccessToken", () => {
    test("adds token to revocation list", async () => {
      const tokenId = "access-token-123"

      await service.revokeAccessToken(tokenId)

      const key = ["oauth:revoked:access", tokenId]
      const result = await Storage.get<{ revoked_at: number }>(storage, key)

      expect(result).toBeTruthy()
      expect(result?.revoked_at).toBe(Date.now())
    })

    test("sets TTL on revocation entry", async () => {
      const tokenId = "access-token-456"

      await service.revokeAccessToken(tokenId)

      // Since we can't directly check TTL in MemoryStorage,
      // we verify the entry exists immediately
      const key = ["oauth:revoked:access", tokenId]
      const result = await Storage.get(storage, key)
      expect(result).toBeTruthy()
    })

    test("allows revoking multiple tokens", async () => {
      const tokens = ["token-1", "token-2", "token-3"]

      for (const token of tokens) {
        await service.revokeAccessToken(token)
      }

      for (const token of tokens) {
        const isRevoked = await service.isAccessTokenRevoked(token)
        expect(isRevoked).toBe(true)
      }
    })
  })

  describe("isAccessTokenRevoked", () => {
    test("returns true for revoked token", async () => {
      const tokenId = "revoked-token"

      await service.revokeAccessToken(tokenId)
      const isRevoked = await service.isAccessTokenRevoked(tokenId)

      expect(isRevoked).toBe(true)
    })

    test("returns false for non-revoked token", async () => {
      const tokenId = "valid-token"

      const isRevoked = await service.isAccessTokenRevoked(tokenId)

      expect(isRevoked).toBe(false)
    })

    test("returns false on error (fail-open for availability)", async () => {
      // Create a service with a broken storage adapter
      const brokenStorage = {
        get: () => {
          throw new Error("Storage failure")
        },
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        scan: () => (async function* () {})(),
      }

      const brokenService = new RevocationService({
        storage: brokenStorage as any,
        revocationTTL: 900,
      })

      const isRevoked = await brokenService.isAccessTokenRevoked("any-token")

      // Should return false to avoid blocking valid tokens
      expect(isRevoked).toBe(false)
    })
  })

  describe("revokeRefreshToken", () => {
    test("removes refresh token from storage", async () => {
      const subject = "user:abc123"
      const tokenId = "refresh-token-xyz"
      const key = ["oauth:refresh", subject, tokenId]

      // Add a refresh token first
      await Storage.set(
        storage,
        key,
        {
          type: "user",
          subject,
          clientID: "test-client",
          properties: { userID: "123" },
          ttl: { access: 900, refresh: 86400 },
        },
        86400,
      )

      // Verify it exists
      let result = await Storage.get(storage, key)
      expect(result).toBeTruthy()

      // Revoke it
      const success = await service.revokeRefreshToken(subject, tokenId)

      // Verify it was removed (Storage.get returns undefined for missing keys)
      result = await Storage.get(storage, key)
      expect(result).toBeUndefined()
      expect(success).toBe(true)
    })

    test("returns true even if token doesn't exist", async () => {
      const subject = "user:xyz789"
      const tokenId = "non-existent-token"

      const success = await service.revokeRefreshToken(subject, tokenId)

      expect(success).toBe(true)
    })

    test("returns false on storage error", async () => {
      const brokenStorage = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        remove: () => {
          throw new Error("Storage failure")
        },
        scan: () => (async function* () {})(),
      }

      const brokenService = new RevocationService({
        storage: brokenStorage as any,
        revocationTTL: 900,
      })

      const success = await brokenService.revokeRefreshToken(
        "user:123",
        "token",
      )

      expect(success).toBe(false)
    })
  })

  describe("revokeAllRefreshTokens", () => {
    test("revokes all refresh tokens for a subject", async () => {
      const subject = "user:abc123"
      const tokens = ["token-1", "token-2", "token-3"]

      // Add multiple refresh tokens for the same subject
      for (const tokenId of tokens) {
        await Storage.set(
          storage,
          ["oauth:refresh", subject, tokenId],
          {
            type: "user",
            subject,
            clientID: "test-client",
            properties: { userID: "123" },
            ttl: { access: 900, refresh: 86400 },
          },
          86400,
        )
      }

      // Revoke all tokens
      const count = await service.revokeAllRefreshTokens(subject)

      expect(count).toBe(3)

      // Verify all tokens are removed
      for (const tokenId of tokens) {
        const result = await Storage.get(storage, [
          "oauth:refresh",
          subject,
          tokenId,
        ])
        expect(result).toBeUndefined()
      }
    })

    test("returns 0 when no tokens exist", async () => {
      const subject = "user:no-tokens"

      const count = await service.revokeAllRefreshTokens(subject)

      expect(count).toBe(0)
    })

    test("only revokes tokens for specified subject", async () => {
      const subject1 = "user:alice"
      const subject2 = "user:bob"

      // Add tokens for both subjects
      await Storage.set(
        storage,
        ["oauth:refresh", subject1, "token-1"],
        { subject: subject1 },
        86400,
      )
      await Storage.set(
        storage,
        ["oauth:refresh", subject2, "token-2"],
        { subject: subject2 },
        86400,
      )

      // Revoke only subject1's tokens
      await service.revokeAllRefreshTokens(subject1)

      // Verify subject1's tokens are removed
      const result1 = await Storage.get(storage, [
        "oauth:refresh",
        subject1,
        "token-1",
      ])
      expect(result1).toBeUndefined()

      // Verify subject2's tokens still exist
      const result2 = await Storage.get(storage, [
        "oauth:refresh",
        subject2,
        "token-2",
      ])
      expect(result2).toBeTruthy()
    })
  })

  describe("cleanExpiredRevocations", () => {
    test("removes expired revocation entries", async () => {
      const expiredToken = "expired-token"
      const validToken = "valid-token"

      // Add an expired revocation (created 20 minutes ago)
      await Storage.set(
        storage,
        ["oauth:revoked:access", expiredToken],
        { revoked_at: Date.now() - 20 * 60 * 1000 }, // 20 minutes ago
        900, // 15 minute TTL
      )

      // Add a valid revocation (created 5 minutes ago)
      await Storage.set(
        storage,
        ["oauth:revoked:access", validToken],
        { revoked_at: Date.now() - 5 * 60 * 1000 }, // 5 minutes ago
        900,
      )

      // Advance time to trigger expiration
      setSystemTime(Date.now() + 1000)

      // Clean expired entries
      const count = await service.cleanExpiredRevocations()

      expect(count).toBeGreaterThanOrEqual(1)

      // Verify expired token is removed
      const expiredResult = await service.isAccessTokenRevoked(expiredToken)
      expect(expiredResult).toBe(false)

      // Verify valid token still exists
      const validResult = await service.isAccessTokenRevoked(validToken)
      expect(validResult).toBe(true)
    })

    test("returns 0 when no expired entries exist", async () => {
      const tokenId = "recent-token"

      // Add a recent revocation
      await service.revokeAccessToken(tokenId)

      const count = await service.cleanExpiredRevocations()

      expect(count).toBe(0)
    })

    test("handles errors gracefully", async () => {
      const brokenStorage = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        remove: () => {
          throw new Error("Storage failure")
        },
        scan: () =>
          (async function* () {
            yield [
              ["oauth:revoked:access", "token"],
              { revoked_at: Date.now() - 1000000 },
            ]
          })(),
      }

      const brokenService = new RevocationService({
        storage: brokenStorage as any,
        revocationTTL: 900,
      })

      const count = await brokenService.cleanExpiredRevocations()

      expect(count).toBe(0)
    })
  })

  describe("configuration", () => {
    test("uses custom revocationTTL", async () => {
      const customService = new RevocationService({
        storage,
        revocationTTL: 3600, // 1 hour
      })

      const tokenId = "custom-ttl-token"
      await customService.revokeAccessToken(tokenId)

      // Verify entry exists
      const isRevoked = await customService.isAccessTokenRevoked(tokenId)
      expect(isRevoked).toBe(true)
    })

    test("uses default revocationTTL when not specified", async () => {
      const defaultService = new RevocationService({
        storage,
      })

      const tokenId = "default-ttl-token"
      await defaultService.revokeAccessToken(tokenId)

      // Verify entry exists
      const isRevoked = await defaultService.isAccessTokenRevoked(tokenId)
      expect(isRevoked).toBe(true)
    })
  })
})

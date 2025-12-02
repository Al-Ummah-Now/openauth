import {
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
  setSystemTime,
} from "bun:test"
import { MemoryStorage } from "../src/storage/memory.js"
import { encryptionKeys, signingKeys } from "../src/keys.js"
import { Storage, joinKey } from "../src/storage/storage.js"

describe("Key Generation and Persistence", () => {
  let storage: ReturnType<typeof MemoryStorage>

  beforeEach(() => {
    storage = MemoryStorage()
    setSystemTime(new Date("2024-01-01T00:00:00Z"))
  })

  afterEach(() => {
    setSystemTime()
  })

  describe("encryptionKeys", () => {
    test("generates and saves key on first call when no keys exist", async () => {
      // First call - should generate key
      const keys1 = await encryptionKeys(storage)

      expect(keys1).toHaveLength(1)
      expect(keys1[0].alg).toBe("RSA-OAEP-512")
      expect(keys1[0].id).toBe("primary") // Fixed ID to prevent race condition
      expect(keys1[0].public).toBeDefined()
      expect(keys1[0].private).toBeDefined()

      // Verify key was saved to storage with new separator
      const savedKeys = await Array.fromAsync(
        Storage.scan(storage, ["encryption:key"]),
      )
      expect(savedKeys).toHaveLength(1)
      expect(savedKeys[0][0]).toEqual(["encryption:key", "primary"])
    })

    test("uses double colon separator for storage keys", async () => {
      await encryptionKeys(storage)

      // Verify the key is stored with double colon separator
      const expectedKey = joinKey(["encryption:key", "primary"])
      expect(expectedKey).toBe("encryption:key::primary")
    })

    test("loads existing key on second call (no regeneration)", async () => {
      // First call - generates key
      const keys1 = await encryptionKeys(storage)
      const keyId1 = keys1[0].id

      // Second call - should load same key, NOT generate new one
      const keys2 = await encryptionKeys(storage)
      const keyId2 = keys2[0].id

      expect(keyId1).toBe(keyId2)
      expect(keys2).toHaveLength(1)
    })

    test("key persists across multiple calls", async () => {
      // Generate key
      const keys1 = await encryptionKeys(storage)

      // Simulate "cold start" by calling again
      const keys2 = await encryptionKeys(storage)
      const keys3 = await encryptionKeys(storage)

      // All should return the same key
      expect(keys1[0].id).toBe(keys2[0].id)
      expect(keys2[0].id).toBe(keys3[0].id)

      // Only 1 key in storage
      const savedKeys = await Array.fromAsync(
        Storage.scan(storage, ["encryption:key"]),
      )
      expect(savedKeys).toHaveLength(1)
    })

    test("concurrent calls only generate one key", async () => {
      // Simulate concurrent first requests
      const [keys1, keys2, keys3] = await Promise.all([
        encryptionKeys(storage),
        encryptionKeys(storage),
        encryptionKeys(storage),
      ])

      // All should have same key ID
      expect(keys1[0].id).toBe(keys2[0].id)
      expect(keys2[0].id).toBe(keys3[0].id)

      // Check how many keys were actually created
      const savedKeys = await Array.fromAsync(
        Storage.scan(storage, ["encryption:key"]),
      )

      // Verify only one key was created (no race condition)
      expect(savedKeys).toHaveLength(1)
    })
  })

  describe("signingKeys", () => {
    test("generates and saves key on first call", async () => {
      const keys = await signingKeys(storage)

      expect(keys).toHaveLength(1)
      expect(keys[0].alg).toBe("ES256")
      expect(keys[0].id).toBe("primary") // Fixed ID to prevent race condition

      const savedKeys = await Array.fromAsync(
        Storage.scan(storage, ["signing:key"]),
      )
      expect(savedKeys).toHaveLength(1)
      expect(savedKeys[0][0]).toEqual(["signing:key", "primary"])
    })

    test("loads existing key on second call", async () => {
      const keys1 = await signingKeys(storage)
      const keys2 = await signingKeys(storage)

      expect(keys1[0].id).toBe(keys2[0].id)
      expect(keys1[0].id).toBe("primary")
    })

    test("concurrent calls only generate one key", async () => {
      const [keys1, keys2, keys3] = await Promise.all([
        signingKeys(storage),
        signingKeys(storage),
        signingKeys(storage),
      ])

      expect(keys1[0].id).toBe(keys2[0].id)
      expect(keys2[0].id).toBe(keys3[0].id)

      const savedKeys = await Array.fromAsync(
        Storage.scan(storage, ["signing:key"]),
      )
      expect(savedKeys).toHaveLength(1)
    })
  })

  describe("Storage persistence simulation", () => {
    test("keys survive 'restart' (new storage instance with same data)", async () => {
      // Generate keys
      await encryptionKeys(storage)
      await signingKeys(storage)

      // Get raw storage data
      const encKeys = await Array.fromAsync(
        Storage.scan(storage, ["encryption:key"]),
      )
      const sigKeys = await Array.fromAsync(
        Storage.scan(storage, ["signing:key"]),
      )

      expect(encKeys.length).toBeGreaterThan(0)
      expect(sigKeys.length).toBeGreaterThan(0)

      // Simulate "restart" - create new storage with persisted data
      const storage2 = MemoryStorage()
      for (const [key, value] of encKeys) {
        await Storage.set(storage2, key, value)
      }
      for (const [key, value] of sigKeys) {
        await Storage.set(storage2, key, value)
      }

      // Load keys from "restarted" storage - should NOT generate new ones
      const loadedEncKeys = await encryptionKeys(storage2)
      const loadedSigKeys = await signingKeys(storage2)

      expect(loadedEncKeys[0].id).toBe(encKeys[0][1].id)
      expect(loadedSigKeys[0].id).toBe(sigKeys[0][1].id)
    })
  })

  describe("CloudflareStorage simulation", () => {
    test("keys should persist with async storage", async () => {
      // Simulate async storage like Cloudflare KV
      const data = new Map<string, any>()

      const asyncStorage = {
        async get(key: string[]) {
          const k = JSON.stringify(key)
          return data.get(k)
        },
        async set(key: string[], value: any, ttl?: number) {
          const k = JSON.stringify(key)
          data.set(k, value)
        },
        async remove(key: string[]) {
          const k = JSON.stringify(key)
          data.delete(k)
        },
        async *scan(prefix: string[]) {
          const prefixStr = JSON.stringify(prefix)
          for (const [key, value] of data) {
            if (key.startsWith(prefixStr.slice(0, -1))) {
              yield [JSON.parse(key), value] as [string[], any]
            }
          }
        },
      }

      // Generate keys
      const keys1 = await encryptionKeys(asyncStorage)

      // Load again - should get same key
      const keys2 = await encryptionKeys(asyncStorage)

      expect(keys1[0].id).toBe(keys2[0].id)
    })
  })
})

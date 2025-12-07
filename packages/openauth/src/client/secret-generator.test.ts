import { describe, test, expect } from "bun:test"
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret,
} from "./secret-generator.js"

describe("generateClientId", () => {
  test("generates unique IDs with prefix", () => {
    const id1 = generateClientId()
    const id2 = generateClientId()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^client_[A-Za-z0-9_-]+$/)
  })

  test("uses custom prefix", () => {
    const id = generateClientId("svc")
    expect(id).toMatch(/^svc_/)
  })
})

describe("generateClientSecret", () => {
  test("generates 32-byte secrets", () => {
    const secret = generateClientSecret()
    // Base64 encoded 32 bytes = ~43 characters
    expect(secret.length).toBeGreaterThanOrEqual(40)
  })

  test("generates unique secrets", () => {
    const secrets = new Set()
    for (let i = 0; i < 100; i++) {
      secrets.add(generateClientSecret())
    }
    expect(secrets.size).toBe(100)
  })
})

describe("hashClientSecret / verifyClientSecret", () => {
  test("verifies correct secret", async () => {
    const secret = generateClientSecret()
    const hash = await hashClientSecret(secret)
    expect(await verifyClientSecret(secret, hash)).toBe(true)
  })

  test("rejects incorrect secret", async () => {
    const secret = generateClientSecret()
    const hash = await hashClientSecret(secret)
    expect(await verifyClientSecret("wrong", hash)).toBe(false)
  })

  test("hash format is correct", async () => {
    const hash = await hashClientSecret("test")
    expect(hash).toMatch(
      /^\$pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/,
    )
  })

  test("different secrets produce different hashes", async () => {
    const secret1 = generateClientSecret()
    const secret2 = generateClientSecret()
    const hash1 = await hashClientSecret(secret1)
    const hash2 = await hashClientSecret(secret2)
    expect(hash1).not.toBe(hash2)
  })

  test("same secret produces different hashes (due to random salt)", async () => {
    const secret = "test-secret"
    const hash1 = await hashClientSecret(secret)
    const hash2 = await hashClientSecret(secret)
    expect(hash1).not.toBe(hash2)
    // But both should verify
    expect(await verifyClientSecret(secret, hash1)).toBe(true)
    expect(await verifyClientSecret(secret, hash2)).toBe(true)
  })

  test("rejects malformed hash", async () => {
    expect(await verifyClientSecret("secret", "invalid-hash")).toBe(false)
    expect(await verifyClientSecret("secret", "$pbkdf2-sha256$")).toBe(false)
    expect(await verifyClientSecret("secret", "")).toBe(false)
  })
})

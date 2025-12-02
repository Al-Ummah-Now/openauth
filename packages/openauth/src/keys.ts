import {
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  JWK,
  KeyLike,
} from "jose"
import { Storage, StorageAdapter } from "./storage/storage.js"

const signingAlg = "ES256"
const encryptionAlg = "RSA-OAEP-512"

/**
 * Fixed key IDs for primary keys.
 * Using fixed IDs instead of random UUIDs prevents key proliferation
 * when multiple workers race to generate keys - last writer wins,
 * but all workers will read the same key on next request.
 */
const PRIMARY_SIGNING_KEY_ID = "primary"
const PRIMARY_ENCRYPTION_KEY_ID = "primary"

/**
 * In-memory promise cache to prevent concurrent key generation within same isolate.
 * Maps storage instance + key type to the pending Promise.
 */
const keyGenerationLocks = new WeakMap<
  StorageAdapter,
  Map<string, Promise<KeyPair[]>>
>()

interface SerializedKeyPair {
  id: string
  publicKey: string
  privateKey: string
  created: number
  alg: string
  expired?: number
}

export interface KeyPair {
  id: string
  alg: string
  public: KeyLike
  private: KeyLike
  created: Date
  expired?: Date
  jwk: JWK
}

/**
 * Deserialize a stored key pair into a KeyPair object
 */
async function deserializeKeyPair(
  value: SerializedKeyPair,
  alg: string,
  use?: string,
): Promise<KeyPair> {
  const publicKey = await importSPKI(value.publicKey, value.alg, {
    extractable: true,
  })
  const privateKey = await importPKCS8(value.privateKey, value.alg)
  const jwk = await exportJWK(publicKey)
  jwk.kid = value.id
  if (use) jwk.use = use
  return {
    id: value.id,
    alg,
    created: new Date(value.created),
    expired: value.expired ? new Date(value.expired) : undefined,
    public: publicKey,
    private: privateKey,
    jwk,
  }
}

/**
 * @deprecated use `signingKeys` instead
 */
export async function legacySigningKeys(
  storage: StorageAdapter,
): Promise<KeyPair[]> {
  const alg = "RS512"
  const results = [] as KeyPair[]
  const scanner = Storage.scan<SerializedKeyPair>(storage, ["oauth:key"])
  for await (const [_key, value] of scanner) {
    const publicKey = await importSPKI(value.publicKey, alg, {
      extractable: true,
    })
    const privateKey = await importPKCS8(value.privateKey, alg)
    const jwk = await exportJWK(publicKey)
    jwk.kid = value.id
    results.push({
      id: value.id,
      alg,
      created: new Date(value.created),
      public: publicKey,
      private: privateKey,
      expired: new Date(1735858114000),
      jwk,
    })
  }
  return results
}

export async function signingKeys(storage: StorageAdapter): Promise<KeyPair[]> {
  // Check for existing lock to prevent concurrent generation
  let locks = keyGenerationLocks.get(storage)
  if (!locks) {
    locks = new Map()
    keyGenerationLocks.set(storage, locks)
  }

  const lockKey = "signing"
  const existingLock = locks.get(lockKey)
  if (existingLock) {
    return existingLock
  }

  const promise = signingKeysInternal(storage).finally(() => {
    locks!.delete(lockKey)
  })
  locks.set(lockKey, promise)
  return promise
}

async function signingKeysInternal(
  storage: StorageAdapter,
): Promise<KeyPair[]> {
  // Fast path: try to get the primary key directly (single KV read)
  const primaryKey = await Storage.get<SerializedKeyPair>(storage, [
    "signing:key",
    PRIMARY_SIGNING_KEY_ID,
  ])

  if (primaryKey && !primaryKey.expired) {
    try {
      const keyPair = await deserializeKeyPair(primaryKey, signingAlg, "sig")
      return [keyPair]
    } catch (err) {
      console.error("[openauth:keys] Failed to load primary signing key:", err)
    }
  }

  // Slow path: scan for any existing keys (supports rotation/legacy)
  const results = [] as KeyPair[]
  const scanner = Storage.scan<SerializedKeyPair>(storage, ["signing:key"])
  for await (const [_key, value] of scanner) {
    try {
      const keyPair = await deserializeKeyPair(value, signingAlg, "sig")
      results.push(keyPair)
    } catch (err) {
      console.error(
        `[openauth:keys] Failed to load signing key ${value.id}:`,
        err,
      )
    }
  }

  // Return existing keys if any are unexpired
  results.sort((a, b) => b.created.getTime() - a.created.getTime())
  if (results.filter((item) => !item.expired).length) {
    return results
  }

  // No valid keys found - generate a new primary key
  // Using fixed ID means multiple workers racing will overwrite each other,
  // but that's fine - all generated keys are valid, and on next request
  // everyone will read the same key
  const key = await generateKeyPair(signingAlg, {
    extractable: true,
  })
  const serialized: SerializedKeyPair = {
    id: PRIMARY_SIGNING_KEY_ID,
    publicKey: await exportSPKI(key.publicKey),
    privateKey: await exportPKCS8(key.privateKey),
    created: Date.now(),
    alg: signingAlg,
  }
  await Storage.set(
    storage,
    ["signing:key", PRIMARY_SIGNING_KEY_ID],
    serialized,
  )

  // Re-read to get whatever key is now stored (handles race condition)
  const savedKey = await Storage.get<SerializedKeyPair>(storage, [
    "signing:key",
    PRIMARY_SIGNING_KEY_ID,
  ])
  if (savedKey) {
    return [await deserializeKeyPair(savedKey, signingAlg, "sig")]
  }

  // Fallback: return the key we just generated (should rarely happen)
  console.warn(
    "[openauth:keys] Using locally generated signing key - storage may be unavailable",
  )
  return [await deserializeKeyPair(serialized, signingAlg, "sig")]
}

export async function encryptionKeys(
  storage: StorageAdapter,
): Promise<KeyPair[]> {
  // Check for existing lock to prevent concurrent generation
  let locks = keyGenerationLocks.get(storage)
  if (!locks) {
    locks = new Map()
    keyGenerationLocks.set(storage, locks)
  }

  const lockKey = "encryption"
  const existingLock = locks.get(lockKey)
  if (existingLock) {
    return existingLock
  }

  const promise = encryptionKeysInternal(storage).finally(() => {
    locks!.delete(lockKey)
  })
  locks.set(lockKey, promise)
  return promise
}

async function encryptionKeysInternal(
  storage: StorageAdapter,
): Promise<KeyPair[]> {
  // Fast path: try to get the primary key directly (single KV read)
  const primaryKey = await Storage.get<SerializedKeyPair>(storage, [
    "encryption:key",
    PRIMARY_ENCRYPTION_KEY_ID,
  ])

  if (primaryKey && !primaryKey.expired) {
    try {
      const keyPair = await deserializeKeyPair(primaryKey, encryptionAlg)
      return [keyPair]
    } catch (err) {
      console.error(
        "[openauth:keys] Failed to load primary encryption key:",
        err,
      )
    }
  }

  // Slow path: scan for any existing keys (supports rotation/legacy)
  const results = [] as KeyPair[]
  const scanner = Storage.scan<SerializedKeyPair>(storage, ["encryption:key"])
  for await (const [_key, value] of scanner) {
    try {
      const keyPair = await deserializeKeyPair(value, encryptionAlg)
      results.push(keyPair)
    } catch (err) {
      console.error(
        `[openauth:keys] Failed to load encryption key ${value.id}:`,
        err,
      )
    }
  }

  // Return existing keys if any are unexpired
  results.sort((a, b) => b.created.getTime() - a.created.getTime())
  if (results.filter((item) => !item.expired).length) {
    return results
  }

  // No valid keys found - generate a new primary key
  // Using fixed ID means multiple workers racing will overwrite each other,
  // but that's fine - all generated keys are valid, and on next request
  // everyone will read the same key
  const key = await generateKeyPair(encryptionAlg, {
    extractable: true,
  })
  const serialized: SerializedKeyPair = {
    id: PRIMARY_ENCRYPTION_KEY_ID,
    publicKey: await exportSPKI(key.publicKey),
    privateKey: await exportPKCS8(key.privateKey),
    created: Date.now(),
    alg: encryptionAlg,
  }
  await Storage.set(
    storage,
    ["encryption:key", PRIMARY_ENCRYPTION_KEY_ID],
    serialized,
  )

  // Re-read to get whatever key is now stored (handles race condition)
  const savedKey = await Storage.get<SerializedKeyPair>(storage, [
    "encryption:key",
    PRIMARY_ENCRYPTION_KEY_ID,
  ])
  if (savedKey) {
    return [await deserializeKeyPair(savedKey, encryptionAlg)]
  }

  // Fallback: return the key we just generated (should rarely happen)
  console.warn(
    "[openauth:keys] Using locally generated encryption key - storage may be unavailable",
  )
  return [await deserializeKeyPair(serialized, encryptionAlg)]
}

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

/** JWS algorithm used for newly generated signing keys. */
export const SIGNING_ALG = signingAlg
const encryptionAlg = "RSA-OAEP-512"

/**
 * Keys are listed in one index per kind, `["keys:signing"]` and
 * `["keys:encryption"]` (no other key's prefix), in the storage adapter's atomic store (OA-3):
 *
 * - every key has its own random `kid`, so two keys can never share one;
 * - a new key is added with compare-and-set on the index, so of processes
 *   racing to create the first key exactly one succeeds and the others use
 *   it (no process ever signs with a key that lost the race);
 * - every key in the index is returned (newest first): JWKS publishes all
 *   non-expired keys.
 *
 * Keys stored by older versions (`signing:key/primary` and other
 * `signing:key/*` entries in the plain store) are adopted into the index on
 * first use, keeping their ids. New keys are also written to the plain store
 * under `<kind>:key/<kid>` so older readers still find them.
 */
const INDEX = {
  signing: ["keys:signing"],
  encryption: ["keys:encryption"],
} as const
const LEGACY_PREFIX = {
  signing: ["signing:key"],
  encryption: ["encryption:key"],
} as const

interface KeyIndex {
  keys: SerializedKeyPair[]
}

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
  return locked(storage, "signing", () =>
    loadOrCreate(storage, "signing", signingAlg, "sig"),
  )
}

export async function encryptionKeys(
  storage: StorageAdapter,
): Promise<KeyPair[]> {
  return locked(storage, "encryption", () =>
    loadOrCreate(storage, "encryption", encryptionAlg),
  )
}

/** One load per storage and kind at a time within this isolate. */
function locked(
  storage: StorageAdapter,
  kind: string,
  load: () => Promise<KeyPair[]>,
): Promise<KeyPair[]> {
  let locks = keyGenerationLocks.get(storage)
  if (!locks) {
    locks = new Map()
    keyGenerationLocks.set(storage, locks)
  }
  const existing = locks.get(kind)
  if (existing) return existing
  const promise = load().finally(() => locks!.delete(kind))
  locks.set(kind, promise)
  return promise
}

/** Keys an older version stored in the plain store. */
async function legacyKeys(
  storage: StorageAdapter,
  kind: keyof typeof LEGACY_PREFIX,
): Promise<SerializedKeyPair[]> {
  const found = new Map<string, SerializedKeyPair>()
  const primary = await Storage.get<SerializedKeyPair>(storage, [
    ...LEGACY_PREFIX[kind],
    "primary",
  ])
  if (primary) found.set(primary.id, primary)
  for await (const [, value] of Storage.scan<SerializedKeyPair>(storage, [
    ...LEGACY_PREFIX[kind],
  ]))
    if (value?.id) found.set(value.id, value)
  return [...found.values()]
}

async function deserializeAll(
  keys: SerializedKeyPair[],
  alg: string,
  use?: string,
): Promise<KeyPair[]> {
  const out = [] as KeyPair[]
  for (const value of keys) {
    try {
      out.push(await deserializeKeyPair(value, alg, use))
    } catch (err) {
      console.error(`[openauth:keys] Failed to load key ${value.id}:`, err)
    }
  }
  // Newest non-expired first: that is the key in use
  return out.sort(
    (a, b) =>
      Number(!!a.expired) - Number(!!b.expired) ||
      b.created.getTime() - a.created.getTime(),
  )
}

async function loadOrCreate(
  storage: StorageAdapter,
  kind: keyof typeof INDEX,
  alg: string,
  use?: string,
): Promise<KeyPair[]> {
  const atomic = Storage.atomic(storage)
  const indexKey = [...INDEX[kind]]
  for (let attempt = 0; attempt < 5; attempt++) {
    const index = (await atomic.get(indexKey)) as KeyIndex | undefined
    if (!index) {
      const legacy = await legacyKeys(storage, kind)
      if (legacy.length) {
        // Adopt existing keys (same ids); whoever adds first wins, all agree
        await atomic.add(indexKey, { keys: legacy } satisfies KeyIndex)
        continue
      }
    }
    const keys = index?.keys ?? []
    if (keys.some((k) => !k.expired)) {
      const loaded = await deserializeAll(keys, alg, use)
      if (loaded.some((k) => !k.expired)) return loaded
    }

    // No usable key: create one with a unique kid and add it atomically
    const pair = await generateKeyPair(alg, { extractable: true })
    const fresh: SerializedKeyPair = {
      id: crypto.randomUUID(),
      publicKey: await exportSPKI(pair.publicKey),
      privateKey: await exportPKCS8(pair.privateKey),
      created: Date.now(),
      alg,
    }
    const next: KeyIndex = { keys: [fresh, ...keys] }
    const won = index
      ? await atomic.replace(indexKey, index, next)
      : await atomic.add(indexKey, next)
    if (won) {
      await Storage.set(storage, [...LEGACY_PREFIX[kind], fresh.id], fresh)
      return deserializeAll(next.keys, alg, use)
    }
    // Another process created a key first: use theirs
  }
  throw new Error(`[openauth:keys] Could not load or create ${kind} keys`)
}

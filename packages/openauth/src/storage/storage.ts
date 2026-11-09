export interface StorageAdapter {
  get(key: string[]): Promise<Record<string, any> | undefined>
  remove(key: string[]): Promise<void>
  set(key: string[], value: any, expiry?: Date): Promise<void>
  scan(prefix: string[]): AsyncIterable<[string[], any]>
  /**
   * Optional strongly consistent store with atomic operations. The issuer
   * keeps single-use and rotating credentials (authorization codes, used-code
   * markers, refresh-token families, device-flow state) here when it is
   * present. Without it those fall back to the plain operations above, which
   * are only correct when a single process uses the store (eventually
   * consistent stores such as Cloudflare KV cannot give one-time use).
   */
  atomic?: AtomicStorageAdapter
  /**
   * Optional stable name of the underlying store (e.g. the KV namespace).
   * Adapters are often rebuilt per request; with a scope, data derived from
   * the store that rarely changes (imported signing and encryption keys) is
   * cached in module scope across requests for a few minutes.
   */
  scope?: string
}

/**
 * Atomic, strongly consistent operations. Every method must be linearizable
 * per key: concurrent callers from any process observe one order. Values are
 * JSON; `expiry` behaves as in {@link StorageAdapter.set} and an expired value
 * counts as absent.
 */
export interface AtomicStorageAdapter {
  /** Read the live value (never a cached or stale copy). */
  get(key: string[]): Promise<any | undefined>
  /** Unconditional write. */
  set(key: string[], value: any, expiry?: Date): Promise<void>
  /** Write only if the key has no live value. True if this call wrote it. */
  add(key: string[], value: any, expiry?: Date): Promise<boolean>
  /**
   * Compare-and-set: replace the live value only if its JSON serialization
   * equals that of `expected` (a value previously read with `get`). True if
   * this call replaced it.
   */
  replace(
    key: string[],
    expected: any,
    value: any,
    expiry?: Date,
  ): Promise<boolean>
  /** Delete and return the live value. At most one caller receives it. */
  take(key: string[]): Promise<any | undefined>
  remove(key: string[]): Promise<void>
  /**
   * Delete every key under a prefix (e.g. all refresh tokens of a subject).
   * Returns how many were deleted. Required for refresh tokens to be revoked
   * in bulk; without it only the plain store is cleared.
   */
  removePrefix?(prefix: string[]): Promise<number>
}

/** New separator - double colon is KV-friendly and won't conflict with single colons in key names */
const SEPARATOR = "::"

/** Legacy separator for migration support */
const LEGACY_SEPARATOR = String.fromCharCode(0x1f)

export function joinKey(key: string[]) {
  return key.join(SEPARATOR)
}

export function splitKey(key: string) {
  // Support both new and legacy separators when splitting
  if (key.includes(LEGACY_SEPARATOR)) {
    return key.split(LEGACY_SEPARATOR)
  }
  return key.split(SEPARATOR)
}

/** Join key with legacy separator (for migration reads) */
export function joinKeyLegacy(key: string[]) {
  return key.join(LEGACY_SEPARATOR)
}

export namespace Storage {
  function encode(key: string[]) {
    // Strip separators from key segments to prevent injection
    return key.map((k) =>
      k.replaceAll(SEPARATOR, "").replaceAll(LEGACY_SEPARATOR, ""),
    )
  }
  export function get<T>(adapter: StorageAdapter, key: string[]) {
    return adapter.get(encode(key)) as Promise<T | null>
  }

  export function set(
    adapter: StorageAdapter,
    key: string[],
    value: any,
    ttl?: number,
  ) {
    const expiry = ttl ? new Date(Date.now() + ttl * 1000) : undefined
    return adapter.set(encode(key), value, expiry)
  }

  export function remove(adapter: StorageAdapter, key: string[]) {
    return adapter.remove(encode(key))
  }

  /**
   * The adapter's atomic store with keys encoded. Without one, a best-effort
   * emulation over the plain operations (correct only for a single process).
   */
  export function atomic(adapter: StorageAdapter): AtomicStorageAdapter {
    const a = adapter.atomic ?? emulateAtomic(adapter)
    return {
      get: (key) => a.get(encode(key)),
      set: (key, value, expiry) => a.set(encode(key), value, expiry),
      add: (key, value, expiry) => a.add(encode(key), value, expiry),
      replace: (key, expected, value, expiry) =>
        a.replace(encode(key), expected, value, expiry),
      take: (key) => a.take(encode(key)),
      remove: (key) => a.remove(encode(key)),
      removePrefix: async (prefix) =>
        a.removePrefix ? a.removePrefix(encode(prefix)) : 0,
    }
  }

  /** True when the adapter provides real atomic operations. */
  export function isAtomic(adapter: StorageAdapter) {
    return !!adapter.atomic
  }

  export function scan<T>(
    adapter: StorageAdapter,
    key: string[],
  ): AsyncIterable<[string[], T]> {
    return adapter.scan(encode(key))
  }
}

/** Read-then-write emulation: the behaviour before atomic adapters existed. */
function emulateAtomic(adapter: StorageAdapter): AtomicStorageAdapter {
  return {
    get: (key) => adapter.get(key),
    set: (key, value, expiry) => adapter.set(key, value, expiry),
    async add(key, value, expiry) {
      if ((await adapter.get(key)) != null) return false
      await adapter.set(key, value, expiry)
      return true
    },
    async replace(key, expected, value, expiry) {
      const current = await adapter.get(key)
      if (
        current == null ||
        JSON.stringify(current) !== JSON.stringify(expected)
      )
        return false
      await adapter.set(key, value, expiry)
      return true
    },
    async take(key) {
      const value = await adapter.get(key)
      if (value == null) return undefined
      await adapter.remove(key)
      return value
    },
    remove: (key) => adapter.remove(key),
  }
}

export interface StorageAdapter {
  get(key: string[]): Promise<Record<string, any> | undefined>
  remove(key: string[]): Promise<void>
  set(key: string[], value: any, expiry?: Date): Promise<void>
  scan(prefix: string[]): AsyncIterable<[string[], any]>
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

  export function scan<T>(
    adapter: StorageAdapter,
    key: string[],
  ): AsyncIterable<[string[], T]> {
    return adapter.scan(encode(key))
  }
}

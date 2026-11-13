/**
 * Refresh-token storage (OA-2).
 *
 * Refresh tokens rotate: each use marks the token used and hands out the
 * pre-reserved next one. That is a read-modify-write, so the tokens live in
 * the storage adapter's atomic store when it has one:
 *
 * - marking a token used is a compare-and-set, so exactly one request rotates
 *   it; concurrent requests within the reuse window get the same next token;
 * - a token written in one place is readable everywhere at once (no
 *   `invalid_grant` for a token that was just issued in another PoP);
 * - invalidating a subject deletes its tokens exactly, not from a lagging
 *   `list`.
 *
 * Tokens written to the plain store by an older version keep working: on
 * first read they are moved into the atomic store (once, with `add`).
 */
import { Storage, type StorageAdapter } from "./storage/storage.js"

export interface RefreshTokenPayload {
  type: string
  properties: any
  clientID: string
  subject: string
  ttl: { access: number; refresh: number }
  nextToken: string
  timeUsed?: number
  family?: string
  authTime?: number
  amr?: string[]
  [key: string]: any
}

export const refreshKey = (subject: string, token: string) => [
  "oauth:refresh",
  subject,
  token,
]

const at = (ttl: number) => new Date(Date.now() + ttl * 1000)

export async function storeRefreshToken(
  storage: StorageAdapter,
  key: string[],
  value: RefreshTokenPayload,
  ttl: number,
) {
  await Storage.atomic(storage).set(key, value, at(ttl))
}

export async function loadRefreshToken(
  storage: StorageAdapter,
  key: string[],
): Promise<RefreshTokenPayload | undefined> {
  const atomic = Storage.atomic(storage)
  const value = await atomic.get(key)
  if (value || !Storage.isAtomic(storage)) return value ?? undefined
  const legacy = await Storage.get<RefreshTokenPayload>(storage, key)
  if (!legacy) return undefined
  // The plain store does not say when it expires; keep it for its refresh TTL
  await atomic.add(key, legacy, at(legacy.ttl?.refresh ?? 60 * 60 * 24 * 365))
  await Storage.remove(storage, key)
  return (await atomic.get(key)) ?? undefined
}

/** Mark a token used. True for exactly one caller. */
export function markRefreshTokenUsed(
  storage: StorageAdapter,
  key: string[],
  seen: RefreshTokenPayload,
  used: RefreshTokenPayload,
  ttl: number,
) {
  return Storage.atomic(storage).replace(key, seen, used, at(Math.max(ttl, 1)))
}

export async function removeRefreshToken(
  storage: StorageAdapter,
  key: string[],
) {
  await Storage.atomic(storage).remove(key)
  if (Storage.isAtomic(storage)) await Storage.remove(storage, key)
}

/** Delete every refresh token of a subject, in both stores. */
export async function removeAllRefreshTokens(
  storage: StorageAdapter,
  subject: string,
): Promise<number> {
  let n = 0
  if (Storage.isAtomic(storage))
    n +=
      (await Storage.atomic(storage).removePrefix?.([
        "oauth:refresh",
        subject,
      ])) ?? 0
  const keys = await Array.fromAsync(
    Storage.scan(storage, ["oauth:refresh", subject]),
  )
  for (const [key] of keys) await Storage.remove(storage, key)
  return n + keys.length
}

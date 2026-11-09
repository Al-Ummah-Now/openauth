/**
 * Single-use authorization codes (RFC 6749 §4.1.2, §10.5).
 *
 * Codes live in the storage adapter's atomic store (`StorageAdapter.atomic`)
 * when it has one, so every process sees the same state:
 *
 * - `redeemAuthorizationCode` reads the code (strongly consistent) so the
 *   request can be validated without using the code up.
 * - `consumeAuthorizationCode` is the one atomic step: it creates the
 *   used-code marker with `add`. Exactly one concurrent request creates it;
 *   every other one fails. The marker holds what the code is exchanged for
 *   (refresh-token family and access-token id) and is written before any
 *   token exists.
 * - A later request with the same code finds the marker, and the caller
 *   revokes that grant (RFC 6749 §4.1.2: "SHOULD revoke … all tokens
 *   previously issued based on that authorization code").
 *
 * Without an atomic store this degrades to the old read-then-write behaviour,
 * which is only single-use within one process.
 */
import { Storage, type StorageAdapter } from "./storage/storage.js"

export interface AuthorizationCodePayload {
  clientID: string
  redirectURI: string
  pkce?: { challenge: string; method: string }
  [key: string]: any
}

/** What a code was exchanged for, kept so a replay can revoke it. */
export interface CodeGrant {
  /** Refresh-token family started by this code. */
  family: string
  /** `jti` of the access token minted by the exchange, when known. */
  jti?: string
  subject: string
  clientID: string
}

export interface RedeemedCode {
  payload?: AuthorizationCodePayload
  /** The code was already used: what it was exchanged for. */
  replayed?: CodeGrant
  /** Found only in the plain store (written before the atomic store existed). */
  legacy?: boolean
}

/** How long a used code is remembered. Codes live 10 minutes at most. */
export const USED_CODE_TTL = 24 * 60 * 60

export const codeKey = (code: string) => ["oauth:code", code]
export const usedCodeKey = (code: string) => ["oauth:code_used", code]
export const refreshFamilyKey = (family: string) => [
  "oauth:refresh_family",
  family,
]

const expiry = (ttl: number) => new Date(Date.now() + ttl * 1000)

export async function storeAuthorizationCode(
  storage: StorageAdapter,
  code: string,
  payload: AuthorizationCodePayload,
  ttl: number,
) {
  await Storage.atomic(storage).set(codeKey(code), payload, expiry(ttl))
}

/** Read a code without using it up. */
export async function redeemAuthorizationCode(
  storage: StorageAdapter,
  code: string,
): Promise<RedeemedCode> {
  const atomic = Storage.atomic(storage)
  const payload = await atomic.get(codeKey(code))
  if (payload) return { payload }
  const used = await atomic.get(usedCodeKey(code))
  if (used) return { replayed: used }
  if (Storage.isAtomic(storage)) {
    // Issued by a version that kept codes in the plain store (lives <= 10 min)
    const legacy = await Storage.get<AuthorizationCodePayload>(
      storage,
      codeKey(code),
    )
    if (legacy) return { payload: legacy, legacy: true }
  }
  return {}
}

/**
 * Use the code up. True for exactly one caller; false when another request
 * already used it (the caller should then revoke that request's grant).
 */
export async function consumeAuthorizationCode(
  storage: StorageAdapter,
  code: string,
  redeemed: RedeemedCode,
  grant: CodeGrant,
): Promise<boolean> {
  const atomic = Storage.atomic(storage)
  if (!(await atomic.add(usedCodeKey(code), grant, expiry(USED_CODE_TTL))))
    return false
  if (redeemed.legacy) await Storage.remove(storage, codeKey(code))
  else await atomic.remove(codeKey(code))
  return true
}

/** Mark a refresh-token family revoked (checked on every refresh). */
export async function revokeRefreshFamily(
  storage: StorageAdapter,
  family: string,
  ttl: number,
) {
  await Storage.atomic(storage).set(
    refreshFamilyKey(family),
    { revokedAt: Date.now() },
    expiry(ttl),
  )
}

export async function isRefreshFamilyRevoked(
  storage: StorageAdapter,
  family: string | undefined,
): Promise<boolean> {
  if (!family) return false
  return !!(await Storage.atomic(storage).get(refreshFamilyKey(family)))
}

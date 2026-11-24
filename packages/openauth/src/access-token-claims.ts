/**
 * Extra top-level access-token claims an issuer adds (`accessTokenClaims`).
 *
 * They are computed for every access token, at sign-in and at each refresh, and stored nowhere: not on the
 * refresh token, not in the subject (whose hash is the subject id), not in `/userinfo`.
 */

/** Claims the issuer itself sets, or that have a standard meaning: a hook never sets these. */
const RESERVED = new Set([
  "iss",
  "sub",
  "aud",
  "exp",
  "nbf",
  "iat",
  "jti",
  "mode",
  "type",
  "properties",
  "auth_time",
  "amr",
  "acr",
  "azp",
  "sid",
  "scope",
  "scp",
  "client_id",
  "cnf",
  "act",
  "may_act",
  "nonce",
])

export interface AccessTokenClaimsInput {
  /** The subject's type, e.g. "user" (an M2M token has its client's type) */
  type: string
  properties: any
  subject: string
  clientID: string
}

export type AccessTokenClaims = (
  input: AccessTokenClaimsInput,
) => Promise<Record<string, string | number | boolean> | undefined>

/**
 * The hook's claims, without reserved names or values that aren't plain. A hook that throws adds none: an
 * optional claim never stops a sign-in. Its error text is not logged (it may quote what it read).
 */
export async function extraAccessTokenClaims(
  hook: AccessTokenClaims | undefined,
  input: AccessTokenClaimsInput,
): Promise<Record<string, string | number | boolean>> {
  if (!hook) return {}
  let claims: Awaited<ReturnType<AccessTokenClaims>>
  try {
    claims = await hook(input)
  } catch {
    console.error("accessTokenClaims failed; the token has no extra claims")
    return {}
  }
  return Object.fromEntries(
    Object.entries(claims ?? {}).filter(
      ([name, value]) =>
        !RESERVED.has(name) &&
        (typeof value === "string" ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))),
    ),
  )
}

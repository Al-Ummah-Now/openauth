/**
 * The session id (`sid`) carried by tokens issued from a browser sign-in.
 *
 * One value per (browser session, user): opaque (a hash, so the browser
 * session id never appears in a token) and computable by the application from
 * its own session rows, so it can revoke one device's sign-in without
 * touching the user's other devices (AlUmmahNow#442).
 *
 * @example
 * ```ts
 * const sid = await sessionTokenId(row.browser_session_id, row.user_id)
 * ```
 */
export async function sessionTokenId(
  browserSessionId: string,
  userId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`sid:v1:${browserSessionId}:${userId}`),
  )
  let binary = ""
  for (const byte of new Uint8Array(digest).slice(0, 16))
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * A native app's install id (sent as `install_id` on the code exchange):
 * 1-128 characters of letters, digits, `.`, `_` or `-`. Anything else is
 * ignored rather than stored.
 */
export function parseInstallId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : undefined
}

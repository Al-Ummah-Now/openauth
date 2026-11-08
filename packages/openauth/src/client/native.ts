/**
 * Native (installed) app clients: per-client PKCE policy and redirect URI
 * matching for custom schemes and loopback redirects (RFC 8252).
 *
 * - A client whose `metadata.type` is `"native"` or whose `metadata.pkce` is
 *   `"required"` must use PKCE (S256), whatever the issuer-wide policy.
 * - Redirect URIs match exactly (full string), except a loopback redirect
 *   (`http://127.0.0.1` or `http://[::1]`) may differ from the registered one
 *   in its port only (RFC 8252 §7.3: the app picks a free port at run time).
 * - A redirect URI registered for the client may use a private-use scheme
 *   (`com.example.app:/cb`, `alummahnow://auth/callback`, RFC 8252 §7.1).
 *   Dangerous schemes (`javascript:`, `data:`, `file:` …) are never accepted.
 */
import type { OAuthClient } from "./types.js"

export interface PkcePolicy {
  /** Require PKCE for clients registered without a secret. */
  requireForPublicClients?: boolean
}

type PkceClient = Pick<OAuthClient, "client_secret_hash"> & {
  metadata?: Record<string, unknown> | null
}

/** Whether `/authorize` must carry an S256 code_challenge for this client. */
export function clientRequiresPkce(
  client: PkceClient | null | undefined,
  policy?: PkcePolicy,
): boolean {
  if (!client) return false
  const meta = client.metadata ?? {}
  if (meta.type === "native" || meta.pkce === "required") return true
  return !!policy?.requireForPublicClients && !client.client_secret_hash
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"])
const BLOCKED_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
  "about:",
  "filesystem:",
  "view-source:",
])

function parse(uri: string): URL | null {
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

/** A loopback redirect (http://127.0.0.1 or http://[::1]). */
export function isLoopbackRedirect(uri: string): boolean {
  const url = parse(uri)
  return !!url && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
}

/** Schemes a registered redirect may use: https, loopback http, or a private-use scheme. */
export function isAllowedRedirectScheme(uri: string): boolean {
  const url = parse(uri)
  if (!url) return false
  if (url.protocol === "https:") return true
  if (url.protocol === "http:")
    return LOOPBACK_HOSTS.has(url.hostname) || url.hostname === "localhost"
  if (BLOCKED_SCHEMES.has(url.protocol)) return false
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
}

/** Exact match, or a loopback redirect that differs from a registered one only in its port. */
export function redirectUriMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true
  if (!isLoopbackRedirect(uri)) return false
  const asked = parse(uri)!
  return registered.some((r) => {
    if (!isLoopbackRedirect(r)) return false
    const reg = parse(r)!
    return (
      reg.hostname === asked.hostname &&
      reg.pathname === asked.pathname &&
      reg.search === asked.search &&
      reg.username === "" &&
      asked.username === "" &&
      asked.hash === "" &&
      reg.hash === ""
    )
  })
}

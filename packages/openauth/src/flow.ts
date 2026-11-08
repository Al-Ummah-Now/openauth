/**
 * Per-tab authorization flows.
 *
 * `/authorize` used to keep the pending authorization in a single `authorization`
 * cookie. Every tab and every client shares that cookie, so a second sign-in
 * overwrote the first (and the first tab could then complete with the second
 * client's redirect_uri), and the back button after a successful sign-in found
 * no state at all.
 *
 * A flow gives each `/authorize` call its own id, carried in the URL
 * (`?auth_flow=<id>`), that keys a storage record with the pending
 * authorization and the provider state. The record is bound to the browser: it
 * stores the SHA-256 of a random secret held in the `oa_flow_bind` cookie, so a
 * flow id copied into another browser is rejected.
 *
 * Storage record (versioned, TTL = the authorization TTL, 24h by default):
 *
 *   key   ["oauth:flow", <id>]
 *   value FlowRecord (v: 1)
 *
 * @packageDocumentation
 */

/** Query parameter that carries the flow id. */
export const FLOW_PARAM = "auth_flow"
/** Cookie holding the per-browser secret that flow records are bound to. */
export const FLOW_BIND_COOKIE = "oa_flow_bind"
/** Current FlowRecord schema version. */
export const FLOW_RECORD_VERSION = 1
/** How long a completed flow is remembered (to recognise a resubmitted form). */
export const FLOW_COMPLETED_TTL = 60 * 60

export interface FlowRecord<A = unknown> {
  v: typeof FLOW_RECORD_VERSION
  authorization: A
  /** SHA-256 (hex) of the browser's bind secret. */
  binding: string
  createdAt: number
  /** Absolute expiry (ms). Provider state writes keep it. */
  expiresAt: number
  /** Set once a code/token was issued for this flow. */
  completedAt?: number
  /** Provider state (what providers store with ctx.set), keyed by name. */
  provider?: Record<string, unknown>
}

export function flowKey(id: string) {
  return ["oauth:flow", id]
}

function base64url(bytes: Uint8Array) {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** 128-bit random flow id (22 base64url chars). */
export function newFlowId() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)))
}

/** 256-bit random bind secret (43 base64url chars). */
export function newBindSecret() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export function isFlowId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22}$/.test(value)
}

export function isBindSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
}

export async function bindingHash(secret: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Query parameters that must survive every link/redirect inside a flow. */
const CARRIED_PARAMS = [FLOW_PARAM, "lang"]

/**
 * Copy the flow id (and UI locale) from `from` onto `target`. `target` may be
 * relative; it is resolved against `from`. Returns a path + query when `target`
 * was relative, or the full URL when it was absolute.
 */
export function withFlowParams(target: string, from: string | URL): string {
  const source = new URL(from.toString())
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(target)
  const url = new URL(target, source)
  for (const name of CARRIED_PARAMS) {
    const value = source.searchParams.get(name)
    if (value && !url.searchParams.has(name)) url.searchParams.set(name, value)
  }
  if (absolute) return url.toString()
  // Keep relative targets relative to preserve the original path semantics.
  const qs = url.searchParams.toString()
  const path = target.split("?")[0].split("#")[0]
  return qs ? `${path}?${qs}` : path
}

/**
 * The page to restart a flow from: the client's home page (origin of its
 * redirect_uri). The redirect_uri was validated by `allow` at `/authorize`.
 */
export function restartUrlFor(redirectURI?: string): string | undefined {
  if (!redirectURI) return undefined
  try {
    const url = new URL(redirectURI)
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    return `${url.origin}/`
  } catch {
    return undefined
  }
}

/** The `locale` or `lang` query param of a redirect_uri, if any. */
export function localeHintFor(redirectURI?: string): string | undefined {
  if (!redirectURI) return undefined
  try {
    const url = new URL(redirectURI)
    return (
      url.searchParams.get("locale") ||
      url.searchParams.get("lang") ||
      undefined
    )
  } catch {
    return undefined
  }
}

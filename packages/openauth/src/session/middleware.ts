/**
 * Session middleware for Hono applications.
 *
 * Extracts session cookies, decrypts them, loads session data,
 * and attaches it to the request context.
 *
 * @packageDocumentation
 */

import type { MiddlewareHandler, Context, Next } from "hono"
import type {
  SessionService,
  SessionConfig,
  BrowserSession,
  AccountSession,
} from "../contracts/types.js"
import { DEFAULT_SESSION_CONFIG } from "../contracts/types.js"
import {
  decryptSessionCookie,
  parseCookie,
  encryptSessionCookie,
  createCookieOptions,
  createCookiePayload,
} from "./cookie.js"

/**
 * Context variables set by the session middleware
 */
export interface SessionMiddlewareVariables {
  browserSession: BrowserSession | null
  activeAccount: AccountSession | null
}

/**
 * Options for the session middleware
 */
export interface SessionMiddlewareOptions {
  /**
   * Cookie name to use for session (default: "__session")
   */
  cookieName?: string

  /**
   * Cookie domain (optional)
   */
  cookieDomain?: string

  /**
   * Whether to automatically refresh the cookie on each request
   * (default: true)
   */
  autoRefresh?: boolean
}

/**
 * Create session middleware for Hono.
 *
 * This middleware:
 * 1. Extracts the session cookie from the request
 * 2. Decrypts the cookie payload using JWE
 * 3. Loads the browser session from storage
 * 4. Loads the active account session if exists
 * 5. Attaches session data to the Hono context
 * 6. Updates last_activity if sliding window threshold exceeded
 *
 * @param service - The session service instance
 * @param secret - 256-bit secret key for cookie encryption
 * @param options - Optional middleware configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from "hono"
 * import { createSessionMiddleware } from "./session/middleware.js"
 * import { SessionServiceImpl } from "./session/service.js"
 * import { hexToSecret } from "./session/cookie.js"
 *
 * const sessionService = new SessionServiceImpl(storage)
 * const secret = hexToSecret(process.env.SESSION_SECRET!)
 *
 * const app = new Hono()
 * app.use("*", createSessionMiddleware(sessionService, secret))
 *
 * app.get("/", (c) => {
 *   const browserSession = c.get("browserSession")
 *   const activeAccount = c.get("activeAccount")
 *
 *   if (browserSession) {
 *     return c.json({ loggedIn: true, userId: activeAccount?.user_id })
 *   }
 *   return c.json({ loggedIn: false })
 * })
 * ```
 */
export function createSessionMiddleware(
  service: SessionService,
  secret: Uint8Array,
  options: SessionMiddlewareOptions = {},
): MiddlewareHandler<{ Variables: SessionMiddlewareVariables }> {
  const cookieName = options.cookieName ?? DEFAULT_SESSION_CONFIG.cookieName
  const autoRefresh = options.autoRefresh ?? true

  return async (
    c: Context<{ Variables: SessionMiddlewareVariables }>,
    next: Next,
  ): Promise<Response | void> => {
    // Initialize context with null values
    c.set("browserSession", null)
    c.set("activeAccount", null)

    // Extract cookie from request
    const cookieHeader = c.req.header("Cookie")
    const cookieValue = parseCookie(cookieHeader, cookieName)

    if (!cookieValue) {
      return next()
    }

    // Decrypt cookie payload
    const payload = await decryptSessionCookie(cookieValue, secret)
    if (!payload) {
      // Invalid cookie, clear it by setting empty value
      // But don't block the request
      return next()
    }

    // Load browser session from storage
    const browserSession = await service.getBrowserSession(
      payload.sid,
      payload.tid,
    )
    if (!browserSession) {
      // Session not found or expired
      return next()
    }

    // Set browser session in context
    c.set("browserSession", browserSession)

    // Load active account if exists
    if (browserSession.active_user_id) {
      const activeAccount = await service.getAccountSession(
        browserSession.id,
        browserSession.active_user_id,
      )
      if (activeAccount) {
        c.set("activeAccount", activeAccount)
      }
    }

    // Auto-refresh cookie if enabled and version changed
    if (autoRefresh && browserSession.version !== payload.v) {
      const newPayload = createCookiePayload({
        sessionId: browserSession.id,
        tenantId: browserSession.tenant_id,
        version: browserSession.version,
      })

      const newCookie = await encryptSessionCookie(newPayload, secret)
      const cookieOptions = createCookieOptions(options.cookieDomain)

      // Build cookie string
      let cookieString = `${cookieName}=${newCookie}; Path=${cookieOptions.path}; Max-Age=${cookieOptions.maxAge}`
      if (cookieOptions.httpOnly) cookieString += "; HttpOnly"
      if (cookieOptions.secure) cookieString += "; Secure"
      cookieString += `; SameSite=${cookieOptions.sameSite.charAt(0).toUpperCase() + cookieOptions.sameSite.slice(1)}`
      if (cookieOptions.domain)
        cookieString += `; Domain=${cookieOptions.domain}`

      c.header("Set-Cookie", cookieString)
    }

    return next()
  }
}

/**
 * Helper to get browser session from context with type safety.
 *
 * @param c - Hono context
 * @returns Browser session or null
 */
export function getBrowserSession(
  c: Context<{ Variables: SessionMiddlewareVariables }>,
): BrowserSession | null {
  return c.get("browserSession")
}

/**
 * Helper to get active account from context with type safety.
 *
 * @param c - Hono context
 * @returns Active account session or null
 */
export function getActiveAccount(
  c: Context<{ Variables: SessionMiddlewareVariables }>,
): AccountSession | null {
  return c.get("activeAccount")
}

/**
 * Helper to require an authenticated session.
 * Returns 401 if no session is found.
 *
 * @param c - Hono context
 * @returns Browser session and active account, or Response if unauthorized
 */
export function requireSession(
  c: Context<{ Variables: SessionMiddlewareVariables }>,
):
  | { browserSession: BrowserSession; activeAccount: AccountSession | null }
  | Response {
  const browserSession = c.get("browserSession")

  if (!browserSession) {
    return c.json(
      {
        error: "unauthorized",
        message: "Session required",
      },
      401,
    )
  }

  return {
    browserSession,
    activeAccount: c.get("activeAccount"),
  }
}

/**
 * Helper to require an authenticated session with an active account.
 * Returns 401 if no session or no active account.
 *
 * @param c - Hono context
 * @returns Browser session and active account, or Response if unauthorized
 */
export function requireActiveAccount(
  c: Context<{ Variables: SessionMiddlewareVariables }>,
):
  | { browserSession: BrowserSession; activeAccount: AccountSession }
  | Response {
  const browserSession = c.get("browserSession")
  const activeAccount = c.get("activeAccount")

  if (!browserSession) {
    return c.json(
      {
        error: "unauthorized",
        message: "Session required",
      },
      401,
    )
  }

  if (!activeAccount) {
    return c.json(
      {
        error: "unauthorized",
        message: "Active account required",
      },
      401,
    )
  }

  return { browserSession, activeAccount }
}

/**
 * Middleware guard that requires a session.
 * Use this to protect routes that require authentication.
 *
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use("/protected/*", requireSessionMiddleware())
 * ```
 */
export function requireSessionMiddleware(): MiddlewareHandler<{
  Variables: SessionMiddlewareVariables
}> {
  return async (
    c: Context<{ Variables: SessionMiddlewareVariables }>,
    next: Next,
  ): Promise<Response | void> => {
    const browserSession = c.get("browserSession")

    if (!browserSession) {
      return c.json(
        {
          error: "unauthorized",
          message: "Session required",
        },
        401,
      )
    }

    return next()
  }
}

/**
 * Middleware guard that requires an active account.
 * Use this to protect routes that require an active logged-in account.
 *
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use("/api/*", requireActiveAccountMiddleware())
 * ```
 */
export function requireActiveAccountMiddleware(): MiddlewareHandler<{
  Variables: SessionMiddlewareVariables
}> {
  return async (
    c: Context<{ Variables: SessionMiddlewareVariables }>,
    next: Next,
  ): Promise<Response | void> => {
    const browserSession = c.get("browserSession")
    const activeAccount = c.get("activeAccount")

    if (!browserSession) {
      return c.json(
        {
          error: "unauthorized",
          message: "Session required",
        },
        401,
      )
    }

    if (!activeAccount) {
      return c.json(
        {
          error: "unauthorized",
          message: "Active account required",
        },
        401,
      )
    }

    return next()
  }
}

/**
 * Create a session cookie for a newly created or authenticated session.
 *
 * @param session - The browser session
 * @param secret - 256-bit secret key for cookie encryption
 * @param cookieName - Cookie name (default: "__session")
 * @param domain - Optional cookie domain
 * @returns Cookie header string
 *
 * @example
 * ```typescript
 * const session = await sessionService.createBrowserSession({
 *   tenantId: "tenant-1",
 *   userAgent: "Mozilla/5.0...",
 *   ipAddress: "192.168.1.1"
 * })
 *
 * const cookieHeader = await createSessionCookieHeader(session, secret)
 * c.header("Set-Cookie", cookieHeader)
 * ```
 */
export async function createSessionCookieHeader(
  session: BrowserSession,
  secret: Uint8Array,
  cookieName: string = DEFAULT_SESSION_CONFIG.cookieName,
  domain?: string,
): Promise<string> {
  const payload = createCookiePayload({
    sessionId: session.id,
    tenantId: session.tenant_id,
    version: session.version,
  })

  const encryptedCookie = await encryptSessionCookie(payload, secret)
  const cookieOptions = createCookieOptions(domain)

  let cookieString = `${cookieName}=${encryptedCookie}; Path=${cookieOptions.path}; Max-Age=${cookieOptions.maxAge}`
  if (cookieOptions.httpOnly) cookieString += "; HttpOnly"
  if (cookieOptions.secure) cookieString += "; Secure"
  cookieString += `; SameSite=${cookieOptions.sameSite.charAt(0).toUpperCase() + cookieOptions.sameSite.slice(1)}`
  if (cookieOptions.domain) cookieString += `; Domain=${cookieOptions.domain}`

  return cookieString
}

/**
 * Create a cookie header to clear the session cookie.
 *
 * @param cookieName - Cookie name (default: "__session")
 * @param domain - Optional cookie domain
 * @returns Cookie header string to clear the cookie
 *
 * @example
 * ```typescript
 * const clearCookieHeader = clearSessionCookieHeader()
 * c.header("Set-Cookie", clearCookieHeader)
 * ```
 */
export function clearSessionCookieHeader(
  cookieName: string = DEFAULT_SESSION_CONFIG.cookieName,
  domain?: string,
): string {
  let cookieString = `${cookieName}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  cookieString += "; HttpOnly; Secure; SameSite=Lax"
  if (domain) cookieString += `; Domain=${domain}`

  return cookieString
}

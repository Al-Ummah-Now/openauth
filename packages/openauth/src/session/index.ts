/**
 * Multi-account session management for OpenAuth enterprise SSO.
 *
 * This module provides a complete session management solution that allows
 * users to be logged into multiple accounts simultaneously (up to 3 by default).
 *
 * Features:
 * - Browser session management with encrypted cookies
 * - Multiple account sessions per browser (max 3)
 * - Active account switching
 * - Sliding window session expiration
 * - Admin session revocation
 * - Hono middleware and routes
 *
 * @example
 * ```typescript
 * import { Hono } from "hono"
 * import {
 *   SessionServiceImpl,
 *   createSessionMiddleware,
 *   sessionRoutes,
 *   adminSessionRoutes,
 *   hexToSecret,
 * } from "@openauthjs/openauth/session"
 *
 * // Create session service
 * const sessionService = new SessionServiceImpl(storage, {
 *   maxAccountsPerSession: 3,
 *   sessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days
 *   slidingWindowSeconds: 24 * 60 * 60, // 1 day
 * })
 *
 * // Create Hono app with session support
 * const app = new Hono()
 * const secret = hexToSecret(process.env.SESSION_SECRET!)
 *
 * // Add session middleware
 * app.use("*", createSessionMiddleware(sessionService, secret))
 *
 * // Add session routes
 * app.route("/session", sessionRoutes(sessionService))
 * app.route("/admin/sessions", adminSessionRoutes(sessionService))
 * ```
 *
 * @packageDocumentation
 */

// Types (re-exported from contracts + internal types)
export type {
  BrowserSession,
  AccountSession,
  SessionCookiePayload,
  SessionConfig,
  SessionService,
  SessionContext,
  SessionErrorCode,
} from "../contracts/types.js"

export {
  SessionError,
  DEFAULT_SESSION_CONFIG,
} from "../contracts/types.js"

export type {
  CreateCookieParams,
  SessionCookieOptions,
  SessionStorageKeyType,
  SessionContextVariables,
  RevokeUserSessionsRequest,
  RevokeSessionRequest,
  SwitchAccountRequest,
  SessionCheckResponse,
  AccountsListResponse,
} from "./types.js"

// Service implementation
export { SessionServiceImpl } from "./service.js"

// Cookie utilities
export {
  encryptSessionCookie,
  decryptSessionCookie,
  createCookieOptions,
  createCookiePayload,
  parseCookie,
  generateCookieSecret,
  hexToSecret,
  base64ToSecret,
  secretToHex,
} from "./cookie.js"

// Routes
export { sessionRoutes, adminSessionRoutes } from "./routes.js"

// Middleware
export type {
  SessionMiddlewareVariables,
  SessionMiddlewareOptions,
} from "./middleware.js"

export {
  createSessionMiddleware,
  getBrowserSession,
  getActiveAccount,
  requireSession,
  requireActiveAccount,
  requireSessionMiddleware,
  requireActiveAccountMiddleware,
  createSessionCookieHeader,
  clearSessionCookieHeader,
} from "./middleware.js"

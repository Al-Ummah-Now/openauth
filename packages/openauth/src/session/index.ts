/**
 * Multi-account session management for OpenAuth enterprise SSO.
 *
 * This module provides a complete session management solution that allows
 * users to be logged into multiple accounts simultaneously (up to 3 by default),
 * similar to Google's multi-account feature.
 *
 * ## Features
 *
 * - **Browser Session Management**: Encrypted JWE cookies for secure session storage
 * - **Multiple Account Sessions**: Support for up to 3 logged-in accounts per browser
 * - **Active Account Switching**: Seamlessly switch between logged-in accounts
 * - **Sliding Window Expiration**: Sessions automatically extend with activity
 * - **Admin Session Revocation**: Force logout users from all devices
 * - **Hono Integration**: Ready-to-use middleware and API routes
 *
 * ## Quick Start
 *
 * ```ts title="session-setup.ts"
 * import { Hono } from "hono"
 * import {
 *   SessionServiceImpl,
 *   createSessionMiddleware,
 *   sessionRoutes,
 *   adminSessionRoutes,
 *   hexToSecret,
 * } from "@openauthjs/openauth/session"
 *
 * // Create session service with configuration
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
 * // Add session middleware to all routes
 * app.use("*", createSessionMiddleware(sessionService, secret))
 *
 * // Mount session management routes
 * app.route("/session", sessionRoutes(sessionService))
 * app.route("/admin/sessions", adminSessionRoutes(sessionService))
 * ```
 *
 * ## Session Storage Keys
 *
 * Sessions are stored using a hierarchical key structure:
 * - Browser session: `["session", "browser", tenantId, sessionId]`
 * - Account session: `["session", "account", browserSessionId, userId]`
 * - User index: `["session", "user", tenantId, userId, browserSessionId]`
 *
 * ## API Endpoints
 *
 * When mounted, the session routes provide:
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/session/accounts` | GET | List all logged-in accounts |
 * | `/session/switch` | POST | Switch active account |
 * | `/session/accounts/:userId` | DELETE | Sign out one account |
 * | `/session/all` | DELETE | Sign out all accounts |
 * | `/session/check` | GET | Silent session check (CORS enabled) |
 *
 * Admin endpoints (require authentication):
 *
 * | Endpoint | Method | Description |
 * |----------|--------|-------------|
 * | `/admin/sessions/revoke-user` | POST | Revoke all sessions for a user |
 * | `/admin/sessions/revoke` | POST | Revoke a specific session |
 *
 * ## Security
 *
 * - Session cookies are encrypted using JWE (JSON Web Encryption)
 * - 256-bit cryptographically random session IDs
 * - Optimistic concurrency control via session versioning
 * - HttpOnly, Secure, SameSite cookie attributes
 *
 * @see {@link SessionServiceImpl} - Main session service implementation
 * @see {@link createSessionMiddleware} - Hono middleware for session loading
 * @see {@link sessionRoutes} - User-facing session API routes
 * @see {@link adminSessionRoutes} - Admin session management routes
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

export { SessionError, DEFAULT_SESSION_CONFIG } from "../contracts/types.js"

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

// D1 Adapter for dual-write and admin queries
export {
  D1SessionAdapter,
  BROWSER_SESSION_COLUMNS,
  ACCOUNT_SESSION_COLUMNS,
  type D1Database,
  type D1PreparedStatement,
  type D1Result,
  type D1ExecResult,
  type D1SessionAdapterConfig,
} from "./d1-adapter.js"

// Admin Session Service for administrative operations
export {
  AdminSessionService,
  type AdminSessionServiceConfig,
  type UserSessionInfo,
  type RevokeResult,
  type SessionStats,
} from "./admin-service.js"

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

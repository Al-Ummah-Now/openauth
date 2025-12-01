/**
 * Session types for multi-account session management.
 *
 * Re-exports contract types and defines internal types.
 *
 * @packageDocumentation
 */

// Re-export all session-related types from contracts
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

// Internal types for session management

/**
 * Parameters for creating a session cookie
 */
export interface CreateCookieParams {
  sessionId: string
  tenantId: string
  version: number
}

/**
 * Cookie options for session management
 */
export interface SessionCookieOptions {
  httpOnly: boolean
  secure: boolean
  sameSite: "lax" | "strict" | "none"
  maxAge: number
  path: string
  domain?: string
}

/**
 * Session storage key types for consistent key generation
 */
export type SessionStorageKeyType =
  | "browser" // Browser session storage
  | "account" // Account session storage
  | "user" // User index for session lookup

/**
 * Context variables set by session middleware
 */
export interface SessionContextVariables {
  browserSession: import("../contracts/types.js").BrowserSession | null
  activeAccount: import("../contracts/types.js").AccountSession | null
}

/**
 * Admin revoke user sessions request body
 */
export interface RevokeUserSessionsRequest {
  tenantId: string
  userId: string
}

/**
 * Admin revoke specific session request body
 */
export interface RevokeSessionRequest {
  sessionId: string
  tenantId: string
}

/**
 * Switch account request body
 */
export interface SwitchAccountRequest {
  userId: string
}

/**
 * Response for session check endpoint
 */
export interface SessionCheckResponse {
  active: boolean
  sessionId?: string
  tenantId?: string
  activeUserId?: string
  accountCount?: number
}

/**
 * Response for accounts list endpoint
 */
export interface AccountsListResponse {
  accounts: Array<{
    userId: string
    isActive: boolean
    authenticatedAt: number
    subjectType: string
    clientId: string
  }>
}

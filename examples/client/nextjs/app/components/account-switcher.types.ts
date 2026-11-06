/**
 * Shared TypeScript types for the AccountSwitcher component
 * and OpenAuth session management APIs.
 *
 * These types match the response structures from:
 * - /packages/openauth/src/session/types.ts
 * - /packages/openauth/src/session/routes.ts
 * - /packages/openauth/src/ui/theme.ts
 *
 * @packageDocumentation
 */

// ============================================
// THEME TYPES (matching OpenAuth theme system)
// ============================================

/**
 * Color scheme for light/dark mode support
 */
export interface ColorScheme {
  light: string
  dark: string
}

/**
 * Theme configuration matching OpenAuth's theme system.
 *
 * @see /packages/openauth/src/ui/theme.ts
 */
export interface Theme {
  /** App title */
  title?: string
  /** Favicon URL */
  favicon?: string
  /** Border radius: none, sm, md, lg, full */
  radius?: "none" | "sm" | "md" | "lg" | "full"
  /** Primary color (string or light/dark) */
  primary: string | ColorScheme
  /** Background color (string or light/dark) */
  background?: string | ColorScheme
  /** Logo URL (string or light/dark) */
  logo?: string | ColorScheme
  /** Font settings */
  font?: {
    family?: string
    scale?: string
  }
  /** Custom CSS */
  css?: string
}

/**
 * Default theme matching THEME_OPENAUTH
 */
export const DEFAULT_THEME: Theme = {
  title: "OpenAuth",
  radius: "md",
  primary: {
    light: "#3b82f6",
    dark: "#60a5fa",
  },
  background: {
    light: "#ffffff",
    dark: "#111827",
  },
  font: {
    family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
}

/**
 * Account information returned from the session API
 *
 * Represents a single logged-in account within a browser session.
 */
export interface Account {
  /**
   * Unique identifier for the user
   */
  userId: string

  /**
   * Whether this is the currently active account
   */
  isActive: boolean

  /**
   * Unix timestamp (milliseconds) when the user was authenticated
   */
  authenticatedAt: number

  /**
   * Type of subject (typically "user" for regular users)
   */
  subjectType: string

  /**
   * OAuth client ID that authenticated this user
   */
  clientId: string
}

/**
 * Response from GET /session/accounts
 *
 * Lists all accounts in the current browser session.
 */
export interface AccountsListResponse {
  /**
   * Array of all logged-in accounts
   */
  accounts: Account[]
}

/**
 * Request body for POST /session/switch
 *
 * Used to switch the active account in a browser session.
 */
export interface SwitchAccountRequest {
  /**
   * User ID of the account to switch to
   */
  userId: string
}

/**
 * Response from GET /session/check
 *
 * Used for silent authentication checks.
 */
export interface SessionCheckResponse {
  /**
   * Whether there is an active session
   */
  active: boolean

  /**
   * Browser session ID (only present if active)
   */
  sessionId?: string

  /**
   * Tenant ID (only present if active)
   */
  tenantId?: string

  /**
   * Currently active user ID (only present if active)
   */
  activeUserId?: string

  /**
   * Number of accounts in the session (only present if active)
   */
  accountCount?: number
}

/**
 * Generic success response from session operations
 *
 * Used by switch, remove, and sign-out operations.
 */
export interface SuccessResponse {
  /**
   * Whether the operation was successful
   */
  success: boolean
}

/**
 * Error response structure from session APIs
 *
 * Returned when operations fail.
 */
export interface ErrorResponse {
  /**
   * Machine-readable error code
   *
   * Common codes:
   * - "session_not_found" - No active session
   * - "account_not_found" - Account doesn't exist in session
   * - "invalid_request" - Malformed request
   */
  error: string

  /**
   * Human-readable error message
   */
  message: string
}

/**
 * Component state type for loading operations
 *
 * Used to track the current operation in progress.
 */
export type LoadingState =
  "idle" | "loading" | "switching" | "removing" | "adding"

/**
 * Props for the AccountSwitcher component
 */
export interface AccountSwitcherProps {
  /**
   * Base URL for session API endpoints
   *
   * @default "/api"
   * @example "/api" - All endpoints will be prefixed with this
   */
  apiBaseUrl?: string

  /**
   * OAuth authorization URL for adding new accounts
   *
   * @default "/authorize"
   * @example "/authorize" - Will redirect here with prompt=login
   */
  authorizeUrl?: string

  /**
   * Theme configuration for styling the component.
   *
   * Supports the same theme format as OpenAuth's server-side components.
   * If not provided, uses DEFAULT_THEME.
   *
   * @example
   * ```tsx
   * theme={{
   *   primary: "#ff5e00",
   *   background: { light: "#fff", dark: "#000" },
   *   radius: "lg",
   *   font: { family: "Inter, sans-serif" }
   * }}
   * ```
   */
  theme?: Theme

  /**
   * Callback fired when an account is successfully switched
   *
   * @param userId - The user ID of the newly active account
   *
   * @example
   * ```tsx
   * onAccountSwitch={(userId) => {
   *   console.log("Switched to:", userId)
   *   // Update app state, refresh data, etc.
   * }}
   * ```
   */
  onAccountSwitch?: (userId: string) => void

  /**
   * Callback fired when the user signs out (all accounts)
   *
   * @example
   * ```tsx
   * onSignOut={() => {
   *   console.log("Signed out")
   *   // Clear local state, redirect to login, etc.
   * }}
   * ```
   */
  onSignOut?: () => void
}

/**
 * Internal state for the AccountSwitcher component
 */
export interface AccountSwitcherState {
  /**
   * List of accounts fetched from the API
   */
  accounts: Account[]

  /**
   * Current loading/operation state
   */
  loading: LoadingState

  /**
   * Error message if any operation failed
   */
  error: string | null
}

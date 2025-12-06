/**
 * Session Integration for Enterprise Issuer
 *
 * Provides helper functions to integrate multi-account sessions with
 * the OAuth/OIDC authorization flow.
 *
 * Key features:
 * - Add authenticated accounts to browser sessions
 * - Handle OIDC prompt parameter (none, login, select_account, consent)
 * - Handle max_age parameter for forced re-authentication
 * - Handle account_hint for pre-selecting accounts
 *
 * @packageDocumentation
 */

import type { Context } from "hono"
import type {
  SessionService,
  BrowserSession,
  AccountSession,
  PromptType,
} from "../contracts/types.js"
import type {
  AddAccountParams,
  PromptHandlerResult,
  OIDCErrorResponse,
  EnterpriseAuthorizationState,
  AccountPickerAccount,
} from "./types.js"
import { OauthError } from "../error.js"

// ============================================
// ADD ACCOUNT TO SESSION
// ============================================

/**
 * Add an authenticated account to a browser session.
 *
 * This is called after successful authentication to:
 * 1. Add the user to the browser session (or update if exists)
 * 2. Make it the active account
 * 3. Store the refresh token for future use
 *
 * @param ctx - Hono context (for logging/metrics)
 * @param sessionService - The session service
 * @param params - Account parameters
 * @returns The created/updated account session
 *
 * @example
 * ```typescript
 * const accountSession = await addAccountToSession(ctx, sessionService, {
 *   browserSession: ctx.get("browserSession"),
 *   userId: "user-123",
 *   subjectType: "user",
 *   subjectProperties: { email: "user@example.com" },
 *   refreshToken: tokens.refresh,
 *   clientId: "my-app",
 *   ttl: 7 * 24 * 60 * 60, // 7 days
 * })
 * ```
 */
export async function addAccountToSession(
  ctx: Context,
  sessionService: SessionService,
  params: AddAccountParams,
): Promise<AccountSession> {
  const { browserSession, ...accountParams } = params

  const accountSession = await sessionService.addAccountToSession({
    browserSessionId: browserSession.id,
    userId: accountParams.userId,
    subjectType: accountParams.subjectType,
    subjectProperties: accountParams.subjectProperties,
    refreshToken: accountParams.refreshToken,
    clientId: accountParams.clientId,
    ttl: accountParams.ttl,
  })

  return accountSession
}

// ============================================
// PROMPT PARAMETER HANDLING
// ============================================

/**
 * Handle the OIDC prompt parameter.
 *
 * The prompt parameter specifies whether the authorization server should
 * prompt the user for re-authentication and/or consent.
 *
 * Values:
 * - `none`: Silent auth - return error if user is not already authenticated
 * - `login`: Force re-authentication even if user has an active session
 * - `select_account`: Show account picker if multiple accounts
 * - `consent`: Force consent screen (not implemented here)
 *
 * @param ctx - Hono context
 * @param prompt - The prompt parameter value
 * @param sessionService - Session service for account lookup
 * @param browserSession - Current browser session (may be null)
 * @param authorization - Authorization request parameters
 * @returns Handler result indicating how to proceed
 *
 * @example
 * ```typescript
 * const result = await handlePromptParameter(
 *   ctx,
 *   "none",
 *   sessionService,
 *   browserSession,
 *   authorization,
 * )
 *
 * if (!result.proceed) {
 *   return result.response
 * }
 *
 * if (result.forceReauth) {
 *   // Skip session and force re-authentication
 * }
 * ```
 */
export async function handlePromptParameter(
  ctx: Context,
  prompt: PromptType | undefined,
  sessionService: SessionService,
  browserSession: BrowserSession | null,
  authorization: EnterpriseAuthorizationState,
  activeAccount: AccountSession | null = null,
): Promise<PromptHandlerResult> {
  // No prompt specified - proceed normally
  if (!prompt) {
    return { proceed: true }
  }

  switch (prompt) {
    case "none":
      return handlePromptNone(ctx, browserSession, authorization, activeAccount)

    case "login":
      return handlePromptLogin()

    case "select_account":
      return handlePromptSelectAccount(
        ctx,
        sessionService,
        browserSession,
        authorization,
      )

    case "consent":
      // Consent is typically handled later in the flow
      return { proceed: true }

    default:
      // Unknown prompt value - proceed normally
      return { proceed: true }
  }
}

/**
 * Handle prompt=none (silent authentication).
 *
 * If the user is not authenticated, return an error response.
 * If authenticated, return silentAuth with the active account to issue code directly.
 * This is used for silent token renewal in SPAs.
 */
async function handlePromptNone(
  ctx: Context,
  browserSession: BrowserSession | null,
  authorization: EnterpriseAuthorizationState,
  activeAccount: AccountSession | null,
): Promise<PromptHandlerResult> {
  // Check if user has an active session
  if (!browserSession || !browserSession.active_user_id || !activeAccount) {
    // No session - return login_required error
    const errorResponse = createOIDCErrorRedirect(authorization.redirect_uri, {
      error: "login_required",
      error_description:
        "User is not authenticated. Interactive login is required.",
      state: authorization.state,
    })

    return {
      proceed: false,
      response: ctx.redirect(errorResponse),
    }
  }

  // Check if session is expired
  if (Date.now() > activeAccount.expires_at) {
    const errorResponse = createOIDCErrorRedirect(authorization.redirect_uri, {
      error: "login_required",
      error_description: "Session has expired. Interactive login is required.",
      state: authorization.state,
    })

    return {
      proceed: false,
      response: ctx.redirect(errorResponse),
    }
  }

  // User is authenticated - return silentAuth to issue code directly
  return {
    proceed: true,
    silentAuth: activeAccount,
  }
}

/**
 * Handle prompt=login (force re-authentication).
 *
 * Always skip the existing session and force the user to re-authenticate.
 */
function handlePromptLogin(): PromptHandlerResult {
  return {
    proceed: true,
    forceReauth: true,
  }
}

/**
 * Handle prompt=select_account (show account picker).
 *
 * If the user has multiple accounts, return a response that triggers
 * the account picker UI. If only one account, proceed normally.
 */
async function handlePromptSelectAccount(
  ctx: Context,
  sessionService: SessionService,
  browserSession: BrowserSession | null,
  authorization: EnterpriseAuthorizationState,
): Promise<PromptHandlerResult> {
  // No session - proceed to login
  if (!browserSession) {
    return { proceed: true }
  }

  // Get all accounts in the session
  const accounts = await sessionService.listAccounts(browserSession.id)

  // No accounts or single account - proceed normally
  if (accounts.length <= 1) {
    return { proceed: true }
  }

  // Multiple accounts - return account picker response
  // The account picker UI will be rendered by the issuer
  const pickerAccounts: AccountPickerAccount[] = accounts.map((account) => ({
    userId: account.user_id,
    displayName: (account.subject_properties as any)?.name || undefined,
    email: (account.subject_properties as any)?.email || undefined,
    avatarUrl: (account.subject_properties as any)?.avatar || undefined,
    subjectType: account.subject_type,
    isActive: account.is_active,
    authenticatedAt: account.authenticated_at,
  }))

  // Store accounts in context for the account picker UI
  ctx.set("accountPickerAccounts", pickerAccounts)
  ctx.set("showAccountPicker", true)

  return {
    proceed: false,
    // Response will be handled by the issuer to show account picker
    response: undefined,
  }
}

// ============================================
// MAX_AGE HANDLING
// ============================================

/**
 * Handle the max_age parameter for session freshness.
 *
 * If the user's authentication is older than max_age seconds,
 * force re-authentication.
 *
 * @param ctx - Hono context
 * @param maxAge - Maximum authentication age in seconds
 * @param accountSession - The active account session
 * @returns Handler result
 *
 * @example
 * ```typescript
 * if (authorization.max_age !== undefined) {
 *   const result = handleMaxAge(ctx, authorization.max_age, activeAccount)
 *   if (result.forceReauth) {
 *     // Skip session and force re-authentication
 *   }
 * }
 * ```
 */
export function handleMaxAge(
  ctx: Context,
  maxAge: number | undefined,
  accountSession: AccountSession | null,
): PromptHandlerResult {
  // No max_age or no session - proceed normally
  if (maxAge === undefined || maxAge < 0 || !accountSession) {
    return { proceed: true }
  }

  // Check if authentication is fresh enough
  const now = Date.now()
  const authAge = (now - accountSession.authenticated_at) / 1000

  if (authAge > maxAge) {
    // Authentication is too old - force re-authentication
    return {
      proceed: true,
      forceReauth: true,
    }
  }

  // Authentication is fresh - proceed normally
  return { proceed: true }
}

// ============================================
// ACCOUNT HINT HANDLING
// ============================================

/**
 * Handle the account_hint parameter.
 *
 * If specified, try to select the hinted account from the session.
 * This is useful when a client knows which account the user wants to use.
 *
 * @param ctx - Hono context
 * @param accountHint - The user ID to select
 * @param sessionService - Session service
 * @param browserSession - Current browser session
 * @returns Handler result with selected account if found
 *
 * @example
 * ```typescript
 * if (authorization.account_hint) {
 *   const result = await handleAccountHint(
 *     ctx,
 *     authorization.account_hint,
 *     sessionService,
 *     browserSession,
 *   )
 *   if (result.selectedAccount) {
 *     // Use the selected account
 *   }
 * }
 * ```
 */
export async function handleAccountHint(
  ctx: Context,
  accountHint: string | undefined,
  sessionService: SessionService,
  browserSession: BrowserSession | null,
): Promise<PromptHandlerResult> {
  // No hint or no session - proceed normally
  if (!accountHint || !browserSession) {
    return { proceed: true }
  }

  // Try to find the hinted account
  const account = await sessionService.getAccountSession(
    browserSession.id,
    accountHint,
  )

  if (account) {
    // Found the account - switch to it if not already active
    if (browserSession.active_user_id !== accountHint) {
      await sessionService.switchActiveAccount(browserSession.id, accountHint)
    }

    return {
      proceed: true,
      selectedAccount: account,
    }
  }

  // Account not found - proceed normally (user may need to login)
  return { proceed: true }
}

// ============================================
// LOGIN HINT HANDLING
// ============================================

/**
 * Handle the login_hint parameter.
 *
 * The login_hint is typically an email or username that should be
 * pre-filled in the login form or used to select a provider.
 *
 * @param ctx - Hono context
 * @param loginHint - The login hint (email, username, etc.)
 * @param sessionService - Session service
 * @param browserSession - Current browser session
 * @returns Account session if found by login hint
 */
export async function handleLoginHint(
  ctx: Context,
  loginHint: string | undefined,
  sessionService: SessionService,
  browserSession: BrowserSession | null,
): Promise<AccountSession | null> {
  // No hint or no session - nothing to do
  if (!loginHint || !browserSession) {
    return null
  }

  // Try to find an account matching the login hint (by email)
  const accounts = await sessionService.listAccounts(browserSession.id)

  for (const account of accounts) {
    const email = (account.subject_properties as any)?.email
    if (email && email.toLowerCase() === loginHint.toLowerCase()) {
      // Found matching account - switch to it
      if (browserSession.active_user_id !== account.user_id) {
        await sessionService.switchActiveAccount(
          browserSession.id,
          account.user_id,
        )
      }
      return account
    }
  }

  // No matching account - store hint for the login form
  ctx.set("loginHint", loginHint)
  return null
}

// ============================================
// SESSION VALIDATION
// ============================================

/**
 * Validate that a session can be used for silent authentication.
 *
 * Checks:
 * 1. Session exists
 * 2. Session has an active account
 * 3. Account session is not expired
 * 4. Account session was authenticated for this client (optional)
 *
 * @param browserSession - The browser session
 * @param activeAccount - The active account session
 * @param clientId - Optional client ID to verify
 * @returns true if session is valid for silent auth
 */
export function validateSessionForSilentAuth(
  browserSession: BrowserSession | null,
  activeAccount: AccountSession | null,
  clientId?: string,
): boolean {
  if (!browserSession || !activeAccount) {
    return false
  }

  // Check if account is expired
  if (Date.now() > activeAccount.expires_at) {
    return false
  }

  // Optionally check client ID match
  if (clientId && activeAccount.client_id !== clientId) {
    // Different client - may want to require re-consent
    // For now, we allow cross-client SSO
  }

  return true
}

// ============================================
// ERROR HELPERS
// ============================================

/**
 * Create an OIDC error redirect URL.
 *
 * @param redirectUri - The redirect URI
 * @param error - The error details
 * @returns URL string with error parameters
 */
export function createOIDCErrorRedirect(
  redirectUri: string,
  error: OIDCErrorResponse,
): string {
  const url = new URL(redirectUri)
  url.searchParams.set("error", error.error)
  url.searchParams.set("error_description", error.error_description)
  if (error.state) {
    url.searchParams.set("state", error.state)
  }
  return url.toString()
}

/**
 * Create an OIDC error response for fragment-based responses.
 *
 * @param redirectUri - The redirect URI
 * @param error - The error details
 * @returns URL string with error in fragment
 */
export function createOIDCErrorFragment(
  redirectUri: string,
  error: OIDCErrorResponse,
): string {
  const url = new URL(redirectUri)
  const params = new URLSearchParams()
  params.set("error", error.error)
  params.set("error_description", error.error_description)
  if (error.state) {
    params.set("state", error.state)
  }
  url.hash = params.toString()
  return url.toString()
}

// ============================================
// ACCOUNT PICKER HELPERS
// ============================================

/**
 * Format accounts for the account picker UI.
 *
 * @param accounts - Account sessions
 * @returns Formatted accounts for display
 */
export function formatAccountsForPicker(
  accounts: AccountSession[],
): AccountPickerAccount[] {
  return accounts.map((account) => {
    const props = account.subject_properties as Record<string, unknown>

    return {
      userId: account.user_id,
      displayName:
        (props?.name as string) ||
        (props?.displayName as string) ||
        (props?.username as string) ||
        undefined,
      email: (props?.email as string) || undefined,
      avatarUrl:
        (props?.avatar as string) ||
        (props?.picture as string) ||
        (props?.avatarUrl as string) ||
        undefined,
      subjectType: account.subject_type,
      isActive: account.is_active,
      authenticatedAt: account.authenticated_at,
    }
  })
}

/**
 * Generate an "Add Another Account" URL.
 *
 * @param baseUrl - The base authorization URL
 * @param authorization - Current authorization parameters
 * @returns URL for adding another account
 */
export function generateAddAccountUrl(
  baseUrl: string,
  authorization: EnterpriseAuthorizationState,
): string {
  const url = new URL(baseUrl)

  // Copy authorization parameters
  url.searchParams.set("client_id", authorization.client_id)
  url.searchParams.set("redirect_uri", authorization.redirect_uri)
  url.searchParams.set("response_type", authorization.response_type)
  if (authorization.state) {
    url.searchParams.set("state", authorization.state)
  }
  if (authorization.scope) {
    url.searchParams.set("scope", authorization.scope)
  }
  if (authorization.nonce) {
    url.searchParams.set("nonce", authorization.nonce)
  }

  // Force login prompt to add new account
  url.searchParams.set("prompt", "login")

  return url.toString()
}

// ============================================
// CONTEXT AUGMENTATION
// ============================================

// Augment Hono context types
declare module "hono" {
  interface ContextVariableMap {
    accountPickerAccounts?: AccountPickerAccount[]
    showAccountPicker?: boolean
    loginHint?: string
  }
}

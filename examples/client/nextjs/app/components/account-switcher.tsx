"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  type Theme,
  type ColorScheme,
  DEFAULT_THEME,
  type Account,
  type AccountsListResponse,
  type ErrorResponse,
  type SuccessResponse,
  type LoadingState,
  type AccountSwitcherState,
} from "./account-switcher.types"
import { ConfirmDialog } from "./confirm-dialog"

/**
 * Which sign-out action is waiting for the user's confirmation, if any.
 */
type PendingSignOut = { kind: "account"; userId: string } | { kind: "all" }

/**
 * Helper to get color value from theme (handles string or ColorScheme)
 */
function getColor(
  color: string | ColorScheme | undefined,
  mode: "light" | "dark",
  fallback: string,
): string {
  if (!color) return fallback
  if (typeof color === "string") return color
  return color[mode] || fallback
}

/**
 * Helper to get border radius value from theme
 */
function getRadius(radius?: Theme["radius"]): string {
  switch (radius) {
    case "none":
      return "0"
    case "sm":
      return "4px"
    case "md":
      return "8px"
    case "lg":
      return "12px"
    case "full":
      return "9999px"
    default:
      return "8px"
  }
}

/**
 * AccountSwitcher Component
 *
 * A comprehensive multi-account user switching UI component that demonstrates
 * the OpenAuth session management APIs.
 *
 * Features:
 * - Lists all logged-in accounts for the current browser session
 * - Switches between accounts without re-authentication
 * - Signs out individual accounts
 * - Signs out all accounts at once
 * - Adds new accounts via OAuth authorization flow
 *
 * @example
 * ```tsx
 * import { AccountSwitcher } from "./components/account-switcher"
 *
 * export default function ProfilePage() {
 *   return (
 *     <div>
 *       <h1>Profile</h1>
 *       <AccountSwitcher apiBaseUrl="/api" />
 *     </div>
 *   )
 * }
 * ```
 */
export function AccountSwitcher({
  apiBaseUrl = "/api",
  authorizeUrl = "/authorize",
  theme: themeProp,
  onAccountSwitch,
  onSignOut,
}: {
  /**
   * Base URL for session API endpoints
   * @default "/api"
   */
  apiBaseUrl?: string
  /**
   * OAuth authorization URL for adding new accounts
   * @default "/authorize"
   */
  authorizeUrl?: string
  /**
   * Theme configuration for styling
   */
  theme?: Theme
  /**
   * Callback fired when account is switched successfully
   */
  onAccountSwitch?: (userId: string) => void
  /**
   * Callback fired when user signs out
   */
  onSignOut?: () => void
}) {
  const [state, setState] = useState<AccountSwitcherState>({
    accounts: [],
    loading: "idle",
    error: null,
  })
  const [pendingSignOut, setPendingSignOut] = useState<PendingSignOut | null>(
    null,
  )

  // Merge provided theme with defaults
  const theme = useMemo(() => ({ ...DEFAULT_THEME, ...themeProp }), [themeProp])

  // Generate CSS variables from theme
  const themeStyles = useMemo(() => {
    const primaryLight = getColor(theme.primary, "light", "#3b82f6")
    const primaryDark = getColor(theme.primary, "dark", "#60a5fa")
    const bgLight = getColor(theme.background, "light", "#ffffff")
    const bgDark = getColor(theme.background, "dark", "#111827")
    const radius = getRadius(theme.radius)
    const fontFamily =
      theme.font?.family ||
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

    return {
      "--as-primary-light": primaryLight,
      "--as-primary-dark": primaryDark,
      "--as-bg-light": bgLight,
      "--as-bg-dark": bgDark,
      "--as-radius": radius,
      "--as-font-family": fontFamily,
    } as React.CSSProperties
  }, [theme])

  /**
   * Fetch all accounts from the session API
   *
   * Calls GET /session/accounts to retrieve all logged-in accounts
   * in the current browser session.
   */
  const fetchAccounts = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: "loading", error: null }))

    try {
      const response = await fetch(`${apiBaseUrl}/session/accounts`, {
        method: "GET",
        credentials: "include", // Important: include cookies for session
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        const errorData: ErrorResponse = await response.json()
        throw new Error(errorData.message || "Failed to fetch accounts")
      }

      const data: AccountsListResponse = await response.json()

      setState((prev) => ({
        ...prev,
        accounts: data.accounts,
        loading: "idle",
        error: null,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: "idle",
        error:
          error instanceof Error ? error.message : "Failed to fetch accounts",
      }))
    }
  }, [apiBaseUrl])

  /**
   * Switch to a different account
   *
   * Calls POST /session/switch to change the active account
   * without requiring re-authentication.
   *
   * @param userId - The user ID of the account to switch to
   */
  const switchAccount = useCallback(
    async (userId: string) => {
      setState((prev) => ({ ...prev, loading: "switching", error: null }))

      try {
        const response = await fetch(`${apiBaseUrl}/session/switch`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId }),
        })

        if (!response.ok) {
          const errorData: ErrorResponse = await response.json()
          throw new Error(errorData.message || "Failed to switch account")
        }

        const data: SuccessResponse = await response.json()

        if (data.success) {
          // Refresh accounts list to update active status
          await fetchAccounts()

          // Trigger callback if provided
          onAccountSwitch?.(userId)

          // Reload the page to refresh user data throughout the app
          window.location.reload()
        }
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loading: "idle",
          error:
            error instanceof Error ? error.message : "Failed to switch account",
        }))
      }
    },
    [apiBaseUrl, fetchAccounts, onAccountSwitch],
  )

  /**
   * Sign out a single account
   *
   * Calls DELETE /session/accounts/:userId to remove a specific account
   * from the browser session. If it's the active account, the session
   * will either switch to another account or end the session.
   * Called only after the user confirms in the in-app dialog.
   *
   * @param userId - The user ID of the account to remove
   */
  const signOutAccount = useCallback(
    async (userId: string) => {
      setState((prev) => ({ ...prev, loading: "removing", error: null }))

      try {
        const response = await fetch(
          `${apiBaseUrl}/session/accounts/${encodeURIComponent(userId)}`,
          {
            method: "DELETE",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
          },
        )

        if (!response.ok) {
          const errorData: ErrorResponse = await response.json()
          throw new Error(errorData.message || "Failed to sign out account")
        }

        const data: SuccessResponse = await response.json()

        if (data.success) {
          // Refresh accounts list
          await fetchAccounts()

          // If no accounts left or signed out active account, trigger callback
          const remainingAccounts = state.accounts.filter(
            (a) => a.userId !== userId,
          )
          if (remainingAccounts.length === 0) {
            onSignOut?.()
            // Redirect to login or home page
            window.location.href = "/"
          }
        }
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loading: "idle",
          error:
            error instanceof Error
              ? error.message
              : "Failed to sign out account",
        }))
      }
    },
    [apiBaseUrl, fetchAccounts, onSignOut, state.accounts],
  )

  /**
   * Sign out all accounts at once
   *
   * Calls DELETE /session/all to remove all accounts from the browser
   * session and end the session completely.
   * Called only after the user confirms in the in-app dialog.
   */
  const signOutAll = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: "removing", error: null }))

    try {
      const response = await fetch(`${apiBaseUrl}/session/all`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        const errorData: ErrorResponse = await response.json()
        throw new Error(errorData.message || "Failed to sign out all accounts")
      }

      const data: SuccessResponse = await response.json()

      if (data.success) {
        // Clear local state
        setState((prev) => ({
          ...prev,
          accounts: [],
          loading: "idle",
          error: null,
        }))

        // Trigger callback
        onSignOut?.()

        // Redirect to login or home page
        window.location.href = "/"
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: "idle",
        error:
          error instanceof Error
            ? error.message
            : "Failed to sign out all accounts",
      }))
    }
  }, [apiBaseUrl, onSignOut])

  /**
   * Add another account (Google-style flow)
   *
   * Redirects to the OAuth authorization endpoint with prompt=select_account
   * to show the server-side account picker. This displays:
   * 1. All accounts already in the browser session
   * 2. A "+ Use another account" link (which uses prompt=login)
   *
   * This matches Google's behavior where clicking "Add account" first shows
   * the account picker, allowing users to either:
   * - Select an existing account they're already signed into
   * - Click "Use another account" to enter new credentials
   *
   * Flow:
   * 1. User clicks "Add Account" → prompt=select_account
   * 2. Server shows account picker with existing accounts
   * 3. User clicks "+ Use another account" → prompt=login
   * 4. User enters credentials for new account
   * 5. New account added to browser session
   */
  const addAccount = useCallback(() => {
    // Construct authorization URL with prompt=select_account
    // This shows the server-side account picker (like Google)
    const url = new URL(authorizeUrl, window.location.origin)
    url.searchParams.set("prompt", "select_account")
    url.searchParams.set("redirect_uri", window.location.href)

    // Redirect to authorization - server will show account picker
    window.location.href = url.toString()
  }, [authorizeUrl])

  /**
   * Load accounts on component mount
   */
  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  /**
   * Helper function to format timestamps
   */
  const formatAuthTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = Date.now()
    const diff = now - timestamp

    // Less than 1 minute
    if (diff < 60000) {
      return "Just now"
    }
    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000)
      return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
    }
    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000)
      return `${hours} hour${hours > 1 ? "s" : ""} ago`
    }
    // More than 24 hours - show date
    return date.toLocaleDateString()
  }

  /**
   * Get active account
   */
  const activeAccount = state.accounts.find((account) => account.isActive)

  /**
   * Render component
   */
  return (
    <div className="account-switcher" style={themeStyles}>
      <style jsx>{`
        .account-switcher {
          width: 100%;
          max-width: 400px;
          background: var(--as-bg-light, white);
          border: 1px solid
            color-mix(in srgb, var(--as-primary-light) 20%, transparent);
          border-radius: var(--as-radius, 8px);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          font-family: var(--as-font-family, inherit);
        }

        @media (prefers-color-scheme: dark) {
          .account-switcher {
            background: var(--as-bg-dark, #111827);
            border-color: color-mix(
              in srgb,
              var(--as-primary-dark) 30%,
              transparent
            );
          }
        }

        .switcher-header {
          padding: 16px;
          border-bottom: 1px solid
            color-mix(in srgb, var(--as-primary-light) 15%, transparent);
          background: color-mix(
            in srgb,
            var(--as-primary-light) 5%,
            var(--as-bg-light)
          );
        }

        @media (prefers-color-scheme: dark) {
          .switcher-header {
            border-bottom-color: color-mix(
              in srgb,
              var(--as-primary-dark) 20%,
              transparent
            );
            background: color-mix(
              in srgb,
              var(--as-primary-dark) 10%,
              var(--as-bg-dark)
            );
          }
        }

        .switcher-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #111827;
        }

        @media (prefers-color-scheme: dark) {
          .switcher-title {
            color: #f9fafb;
          }
        }

        .switcher-subtitle {
          margin: 4px 0 0;
          font-size: 14px;
          color: #6b7280;
        }

        @media (prefers-color-scheme: dark) {
          .switcher-subtitle {
            color: #9ca3af;
          }
        }

        .accounts-list {
          max-height: 400px;
          overflow-y: auto;
        }

        .account-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid
            color-mix(in srgb, var(--as-primary-light) 10%, transparent);
          transition: background 0.15s;
          cursor: pointer;
        }

        @media (prefers-color-scheme: dark) {
          .account-item {
            border-bottom-color: color-mix(
              in srgb,
              var(--as-primary-dark) 15%,
              transparent
            );
          }
        }

        .account-item:hover {
          background: color-mix(
            in srgb,
            var(--as-primary-light) 5%,
            var(--as-bg-light)
          );
        }

        @media (prefers-color-scheme: dark) {
          .account-item:hover {
            background: color-mix(
              in srgb,
              var(--as-primary-dark) 10%,
              var(--as-bg-dark)
            );
          }
        }

        .account-item.active {
          background: color-mix(
            in srgb,
            var(--as-primary-light) 10%,
            var(--as-bg-light)
          );
          border-left: 3px solid var(--as-primary-light);
        }

        @media (prefers-color-scheme: dark) {
          .account-item.active {
            background: color-mix(
              in srgb,
              var(--as-primary-dark) 15%,
              var(--as-bg-dark)
            );
            border-left-color: var(--as-primary-dark);
          }
        }

        .account-info {
          flex: 1;
          min-width: 0;
        }

        .account-user-id {
          font-size: 14px;
          font-weight: 500;
          color: #111827;
          margin: 0 0 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        @media (prefers-color-scheme: dark) {
          .account-user-id {
            color: #f9fafb;
          }
        }

        .account-item.active .account-user-id {
          color: var(--as-primary-light);
        }

        @media (prefers-color-scheme: dark) {
          .account-item.active .account-user-id {
            color: var(--as-primary-dark);
          }
        }

        .account-meta {
          font-size: 12px;
          color: #6b7280;
          display: flex;
          gap: 8px;
          align-items: center;
        }

        @media (prefers-color-scheme: dark) {
          .account-meta {
            color: #9ca3af;
          }
        }

        .account-badge {
          display: inline-block;
          padding: 2px 6px;
          background: var(--as-primary-light);
          color: white;
          font-size: 10px;
          font-weight: 600;
          border-radius: calc(var(--as-radius, 8px) / 2);
          text-transform: uppercase;
        }

        @media (prefers-color-scheme: dark) {
          .account-badge {
            background: var(--as-primary-dark);
            color: #111827;
          }
        }

        .account-actions {
          display: flex;
          gap: 8px;
        }

        .btn {
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          border-radius: calc(var(--as-radius, 8px) / 2);
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
          font-family: var(--as-font-family, inherit);
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-switch {
          background: var(--as-primary-light);
          color: white;
        }

        @media (prefers-color-scheme: dark) {
          .btn-switch {
            background: var(--as-primary-dark);
            color: #111827;
          }
        }

        .btn-switch:hover:not(:disabled) {
          filter: brightness(0.9);
        }

        .btn-remove {
          background: #ef4444;
          color: white;
        }

        .btn-remove:hover:not(:disabled) {
          background: #dc2626;
        }

        .switcher-footer {
          padding: 12px 16px;
          border-top: 1px solid
            color-mix(in srgb, var(--as-primary-light) 15%, transparent);
          display: flex;
          gap: 8px;
        }

        @media (prefers-color-scheme: dark) {
          .switcher-footer {
            border-top-color: color-mix(
              in srgb,
              var(--as-primary-dark) 20%,
              transparent
            );
          }
        }

        .btn-add {
          flex: 1;
          background: var(--as-primary-light);
          color: white;
        }

        @media (prefers-color-scheme: dark) {
          .btn-add {
            background: var(--as-primary-dark);
            color: #111827;
          }
        }

        .btn-add:hover:not(:disabled) {
          filter: brightness(0.9);
        }

        .btn-sign-out-all {
          background: #ef4444;
          color: white;
        }

        .btn-sign-out-all:hover:not(:disabled) {
          background: #dc2626;
        }

        .loading-state {
          padding: 24px;
          text-align: center;
          color: #6b7280;
        }

        @media (prefers-color-scheme: dark) {
          .loading-state {
            color: #9ca3af;
          }
        }

        .error-state {
          padding: 16px;
          background: #fee2e2;
          border: 1px solid #fecaca;
          border-radius: calc(var(--as-radius, 8px) / 2);
          margin: 16px;
        }

        @media (prefers-color-scheme: dark) {
          .error-state {
            background: #450a0a;
            border-color: #7f1d1d;
          }
        }

        .error-title {
          font-weight: 600;
          color: #991b1b;
          margin: 0 0 4px;
        }

        @media (prefers-color-scheme: dark) {
          .error-title {
            color: #fca5a5;
          }
        }

        .error-message {
          font-size: 14px;
          color: #dc2626;
          margin: 0;
        }

        @media (prefers-color-scheme: dark) {
          .error-message {
            color: #f87171;
          }
        }

        .empty-state {
          padding: 32px 16px;
          text-align: center;
          color: #6b7280;
        }

        @media (prefers-color-scheme: dark) {
          .empty-state {
            color: #9ca3af;
          }
        }

        .empty-state-title {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 8px;
          color: #111827;
        }

        @media (prefers-color-scheme: dark) {
          .empty-state-title {
            color: #f9fafb;
          }
        }

        .empty-state-message {
          font-size: 14px;
          margin: 0 0 16px;
        }
      `}</style>

      <div className="switcher-header">
        <h2 className="switcher-title">Account Switcher</h2>
        <p className="switcher-subtitle">
          {state.accounts.length > 0
            ? `${state.accounts.length} account${state.accounts.length > 1 ? "s" : ""}`
            : "No accounts"}
        </p>
      </div>

      {state.loading === "loading" && (
        <div className="loading-state">Loading accounts...</div>
      )}

      {state.error && (
        <div className="error-state">
          <p className="error-title">Error</p>
          <p className="error-message">{state.error}</p>
        </div>
      )}

      {state.loading !== "loading" &&
        !state.error &&
        state.accounts.length === 0 && (
          <div className="empty-state">
            <p className="empty-state-title">No accounts logged in</p>
            <p className="empty-state-message">
              Add an account to get started with multi-account switching.
            </p>
          </div>
        )}

      {state.loading !== "loading" &&
        !state.error &&
        state.accounts.length > 0 && (
          <div className="accounts-list">
            {state.accounts.map((account) => (
              <div
                key={account.userId}
                className={`account-item ${account.isActive ? "active" : ""}`}
                onClick={() =>
                  !account.isActive && switchAccount(account.userId)
                }
              >
                <div className="account-info">
                  <p className="account-user-id">
                    {account.userId}
                    {account.isActive && (
                      <span
                        className="account-badge"
                        style={{ marginLeft: "8px" }}
                      >
                        Active
                      </span>
                    )}
                  </p>
                  <div className="account-meta">
                    <span>{formatAuthTime(account.authenticatedAt)}</span>
                    <span>•</span>
                    <span>{account.subjectType}</span>
                  </div>
                </div>

                <div className="account-actions">
                  {!account.isActive && (
                    <button
                      className="btn btn-switch"
                      onClick={(e) => {
                        e.stopPropagation()
                        switchAccount(account.userId)
                      }}
                      disabled={state.loading !== "idle"}
                    >
                      {state.loading === "switching"
                        ? "Switching..."
                        : "Switch"}
                    </button>
                  )}
                  <button
                    className="btn btn-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingSignOut({
                        kind: "account",
                        userId: account.userId,
                      })
                    }}
                    disabled={state.loading !== "idle"}
                  >
                    {state.loading === "removing" ? "Removing..." : "Remove"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      <div className="switcher-footer">
        <button
          className="btn btn-add"
          onClick={addAccount}
          disabled={state.loading !== "idle"}
        >
          {state.loading === "adding" ? "Redirecting..." : "+ Add Account"}
        </button>
        {state.accounts.length > 0 && (
          <button
            className="btn btn-sign-out-all"
            onClick={() => setPendingSignOut({ kind: "all" })}
            disabled={state.loading !== "idle"}
          >
            Sign Out All
          </button>
        )}
      </div>

      <ConfirmDialog
        open={pendingSignOut !== null}
        destructive
        title={
          pendingSignOut?.kind === "all"
            ? "Sign out all accounts?"
            : "Sign out this account?"
        }
        description={
          pendingSignOut?.kind === "account"
            ? `${pendingSignOut.userId} will be removed from this browser session.`
            : "Every account will be removed from this browser session."
        }
        confirmLabel={
          pendingSignOut?.kind === "all" ? "Sign out all" : "Sign out"
        }
        onCancel={() => setPendingSignOut(null)}
        onConfirm={() => {
          const pending = pendingSignOut
          setPendingSignOut(null)
          if (pending?.kind === "account") signOutAccount(pending.userId)
          else if (pending?.kind === "all") signOutAll()
        }}
      />
    </div>
  )
}

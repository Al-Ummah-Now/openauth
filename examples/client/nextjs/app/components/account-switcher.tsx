"use client"

import { useState, useEffect, useCallback } from "react"

/**
 * API Response Types
 * Based on /packages/openauth/src/session/types.ts
 */

/**
 * Account information returned from the API
 */
interface Account {
  userId: string
  isActive: boolean
  authenticatedAt: number
  subjectType: string
  clientId: string
}

/**
 * Response from GET /session/accounts
 */
interface AccountsListResponse {
  accounts: Account[]
}

/**
 * Error response structure from API
 */
interface ErrorResponse {
  error: string
  message: string
}

/**
 * Success response for operations
 */
interface SuccessResponse {
  success: boolean
}

/**
 * Component State Types
 */

type LoadingState = "idle" | "loading" | "switching" | "removing" | "adding"

interface AccountSwitcherState {
  accounts: Account[]
  loading: LoadingState
  error: string | null
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
        error: error instanceof Error ? error.message : "Failed to fetch accounts",
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
          error: error instanceof Error ? error.message : "Failed to switch account",
        }))
      }
    },
    [apiBaseUrl, fetchAccounts, onAccountSwitch]
  )

  /**
   * Sign out a single account
   *
   * Calls DELETE /session/accounts/:userId to remove a specific account
   * from the browser session. If it's the active account, the session
   * will either switch to another account or end the session.
   *
   * @param userId - The user ID of the account to remove
   */
  const signOutAccount = useCallback(
    async (userId: string) => {
      if (!confirm(`Are you sure you want to sign out this account (${userId})?`)) {
        return
      }

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
          }
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
          const remainingAccounts = state.accounts.filter((a) => a.userId !== userId)
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
          error: error instanceof Error ? error.message : "Failed to sign out account",
        }))
      }
    },
    [apiBaseUrl, fetchAccounts, onSignOut, state.accounts]
  )

  /**
   * Sign out all accounts at once
   *
   * Calls DELETE /session/all to remove all accounts from the browser
   * session and end the session completely.
   */
  const signOutAll = useCallback(async () => {
    if (!confirm("Are you sure you want to sign out all accounts?")) {
      return
    }

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
        error: error instanceof Error ? error.message : "Failed to sign out all accounts",
      }))
    }
  }, [apiBaseUrl, onSignOut])

  /**
   * Add another account
   *
   * Redirects to the OAuth authorization endpoint with prompt=login
   * to force the user to log in with a different account. After
   * successful authentication, the user will be redirected back with
   * the new account added to their browser session.
   */
  const addAccount = useCallback(() => {
    // Construct authorization URL with prompt=login to force account selection
    const url = new URL(authorizeUrl, window.location.origin)
    url.searchParams.set("prompt", "login")
    url.searchParams.set("redirect_uri", window.location.href)

    // Redirect to authorization
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
    <div className="account-switcher">
      <style jsx>{`
        .account-switcher {
          width: 100%;
          max-width: 400px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }

        .switcher-header {
          padding: 16px;
          border-bottom: 1px solid #e5e7eb;
          background: #f9fafb;
        }

        .switcher-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #111827;
        }

        .switcher-subtitle {
          margin: 4px 0 0;
          font-size: 14px;
          color: #6b7280;
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
          border-bottom: 1px solid #f3f4f6;
          transition: background 0.15s;
          cursor: pointer;
        }

        .account-item:hover {
          background: #f9fafb;
        }

        .account-item.active {
          background: #eff6ff;
          border-left: 3px solid #3b82f6;
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

        .account-item.active .account-user-id {
          color: #1e40af;
        }

        .account-meta {
          font-size: 12px;
          color: #6b7280;
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .account-badge {
          display: inline-block;
          padding: 2px 6px;
          background: #3b82f6;
          color: white;
          font-size: 10px;
          font-weight: 600;
          border-radius: 4px;
          text-transform: uppercase;
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
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-switch {
          background: #3b82f6;
          color: white;
        }

        .btn-switch:hover:not(:disabled) {
          background: #2563eb;
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
          border-top: 1px solid #e5e7eb;
          display: flex;
          gap: 8px;
        }

        .btn-add {
          flex: 1;
          background: #10b981;
          color: white;
        }

        .btn-add:hover:not(:disabled) {
          background: #059669;
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

        .error-state {
          padding: 16px;
          background: #fee2e2;
          border: 1px solid #fecaca;
          border-radius: 4px;
          margin: 16px;
        }

        .error-title {
          font-weight: 600;
          color: #991b1b;
          margin: 0 0 4px;
        }

        .error-message {
          font-size: 14px;
          color: #dc2626;
          margin: 0;
        }

        .empty-state {
          padding: 32px 16px;
          text-align: center;
          color: #6b7280;
        }

        .empty-state-title {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 8px;
          color: #111827;
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

      {state.loading !== "loading" && !state.error && state.accounts.length === 0 && (
        <div className="empty-state">
          <p className="empty-state-title">No accounts logged in</p>
          <p className="empty-state-message">
            Add an account to get started with multi-account switching.
          </p>
        </div>
      )}

      {state.loading !== "loading" && !state.error && state.accounts.length > 0 && (
        <div className="accounts-list">
          {state.accounts.map((account) => (
            <div
              key={account.userId}
              className={`account-item ${account.isActive ? "active" : ""}`}
              onClick={() => !account.isActive && switchAccount(account.userId)}
            >
              <div className="account-info">
                <p className="account-user-id">
                  {account.userId}
                  {account.isActive && (
                    <span className="account-badge" style={{ marginLeft: "8px" }}>
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
                    {state.loading === "switching" ? "Switching..." : "Switch"}
                  </button>
                )}
                <button
                  className="btn btn-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    signOutAccount(account.userId)
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
            onClick={signOutAll}
            disabled={state.loading !== "idle"}
          >
            Sign Out All
          </button>
        )}
      </div>
    </div>
  )
}

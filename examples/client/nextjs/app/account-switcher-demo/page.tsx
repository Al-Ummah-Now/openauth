import { AccountSwitcher } from "../components/account-switcher"

/**
 * Account Switcher Demo Page
 *
 * This page demonstrates the AccountSwitcher component which showcases
 * OpenAuth's multi-account session management capabilities.
 *
 * Features demonstrated:
 * - Listing all logged-in accounts
 * - Switching between accounts without re-authentication
 * - Signing out individual accounts
 * - Signing out all accounts
 * - Adding new accounts via OAuth flow
 */
export default function AccountSwitcherDemo() {
  return (
    <div style={{ padding: "40px", maxWidth: "1200px", margin: "0 auto" }}>
      <style jsx>{`
        .header {
          margin-bottom: 40px;
        }

        .title {
          font-size: 32px;
          font-weight: 700;
          color: #111827;
          margin: 0 0 12px;
        }

        .subtitle {
          font-size: 18px;
          color: #6b7280;
          margin: 0 0 24px;
        }

        .content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          align-items: start;
        }

        .demo-section {
          background: white;
        }

        .info-section {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 24px;
        }

        .info-title {
          font-size: 20px;
          font-weight: 600;
          color: #111827;
          margin: 0 0 16px;
        }

        .info-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .info-item {
          padding: 12px 0;
          border-bottom: 1px solid #e5e7eb;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-item-title {
          font-weight: 600;
          color: #111827;
          margin: 0 0 4px;
        }

        .info-item-desc {
          font-size: 14px;
          color: #6b7280;
          margin: 0;
        }

        .code-block {
          background: #1f2937;
          color: #f3f4f6;
          padding: 16px;
          border-radius: 6px;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 13px;
          line-height: 1.6;
          overflow-x: auto;
          margin: 16px 0;
        }

        .api-section {
          margin-top: 24px;
        }

        .api-endpoint {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 12px;
          margin-bottom: 12px;
        }

        .api-method {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          margin-right: 8px;
        }

        .api-method.get {
          background: #d1fae5;
          color: #065f46;
        }

        .api-method.post {
          background: #dbeafe;
          color: #1e40af;
        }

        .api-method.delete {
          background: #fee2e2;
          color: #991b1b;
        }

        .api-path {
          font-family: "Monaco", "Menlo", monospace;
          font-size: 14px;
          color: #111827;
        }

        .warning-box {
          background: #fef3c7;
          border: 1px solid #fde68a;
          border-radius: 6px;
          padding: 16px;
          margin: 24px 0;
        }

        .warning-title {
          font-weight: 600;
          color: #92400e;
          margin: 0 0 8px;
        }

        .warning-text {
          font-size: 14px;
          color: #78350f;
          margin: 0;
        }

        @media (max-width: 768px) {
          .content {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="header">
        <h1 className="title">Multi-Account Session Management</h1>
        <p className="subtitle">
          OpenAuth Account Switcher Demo - Switch between multiple logged-in accounts
          seamlessly
        </p>
      </div>

      <div className="content">
        <div className="demo-section">
          <AccountSwitcher
            apiBaseUrl="/api"
            authorizeUrl="/authorize"
            onAccountSwitch={(userId) => {
              console.log("Account switched to:", userId)
              // In a real app, you might want to:
              // - Update user context
              // - Refresh user-specific data
              // - Show a success toast
            }}
            onSignOut={() => {
              console.log("User signed out")
              // In a real app, you might want to:
              // - Clear local storage
              // - Reset app state
              // - Redirect to login page
            }}
          />
        </div>

        <div className="info-section">
          <h2 className="info-title">How It Works</h2>

          <ul className="info-list">
            <li className="info-item">
              <h3 className="info-item-title">1. List Accounts</h3>
              <p className="info-item-desc">
                View all accounts logged in to this browser session. The active account
                is highlighted.
              </p>
            </li>

            <li className="info-item">
              <h3 className="info-item-title">2. Switch Accounts</h3>
              <p className="info-item-desc">
                Click "Switch" on any inactive account to make it active without
                re-authentication.
              </p>
            </li>

            <li className="info-item">
              <h3 className="info-item-title">3. Remove Accounts</h3>
              <p className="info-item-desc">
                Click "Remove" to sign out a specific account from this browser session.
              </p>
            </li>

            <li className="info-item">
              <h3 className="info-item-title">4. Add Accounts</h3>
              <p className="info-item-desc">
                Click "+ Add Account" to authenticate with another account via OAuth.
              </p>
            </li>

            <li className="info-item">
              <h3 className="info-item-title">5. Sign Out All</h3>
              <p className="info-item-desc">
                Click "Sign Out All" to remove all accounts and end the session.
              </p>
            </li>
          </ul>

          <div className="api-section">
            <h2 className="info-title">API Endpoints Used</h2>

            <div className="api-endpoint">
              <span className="api-method get">GET</span>
              <span className="api-path">/session/accounts</span>
            </div>

            <div className="api-endpoint">
              <span className="api-method post">POST</span>
              <span className="api-path">/session/switch</span>
            </div>

            <div className="api-endpoint">
              <span className="api-method delete">DELETE</span>
              <span className="api-path">/session/accounts/:userId</span>
            </div>

            <div className="api-endpoint">
              <span className="api-method delete">DELETE</span>
              <span className="api-path">/session/all</span>
            </div>
          </div>

          <div className="warning-box">
            <h3 className="warning-title">Note</h3>
            <p className="warning-text">
              This demo requires the OpenAuth session management APIs to be properly
              configured on your server. Make sure the session middleware is enabled and
              the routes are mounted at <code>/api/session</code>.
            </p>
          </div>

          <h2 className="info-title" style={{ marginTop: "24px" }}>
            Example Usage
          </h2>

          <div className="code-block">
            {`import { AccountSwitcher } from "./components/account-switcher"

export default function ProfilePage() {
  return (
    <div>
      <h1>User Profile</h1>
      <AccountSwitcher
        apiBaseUrl="/api"
        authorizeUrl="/authorize"
        onAccountSwitch={(userId) => {
          console.log("Switched to:", userId)
        }}
        onSignOut={() => {
          console.log("Signed out")
        }}
      />
    </div>
  )
}`}
          </div>
        </div>
      </div>
    </div>
  )
}

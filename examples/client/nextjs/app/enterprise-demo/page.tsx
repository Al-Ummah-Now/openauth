/**
 * Enterprise Features Demo Page
 *
 * This page demonstrates:
 * 1. Feature detection (introspection/revocation availability)
 * 2. Different validation methods (introspection vs JWT)
 * 3. Graceful degradation when features are not available
 */

import {
  getAuthInfo,
  login,
  logout,
  performAdminAction,
} from "../actions-with-enterprise"

export default async function EnterpriseDemoPage() {
  const authInfo = await getAuthInfo()

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Enterprise Features Demo</h1>

      {/* Feature Availability Status */}
      <section style={{ marginTop: "2rem" }}>
        <h2>Server Feature Availability</h2>
        <div
          style={{
            background: "#f5f5f5",
            padding: "1rem",
            borderRadius: "8px",
          }}
        >
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>Token Introspection:</strong>{" "}
            <span
              style={{
                color: authInfo.features.introspection ? "green" : "orange",
              }}
            >
              {authInfo.features.introspection ? "✓ Available" : "✗ Not Available"}
            </span>
            {!authInfo.features.introspection && (
              <span style={{ fontSize: "0.9em", color: "#666" }}>
                {" "}
                (falling back to local JWT verification)
              </span>
            )}
          </div>
          <div>
            <strong>Token Revocation:</strong>{" "}
            <span
              style={{
                color: authInfo.features.revocation ? "green" : "orange",
              }}
            >
              {authInfo.features.revocation ? "✓ Available" : "✗ Not Available"}
            </span>
            {!authInfo.features.revocation && (
              <span style={{ fontSize: "0.9em", color: "#666" }}>
                {" "}
                (clearing local tokens only on logout)
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Authentication Status */}
      <section style={{ marginTop: "2rem" }}>
        <h2>Authentication Status</h2>
        <div
          style={{
            background: "#f5f5f5",
            padding: "1rem",
            borderRadius: "8px",
          }}
        >
          {authInfo.authenticated ? (
            <>
              <div style={{ marginBottom: "0.5rem" }}>
                <strong>Status:</strong>{" "}
                <span style={{ color: "green" }}>✓ Authenticated</span>
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <strong>Validation Method:</strong>{" "}
                <code>{authInfo.validationMethod}</code>
                {authInfo.validationMethod === "introspection" && (
                  <span style={{ fontSize: "0.9em", color: "#666" }}>
                    {" "}
                    (server-side validation)
                  </span>
                )}
                {authInfo.validationMethod === "local" && (
                  <span style={{ fontSize: "0.9em", color: "#666" }}>
                    {" "}
                    (client-side JWT verification)
                  </span>
                )}
              </div>
              <div>
                <strong>Subject:</strong>
                <pre
                  style={{
                    background: "white",
                    padding: "0.5rem",
                    borderRadius: "4px",
                    marginTop: "0.5rem",
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(authInfo.subject, null, 2)}
                </pre>
              </div>
            </>
          ) : (
            <div>
              <strong>Status:</strong>{" "}
              <span style={{ color: "orange" }}>Not authenticated</span>
            </div>
          )}
        </div>
      </section>

      {/* Actions */}
      <section style={{ marginTop: "2rem" }}>
        <h2>Actions</h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {!authInfo.authenticated ? (
            <form action={login}>
              <button
                type="submit"
                style={{
                  padding: "0.75rem 1.5rem",
                  background: "#0070f3",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Login
              </button>
            </form>
          ) : (
            <>
              <form action={logout}>
                <button
                  type="submit"
                  style={{
                    padding: "0.75rem 1.5rem",
                    background: "#666",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Logout
                  {authInfo.features.revocation
                    ? " (with server revocation)"
                    : " (local only)"}
                </button>
              </form>

              <form
                action={async () => {
                  "use server"
                  await performAdminAction("test-action")
                }}
              >
                <button
                  type="submit"
                  style={{
                    padding: "0.75rem 1.5rem",
                    background: "#f81ce5",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Test Admin Action
                  {authInfo.features.introspection
                    ? " (with introspection)"
                    : " (JWT only)"}
                </button>
              </form>
            </>
          )}
        </div>
      </section>

      {/* Documentation */}
      <section style={{ marginTop: "2rem" }}>
        <h2>How It Works</h2>
        <div
          style={{
            background: "#f5f5f5",
            padding: "1rem",
            borderRadius: "8px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Feature Detection</h3>
          <p>
            The client automatically detects which features are available on the
            server by checking for HTTP 501 (Not Implemented) responses:
          </p>
          <ul>
            <li>
              <strong>Introspection Available:</strong> Uses server-side token
              validation for security-critical operations
            </li>
            <li>
              <strong>Introspection Unavailable:</strong> Falls back to local
              JWT verification (still secure)
            </li>
            <li>
              <strong>Revocation Available:</strong> Invalidates tokens on the
              server during logout
            </li>
            <li>
              <strong>Revocation Unavailable:</strong> Clears local tokens only
              (tokens expire naturally)
            </li>
          </ul>

          <h3>Validation Methods</h3>
          <ul>
            <li>
              <strong>Introspection (server-side):</strong> Recommended for
              sensitive operations like admin actions, payments, account
              changes. Provides real-time validation and can check if token was
              revoked.
            </li>
            <li>
              <strong>JWT Verification (local):</strong> Faster and more
              efficient for regular page loads. Still secure but doesn't detect
              revoked tokens until expiry.
            </li>
          </ul>

          <h3>Graceful Degradation</h3>
          <p>
            Your application works seamlessly whether or not the server has
            enterprise features enabled:
          </p>
          <ul>
            <li>
              <strong>Without enterprise features:</strong> Uses standard OAuth
              2.0 with JWT verification
            </li>
            <li>
              <strong>With enterprise features:</strong> Gains additional
              security and control capabilities
            </li>
            <li>
              <strong>Same API:</strong> Your code doesn't need to change when
              features are enabled/disabled
            </li>
          </ul>
        </div>
      </section>

      {/* Configuration Examples */}
      <section style={{ marginTop: "2rem" }}>
        <h2>Server Configuration</h2>
        <div
          style={{
            background: "#f5f5f5",
            padding: "1rem",
            borderRadius: "8px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Basic Setup (Current State)</h3>
          <pre
            style={{
              background: "white",
              padding: "1rem",
              borderRadius: "4px",
              overflow: "auto",
            }}
          >
            {`issuer({
  storage: CloudflareStorage({ namespace: env.CloudflareAuthKV }),
  subjects,
  providers,
  success: async (ctx, value) => ctx.subject("user", { userID })
})`}
          </pre>
          <p style={{ fontSize: "0.9em", color: "#666" }}>
            Introspection: Not available (returns 501)
            <br />
            Revocation: Not available (returns 501)
          </p>

          <h3>With Enterprise Features Enabled</h3>
          <pre
            style={{
              background: "white",
              padding: "1rem",
              borderRadius: "4px",
              overflow: "auto",
            }}
          >
            {`issuer({
  storage: CloudflareStorage({ namespace: env.CloudflareAuthKV }),
  clientDb: env.AUTH_DB,  // 👈 Enables introspection & revocation
  audit: {
    service: new AuditService({ database: env.AUDIT_DB }),
    hooks: { onTokenGenerated: true }
  },
  subjects,
  providers,
  success: async (ctx, value) => ctx.subject("user", { userID })
})`}
          </pre>
          <p style={{ fontSize: "0.9em", color: "#666" }}>
            Introspection: Available (POST /token/introspect)
            <br />
            Revocation: Available (POST /token/revoke)
          </p>
        </div>
      </section>
    </div>
  )
}

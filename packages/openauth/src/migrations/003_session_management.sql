-- Migration 003: Session Management Tables
-- Adds browser sessions and account sessions for multi-account support
-- Browser sessions track the device/browser, account sessions track individual user logins
--
-- Note: KV storage is the primary session store for performance.
-- D1 tables provide queryability for admin operations and session cleanup.
--
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/003_session_management.sql

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================
-- BROWSER SESSIONS TABLE
-- ============================================

-- Browser sessions - tracks a browser/device session
-- Supports up to 3 concurrent user accounts per browser session
CREATE TABLE IF NOT EXISTS browser_sessions (
    -- Unique session identifier (cryptographically random)
    id TEXT PRIMARY KEY,

    -- Tenant this session belongs to
    tenant_id TEXT NOT NULL,

    -- When the session was first created (Unix epoch milliseconds)
    created_at INTEGER NOT NULL,

    -- Last user activity timestamp for session timeout calculation
    -- Updated on each authenticated request
    last_activity INTEGER NOT NULL,

    -- Browser user agent string for session identification
    user_agent TEXT,

    -- Client IP address for security logging and geo-identification
    ip_address TEXT,

    -- Optimistic concurrency control version
    -- Incremented on each update to detect concurrent modifications
    version INTEGER NOT NULL DEFAULT 1,

    -- Currently active user ID within this session
    -- NULL if no user is currently active
    active_user_id TEXT,

    -- Foreign key to tenants table
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Index for tenant-scoped session queries (admin operations)
CREATE INDEX IF NOT EXISTS idx_browser_sessions_tenant ON browser_sessions(tenant_id);

-- Index for session cleanup based on last activity
CREATE INDEX IF NOT EXISTS idx_browser_sessions_activity ON browser_sessions(last_activity);

-- Index for finding all sessions for a specific user
CREATE INDEX IF NOT EXISTS idx_browser_sessions_user ON browser_sessions(active_user_id);

-- Index for listing sessions by creation time
CREATE INDEX IF NOT EXISTS idx_browser_sessions_created ON browser_sessions(created_at);

-- ============================================
-- ACCOUNT SESSIONS TABLE
-- ============================================

-- Account sessions - tracks individual user logins within a browser session
-- Multiple account sessions can exist per browser session (multi-account support)
CREATE TABLE IF NOT EXISTS account_sessions (
    -- Unique account session identifier
    id TEXT PRIMARY KEY,

    -- Parent browser session
    browser_session_id TEXT NOT NULL,

    -- User identifier from the identity provider
    user_id TEXT NOT NULL,

    -- Whether this account is currently active in the browser session
    -- Only one account can be active at a time per browser session
    is_active INTEGER NOT NULL DEFAULT 0,

    -- When the user authenticated (Unix epoch milliseconds)
    authenticated_at INTEGER NOT NULL,

    -- When this account session expires (Unix epoch milliseconds)
    expires_at INTEGER NOT NULL,

    -- Type of authentication subject (e.g., 'user', 'service_account')
    subject_type TEXT NOT NULL,

    -- JSON object containing subject-specific properties
    -- Structure varies by subject_type (email, name, roles, etc.)
    subject_properties TEXT,

    -- Refresh token for obtaining new access tokens
    -- Encrypted at rest in production deployments
    refresh_token TEXT NOT NULL,

    -- OAuth client that initiated this session
    client_id TEXT NOT NULL,

    -- Foreign key to browser sessions
    FOREIGN KEY (browser_session_id) REFERENCES browser_sessions(id) ON DELETE CASCADE
);

-- Index for listing accounts within a browser session
CREATE INDEX IF NOT EXISTS idx_account_sessions_browser ON account_sessions(browser_session_id);

-- Index for finding all sessions for a specific user (cross-browser)
CREATE INDEX IF NOT EXISTS idx_account_sessions_user ON account_sessions(user_id);

-- Index for session cleanup based on expiration
CREATE INDEX IF NOT EXISTS idx_account_sessions_expires ON account_sessions(expires_at);

-- Composite index for finding the active account in a session
CREATE INDEX IF NOT EXISTS idx_account_sessions_active ON account_sessions(browser_session_id, is_active);

-- Index for listing sessions by authentication time
CREATE INDEX IF NOT EXISTS idx_account_sessions_auth ON account_sessions(authenticated_at);

-- Index for client-specific session queries
CREATE INDEX IF NOT EXISTS idx_account_sessions_client ON account_sessions(client_id);

-- Unique constraint: only one session per user per browser session
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_sessions_unique_user
    ON account_sessions(browser_session_id, user_id);

-- ============================================
-- SESSION CLEANUP VIEW (OPTIONAL)
-- ============================================

-- View for identifying expired sessions needing cleanup
CREATE VIEW IF NOT EXISTS expired_sessions AS
SELECT
    bs.id AS browser_session_id,
    bs.tenant_id,
    bs.last_activity,
    bs.created_at,
    COUNT(acs.id) AS account_count
FROM browser_sessions bs
LEFT JOIN account_sessions acs ON bs.id = acs.browser_session_id
WHERE bs.last_activity < (strftime('%s', 'now') * 1000 - 7 * 24 * 60 * 60 * 1000) -- 7 days
GROUP BY bs.id;

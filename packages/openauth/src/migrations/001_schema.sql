-- OpenAuth Database Schema
-- Complete schema for OpenAuth enterprise features
-- All tables use CREATE TABLE IF NOT EXISTS for idempotency
--
-- Run with: npx openauth migrate
-- Or: wrangler d1 execute <db-name> --file=./src/migrations/001_schema.sql

-- Enable foreign keys (D1/SQLite specific)
PRAGMA foreign_keys = ON;

-- ============================================
-- MIGRATION TRACKING
-- ============================================

-- Tracks which migrations have been applied (for future incremental migrations)
CREATE TABLE IF NOT EXISTS _openauth_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    checksum TEXT
);

CREATE INDEX IF NOT EXISTS idx_migrations_applied ON _openauth_migrations(applied_at);

-- ============================================
-- TENANTS
-- ============================================

-- Tenants - represents isolated organizations/customers
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    domain TEXT UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'suspended', 'pending', 'deleted')),
    branding TEXT,
    settings TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_created ON tenants(created_at);

-- Default tenant for single-tenant deployments
INSERT OR IGNORE INTO tenants (id, name, status, branding, settings, created_at, updated_at)
VALUES ('default', 'Default Tenant', 'active', '{}', '{}', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- ============================================
-- OAUTH CLIENTS
-- ============================================

-- OAuth 2.0 client registrations with tenant isolation and secret rotation
CREATE TABLE IF NOT EXISTS oauth_clients (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    client_secret_hash TEXT,
    grant_types TEXT DEFAULT '[]',
    scopes TEXT DEFAULT '[]',
    redirect_uris TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rotated_at INTEGER,
    previous_secret_hash TEXT,
    previous_secret_expires_at INTEGER,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_clients_tenant_name ON oauth_clients(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_tenant ON oauth_clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_created ON oauth_clients(created_at);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_enabled ON oauth_clients(enabled);

-- ============================================
-- BROWSER SESSIONS
-- ============================================

-- Browser sessions - tracks browser/device sessions (up to 3 accounts per session)
CREATE TABLE IF NOT EXISTS browser_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    active_user_id TEXT,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_tenant ON browser_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_activity ON browser_sessions(last_activity);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_user ON browser_sessions(active_user_id);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_created ON browser_sessions(created_at);

-- ============================================
-- ACCOUNT SESSIONS
-- ============================================

-- Account sessions - individual user logins within a browser session
CREATE TABLE IF NOT EXISTS account_sessions (
    id TEXT PRIMARY KEY,
    browser_session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    authenticated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    subject_type TEXT NOT NULL,
    subject_properties TEXT,
    refresh_token TEXT NOT NULL,
    client_id TEXT NOT NULL,
    FOREIGN KEY (browser_session_id) REFERENCES browser_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_sessions_browser ON account_sessions(browser_session_id);
CREATE INDEX IF NOT EXISTS idx_account_sessions_user ON account_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_account_sessions_expires ON account_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_account_sessions_active ON account_sessions(browser_session_id, is_active);
CREATE INDEX IF NOT EXISTS idx_account_sessions_auth ON account_sessions(authenticated_at);
CREATE INDEX IF NOT EXISTS idx_account_sessions_client ON account_sessions(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_sessions_unique_user ON account_sessions(browser_session_id, user_id);

-- View for expired sessions cleanup
CREATE VIEW IF NOT EXISTS expired_sessions AS
SELECT
    bs.id AS browser_session_id,
    bs.tenant_id,
    bs.last_activity,
    bs.created_at,
    COUNT(acs.id) AS account_count
FROM browser_sessions bs
LEFT JOIN account_sessions acs ON bs.id = acs.browser_session_id
WHERE bs.last_activity < (strftime('%s', 'now') * 1000 - 7 * 24 * 60 * 60 * 1000)
GROUP BY bs.id;

-- ============================================
-- USERS
-- ============================================

-- User accounts with tenant isolation
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    metadata TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER,
    deleted_at INTEGER,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_updated ON users(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================
-- USER IDENTITIES
-- ============================================

-- Links users to identity providers (Google, GitHub, etc.)
CREATE TABLE IF NOT EXISTS user_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_data TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_provider ON user_identities(tenant_id, provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_identities_tenant_provider ON user_identities(tenant_id, provider);

-- ============================================
-- IDENTITY PROVIDERS
-- ============================================

-- Dynamic identity provider configuration per tenant
CREATE TABLE IF NOT EXISTS identity_providers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    client_id TEXT,
    client_secret_encrypted TEXT,
    client_secret_iv TEXT,
    config TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(tenant_id, name),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant ON identity_providers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant_enabled ON identity_providers(tenant_id, enabled);
CREATE INDEX IF NOT EXISTS idx_identity_providers_type ON identity_providers(type);
CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant_order ON identity_providers(tenant_id, display_order, name);

-- ============================================
-- RBAC: ROLES
-- ============================================

-- Named collections of permissions
CREATE TABLE IF NOT EXISTS rbac_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    description TEXT,
    is_system_role INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rbac_roles_name_tenant ON rbac_roles(name, tenant_id);
CREATE INDEX IF NOT EXISTS idx_rbac_roles_tenant ON rbac_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rbac_roles_system ON rbac_roles(is_system_role);

-- ============================================
-- RBAC: PERMISSIONS
-- ============================================

-- Granular access controls (resource + action)
-- Permissions are scoped to OAuth clients
CREATE TABLE IF NOT EXISTS rbac_permissions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client_id TEXT NOT NULL,
    description TEXT,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (client_id) REFERENCES oauth_clients(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rbac_permissions_name_client ON rbac_permissions(name, client_id);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_client ON rbac_permissions(client_id);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_resource ON rbac_permissions(resource);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_resource_action ON rbac_permissions(resource, action);

-- ============================================
-- RBAC: ROLE-PERMISSION MAPPING
-- ============================================

-- Maps permissions to roles
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
    role_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,
    granted_at INTEGER NOT NULL,
    granted_by TEXT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES rbac_permissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_role ON rbac_role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_permission ON rbac_role_permissions(permission_id);

-- ============================================
-- RBAC: USER-ROLE MAPPING
-- ============================================

-- Maps roles to users (with optional expiration)
CREATE TABLE IF NOT EXISTS rbac_user_roles (
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    expires_at INTEGER,
    assigned_by TEXT NOT NULL,
    PRIMARY KEY (user_id, role_id, tenant_id),
    FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_user ON rbac_user_roles(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_role ON rbac_user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_expires ON rbac_user_roles(expires_at);
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_tenant ON rbac_user_roles(tenant_id);

-- ============================================
-- RBAC: PERMISSION CHECK VIEW
-- ============================================

-- View for efficient permission checks
CREATE VIEW IF NOT EXISTS user_permissions AS
SELECT DISTINCT
    ur.user_id,
    ur.tenant_id,
    p.client_id,
    p.name AS permission_name,
    p.resource,
    p.action,
    r.name AS role_name,
    r.is_system_role,
    ur.expires_at
FROM rbac_user_roles ur
INNER JOIN rbac_roles r ON ur.role_id = r.id
INNER JOIN rbac_role_permissions rp ON r.id = rp.role_id
INNER JOIN rbac_permissions p ON rp.permission_id = p.id
WHERE (ur.expires_at IS NULL OR ur.expires_at > strftime('%s', 'now') * 1000);

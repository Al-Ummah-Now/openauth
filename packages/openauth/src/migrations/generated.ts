/**
 * AUTO-GENERATED - DO NOT EDIT
 *
 * Generated from SQL files by: bun run script/generate-migrations.ts
 * Source files: src/migrations/*.sql
 */

import type { D1Database } from "../session/d1-adapter.js"

// Migration state cache (per-isolate)
let migrationState: "pending" | "running" | "complete" = "pending"
let migrationPromise: Promise<void> | null = null

export interface Migration {
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    name: "001_oauth_clients",
    sql: `-- Migration 001: Base OAuth Clients Table
-- Creates the oauth_clients table for storing OAuth 2.0 client credentials
-- This is the foundation table that other migrations will extend
--
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/001_oauth_clients.sql

-- Enable foreign keys (D1/SQLite specific)
PRAGMA foreign_keys = ON;

-- OAuth Clients table
-- Stores OAuth 2.0 client registrations for both confidential and public clients
CREATE TABLE IF NOT EXISTS oauth_clients (
    -- Primary identifier for the OAuth client
    client_id TEXT PRIMARY KEY,

    -- Hash of the client secret for confidential clients
    -- NULL for public clients (SPAs, mobile apps) that cannot securely store secrets
    client_secret_hash TEXT,

    -- Human-readable name for the client application
    client_name TEXT NOT NULL,

    -- JSON array of allowed redirect URIs
    -- Example: ["https://app.example.com/callback", "http://localhost:3000/callback"]
    redirect_uris TEXT,

    -- JSON array of allowed OAuth grant types
    -- Example: ["authorization_code", "refresh_token", "client_credentials"]
    grant_types TEXT,

    -- JSON array of allowed OAuth scopes
    -- Example: ["openid", "profile", "email"]
    scopes TEXT,

    -- Timestamps as Unix epoch milliseconds
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Index for client lookup by name (admin UI searches)
CREATE INDEX IF NOT EXISTS idx_oauth_clients_name ON oauth_clients(client_name);

-- Index for listing clients sorted by creation time
CREATE INDEX IF NOT EXISTS idx_oauth_clients_created ON oauth_clients(created_at);
`,
  },
  {
    name: "002_add_tenant_support",
    sql: `-- Migration 002: Tenant Support
-- Adds multi-tenancy support with tenant management and oauth_clients extension
-- Tenants represent isolated organizations/customers in a multi-tenant SaaS setup
--
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/002_add_tenant_support.sql

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================
-- TENANTS TABLE
-- ============================================

-- Tenants table - represents isolated organizations/customers
CREATE TABLE IF NOT EXISTS tenants (
    -- Unique tenant identifier (e.g., 'acme-corp', 'tenant_abc123')
    id TEXT PRIMARY KEY,

    -- Custom domain for this tenant (e.g., 'auth.acme.com')
    -- Used for domain-based tenant resolution
    domain TEXT UNIQUE,

    -- Human-readable tenant name
    name TEXT NOT NULL,

    -- Tenant lifecycle status
    -- active: Normal operation
    -- suspended: Temporarily disabled (billing issues, policy violation)
    -- pending: Awaiting setup completion or approval
    -- deleted: Soft-deleted, awaiting cleanup
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'suspended', 'pending', 'deleted')),

    -- JSON object containing branding configuration
    -- Structure: { theme: {...}, logoLight: string, logoDark: string, favicon: string, customCss: string, emailTemplates: {...} }
    branding TEXT,

    -- JSON object containing tenant-specific settings
    -- Structure: { maxAccountsPerSession: number, sessionLifetime: number, allowPublicRegistration: boolean, ... }
    settings TEXT,

    -- Timestamps as Unix epoch milliseconds
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Index for domain-based tenant lookup (request routing)
CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain);

-- Index for filtering tenants by status (admin operations)
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- Index for listing tenants sorted by creation
CREATE INDEX IF NOT EXISTS idx_tenants_created ON tenants(created_at);

-- ============================================
-- OAUTH CLIENTS TENANT EXTENSION
-- ============================================

-- SQLite does not support ADD COLUMN IF NOT EXISTS, so we use a workaround
-- This approach checks if the column exists before adding it

-- Create a temporary table to check column existence
-- If this fails, the column already exists

-- Add tenant_id column to oauth_clients
-- Default 'default' ensures backward compatibility with existing clients
-- Note: SQLite ALTER TABLE is limited - we cannot add constraints to existing columns
ALTER TABLE oauth_clients ADD COLUMN tenant_id TEXT DEFAULT 'default';

-- Index for filtering clients by tenant (tenant admin operations)
CREATE INDEX IF NOT EXISTS idx_oauth_clients_tenant ON oauth_clients(tenant_id);

-- ============================================
-- DEFAULT TENANT SEED (OPTIONAL)
-- ============================================

-- Insert a default tenant for single-tenant deployments or migrations
-- Uses INSERT OR IGNORE to be idempotent
INSERT OR IGNORE INTO tenants (id, name, status, branding, settings, created_at, updated_at)
VALUES (
    'default',
    'Default Tenant',
    'active',
    '{}',
    '{}',
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);
`,
  },
  {
    name: "003_session_management",
    sql: `-- Migration 003: Session Management Tables
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
`,
  },
  {
    name: "004_rbac_schema",
    sql: `-- Migration 004: Role-Based Access Control (RBAC) Schema
-- Implements a complete RBAC system with apps, roles, permissions, and assignments
-- Supports multi-tenant RBAC with time-limited role assignments
--
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/004_rbac_schema.sql

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================
-- RBAC APPS TABLE
-- ============================================

-- RBAC Apps - applications that define their own permission sets
-- Each app has its own namespace for permissions
CREATE TABLE IF NOT EXISTS rbac_apps (
    -- Unique app identifier
    id TEXT PRIMARY KEY,

    -- Human-readable app name
    name TEXT NOT NULL,

    -- Tenant this app belongs to
    tenant_id TEXT NOT NULL,

    -- Optional description of the application
    description TEXT,

    -- When the app was registered (Unix epoch milliseconds)
    created_at INTEGER NOT NULL,

    -- Foreign key to tenants
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Index for listing apps by tenant
CREATE INDEX IF NOT EXISTS idx_rbac_apps_tenant ON rbac_apps(tenant_id);

-- Unique constraint: app names must be unique within a tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_rbac_apps_name_tenant ON rbac_apps(name, tenant_id);

-- ============================================
-- RBAC ROLES TABLE
-- ============================================

-- RBAC Roles - named collections of permissions
-- Can be system roles (immutable) or custom roles (user-defined)
CREATE TABLE IF NOT EXISTS rbac_roles (
    -- Unique role identifier
    id TEXT PRIMARY KEY,

    -- Human-readable role name (e.g., 'admin', 'editor', 'viewer')
    name TEXT NOT NULL,

    -- Tenant this role belongs to
    tenant_id TEXT NOT NULL,

    -- Optional description of the role's purpose
    description TEXT,

    -- Whether this is a system-defined role (cannot be modified/deleted)
    -- 1 = system role, 0 = custom role
    is_system_role INTEGER NOT NULL DEFAULT 0,

    -- Timestamps (Unix epoch milliseconds)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    -- Foreign key to tenants
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Unique constraint: role names must be unique within a tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_rbac_roles_name_tenant ON rbac_roles(name, tenant_id);

-- Index for listing roles by tenant
CREATE INDEX IF NOT EXISTS idx_rbac_roles_tenant ON rbac_roles(tenant_id);

-- Index for filtering system vs custom roles
CREATE INDEX IF NOT EXISTS idx_rbac_roles_system ON rbac_roles(is_system_role);

-- ============================================
-- RBAC PERMISSIONS TABLE
-- ============================================

-- RBAC Permissions - granular access controls
-- Each permission defines access to a specific resource + action combination
CREATE TABLE IF NOT EXISTS rbac_permissions (
    -- Unique permission identifier
    id TEXT PRIMARY KEY,

    -- Human-readable permission name (e.g., 'documents:read', 'users:delete')
    name TEXT NOT NULL,

    -- App this permission belongs to
    app_id TEXT NOT NULL,

    -- Optional description of what this permission allows
    description TEXT,

    -- Resource being protected (e.g., 'documents', 'users', 'settings')
    resource TEXT NOT NULL,

    -- Action being permitted (e.g., 'read', 'write', 'delete', 'admin')
    action TEXT NOT NULL,

    -- When the permission was created (Unix epoch milliseconds)
    created_at INTEGER NOT NULL,

    -- Foreign key to apps
    FOREIGN KEY (app_id) REFERENCES rbac_apps(id) ON DELETE CASCADE
);

-- Unique constraint: permission names must be unique within an app
CREATE UNIQUE INDEX IF NOT EXISTS idx_rbac_permissions_name_app ON rbac_permissions(name, app_id);

-- Index for listing permissions by app
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_app ON rbac_permissions(app_id);

-- Index for querying permissions by resource
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_resource ON rbac_permissions(resource);

-- Composite index for resource + action lookups
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_resource_action ON rbac_permissions(resource, action);

-- ============================================
-- RBAC ROLE-PERMISSION MAPPING TABLE
-- ============================================

-- Role-Permission assignments - maps permissions to roles
-- A role can have many permissions, a permission can be in many roles
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
    -- Role receiving the permission
    role_id TEXT NOT NULL,

    -- Permission being granted
    permission_id TEXT NOT NULL,

    -- When this assignment was made (Unix epoch milliseconds)
    granted_at INTEGER NOT NULL,

    -- User/system that made this assignment
    granted_by TEXT NOT NULL,

    -- Composite primary key
    PRIMARY KEY (role_id, permission_id),

    -- Foreign keys
    FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES rbac_permissions(id) ON DELETE CASCADE
);

-- Index for listing permissions by role
CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_role ON rbac_role_permissions(role_id);

-- Index for finding roles that have a specific permission
CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_permission ON rbac_role_permissions(permission_id);

-- ============================================
-- RBAC USER-ROLE MAPPING TABLE
-- ============================================

-- User-Role assignments - maps roles to users within a tenant
-- Supports optional expiration for time-limited access
CREATE TABLE IF NOT EXISTS rbac_user_roles (
    -- User receiving the role
    user_id TEXT NOT NULL,

    -- Role being assigned
    role_id TEXT NOT NULL,

    -- Tenant context for this assignment
    -- A user can have different roles in different tenants
    tenant_id TEXT NOT NULL,

    -- When this assignment was made (Unix epoch milliseconds)
    assigned_at INTEGER NOT NULL,

    -- Optional expiration time (NULL = never expires)
    -- Unix epoch milliseconds
    expires_at INTEGER,

    -- User/system that made this assignment
    assigned_by TEXT NOT NULL,

    -- Composite primary key (user can have same role in different tenants)
    PRIMARY KEY (user_id, role_id, tenant_id),

    -- Foreign keys
    FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Index for listing roles by user within a tenant (primary access pattern)
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_user ON rbac_user_roles(user_id, tenant_id);

-- Index for listing users by role
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_role ON rbac_user_roles(role_id);

-- Index for finding expired role assignments
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_expires ON rbac_user_roles(expires_at);

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_tenant ON rbac_user_roles(tenant_id);

-- ============================================
-- RBAC PERMISSION CHECK VIEW
-- ============================================

-- View for efficient permission checks
-- Joins user -> roles -> permissions for a given tenant
CREATE VIEW IF NOT EXISTS user_permissions AS
SELECT DISTINCT
    ur.user_id,
    ur.tenant_id,
    p.app_id,
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

-- ============================================
-- SYSTEM ROLES SEED (OPTIONAL)
-- ============================================

-- Insert system roles for the default tenant
-- These are common roles that most applications need

-- Super Admin role (full access)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_super_admin_default',
    'super_admin',
    'default',
    'Full administrative access to all resources',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Admin role (tenant administration)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_admin_default',
    'admin',
    'default',
    'Tenant administrative access',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Member role (standard user access)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_member_default',
    'member',
    'default',
    'Standard member access',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Viewer role (read-only access)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_viewer_default',
    'viewer',
    'default',
    'Read-only access to resources',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);
`,
  },
]

// Add migration tracking table
const TRACKING_SQL = `
CREATE TABLE IF NOT EXISTS _openauth_migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`

/**
 * Run all migrations that haven't been applied yet.
 */
export async function ensureMigrations(
  db: D1Database,
  options: { verbose?: boolean; force?: boolean } = {},
): Promise<{ applied: string[]; skipped: string[] }> {
  const { verbose = false, force = false } = options
  const log = verbose ? console.log : () => {}
  const result = { applied: [] as string[], skipped: [] as string[] }

  // Ensure tracking table exists
  try {
    await db.exec(TRACKING_SQL)
  } catch {}

  for (const migration of MIGRATIONS) {
    // Check if already applied
    if (!force) {
      try {
        const check = await db
          .prepare("SELECT 1 FROM _openauth_migrations WHERE name = ?")
          .bind(migration.name)
          .first()
        if (check) {
          result.skipped.push(migration.name)
          continue
        }
      } catch {}
    }

    log(`[migrations] Applying ${migration.name}...`)

    try {
      await db.exec(migration.sql)
      await db
        .prepare("INSERT OR REPLACE INTO _openauth_migrations (name, applied_at) VALUES (?, ?)")
        .bind(migration.name, Date.now())
        .run()
      result.applied.push(migration.name)
      log(`[migrations] Applied ${migration.name}`)
    } catch (error) {
      log(`[migrations] Warning: ${error}`)
    }
  }

  return result
}

/**
 * Run migrations once per worker isolate.
 */
export async function ensureMigrationsOnce(db: D1Database): Promise<void> {
  if (migrationState === "complete") return

  if (migrationState === "running" && migrationPromise) {
    await migrationPromise
    return
  }

  migrationState = "running"
  migrationPromise = ensureMigrations(db)
    .then(() => { migrationState = "complete" })
    .catch((e) => { migrationState = "pending"; throw e })

  await migrationPromise
}

export function resetMigrationState(): void {
  migrationState = "pending"
  migrationPromise = null
}

export async function getAppliedMigrations(db: D1Database): Promise<string[]> {
  try {
    const { results } = await db
      .prepare("SELECT name FROM _openauth_migrations ORDER BY applied_at")
      .all<{ name: string }>()
    return (results || []).map((r) => r.name)
  } catch {
    return []
  }
}

/**
 * Database Migrations for OpenAuth Enterprise Features
 *
 * This module provides SQL migrations and utilities for setting up the
 * database schema required by OpenAuth enterprise features.
 *
 * ## Quick Start
 *
 * ```ts
 * import { runMigrations } from "@openauthjs/openauth/migrations"
 *
 * // Run all migrations
 * await runMigrations(db)
 *
 * // Or run specific migrations
 * await runMigrations(db, { only: ["001_oauth_clients", "002_tenant_support"] })
 * ```
 *
 * ## Manual Migration
 *
 * If you prefer to run migrations manually or use a different tool:
 *
 * ```ts
 * import { MIGRATIONS } from "@openauthjs/openauth/migrations"
 *
 * for (const migration of MIGRATIONS) {
 *   console.log(`Running ${migration.name}...`)
 *   await db.exec(migration.sql)
 * }
 * ```
 *
 * @packageDocumentation
 */

import type { D1Database } from "../session/d1-adapter.js"

// ============================================
// Migration SQL Definitions
// ============================================

/**
 * Migration 001: OAuth Clients Table
 * Creates the base oauth_clients table for storing OAuth 2.0 client credentials.
 */
export const MIGRATION_001_OAUTH_CLIENTS = `
-- Migration 001: Base OAuth Clients Table
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret_hash TEXT,
    client_name TEXT NOT NULL,
    redirect_uris TEXT,
    grant_types TEXT,
    scopes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_name ON oauth_clients(client_name);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_created ON oauth_clients(created_at);
`

/**
 * Migration 002: Tenant Support
 * Adds multi-tenancy support with tenant management and oauth_clients extension.
 */
export const MIGRATION_002_TENANT_SUPPORT = `
-- Migration 002: Tenant Support
PRAGMA foreign_keys = ON;

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

-- Add tenant_id to oauth_clients (may fail if already exists)
-- We handle this error gracefully in the runner

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
`

/**
 * Migration 003: Session Management
 * Adds browser sessions and account sessions for multi-account support.
 */
export const MIGRATION_003_SESSION_MANAGEMENT = `
-- Migration 003: Session Management Tables
PRAGMA foreign_keys = ON;

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
`

/**
 * Migration 004: RBAC Schema
 * Implements role-based access control with apps, roles, permissions, and assignments.
 */
export const MIGRATION_004_RBAC_SCHEMA = `
-- Migration 004: RBAC Schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rbac_apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rbac_apps_tenant ON rbac_apps(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rbac_apps_name_tenant ON rbac_apps(name, tenant_id);

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

CREATE TABLE IF NOT EXISTS rbac_permissions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    app_id TEXT NOT NULL,
    description TEXT,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (app_id) REFERENCES rbac_apps(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rbac_permissions_name_app ON rbac_permissions(name, app_id);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_app ON rbac_permissions(app_id);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_resource ON rbac_permissions(resource);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_resource_action ON rbac_permissions(resource, action);

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

-- Seed system roles
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES
    ('role_super_admin_default', 'super_admin', 'default', 'Full administrative access', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
    ('role_admin_default', 'admin', 'default', 'Tenant administrative access', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
    ('role_member_default', 'member', 'default', 'Standard member access', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
    ('role_viewer_default', 'viewer', 'default', 'Read-only access', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
`

// ============================================
// Migration Tracking Table
// ============================================

const MIGRATION_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS _openauth_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
`

// ============================================
// Migration Definitions
// ============================================

export interface Migration {
  /** Unique migration name (used for tracking) */
  name: string
  /** Migration SQL to execute */
  sql: string
  /** Optional description */
  description?: string
}

/**
 * All available migrations in order of execution.
 */
export const MIGRATIONS: Migration[] = [
  {
    name: "001_oauth_clients",
    sql: MIGRATION_001_OAUTH_CLIENTS,
    description: "Base OAuth clients table",
  },
  {
    name: "002_tenant_support",
    sql: MIGRATION_002_TENANT_SUPPORT,
    description: "Multi-tenancy support",
  },
  {
    name: "003_session_management",
    sql: MIGRATION_003_SESSION_MANAGEMENT,
    description: "Session management tables",
  },
  {
    name: "004_rbac_schema",
    sql: MIGRATION_004_RBAC_SCHEMA,
    description: "Role-based access control",
  },
]

// ============================================
// Migration Runner
// ============================================

export interface RunMigrationsOptions {
  /** Only run specific migrations by name */
  only?: string[]
  /** Skip specific migrations by name */
  skip?: string[]
  /** Force re-run migrations even if already applied */
  force?: boolean
  /** Log progress to console */
  verbose?: boolean
}

export interface MigrationResult {
  /** Migrations that were applied */
  applied: string[]
  /** Migrations that were skipped (already applied) */
  skipped: string[]
  /** Migrations that failed */
  failed: Array<{ name: string; error: string }>
}

/**
 * Run database migrations.
 *
 * @param db - D1 database instance
 * @param options - Migration options
 * @returns Result of migration run
 *
 * @example
 * ```ts
 * // Run all migrations
 * const result = await runMigrations(db)
 * console.log(`Applied: ${result.applied.length}, Skipped: ${result.skipped.length}`)
 *
 * // Run specific migrations
 * await runMigrations(db, { only: ["001_oauth_clients"] })
 *
 * // Force re-run
 * await runMigrations(db, { force: true })
 * ```
 */
export async function runMigrations(
  db: D1Database,
  options: RunMigrationsOptions = {},
): Promise<MigrationResult> {
  const { only, skip, force = false, verbose = false } = options

  const result: MigrationResult = {
    applied: [],
    skipped: [],
    failed: [],
  }

  const log = verbose ? console.log : () => {}

  // Ensure migration tracking table exists
  try {
    await db.exec(MIGRATION_TRACKING_TABLE)
  } catch (error) {
    // Table might already exist
  }

  // Get already applied migrations
  const appliedMigrations = new Set<string>()
  if (!force) {
    try {
      const { results } = await db
        .prepare("SELECT name FROM _openauth_migrations")
        .all<{ name: string }>()
      for (const row of results || []) {
        appliedMigrations.add(row.name)
      }
    } catch {
      // Table might not exist yet
    }
  }

  // Filter migrations to run
  let migrationsToRun = MIGRATIONS
  if (only && only.length > 0) {
    migrationsToRun = MIGRATIONS.filter((m) => only.includes(m.name))
  }
  if (skip && skip.length > 0) {
    migrationsToRun = migrationsToRun.filter((m) => !skip.includes(m.name))
  }

  // Run migrations
  for (const migration of migrationsToRun) {
    if (!force && appliedMigrations.has(migration.name)) {
      log(`[migrations] Skipping ${migration.name} (already applied)`)
      result.skipped.push(migration.name)
      continue
    }

    log(`[migrations] Applying ${migration.name}...`)

    try {
      // Split SQL into statements and execute each
      // D1 exec() can handle multiple statements
      await db.exec(migration.sql)

      // Record migration as applied
      await db
        .prepare(
          "INSERT OR REPLACE INTO _openauth_migrations (name, applied_at) VALUES (?, ?)",
        )
        .bind(migration.name, Date.now())
        .run()

      log(`[migrations] Applied ${migration.name}`)
      result.applied.push(migration.name)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      log(`[migrations] Failed ${migration.name}: ${errorMessage}`)
      result.failed.push({ name: migration.name, error: errorMessage })
    }
  }

  return result
}

/**
 * Check which migrations have been applied.
 *
 * @param db - D1 database instance
 * @returns List of applied migration names
 */
export async function getAppliedMigrations(db: D1Database): Promise<string[]> {
  try {
    const { results } = await db
      .prepare(
        "SELECT name FROM _openauth_migrations ORDER BY applied_at ASC",
      )
      .all<{ name: string }>()
    return (results || []).map((r) => r.name)
  } catch {
    return []
  }
}

/**
 * Check which migrations are pending (not yet applied).
 *
 * @param db - D1 database instance
 * @returns List of pending migration names
 */
export async function getPendingMigrations(db: D1Database): Promise<string[]> {
  const applied = new Set(await getAppliedMigrations(db))
  return MIGRATIONS.filter((m) => !applied.has(m.name)).map((m) => m.name)
}

/**
 * Reset all migrations (drop tracking table).
 * WARNING: This does not drop the actual tables, only the tracking.
 *
 * @param db - D1 database instance
 */
export async function resetMigrationTracking(db: D1Database): Promise<void> {
  await db.exec("DROP TABLE IF EXISTS _openauth_migrations")
}

-- Migration 004: Role-Based Access Control (RBAC) Schema
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

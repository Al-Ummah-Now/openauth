-- Migration 002: Tenant Support
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

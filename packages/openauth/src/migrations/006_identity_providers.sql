-- Migration 006: Dynamic Identity Providers
-- Enables database-driven identity provider configuration for multi-tenant OAuth/OIDC
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/006_identity_providers.sql

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================
-- IDENTITY PROVIDERS TABLE
-- ============================================

-- Dynamic identity provider configuration per tenant
-- Stores OAuth/OIDC provider credentials and settings
CREATE TABLE IF NOT EXISTS identity_providers (
    -- Unique provider identifier (UUID)
    id TEXT PRIMARY KEY,

    -- Tenant this provider belongs to
    tenant_id TEXT NOT NULL,

    -- Provider type (google, github, facebook, microsoft, oidc, etc.)
    type TEXT NOT NULL,

    -- Unique name within the tenant (used in URLs like /auth/{name}/authorize)
    name TEXT NOT NULL,

    -- Human-readable display name (shown on login buttons)
    display_name TEXT NOT NULL,

    -- OAuth client ID
    client_id TEXT,

    -- AES-256-GCM encrypted client secret (ciphertext.tag format)
    client_secret_encrypted TEXT,

    -- Initialization vector for AES-256-GCM (base64 encoded, 12 bytes)
    client_secret_iv TEXT,

    -- Provider-specific configuration as JSON
    -- Contains: scopes, endpoints, query params, etc.
    config TEXT DEFAULT '{}',

    -- Whether this provider is active (1 = enabled, 0 = disabled)
    enabled INTEGER DEFAULT 1,

    -- Display order for UI (lower = first)
    display_order INTEGER DEFAULT 0,

    -- Timestamps (Unix epoch milliseconds)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    -- Unique constraint: provider names must be unique within a tenant
    UNIQUE(tenant_id, name),

    -- Foreign key to tenants table
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- ============================================
-- INDEXES
-- ============================================

-- Index for listing providers by tenant (primary access pattern)
CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant
    ON identity_providers(tenant_id);

-- Index for listing enabled providers by tenant (login page)
CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant_enabled
    ON identity_providers(tenant_id, enabled);

-- Index for filtering providers by type (analytics, migration)
CREATE INDEX IF NOT EXISTS idx_identity_providers_type
    ON identity_providers(type);

-- Composite index for ordered listing by tenant
CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant_order
    ON identity_providers(tenant_id, display_order, name);
